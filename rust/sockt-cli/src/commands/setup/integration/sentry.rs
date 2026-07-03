use std::path::PathBuf;

use anyhow::Context;

use crate::cli::SetupIntegrationArgs;
use crate::config::loader::ConfigLoader;
use crate::config::SentryConfig;
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
    if !args.non_interactive && config.integrations.sentry.is_some() {
        println!();
        println!("  Sentry is already configured.");
        println!();

        let reconfigure = dialoguer::Confirm::new()
            .with_prompt("  Reconfigure?")
            .default(false)
            .interact()
            .map_err(|_| anyhow::anyhow!("Setup cancelled."))?;

        if !reconfigure {
            println!();
            println!("  Sentry configuration unchanged.");
            println!();
            return Ok(());
        }
    }

    let sentry_info = if args.non_interactive {
        collect_non_interactive(&args)?
    } else {
        collect_interactive(&args).await?
    };

    // Validate DSN format
    if let Err(e) = url::Url::parse(&sentry_info.dsn) {
        anyhow::bail!("Invalid Sentry DSN format: {}", e);
    }

    // Verify auth token and DSN
    if !args.non_interactive {
        print!("  Verifying Sentry credentials... ");
        std::io::Write::flush(&mut std::io::stdout()).ok();

        match verify::verify_sentry(&sentry_info.auth_token, &sentry_info.dsn).await {
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

    // Encrypt auth token
    let encrypted_auth_token = crypto::encrypt(&sentry_info.auth_token, &recipient)
        .context("Encrypting Sentry auth token")?;

    // Update config
    config.integrations.sentry = Some(SentryConfig {
        auth_token: encrypted_auth_token,
        dsn: sentry_info.dsn,
        organization_slug: sentry_info.organization_slug,
    });

    config_loader
        .save(&config)
        .context("Failed to save config")?;

    println!();
    println!("  ✓ Sentry integration configured");
    println!();

    Ok(())
}

struct SentryInfo {
    auth_token: String,
    dsn: String,
    organization_slug: Option<String>,
}

fn collect_non_interactive(args: &SetupIntegrationArgs) -> anyhow::Result<SentryInfo> {
    let auth_token = args
        .token
        .clone()
        .or_else(|| args.api_key.clone())
        .or_else(|| std::env::var("SOCKT_SENTRY_TOKEN").ok())
        .ok_or_else(|| anyhow::anyhow!("--token required for Sentry in non-interactive mode"))?;

    let dsn = args
        .dsn
        .clone()
        .ok_or_else(|| anyhow::anyhow!("--dsn required for Sentry in non-interactive mode"))?;

    let organization_slug = args.org_id.clone();

    Ok(SentryInfo {
        auth_token,
        dsn,
        organization_slug,
    })
}

async fn collect_interactive(_args: &SetupIntegrationArgs) -> anyhow::Result<SentryInfo> {
    println!();
    llm_verify::print_header("Sentry Integration");
    println!();

    llm_verify::print_hint("Create an auth token at:");
    llm_verify::print_hint("https://sentry.io/settings/account/api/auth-tokens/");
    llm_verify::print_hint("Find your DSN in project settings");
    println!();

    let auth_token = PasswordInput::new("  Sentry Auth Token: ")
        .allow_empty(false)
        .interact()
        .map_err(|_| anyhow::anyhow!("Setup cancelled."))?;

    let dsn = dialoguer::Input::<String>::new()
        .with_prompt("  Sentry DSN (https://...@sentry.io/...)")
        .interact()
        .map_err(|_| anyhow::anyhow!("Setup cancelled."))?;

    let organization_slug = dialoguer::Input::<String>::new()
        .with_prompt("  Organization slug (optional)")
        .allow_empty(true)
        .interact()
        .ok()
        .filter(|s: &String| !s.is_empty());

    Ok(SentryInfo {
        auth_token,
        dsn,
        organization_slug,
    })
}
