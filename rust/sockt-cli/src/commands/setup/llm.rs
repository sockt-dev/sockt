use std::path::PathBuf;

use anyhow::Context;

use crate::cli::SetupLlmArgs;
use crate::config::loader::ConfigLoader;
use crate::config::{ModelConfig, ModelProvider};
use crate::crypto::{self, KeyManager};
use crate::tui::llm_verify;
use crate::tui::password_input::PasswordInput;

pub async fn run(args: SetupLlmArgs, config_path: Option<PathBuf>) -> anyhow::Result<()> {
    let config_loader = ConfigLoader::from_default_or_override(config_path);

    if !config_loader.path().exists() {
        anyhow::bail!(
            "Config not found at {}. Run `sockt init` first.",
            config_loader.path().display()
        );
    }

    let mut config = config_loader
        .load()
        .context("Failed to load existing config")?;

    // In interactive mode, show current config
    if !args.non_interactive {
        println!();
        println!("  Current LLM configuration:");
        println!("    Provider:  {}", config.models.provider);
        println!("    Frontier:  {}", config.models.frontier);
        println!("    Fast:      {}", config.models.fast);
        println!();

        let reconfigure = dialoguer::Confirm::new()
            .with_prompt("  Reconfigure?")
            .default(true)
            .interact()
            .map_err(|_| anyhow::anyhow!("Setup cancelled."))?;

        if !reconfigure {
            println!();
            println!("  LLM configuration unchanged.");
            println!();
            return Ok(());
        }
    }

    let model_info = if args.non_interactive {
        collect_non_interactive(&args)?
    } else {
        collect_interactive(&args).await?
    };

    // Verify LLM connectivity unless skip_verify is set
    if !args.skip_verify {
        println!();
        println!("  Verifying LLM connectivity...");

        llm_verify::verify_model_inline(
            &model_info.provider,
            &model_info.api_key,
            model_info.base_url.as_deref(),
            &model_info.frontier,
            model_info.aws_region.as_deref(),
        )
        .await
        .map_err(|e| anyhow::anyhow!("LLM verification failed: {}", e))?;
    }

    // Load encryption key
    let key_manager = KeyManager::new(KeyManager::default_path());
    let identity = key_manager
        .load()
        .context("Failed to load encryption key. Run `sockt init` first.")?;
    let recipient = identity.to_public();

    // Encrypt API key
    let encrypted_api_key =
        crypto::encrypt(&model_info.api_key, &recipient).context("Encrypting API key")?;

    // Update config
    config.models = ModelConfig {
        provider: model_info.provider,
        frontier: model_info.frontier,
        fast: model_info.fast,
        api_key: encrypted_api_key,
        base_url: model_info.base_url,
        aws_region: model_info.aws_region,
    };

    config_loader
        .save(&config)
        .context("Failed to save config")?;

    println!();
    println!("  \u{2713} LLM configuration updated");
    println!();
    println!("  Run `sockt up` to apply changes.");
    println!();

    Ok(())
}

struct ModelInfo {
    provider: ModelProvider,
    api_key: String,
    frontier: String,
    fast: String,
    base_url: Option<String>,
    aws_region: Option<String>,
}

