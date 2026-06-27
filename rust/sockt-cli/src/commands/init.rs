use std::path::PathBuf;

use anyhow::Context;

use crate::cli::{InitArgs, Tier};
use crate::compose::ComposeGenerator;
use crate::config::loader::ConfigLoader;
use crate::config::{
    EncryptedValue, GBrainConfig, ModelConfig, ModelProvider, SlackConfig, SocktConfig,
};
use crate::crypto::{self, KeyManager};
use crate::gbrain::{GBrainScaffolder, OnboardingAnswers};
use crate::tui::llm_verify;
use crate::tui::password_input::PasswordInput;
use crate::tui::wizard::WizardState;

struct SlackTokens {
    app_token: String,
    bot_token: String,
    signing_secret: String,
}

struct ModelInfo {
    provider: ModelProvider,
    api_key: String,
    frontier: String,
    fast: String,
    base_url: Option<String>,
    aws_region: Option<String>,
}

pub async fn run(args: InitArgs, config_path: Option<PathBuf>) -> anyhow::Result<()> {
    let dir = args.dir.clone().unwrap_or_else(|| PathBuf::from("."));
    std::fs::create_dir_all(&dir).context("Failed to create target directory")?;
    let dir = std::fs::canonicalize(&dir).unwrap_or(dir);

    let config_loader = ConfigLoader::from_default_or_override(config_path);

    if config_loader.path().exists() && !args.non_interactive {
        let overwrite = dialoguer::Confirm::new()
            .with_prompt(format!(
                "Config already exists at {}. Overwrite?",
                config_loader.path().display()
            ))
            .default(false)
            .interact()
            .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;
        if !overwrite {
            println!("Initialization cancelled.");
            return Ok(());
        }
    }

    let (tier, slack_tokens, model_info, answers) = if args.non_interactive {
        collect_non_interactive(&args)
    } else {
        collect_interactive(&args).await?
    };

    let key_manager = KeyManager::new(KeyManager::default_path());
    let identity = key_manager
        .generate()
        .context("Failed to generate encryption key")?;
    let recipient = identity.to_public();

    let slack_config = encrypt_slack(&slack_tokens, &recipient)?;
    let model_config = build_model_config(&model_info, &recipient)?;

    let gbrain_dir = dir.join("gbrain");
    let config = SocktConfig {
        tier,
        deployment_id: uuid::Uuid::new_v4().to_string(),
        slack: slack_config,
        models: model_config,
        gbrain: GBrainConfig {
            directory: gbrain_dir.clone(),
            ..Default::default()
        },
        ..Default::default()
    };

    let compose_yaml = ComposeGenerator::new(&config)
        .generate()
        .context("Failed to generate docker-compose.yaml")?;
    std::fs::write(dir.join("docker-compose.yaml"), &compose_yaml)
        .context("Failed to write docker-compose.yaml")?;

    GBrainScaffolder::scaffold(&gbrain_dir, &answers).context("Failed to scaffold GBrain")?;

    config_loader
        .save(&config)
        .context("Failed to save config")?;

    println!();
    println!("  \u{2713} GBrain initialized at {}/", gbrain_dir.display());
    println!("  \u{2713} Docker config generated");
    println!(
        "  \u{2713} Config saved to {}",
        config_loader.path().display()
    );
    println!();
    println!("  Run `sockt up` to start your swarm.");
    println!();

    Ok(())
}

fn collect_non_interactive(args: &InitArgs) -> (Tier, SlackTokens, ModelInfo, OnboardingAnswers) {
    let tier = args.tier.clone().unwrap_or(Tier::Local);
    let slack_tokens = SlackTokens {
        app_token: String::new(),
        bot_token: String::new(),
        signing_secret: String::new(),
    };
    let model_info = ModelInfo {
        provider: ModelProvider::Anthropic,
        api_key: String::new(),
        frontier: "claude-sonnet-4-20250514".to_string(),
        fast: "claude-haiku-4-20250514".to_string(),
        base_url: None,
        aws_region: None,
    };
    (tier, slack_tokens, model_info, OnboardingAnswers::default())
}

