use std::path::PathBuf;

use anyhow::Context;

use crate::cli::SetupIntegrationArgs;
use crate::config::loader::ConfigLoader;
use crate::config::LinearConfig;
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
    if !args.non_interactive && config.integrations.linear.is_some() {
        println!();
        println!("  Linear is already configured.");
        println!();

        let reconfigure = dialoguer::Confirm::new()
            .with_prompt("  Reconfigure?")
            .default(false)
            .interact()
            .map_err(|_| anyhow::anyhow!("Setup cancelled."))?;

        if !reconfigure {
            println!();
            println!("  Linear configuration unchanged.");
            println!();
            return Ok(());
        }
    }

    let linear_info = if args.non_interactive {
        collect_non_interactive(&args)?
    } else {
        collect_interactive(&args).await?
    };

    // Verify API key
    if !args.non_interactive {
        print!("  Verifying Linear API key... ");
        std::io::Write::flush(&mut std::io::stdout()).ok();

        match verify::verify_linear(&linear_info.api_key).await {
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
    let encrypted_api_key = crypto::encrypt(&linear_info.api_key, &recipient)
        .context("Encrypting Linear API key")?;

    // Update config
    config.integrations.linear = Some(LinearConfig {
        api_key: encrypted_api_key,
        team_id: linear_info.team_id,
    });

    config_loader
        .save(&config)
        .context("Failed to save config")?;

    println!();
    println!("  ✓ Linear integration configured");
    println!();

    Ok(())
}

struct LinearInfo {
    api_key: String,
    team_id: Option<String>,
}

fn collect_non_interactive(args: &SetupIntegrationArgs) -> anyhow::Result<LinearInfo> {
    let api_key = args
        .api_key
        .clone()
        .or_else(|| args.token.clone())
        .or_else(|| std::env::var("SOCKT_LINEAR_TOKEN").ok())
        .ok_or_else(|| anyhow::anyhow!("--api-key required for Linear in non-interactive mode"))?;

    let team_id = args.org_id.clone();

    Ok(LinearInfo { api_key, team_id })
}

async fn collect_interactive(_args: &SetupIntegrationArgs) -> anyhow::Result<LinearInfo> {
    println!();
    llm_verify::print_header("Linear Integration");
    println!();

    llm_verify::print_hint("Create a personal API key at:");
    llm_verify::print_hint("https://linear.app/settings/api");
    println!();

    let api_key = PasswordInput::new("  Linear API Key: ")
        .allow_empty(false)
        .interact()
        .map_err(|_| anyhow::anyhow!("Setup cancelled."))?;

    let team_id = dialoguer::Input::<String>::new()
        .with_prompt("  Team ID (optional)")
        .allow_empty(true)
        .interact()
        .ok()
        .filter(|s: &String| !s.is_empty());

    Ok(LinearInfo { api_key, team_id })
}
