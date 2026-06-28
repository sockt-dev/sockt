use std::path::PathBuf;

use anyhow::Context;

use crate::cli::SetupIntegrationArgs;
use crate::config::loader::ConfigLoader;
use crate::config::PagerDutyConfig;
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
    if !args.non_interactive && config.integrations.pagerduty.is_some() {
        println!();
        println!("  PagerDuty is already configured.");
        println!();

        let reconfigure = dialoguer::Confirm::new()
            .with_prompt("  Reconfigure?")
            .default(false)
            .interact()
            .map_err(|_| anyhow::anyhow!("Setup cancelled."))?;

        if !reconfigure {
            println!();
            println!("  PagerDuty configuration unchanged.");
            println!();
            return Ok(());
        }
    }

    let pagerduty_info = if args.non_interactive {
        collect_non_interactive(&args)?
    } else {
        collect_interactive(&args).await?
    };

    // Verify API token
    if !args.non_interactive {
        print!("  Verifying PagerDuty API token... ");
        std::io::Write::flush(&mut std::io::stdout()).ok();

        match verify::verify_pagerduty(&pagerduty_info.api_token).await {
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

    // Encrypt API token
    let encrypted_api_token = crypto::encrypt(&pagerduty_info.api_token, &recipient)
        .context("Encrypting PagerDuty API token")?;

    // Update config
    config.integrations.pagerduty = Some(PagerDutyConfig {
        api_token: encrypted_api_token,
        service_ids: pagerduty_info.service_ids,
    });

    config_loader
        .save(&config)
        .context("Failed to save config")?;

    println!();
    println!("  ✓ PagerDuty integration configured");
    println!();

    Ok(())
}

struct PagerDutyInfo {
    api_token: String,
    service_ids: Vec<String>,
}

fn collect_non_interactive(args: &SetupIntegrationArgs) -> anyhow::Result<PagerDutyInfo> {
    let api_token = args
        .token
        .clone()
        .or_else(|| args.api_key.clone())
        .or_else(|| std::env::var("SOCKT_PAGERDUTY_TOKEN").ok())
        .ok_or_else(|| anyhow::anyhow!("--token required for PagerDuty in non-interactive mode"))?;

    let service_ids = args
        .services
        .as_ref()
        .map(|s| s.split(',').map(|s| s.trim().to_string()).collect())
        .unwrap_or_default();

    Ok(PagerDutyInfo {
        api_token,
        service_ids,
    })
}

async fn collect_interactive(_args: &SetupIntegrationArgs) -> anyhow::Result<PagerDutyInfo> {
    println!();
    llm_verify::print_header("PagerDuty Integration");
    println!();

    llm_verify::print_hint("Create an API key at:");
    llm_verify::print_hint("https://[your-subdomain].pagerduty.com/api_keys");
    println!();

    let api_token = PasswordInput::new("  PagerDuty API Token: ")
        .allow_empty(false)
        .interact()
        .map_err(|_| anyhow::anyhow!("Setup cancelled."))?;

    let services_input = dialoguer::Input::<String>::new()
        .with_prompt("  Service IDs to monitor (comma-separated, optional)")
        .allow_empty(true)
        .interact()
        .ok()
        .unwrap_or_default();

    let service_ids = if services_input.is_empty() {
        vec![]
    } else {
        services_input
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    };

    Ok(PagerDutyInfo {
        api_token,
        service_ids,
    })
}
