use std::path::PathBuf;

use anyhow::Context;

use crate::cli::{InitArgs, Tier};
use crate::compose::ComposeGenerator;
use crate::config::loader::ConfigLoader;
use crate::config::{
    EncryptedValue, GBrainConfig, ModelConfig, ModelProvider, SlackConfig, SocktConfig,
};
use crate::crypto::{self, KeyManager};
use crate::gbrain::GBrainScaffolder;
use crate::tui::llm_verify;
use crate::tui::password_input::PasswordInput;

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

    if config_loader.path().exists() && !args.force {
        if args.non_interactive {
            anyhow::bail!(
                "Config already exists at {}. Use --force to overwrite.",
                config_loader.path().display()
            );
        }
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

    let model_info = if args.non_interactive {
        collect_non_interactive(&args)?
    } else {
        collect_interactive(&args).await?
    };

    let key_manager = KeyManager::new(KeyManager::default_path());
    let identity = key_manager
        .generate()
        .context("Failed to generate encryption key")?;
    let recipient = identity.to_public();

    let model_config = build_model_config(&model_info, &recipient)?;

    let gbrain_dir = dir.join("gbrain");
    let config = SocktConfig {
        tier: Tier::Local, // Hardcoded to local
        deployment_id: uuid::Uuid::new_v4().to_string(),
        slack: SlackConfig::default(), // Empty Slack config, filled by `sockt setup slack`
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

    GBrainScaffolder::scaffold_generic(&gbrain_dir).context("Failed to scaffold GBrain")?;

    config_loader
        .save(&config)
        .context("Failed to save config")?;

    println!();
    println!("  \u{2713} Config saved to {}", config_loader.path().display());
    println!("  \u{2713} Encryption key generated");
    println!("  \u{2713} GBrain scaffolded at {}/", gbrain_dir.display());
    println!("  \u{2713} Docker Compose generated");
    println!();
    println!("  Next steps:");
    println!("    sockt setup slack      Connect your Slack workspace");
    println!("    sockt setup company    Tell agents about your business");
    println!("    sockt up               Start your swarm");
    println!();

    Ok(())
}

fn collect_non_interactive(args: &InitArgs) -> anyhow::Result<ModelInfo> {
    let provider_str = args
        .provider
        .clone()
        .or_else(|| std::env::var("SOCKT_PROVIDER").ok())
        .unwrap_or_else(|| "anthropic".to_string());

    let provider = match provider_str.to_lowercase().as_str() {
        "anthropic" => ModelProvider::Anthropic,
        "openai" => ModelProvider::Openai,
        "bedrock" => ModelProvider::Bedrock,
        "custom" => ModelProvider::Custom,
        _ => anyhow::bail!("Invalid provider: {}. Use: anthropic|openai|bedrock|custom", provider_str),
    };

    let api_key = args
        .api_key
        .clone()
        .or_else(|| std::env::var("SOCKT_API_KEY").ok())
        .unwrap_or_default();

    let base_url = args
        .base_url
        .clone()
        .or_else(|| std::env::var("SOCKT_BASE_URL").ok());

    // Require both frontier and fast to be explicitly provided
    let frontier = args
        .frontier
        .clone()
        .ok_or_else(|| anyhow::anyhow!("--frontier required in non-interactive mode"))?;

    let fast = args
        .fast
        .clone()
        .ok_or_else(|| anyhow::anyhow!("--fast required in non-interactive mode"))?;

    let aws_region = if provider == ModelProvider::Bedrock {
        Some(std::env::var("AWS_REGION").unwrap_or_else(|_| "us-east-1".to_string()))
    } else {
        None
    };

    Ok(ModelInfo {
        provider,
        api_key,
        frontier,
        fast,
        base_url,
        aws_region,
    })
}

async fn collect_interactive(args: &InitArgs) -> anyhow::Result<ModelInfo> {
    use crossterm::style::Stylize;

    println!();
    println!(
        "  {} {}",
        "\u{2728}".to_string(),
        "Welcome to Sockt \u{2014} deploy AI agent departments in minutes.".bold()
    );
    println!();

    // ─── Step 1 of 2: LLM Provider ───────────────────────────────────────
    llm_verify::print_header("Step 1 of 2: LLM Provider");
    println!();

    let mut provider: ModelProvider;
    let mut api_key: String;
    let mut frontier: String;
    let mut fast: String;
    let mut base_url: Option<String> = None;
    let mut aws_region: Option<String> = None;

    'llm_loop: loop {
        // Provider selection
        let provider_items = vec![
            "Anthropic (Claude) — recommended",
            "OpenAI (GPT)",
            "Amazon Bedrock",
            "Custom endpoint (Ollama, vLLM, OpenRouter, etc.)",
        ];
        let provider_idx = dialoguer::Select::new()
            .with_prompt("  Provider")
            .items(&provider_items)
            .default(0)
            .interact()
            .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

        provider = match provider_idx {
            0 => ModelProvider::Anthropic,
            1 => ModelProvider::Openai,
            2 => ModelProvider::Bedrock,
            _ => ModelProvider::Custom,
        };

        println!();

        // Credentials FIRST (based on provider)
        match provider {
            ModelProvider::Anthropic => {
                llm_verify::print_hint("Get your API key at https://console.anthropic.com/settings/keys");
                api_key = PasswordInput::new("  API key")
                    .interact()
                    .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

                if !api_key.is_empty() && !api_key.starts_with("sk-ant-") {
                    llm_verify::print_hint("Note: Anthropic API keys typically start with sk-ant-");
                }
            }
            ModelProvider::Openai => {
                llm_verify::print_hint("Get your API key at https://platform.openai.com/api-keys");
                api_key = PasswordInput::new("  API key")
                    .interact()
                    .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

                if !api_key.is_empty() && !api_key.starts_with("sk-") {
                    llm_verify::print_hint("Note: OpenAI API keys typically start with sk-");
                }
            }
            ModelProvider::Bedrock => {
                llm_verify::print_hint("Enter your AWS credentials for Bedrock access.");
                api_key = PasswordInput::new("  AWS Access Key: ")
                    .interact()
                    .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

                println!(); // Add blank line before region prompt for consistent spacing

                let region_input: String = dialoguer::Input::new()
                    .with_prompt("  AWS Region")
                    .default("us-east-1".to_string())
                    .interact()
                    .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;
                aws_region = Some(region_input);
            }
            ModelProvider::Custom => {
                llm_verify::print_hint("Enter the base URL of your OpenAI-compatible endpoint.");
                let url_input: String = dialoguer::Input::new()
                    .with_prompt("  Base URL")
                    .default("http://localhost:11434/v1".to_string())
                    .interact()
                    .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;
                base_url = Some(url_input);

                println!(); // Add blank line for consistent spacing

                api_key = PasswordInput::new("  API key (optional)")
                    .allow_empty(true)
                    .interact()
                    .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

                if api_key.is_empty() {
                    api_key = "none".to_string();
                    llm_verify::print_hint("Using no API key (endpoint requires no authentication)");
                }
            }
        }

        println!();

        // Frontier model - PROMPT USER
        frontier = select_model("Frontier model (complex tasks)", &provider, true)?;

        // Verify frontier immediately
        if !args.skip_verify {
            let frontier_result = llm_verify::verify_model_inline(
                &provider,
                &api_key,
                base_url.as_deref(),
                &frontier,
                aws_region.as_deref(),
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
        }

        // Fast model - PROMPT USER
        fast = select_model("Fast model (quick tasks)", &provider, false)?;

        // Verify fast immediately
        if !args.skip_verify {
            let fast_result = llm_verify::verify_model_inline(
                &provider,
                &api_key,
                base_url.as_deref(),
                &fast,
                aws_region.as_deref(),
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
        }

        break;
    }

    // ─── Step 2 of 2: Confirm ────────────────────────────────────────────
    println!();
    llm_verify::print_header("Step 2 of 2: Confirm");
    println!();
    println!("  {}  {:?}", "Provider:".bold(), provider);
    println!("  {}  {}", "Frontier:".bold(), frontier);
    println!("  {}      {}", "Fast:".bold(), fast);
    println!("  {} ./", "Directory:".bold());
    println!();

    let confirmed = dialoguer::Confirm::new()
        .with_prompt("  Initialize here?")
        .default(true)
        .interact()
        .map_err(|_| anyhow::anyhow!("Initialization cancelled."))?;

    if !confirmed {
        anyhow::bail!("Initialization cancelled.");
    }

    Ok(ModelInfo {
        provider,
        api_key,
        frontier,
        fast,
        base_url,
        aws_region,
    })
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
