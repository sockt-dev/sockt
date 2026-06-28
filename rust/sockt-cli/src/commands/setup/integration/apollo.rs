use std::path::PathBuf;

use anyhow::Context;

use crate::cli::SetupIntegrationArgs;
use crate::config::loader::ConfigLoader;
use crate::config::ApolloConfig;
use crate::crypto::{self, KeyManager};
use crate::tui::llm_verify;
use crate::tui::password_input::PasswordInput;

use super::verify;

pub async fn run(args: SetupIntegrationArgs, config_path: Option<PathBuf>) -> anyhow::Result<()> {
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

    // Check if already configured
    if !args.non_interactive && config.integrations.apollo.is_some() {
        println!();
        println!("  Apollo is already configured.");
        println!();

        let reconfigure = dialoguer::Confirm::new()
            .with_prompt("  Reconfigure?")
            .default(false)
            .interact()
            .map_err(|_| anyhow::anyhow!("Setup cancelled."))?;

        if !reconfigure {
            println!();
            println!("  Apollo configuration unchanged.");
            println!();
            return Ok(());
        }
    }

    let apollo_info = if args.non_interactive {
        collect_non_interactive(&args)?
    } else {
        collect_interactive(&args).await?
    };

    // Verify API key
    if !args.non_interactive {
        print!("  Verifying Apollo API key... ");
        std::io::Write::flush(&mut std::io::stdout()).ok();

        match verify::verify_apollo(&apollo_info.api_key).await {
            Ok(_) => println!("✓"),
            Err(e) => {
                println!("✗");
                llm_verify::print_error(&format!("Verification failed: {}", e));

                let continue_anyway = dialoguer::Confirm::new()
                    .with_prompt("  Continue without verification? (not recommended)")
                    .default(false)
                    .interact()
                    .unwrap_or(false);

                if !continue_anyway {
                    anyhow::bail!("Setup cancelled.");
                }
            }
        }
    }

    // Load encryption key
    let key_manager = KeyManager::new(KeyManager::default_path());
    let identity = key_manager
        .load()
        .context("Failed to load encryption key. Run `sockt init` first.")?;
    let recipient = identity.to_public();

    // Encrypt API key
    let encrypted_api_key = crypto::encrypt(&apollo_info.api_key, &recipient)
        .context("Encrypting Apollo API key")?;

    // Update config
    config.integrations.apollo = Some(ApolloConfig {
        api_key: encrypted_api_key,
    });

    config_loader
        .save(&config)
        .context("Failed to save config")?;

    println!();
    println!("  ✓ Apollo integration configured");
    println!();

    Ok(())
}

struct ApolloInfo {
    api_key: String,
}

fn collect_non_interactive(args: &SetupIntegrationArgs) -> anyhow::Result<ApolloInfo> {
    let api_key = args
        .api_key
        .clone()
        .or_else(|| args.token.clone())
        .or_else(|| std::env::var("SOCKT_APOLLO_TOKEN").ok())
        .ok_or_else(|| anyhow::anyhow!("--api-key required for Apollo in non-interactive mode"))?;

    Ok(ApolloInfo { api_key })
}

async fn collect_interactive(_args: &SetupIntegrationArgs) -> anyhow::Result<ApolloInfo> {
    println!();
    llm_verify::print_header("Apollo Integration");
    println!();

    llm_verify::print_hint("Get your API key from:");
    llm_verify::print_hint("https://app.apollo.io/#/settings/integrations/api");
    println!();

    let api_key = PasswordInput::new("  Apollo API Key: ")
        .allow_empty(false)
        .interact()
        .map_err(|_| anyhow::anyhow!("Setup cancelled."))?;

    Ok(ApolloInfo { api_key })
}
