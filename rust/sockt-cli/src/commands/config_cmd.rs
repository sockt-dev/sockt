use std::path::PathBuf;
use anyhow::{Context, Result};

use crate::cli::{ConfigArgs, ConfigCommand};
use crate::config::loader::ConfigLoader;
use crate::config::dot_path::DotPath;
use crate::config::accessor::ConfigAccessor;
use crate::config::secrets::SecretDetector;
use crate::config::formatter::{format_value, format_config};
use crate::crypto::{self, KeyManager};

pub async fn run(args: ConfigArgs, config_path: Option<PathBuf>) -> Result<()> {
    let loader = ConfigLoader::from_default_or_override(config_path);

    match args.command {
        None => show_command(&loader, false, false, false),
        Some(ConfigCommand::Show { reveal, json, raw }) => {
            show_command(&loader, reveal, json, raw)
        }
        Some(ConfigCommand::Get { key, reveal }) => {
            get_command(&loader, &key, reveal)
        }
        Some(ConfigCommand::Set { key, value }) => {
            set_command(&loader, &key, &value)
        }
        Some(ConfigCommand::Reset { key }) => {
            reset_command(&loader, &key)
        }
        Some(ConfigCommand::Path) => {
            println!("{}", loader.path().display());
            Ok(())
        }
    }
}

fn show_command(loader: &ConfigLoader, reveal: bool, json: bool, raw: bool) -> Result<()> {
    if raw {
        // Just cat the file
        let content = std::fs::read_to_string(loader.path())
            .context("failed to read config file")?;
        println!("{}", content);
        return Ok(());
    }

    if reveal {
        // Prompt for confirmation
        let confirmed = dialoguer::Confirm::new()
            .with_prompt("⚠ This will decrypt and display all secrets. Continue?")
            .default(false)
            .interact()
            .context("failed to get user confirmation")?;

        if !confirmed {
            anyhow::bail!("cancelled by user");
        }
    }

    let config = loader.load()
        .context("failed to load config")?;

    if !json {
        println!("\n  Config: {}", loader.path().display());
        println!("  ─────────────────────────────────────────────────────────────\n");
    }

    let output = format_config(&config, reveal, json)
        .context("failed to format config")?;

    println!("{}", output);

    Ok(())
}

fn get_command(loader: &ConfigLoader, key: &str, reveal: bool) -> Result<()> {
    let config = loader.load()
        .context("failed to load config")?;

    let path = DotPath::parse(key)
        .context("invalid key path")?;

    let value = ConfigAccessor::get(&config, &path)
        .context(format!("failed to get '{}'", key))?;

    let is_secret = SecretDetector::is_secret(&path);

    if is_secret && !reveal {
        println!("••••••••  (encrypted, use --reveal to decrypt)");
        return Ok(());
    }

    let display = format_value(&value, !reveal);
    println!("{}", display);

    Ok(())
}

fn set_command(loader: &ConfigLoader, key: &str, value: &str) -> Result<()> {
    let mut config = loader.load()
        .context("failed to load config")?;

    let path = DotPath::parse(key)
        .context("invalid key path")?;

    if SecretDetector::is_read_only(&path) {
        anyhow::bail!("Key '{}' is read-only (set during init)", key);
    }

    let is_secret = SecretDetector::is_secret(&path);

    if is_secret {
        // Encrypt the value and update config
        let km = KeyManager::new(KeyManager::default_path());
        let identity = km.load()
            .context("failed to load encryption key")?;
        let recipient = identity.to_public();
        let encrypted = crypto::encrypt(value, &recipient)
            .context("failed to encrypt value")?;

        // Set encrypted value in config (need to match path and update struct field)
        let segments: Vec<&str> = path.segments().iter().map(|s| s.as_str()).collect();
        match segments.as_slice() {
            ["models", "api_key"] => config.models.api_key = encrypted,
            ["slack", "app_token"] => config.slack.app_token = encrypted,
            ["slack", "bot_token"] => config.slack.bot_token = encrypted,
            ["slack", "signing_secret"] => config.slack.signing_secret = encrypted,
            _ => anyhow::bail!("unsupported secret field: {}", key),
        }

        println!("✓ {} updated (encrypted)", key);
    } else {
        ConfigAccessor::set(&mut config, &path, value)
            .context(format!("failed to set '{}'", key))?;

        println!("✓ {} = {}", key, value);
    }

    if SecretDetector::needs_restart(&path) {
        println!("Note: restart agents for this to take effect (`sockt restart`)");
    }

    loader.save(&config)
        .context("failed to save config")?;

    Ok(())
}

fn reset_command(loader: &ConfigLoader, key: &str) -> Result<()> {
    let mut config = loader.load()
        .context("failed to load config")?;

    let path = DotPath::parse(key)
        .context("invalid key path")?;

    if SecretDetector::is_read_only(&path) {
        anyhow::bail!("Key '{}' is read-only (cannot reset)", key);
    }

    // Reset to default - implement defaults per field
    let segments: Vec<&str> = path.segments().iter().map(|s| s.as_str()).collect();
    match segments.as_slice() {
        ["models", "frontier"] => {
            config.models.frontier = "claude-sonnet-4-20250514".to_string();
            println!("✓ models.frontier reset to default: claude-sonnet-4-20250514");
        }
        ["models", "fast"] => {
            config.models.fast = "claude-haiku-4-20250514".to_string();
            println!("✓ models.fast reset to default: claude-haiku-4-20250514");
        }
        ["slack", "socket_mode"] => {
            config.slack.socket_mode = true;
            println!("✓ slack.socket_mode reset to default: true");
        }
        ["gbrain", "directory"] => {
            config.gbrain.directory = std::path::PathBuf::from("./gbrain");
            println!("✓ gbrain.directory reset to default: ./gbrain");
        }
        ["gbrain", "soul_file"] => {
            config.gbrain.soul_file = "SOUL.md".to_string();
            println!("✓ gbrain.soul_file reset to default: SOUL.md");
        }
        ["gbrain", "agents_file"] => {
            config.gbrain.agents_file = "AGENTS.md".to_string();
            println!("✓ gbrain.agents_file reset to default: AGENTS.md");
        }
        _ => anyhow::bail!("Key '{}' cannot be reset (no default defined)", key),
    }

    loader.save(&config)
        .context("failed to save config")?;

    Ok(())
}