fn collect_non_interactive(args: &SetupLlmArgs) -> anyhow::Result<ModelInfo> {
    // Parse provider
    let provider_str = args
        .provider
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("--provider required in non-interactive mode"))?;

    let provider = parse_provider(provider_str)?;

    // Get API key
    let api_key = args
        .api_key
        .clone()
        .or_else(|| std::env::var("SOCKT_API_KEY").ok())
        .ok_or_else(|| anyhow::anyhow!("--api-key required in non-interactive mode"))?;

    // Handle model flags
    let (frontier, fast) = if let Some(model) = &args.model {
        // Auto-split: use same model for both
        (model.clone(), model.clone())
    } else {
        // Use explicit frontier and fast
        let frontier = args
            .frontier
            .clone()
            .ok_or_else(|| anyhow::anyhow!("--frontier or --model required in non-interactive mode"))?;
        let fast = args
            .fast
            .clone()
            .ok_or_else(|| anyhow::anyhow!("--fast or --model required in non-interactive mode"))?;
        (frontier, fast)
    };

    // Base URL required for custom provider
    let base_url = if matches!(provider, ModelProvider::Custom) {
        Some(
            args.base_url
                .clone()
                .ok_or_else(|| anyhow::anyhow!("--base-url required for custom provider"))?,
        )
    } else {
        args.base_url.clone()
    };

    // AWS region for Bedrock (with default)
    let aws_region = if matches!(provider, ModelProvider::Bedrock) {
        Some(args.aws_region.clone().unwrap_or_else(|| "us-east-1".to_string()))
    } else {
        args.aws_region.clone()
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

async fn collect_interactive(_args: &SetupLlmArgs) -> anyhow::Result<ModelInfo> {
    println!();
    llm_verify::print_header("LLM Configuration");
    println!();

    // Select provider
    let provider_options = vec!["Anthropic", "OpenAI", "Bedrock", "Custom"];
    let provider_idx = dialoguer::Select::new()
        .with_prompt("  LLM Provider")
        .items(&provider_options)
        .default(0)
        .interact()
        .map_err(|_| anyhow::anyhow!("Setup cancelled."))?;

    let provider = match provider_idx {
        0 => ModelProvider::Anthropic,
        1 => ModelProvider::Openai,
        2 => ModelProvider::Bedrock,
        3 => ModelProvider::Custom,
        _ => unreachable!(),
    };

    // Collect API key
    let api_key = PasswordInput::new("  API Key: ")
        .allow_empty(false)
        .interact()
        .map_err(|_| anyhow::anyhow!("Setup cancelled."))?;

    // Get default models based on provider
    let (default_frontier, default_fast) = default_models_for_provider(&provider);

    // Prompt for frontier model
    let frontier = dialoguer::Input::<String>::new()
        .with_prompt("  Frontier model")
        .default(default_frontier.clone())
        .interact()
        .unwrap_or(default_frontier);

    // Prompt for fast model
    let fast = dialoguer::Input::<String>::new()
        .with_prompt("  Fast model")
        .default(default_fast.clone())
        .interact()
        .unwrap_or(default_fast);

    // Conditional fields based on provider
    let base_url = if matches!(provider, ModelProvider::Custom) {
        Some(
            dialoguer::Input::<String>::new()
                .with_prompt("  Base URL")
                .default("http://localhost:11434".to_string())
                .interact()
                .map_err(|_| anyhow::anyhow!("Setup cancelled."))?,
        )
    } else {
        None
    };

    let aws_region = if matches!(provider, ModelProvider::Bedrock) {
        Some(
            dialoguer::Input::<String>::new()
                .with_prompt("  AWS Region")
                .default("us-east-1".to_string())
                .interact()
                .unwrap_or_else(|_| "us-east-1".to_string()),
        )
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

fn parse_provider(s: &str) -> anyhow::Result<ModelProvider> {
    match s.to_lowercase().as_str() {
        "anthropic" => Ok(ModelProvider::Anthropic),
        "openai" => Ok(ModelProvider::Openai),
        "bedrock" => Ok(ModelProvider::Bedrock),
        "custom" => Ok(ModelProvider::Custom),
        _ => anyhow::bail!(
            "Invalid provider '{}'. Must be one of: anthropic, openai, bedrock, custom",
            s
        ),
    }
}

fn default_models_for_provider(provider: &ModelProvider) -> (String, String) {
    match provider {
        ModelProvider::Anthropic => (
            "claude-sonnet-4-20250514".to_string(),
            "claude-haiku-4-20250514".to_string(),
        ),
        ModelProvider::Openai => ("gpt-4".to_string(), "gpt-3.5-turbo".to_string()),
        ModelProvider::Bedrock => (
            "anthropic.claude-v2".to_string(),
            "anthropic.claude-instant-v1".to_string(),
        ),
        ModelProvider::Custom => ("llama2".to_string(), "llama2".to_string()),
    }
}
