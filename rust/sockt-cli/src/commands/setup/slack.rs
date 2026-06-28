use std::path::PathBuf;

use anyhow::Context;

use crate::cli::SetupSlackArgs;
use crate::config::loader::ConfigLoader;
use crate::config::SlackConfig;
use crate::crypto::{self, KeyManager};
use crate::tui::llm_verify;
use crate::tui::password_input::PasswordInput;

pub async fn run(args: SetupSlackArgs, config_path: Option<PathBuf>) -> anyhow::Result<()> {
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

    let (app_token, bot_token, signing_secret) = if args.non_interactive {
        collect_non_interactive(&args)?
    } else {
        collect_interactive(&args).await?
    };

    // Load encryption key
    let key_manager = KeyManager::new(KeyManager::default_path());
    let identity = key_manager
        .load()
        .context("Failed to load encryption key. Run `sockt init` first.")?;
    let recipient = identity.to_public();

    // Encrypt and update config
    let encrypted_app_token =
        crypto::encrypt(&app_token, &recipient).context("Encrypting Slack app token")?;
    let encrypted_signing_secret =
        crypto::encrypt(&signing_secret, &recipient).context("Encrypting Slack signing secret")?;
    let encrypted_bot_token =
        crypto::encrypt(&bot_token, &recipient).context("Encrypting Slack bot token")?;

    config.slack = SlackConfig {
        app_token: encrypted_app_token,
        signing_secret: encrypted_signing_secret,
        bot_token: encrypted_bot_token,
        socket_mode: true,
    };

    config_loader
        .save(&config)
        .context("Failed to save config")?;

    println!();
    println!("  \u{2713} Slack credentials saved to {}", config_loader.path().display());
    println!();
    println!("  Run `sockt up` to start your swarm with Slack integration.");
    println!();

    Ok(())
}

fn collect_non_interactive(args: &SetupSlackArgs) -> anyhow::Result<(String, String, String)> {
    let app_token = args
        .app_token
        .clone()
        .or_else(|| std::env::var("SOCKT_SLACK_APP_TOKEN").ok())
        .ok_or_else(|| anyhow::anyhow!("--app-token required in non-interactive mode"))?;

    let bot_token = args
        .bot_token
        .clone()
        .or_else(|| std::env::var("SOCKT_SLACK_BOT_TOKEN").ok())
        .ok_or_else(|| anyhow::anyhow!("--bot-token required in non-interactive mode"))?;

    let signing_secret = args
        .signing_secret
        .clone()
        .or_else(|| std::env::var("SOCKT_SLACK_SIGNING_SECRET").ok())
        .ok_or_else(|| anyhow::anyhow!("--signing-secret required in non-interactive mode"))?;

    Ok((app_token, bot_token, signing_secret))
}

async fn collect_interactive(
    args: &SetupSlackArgs,
) -> anyhow::Result<(String, String, String)> {

    println!();
    llm_verify::print_header("Slack Integration");
    println!();

    let has_app = dialoguer::Confirm::new()
        .with_prompt("  Do you already have a Slack app configured for Sockt?")
        .default(false)
        .interact()
        .map_err(|_| anyhow::anyhow!("Setup cancelled."))?;

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
            .map_err(|_| anyhow::anyhow!("Setup cancelled."))?;

        if open_browser {
            println!();
            println!("  Opening Slack...");
            llm_verify::print_hint(
                "Select your workspace and click 'Create' to provision the app.",
            );
            println!();
            super::super::slack_setup::open_creation_page();
        } else {
            println!();
            println!("  To create manually:");
            println!("  1. Go to https://api.slack.com/apps");
            println!("  2. Click 'Create New App' > 'From an app manifest'");
            println!("  3. Select your workspace");
            println!("  4. Switch to YAML and paste the following manifest:");
            println!();
            for line in super::super::slack_setup::SLACK_MANIFEST.lines() {
                println!("     {}", line);
            }
            println!();
        }

        super::super::slack_setup::print_token_instructions();
    }

    println!();

    loop {
        let app_token = args
            .app_token
            .clone()
            .or_else(|| {
                PasswordInput::new("  Slack App Token (xapp-...): ")
                    .allow_empty(false)
                    .interact()
                    .ok()
            })
            .ok_or_else(|| anyhow::anyhow!("Setup cancelled."))?;

        if !app_token.is_empty() && !app_token.starts_with("xapp-") {
            llm_verify::print_hint("Note: Slack App Tokens typically start with xapp-");
        }

        let signing_secret = args
            .signing_secret
            .clone()
            .or_else(|| {
                PasswordInput::new("  Slack Signing Secret: ")
                    .allow_empty(false)
                    .interact()
                    .ok()
            })
            .ok_or_else(|| anyhow::anyhow!("Setup cancelled."))?;

        let bot_token = args
            .bot_token
            .clone()
            .or_else(|| {
                PasswordInput::new("  Slack Bot Token (xoxb-...): ")
                    .allow_empty(false)
                    .interact()
                    .ok()
            })
            .ok_or_else(|| anyhow::anyhow!("Setup cancelled."))?;

        if !bot_token.is_empty() && !bot_token.starts_with("xoxb-") {
            llm_verify::print_hint("Note: Slack Bot Tokens typically start with xoxb-");
        }

        // Basic validation
        if app_token.is_empty() || bot_token.is_empty() || signing_secret.is_empty() {
            llm_verify::print_error("All three tokens are required. Please try again.");
            println!();
            continue;
        }

        return Ok((app_token, bot_token, signing_secret));
    }
}