async fn collect_interactive(
    args: &InitArgs,
) -> anyhow::Result<(Tier, SlackTokens, ModelInfo, OnboardingAnswers)> {
    use crossterm::style::Stylize;

    println!();
    println!(
        "  {} {}",
        "\u{2728}".to_string(),
        "Welcome to Sockt \u{2014} AI departments that never bankrupt you or embarrass you."
            .bold()
    );
    println!();

    let mut state = WizardState::default();

    // ─── Step 1: Tier ────────────────────────────────────────────────────
    llm_verify::print_header("Deployment Tier");
    println!();

    if let Some(tier) = &args.tier {
        state.tier = Some(tier.clone());
    } else {
        let items = vec![
            "local   — run everything on this machine",
            "cloud   — managed deployment",
            "enterprise — custom infrastructure",
        ];
        let selection = dialoguer::Select::new()
            .with_prompt("  Select tier")
            .items(&items)
            .default(0)
            .interact()
            .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;
        state.tier = Some(match selection {
            0 => Tier::Local,
            1 => Tier::Cloud,
            _ => Tier::Enterprise,
        });
    }
    state
        .advance()
        .map_err(|e| anyhow::anyhow!("Tier selection: {e}"))?;

    // ─── Step 2: LLM Configuration ──────────────────────────────────────
    println!();
    llm_verify::print_header("LLM Configuration");
    println!();
    llm_verify::print_hint("Configure the AI models that power your agents.");
    println!();

    'llm_loop: loop {
        // Provider selection
        let provider_items = vec![
            "Anthropic (Claude)",
            "OpenAI (GPT)",
            "Amazon Bedrock (AWS)",
            "Custom URL (OpenAI-compatible)",
        ];
        let provider_idx = dialoguer::Select::new()
            .with_prompt("  Provider")
            .items(&provider_items)
            .default(0)
            .interact()
            .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

        state.model_provider = Some(match provider_idx {
            0 => ModelProvider::Anthropic,
            1 => ModelProvider::Openai,
            2 => ModelProvider::Bedrock,
            _ => ModelProvider::Custom,
        });

        println!();

        // Credentials based on provider
        match state.model_provider.as_ref().unwrap() {
            ModelProvider::Anthropic => {
                llm_verify::print_hint("Get your API key at https://platform.claude.com/settings/keys");
                state.model_api_key = PasswordInput::new("  API key: ")
                    .interact()
                    .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

                if !state.model_api_key.is_empty() && !state.model_api_key.starts_with("sk-ant-") {
                    llm_verify::print_hint("Note: Anthropic API keys typically start with sk-ant-");
                }
            }
            ModelProvider::Openai => {
                llm_verify::print_hint("Get your API key at https://platform.openai.com/api-keys");
                state.model_api_key = PasswordInput::new("  API key: ")
                    .interact()
                    .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

                if !state.model_api_key.is_empty() && !state.model_api_key.starts_with("sk-") {
                    llm_verify::print_hint("Note: OpenAI API keys typically start with sk-");
                }
            }
            ModelProvider::Bedrock => {
                llm_verify::print_hint("Enter your API key and region for Bedrock access.");
                state.model_api_key = PasswordInput::new("  API key: ")
                    .interact()
                    .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

                state.aws_region = dialoguer::Input::new()
                    .with_prompt("  AWS Region")
                    .default("us-east-1".to_string())
                    .interact()
                    .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;
            }
            ModelProvider::Custom => {
                llm_verify::print_hint("Enter the base URL of your OpenAI-compatible endpoint.");
                state.model_base_url = dialoguer::Input::new()
                    .with_prompt("  Base URL")
                    .default("http://localhost:11434/v1".to_string())
                    .interact()
                    .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;
                state.model_api_key = PasswordInput::new("  API key: ")
                    .allow_empty(true)
                    .interact()
                    .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

                if state.model_api_key.is_empty() {
                    state.model_api_key = "none".to_string();
                    llm_verify::print_hint("Using no API key (endpoint requires no authentication)");
                }
            }
        }

        println!();

        // Frontier model selection + inline verify
        let provider = state.model_provider.as_ref().unwrap().clone();
        let base_url = if state.model_base_url.is_empty() {
            None
        } else {
            Some(state.model_base_url.as_str())
        };
        let aws_region = if state.model_provider == Some(ModelProvider::Bedrock) {
            Some(state.aws_region.as_str())
        } else {
            None
        };

        state.model_frontier = select_model(
            "Frontier model (complex tasks)",
            &provider,
            true,
        )?;

        let frontier_result = llm_verify::verify_model_inline(
            &provider,
            &state.model_api_key,
            base_url,
            &state.model_frontier,
            aws_region,
        )
        .await;

        if frontier_result.is_err() {
            println!();
            let retry_items = vec!["Re-enter credentials", "Skip and continue"];
            let action = dialoguer::Select::new()
                .with_prompt("  What would you like to do?")
                .items(&retry_items)
                .default(0)
                .interact()
                .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

            if action == 0 {
                println!();
                continue 'llm_loop;
            }
        }

        // Fast model selection + inline verify
        state.model_fast = select_model(
            "Fast model (quick tasks)",
            &provider,
            false,
        )?;

        let fast_result = llm_verify::verify_model_inline(
            &provider,
            &state.model_api_key,
            base_url,
            &state.model_fast,
            aws_region,
        )
        .await;

        if fast_result.is_err() {
            println!();
            let retry_items = vec!["Re-enter credentials", "Skip and continue"];
            let action = dialoguer::Select::new()
                .with_prompt("  What would you like to do?")
                .items(&retry_items)
                .default(0)
                .interact()
                .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

            if action == 0 {
                println!();
                continue 'llm_loop;
            }
        }

        state.model_verified = frontier_result.is_ok() && fast_result.is_ok();

        match state.advance() {
            Ok(()) => break,
            Err(e) => {
                println!();
                llm_verify::print_error(&format!("{e}. Please try again."));
                println!();
            }
        }
    }

    // ─── Step 3: Slack credentials ───────────────────────────────────────
    println!();
    llm_verify::print_header("Slack Integration");
    println!();

    let has_app = dialoguer::Confirm::new()
        .with_prompt("  Do you already have a Slack app configured for Sockt?")
        .default(false)
        .interact()
        .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

    if !has_app {
        println!();
        llm_verify::print_hint(
            "Let's create your Slack app using a pre-configured manifest.",
        );
        llm_verify::print_hint(
            "This sets up Socket Mode, event subscriptions, and bot scopes automatically.",
        );
        println!();

        let open_browser = dialoguer::Confirm::new()
            .with_prompt("  Open Slack app creation page in your browser?")
            .default(true)
            .interact()
            .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

        if open_browser {
            println!();
            println!("  Opening Slack...");
            llm_verify::print_hint(
                "Select your workspace and click 'Create' to provision the app.",
            );
            println!();
            super::slack_setup::open_creation_page();
        } else {
            println!();
            println!("  To create manually:");
            println!("  1. Go to https://api.slack.com/apps");
            println!("  2. Click 'Create New App' > 'From an app manifest'");
            println!("  3. Select your workspace");
            println!("  4. Switch to YAML and paste the following manifest:");
            println!();
            for line in super::slack_setup::SLACK_MANIFEST.lines() {
                println!("     {}", line);
            }
            println!();
        }

        super::slack_setup::print_token_instructions();
    }

    loop {
        state.slack_app_token = PasswordInput::new("  Slack App Token (xapp-...): ")
            .allow_empty(true)
            .interact()
            .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

        if !state.slack_app_token.is_empty() && !state.slack_app_token.starts_with("xapp-") {
            llm_verify::print_hint("Note: Slack App Tokens typically start with xapp-");
        }

        state.slack_signing_secret = PasswordInput::new("  Slack Signing Secret: ")
            .allow_empty(true)
            .interact()
            .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

        state.slack_bot_token = PasswordInput::new("  Slack Bot Token (xoxb-...): ")
            .allow_empty(true)
            .interact()
            .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

        if !state.slack_bot_token.is_empty() && !state.slack_bot_token.starts_with("xoxb-") {
            llm_verify::print_hint("Note: Slack Bot Tokens typically start with xoxb-");
        }

        match state.advance() {
            Ok(()) => break,
            Err(e) => {
                llm_verify::print_error(&format!("{e}. Please try again."));
                println!();
            }
        }
    }

    // ─── Step 4: Company info ────────────────────────────────────────────
    println!();
    llm_verify::print_header("Company & Preferences");
    println!();

    loop {
        state.company_name = dialoguer::Input::new()
            .with_prompt("  Company name")
            .interact()
            .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

        state.industry = dialoguer::Input::new()
            .with_prompt("  Industry")
            .default("Technology".to_string())
            .interact()
            .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

        state.team_size = dialoguer::Input::new()
            .with_prompt("  Team size")
            .default("1-10".to_string())
            .interact()
            .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

        state.primary_use_case = dialoguer::Input::new()
            .with_prompt("  Primary use case")
            .default("General automation".to_string())
            .interact()
            .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

        let tool_options = vec!["Slack", "GitHub", "Linear", "HubSpot", "Sentry", "PagerDuty"];
        let selected = dialoguer::MultiSelect::new()
            .with_prompt("  Tools & integrations (space to select)")
            .items(&tool_options)
            .defaults(&[true, false, false, false, false, false])
            .interact()
            .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;
        state.tools_used = selected
            .iter()
            .map(|&i| tool_options[i].to_string())
            .collect();

        let tone_options = vec!["professional", "casual", "friendly", "technical"];
        let tone_idx = dialoguer::Select::new()
            .with_prompt("  Communication tone")
            .items(&tone_options)
            .default(0)
            .interact()
            .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;
        state.tone = tone_options[tone_idx].to_string();

        let approval_options = vec!["conservative", "balanced", "permissive"];
        let approval_idx = dialoguer::Select::new()
            .with_prompt("  Approval threshold")
            .items(&approval_options)
            .default(1)
            .interact()
            .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;
        state.approval_threshold = approval_options[approval_idx].to_string();

        match state.advance() {
            Ok(()) => break,
            Err(e) => {
                llm_verify::print_error(&format!("{e}. Please try again."));
                println!();
            }
        }
    }

    // ─── Step 5: Review ──────────────────────────────────────────────────
    println!();
    llm_verify::print_header("Review");
    println!();
    println!(
        "  {}        {:?}",
        "Tier:".bold(),
        state.tier.as_ref().unwrap()
    );
    println!(
        "  {}    {}",
        "Provider:".bold(),
        state.model_provider.as_ref().unwrap()
    );
    println!("  {}    {}", "Frontier:".bold(), state.model_frontier);
    println!("  {}        {}", "Fast:".bold(), state.model_fast);
    if state.model_verified {
        println!("  {}    {}", "Verified:".bold(), "yes".green());
    } else {
        println!("  {}    {}", "Verified:".bold(), "no (skipped)".dark_grey());
    }
    println!("  {}     {}", "Company:".bold(), state.company_name);
    println!("  {}    {}", "Industry:".bold(), state.industry);
    println!(
        "  {}       {}",
        "Tools:".bold(),
        state.tools_used.join(", ")
    );
    println!("  {}        {}", "Tone:".bold(), state.tone);
    println!("  {}    {}", "Approval:".bold(), state.approval_threshold);
    println!();

    let confirmed = dialoguer::Confirm::new()
        .with_prompt("  Proceed with initialization?")
        .default(true)
        .interact()
        .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

    if !confirmed {
        anyhow::bail!("Initialization cancelled.");
    }

    let tier = state.tier.clone().unwrap();
    let slack_tokens = SlackTokens {
        app_token: state.slack_app_token.clone(),
        bot_token: state.slack_bot_token.clone(),
        signing_secret: state.slack_signing_secret.clone(),
    };
    let model_info = ModelInfo {
        provider: state.model_provider.clone().unwrap(),
        api_key: state.model_api_key.clone(),
        frontier: state.model_frontier.clone(),
        fast: state.model_fast.clone(),
        base_url: if state.model_base_url.is_empty() {
            None
        } else {
            Some(state.model_base_url.clone())
        },
        aws_region: if state.aws_region.is_empty() {
            None
        } else {
            Some(state.aws_region.clone())
        },
    };
    let answers = state
        .into_answers()
        .map_err(|e| anyhow::anyhow!("Wizard incomplete: {e}"))?;

    Ok((tier, slack_tokens, model_info, answers))
}

