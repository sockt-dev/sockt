use std::path::PathBuf;

use anyhow::Context;

use crate::cli::SetupIntegrationArgs;
use crate::config::loader::ConfigLoader;
use crate::config::HubSpotConfig;
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
    if !args.non_interactive && config.integrations.hubspot.is_some() {
        println!();
        println!("  HubSpot is already configured.");
        println!();

        let reconfigure = dialoguer::Confirm::new()
            .with_prompt("  Reconfigure?")
            .default(false)
            .interact()
            .map_err(|_| anyhow::anyhow!("Setup cancelled."))?;

        if !reconfigure {
            println!();
            println!("  HubSpot configuration unchanged.");
            println!();
            return Ok(());
        }
    }

    let hubspot_info = if args.non_interactive {
        collect_non_interactive(&args)?
    } else {
        collect_interactive(&args).await?
    };

    // Verify API key
    if !args.non_interactive {
        print!("  Verifying HubSpot API key... ");
        std::io::Write::flush(&mut std::io::stdout()).ok();

        match verify::verify_hubspot(&hubspot_info.api_key).await {
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
    let encrypted_api_key = crypto::encrypt(&hubspot_info.api_key, &recipient)
        .context("Encrypting HubSpot API key")?;

    // Update config
    config.integrations.hubspot = Some(HubSpotConfig {
        api_key: encrypted_api_key,
        portal_id: hubspot_info.portal_id,
    });

    config_loader
        .save(&config)
        .context("Failed to save config")?;

    println!();
    println!("  ✓ HubSpot integration configured");
    println!();

    Ok(())
}

struct HubSpotInfo {
    api_key: String,
    portal_id: String,
}

fn collect_non_interactive(args: &SetupIntegrationArgs) -> anyhow::Result<HubSpotInfo> {
    let api_key = args
        .api_key
        .clone()
        .or_else(|| args.token.clone())
        .or_else(|| std::env::var("SOCKT_HUBSPOT_TOKEN").ok())
        .ok_or_else(|| anyhow::anyhow!("--api-key required for HubSpot in non-interactive mode"))?;

    let portal_id = args
        .org_id
        .clone()
        .ok_or_else(|| anyhow::anyhow!("--org-id (portal ID) required for HubSpot in non-interactive mode"))?;

    Ok(HubSpotInfo { api_key, portal_id })
}

async fn collect_interactive(_args: &SetupIntegrationArgs) -> anyhow::Result<HubSpotInfo> {
    println!();
    llm_verify::print_header("HubSpot Integration");
    println!();

    llm_verify::print_hint("Create a private app at:");
    llm_verify::print_hint("https://app.hubspot.com/private-apps");
    println!();

    let api_key = PasswordInput::new("  HubSpot API Key: ")
        .allow_empty(false)
        .interact()
        .map_err(|_| anyhow::anyhow!("Setup cancelled."))?;

    let portal_id = dialoguer::Input::<String>::new()
        .with_prompt("  Portal ID (Hub ID)")
        .interact()
        .map_err(|_| anyhow::anyhow!("Setup cancelled."))?;

    Ok(HubSpotInfo { api_key, portal_id })
}
