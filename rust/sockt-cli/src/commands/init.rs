use std::path::PathBuf;

use anyhow::Context;

use crate::cli::{InitArgs, Tier};
use crate::compose::ComposeGenerator;
use crate::config::loader::ConfigLoader;
use crate::config::{EncryptedValue, GBrainConfig, ModelConfig, SlackConfig, SocktConfig};
use crate::crypto::{self, KeyManager};
use crate::gbrain::{GBrainScaffolder, OnboardingAnswers};
use crate::tui::wizard::WizardState;

struct SlackTokens {
    app_token: String,
    bot_token: String,
    signing_secret: String,
}

struct ModelInfo {
    api_key: String,
    frontier: String,
    fast: String,
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
        collect_interactive(&args)?
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
        api_key: String::new(),
        frontier: "claude-sonnet-4-20250514".to_string(),
        fast: "claude-haiku-4-20250514".to_string(),
    };
    (tier, slack_tokens, model_info, OnboardingAnswers::default())
}

fn collect_interactive(
    args: &InitArgs,
) -> anyhow::Result<(Tier, SlackTokens, ModelInfo, OnboardingAnswers)> {
    println!();
    println!("  Welcome to Sockt \u{2014} AI departments that never bankrupt you or embarrass you.");
    println!();

    let mut state = WizardState::default();

    // Step 1: Tier
    if let Some(tier) = &args.tier {
        state.tier = Some(tier.clone());
    } else {
        let items = vec!["local", "cloud", "enterprise"];
        let selection = dialoguer::Select::new()
            .with_prompt("  Deployment tier")
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

    // Step 2: Slack credentials
    loop {
        state.slack_app_token = dialoguer::Password::new()
            .with_prompt("  Slack App Token (xapp-...)")
            .allow_empty_password(true)
            .interact()
            .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

        state.slack_bot_token = dialoguer::Password::new()
            .with_prompt("  Slack Bot Token (xoxb-...)")
            .allow_empty_password(true)
            .interact()
            .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

        state.slack_signing_secret = dialoguer::Password::new()
            .with_prompt("  Slack Signing Secret")
            .allow_empty_password(true)
            .interact()
            .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

        match state.advance() {
            Ok(()) => break,
            Err(e) => {
                println!("  Error: {e}. Please try again.");
                println!();
            }
        }
    }

    // Step 3: Model provider
    loop {
        state.model_api_key = dialoguer::Password::new()
            .with_prompt("  LLM API key")
            .allow_empty_password(true)
            .interact()
            .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

        state.model_frontier = dialoguer::Input::new()
            .with_prompt("  Frontier model")
            .default("claude-sonnet-4-20250514".to_string())
            .interact()
            .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

        state.model_fast = dialoguer::Input::new()
            .with_prompt("  Fast model")
            .default("claude-haiku-4-20250514".to_string())
            .interact()
            .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

        match state.advance() {
            Ok(()) => break,
            Err(e) => {
                println!("  Error: {e}. Please try again.");
                println!();
            }
        }
    }

    // Step 4: Company info
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
                println!("  Error: {e}. Please try again.");
                println!();
            }
        }
    }

    // Step 5: Review
    println!();
    println!("  --- Review ---");
    println!("  Tier:             {:?}", state.tier.as_ref().unwrap());
    println!("  Company:          {}", state.company_name);
    println!("  Industry:         {}", state.industry);
    println!("  Frontier model:   {}", state.model_frontier);
    println!("  Fast model:       {}", state.model_fast);
    println!("  Tools:            {}", state.tools_used.join(", "));
    println!("  Tone:             {}", state.tone);
    println!("  Approval:         {}", state.approval_threshold);
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
        api_key: state.model_api_key.clone(),
        frontier: state.model_frontier.clone(),
        fast: state.model_fast.clone(),
    };
    let answers = state
        .into_answers()
        .map_err(|e| anyhow::anyhow!("Wizard incomplete: {e}"))?;

    Ok((tier, slack_tokens, model_info, answers))
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
    let bot_token = crypto::encrypt(&tokens.bot_token, recipient)
        .context("Encrypting Slack bot token")?;
    let signing_secret = crypto::encrypt(&tokens.signing_secret, recipient)
        .context("Encrypting Slack signing secret")?;

    Ok(SlackConfig {
        app_token,
        bot_token,
        signing_secret,
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
        frontier: info.frontier.clone(),
        fast: info.fast.clone(),
        api_key,
    })
}