fn select_model(
    prompt: &str,
    _provider: &ModelProvider,
    _is_frontier: bool,
) -> anyhow::Result<String> {
    let model: String = dialoguer::Input::new()
        .with_prompt(format!("  {}", prompt))
        .interact()
        .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;
    Ok(model)
}

fn encrypt_slack(
    tokens: &SlackTokens,
    recipient: &age::x25519::Recipient,
) -> anyhow::Result<SlackConfig> {
    if tokens.app_token.is_empty() && tokens.bot_token.is_empty() {
        return Ok(SlackConfig::default());
    }

    let app_token = crypto::encrypt(&tokens.app_token, recipient)
        .context("Encrypting Slack app token")?;
    let signing_secret = crypto::encrypt(&tokens.signing_secret, recipient)
        .context("Encrypting Slack signing secret")?;
    let bot_token = crypto::encrypt(&tokens.bot_token, recipient)
        .context("Encrypting Slack bot token")?;

    Ok(SlackConfig {
        app_token,
        signing_secret,
        bot_token,
        socket_mode: true,
    })
}

fn build_model_config(
    info: &ModelInfo,
    recipient: &age::x25519::Recipient,
) -> anyhow::Result<ModelConfig> {
    let api_key = if info.api_key.is_empty() {
        EncryptedValue::default()
    } else {
        crypto::encrypt(&info.api_key, recipient).context("Encrypting API key")?
    };

    Ok(ModelConfig {
        provider: info.provider.clone(),
        frontier: info.frontier.clone(),
        fast: info.fast.clone(),
        api_key,
        base_url: info.base_url.clone(),
        aws_region: info.aws_region.clone(),
    })
}
