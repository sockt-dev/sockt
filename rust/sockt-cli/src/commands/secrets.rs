use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use crate::cli::{SecretsArgs, SecretsCommand};
use crate::config::loader::ConfigLoader;
use crate::config::secrets::all_secrets;
use crate::config::{EncryptedValue, SocktConfig};
use crate::crypto::KeyManager;

/// Resolve key path from config path
fn resolve_key_path(config_path: &Option<PathBuf>) -> PathBuf {
    if let Some(cfg_path) = config_path {
        // If config path is provided, key should be in same directory
        if let Some(parent) = cfg_path.parent() {
            return parent.join("key.txt");
        }
    }
    KeyManager::default_path()
}

/// Check key file permissions and warn if insecure
#[cfg(unix)]
fn check_key_permissions(key_path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;

    if let Ok(metadata) = std::fs::metadata(key_path) {
        let mode = metadata.permissions().mode() & 0o777;
        if mode != 0o600 {
            eprintln!("⚠ Warning: {} has incorrect permissions ({:o}). Expected 600.",
                     key_path.display(), mode);
            eprintln!("  Fix with: chmod 600 {}", key_path.display());
        }
    }
}

#[cfg(not(unix))]
fn check_key_permissions(_key_path: &std::path::Path) {
    // No-op on non-Unix systems
}

pub async fn run(args: SecretsArgs, config_path: Option<PathBuf>) -> Result<()> {
    match args.command {
        SecretsCommand::List => list_secrets(config_path).await,
        SecretsCommand::Set { name, value } => set_secret(&name, &value, config_path).await,
        SecretsCommand::Rotate { confirm } => rotate_secrets(confirm, config_path).await,
        SecretsCommand::Export { output } => export_secrets(output.as_deref(), config_path).await,
    }
}

async fn list_secrets(config_path: Option<PathBuf>) -> Result<()> {
    let key_path = resolve_key_path(&config_path);
    check_key_permissions(&key_path);

    let km = KeyManager::new(key_path);
    let identity = km
        .load()
        .context("No encryption key found at ~/.sockt/key.txt. Run `sockt init` first.")?;

    let loader = ConfigLoader::from_default_or_override(config_path);
    let config = loader.load()?;

    println!("\n  Encrypted secrets (age, key: ~/.sockt/key.txt)");
    println!("  ─────────────────────────────────────────────────────────────\n");

    let secrets: Vec<_> = all_secrets(&config).collect();
    for (path, encrypted) in &secrets {
        let name = format_secret_name(path);
        let status = if encrypted.ciphertext.is_empty() {
            "not set".to_string()
        } else {
            "encrypted".to_string()
        };
        let timestamp = format_timestamp(&encrypted.set_at);
        println!("    {:<22} {:<11} set {}", name, status, timestamp);
    }

    println!("\n  {} secrets stored", secrets.len());
    println!("  Key fingerprint: {}", KeyManager::fingerprint(&identity));
    println!("\n  Rotate: sockt secrets rotate");
    println!("  Export: sockt secrets export\n");

    Ok(())
}

fn format_secret_name(path: &str) -> String {
    path.replace('.', "_")
}

fn format_timestamp(set_at: &Option<String>) -> String {
    set_at
        .as_ref()
        .and_then(|ts| ts.split('T').next())
        .unwrap_or("unknown")
        .to_string()
}

async fn set_secret(name: &str, value: &str, config_path: Option<PathBuf>) -> Result<()> {
    // Map user-friendly name to config path
    let config_key = map_secret_name(name)?;

    let key_path = resolve_key_path(&config_path);
    let km = KeyManager::new(key_path);
    let identity = km.load()?;
    let recipient = identity.to_public();

    let loader = ConfigLoader::from_default_or_override(config_path);
    let mut config = loader.load()?;

    // Check if secret exists
    let existing = get_secret_by_path(&config, &config_key)?;
    let is_update = !existing.ciphertext.is_empty();

    if is_update {
        let confirm = dialoguer::Confirm::new()
            .with_prompt(format!("⚠ {} already exists. Overwrite?", name))
            .default(false)
            .interact()?;
        if !confirm {
            println!("  Aborted.");
            return Ok(());
        }
    }

    // Encrypt and set
    let encrypted = crate::crypto::encrypt(value, &recipient)?;
    let now = chrono::Utc::now().to_rfc3339();
    let mut encrypted_with_time = encrypted;
    encrypted_with_time.set_at = Some(now);

    set_secret_by_path(&mut config, &config_key, encrypted_with_time)?;
    loader.save(&config)?;

    if is_update {
        println!("  ✓ {} updated (re-encrypted)", name);
    } else {
        println!("  ✓ {} encrypted and stored", name);
    }

    if needs_restart(&config_key) {
        println!("  Note: restart swarm to use new key (`sockt restart`)");
    }

    Ok(())
}

fn map_secret_name(name: &str) -> Result<String> {
    let mapped = match name {
        "anthropic_api_key" | "api_key" => "models.api_key",
        "slack_app_token" => "slack.app_token",
        "slack_bot_token" => "slack.bot_token",
        "slack_signing_secret" => "slack.signing_secret",
        "github_token" => "integrations.github.token",
        "hubspot_api_key" => "integrations.hubspot.api_key",
        "linear_api_key" => "integrations.linear.api_key",
        "sentry_auth_token" => "integrations.sentry.auth_token",
        "pagerduty_api_token" => "integrations.pagerduty.api_token",
        "apollo_api_key" => "integrations.apollo.api_key",
        _ => anyhow::bail!(
            "Unknown secret name: {}. Use 'sockt secrets list' to see available secrets.",
            name
        ),
    };
    Ok(mapped.to_string())
}

fn needs_restart(path: &str) -> bool {
    path.starts_with("models.") || path.starts_with("slack.")
}

fn get_secret_by_path<'a>(config: &'a SocktConfig, path: &str) -> Result<&'a EncryptedValue> {
    match path {
        "models.api_key" => Ok(&config.models.api_key),
        "slack.app_token" => Ok(&config.slack.app_token),
        "slack.bot_token" => Ok(&config.slack.bot_token),
        "slack.signing_secret" => Ok(&config.slack.signing_secret),
        "integrations.github.token" => {
            config.integrations.github
                .as_ref()
                .map(|g| &g.token)
                .ok_or_else(|| anyhow::anyhow!("GitHub integration not configured. Run 'sockt setup integration github' first."))
        }
        "integrations.hubspot.api_key" => {
            config.integrations.hubspot
                .as_ref()
                .map(|h| &h.api_key)
                .ok_or_else(|| anyhow::anyhow!("HubSpot integration not configured. Run 'sockt setup integration hubspot' first."))
        }
        "integrations.linear.api_key" => {
            config.integrations.linear
                .as_ref()
                .map(|l| &l.api_key)
                .ok_or_else(|| anyhow::anyhow!("Linear integration not configured. Run 'sockt setup integration linear' first."))
        }
        "integrations.sentry.auth_token" => {
            config.integrations.sentry
                .as_ref()
                .map(|s| &s.auth_token)
                .ok_or_else(|| anyhow::anyhow!("Sentry integration not configured. Run 'sockt setup integration sentry' first."))
        }
        "integrations.pagerduty.api_token" => {
            config.integrations.pagerduty
                .as_ref()
                .map(|p| &p.api_token)
                .ok_or_else(|| anyhow::anyhow!("PagerDuty integration not configured. Run 'sockt setup integration pagerduty' first."))
        }
        "integrations.apollo.api_key" => {
            config.integrations.apollo
                .as_ref()
                .map(|a| &a.api_key)
                .ok_or_else(|| anyhow::anyhow!("Apollo integration not configured. Run 'sockt setup integration apollo' first."))
        }
        _ => anyhow::bail!("Invalid secret path: {}", path),
    }
}

fn set_secret_by_path(
    config: &mut SocktConfig,
    path: &str,
    value: EncryptedValue,
) -> Result<()> {
    match path {
        "models.api_key" => config.models.api_key = value,
        "slack.app_token" => config.slack.app_token = value,
        "slack.bot_token" => config.slack.bot_token = value,
        "slack.signing_secret" => config.slack.signing_secret = value,
        "integrations.github.token" => {
            if let Some(ref mut github) = config.integrations.github {
                github.token = value;
            } else {
                anyhow::bail!("GitHub integration not configured. Run 'sockt setup integration github' first.");
            }
        }
        "integrations.hubspot.api_key" => {
            if let Some(ref mut hubspot) = config.integrations.hubspot {
                hubspot.api_key = value;
            } else {
                anyhow::bail!("HubSpot integration not configured. Run 'sockt setup integration hubspot' first.");
            }
        }
        "integrations.linear.api_key" => {
            if let Some(ref mut linear) = config.integrations.linear {
                linear.api_key = value;
            } else {
                anyhow::bail!("Linear integration not configured. Run 'sockt setup integration linear' first.");
            }
        }
        "integrations.sentry.auth_token" => {
            if let Some(ref mut sentry) = config.integrations.sentry {
                sentry.auth_token = value;
            } else {
                anyhow::bail!("Sentry integration not configured. Run 'sockt setup integration sentry' first.");
            }
        }
        "integrations.pagerduty.api_token" => {
            if let Some(ref mut pagerduty) = config.integrations.pagerduty {
                pagerduty.api_token = value;
            } else {
                anyhow::bail!("PagerDuty integration not configured. Run 'sockt setup integration pagerduty' first.");
            }
        }
        "integrations.apollo.api_key" => {
            if let Some(ref mut apollo) = config.integrations.apollo {
                apollo.api_key = value;
            } else {
                anyhow::bail!("Apollo integration not configured. Run 'sockt setup integration apollo' first.");
            }
        }
        _ => anyhow::bail!("Invalid secret path: {}", path),
    }
    Ok(())
}

async fn rotate_secrets(skip_confirm: bool, config_path: Option<PathBuf>) -> Result<()> {
    let key_path = resolve_key_path(&config_path);
    let km = KeyManager::new(key_path);
    let old_identity = km.load()?;

    let loader = ConfigLoader::from_default_or_override(config_path);
    let config = loader.load()?;

    let secret_count = all_secrets(&config).filter(|(_, e)| !e.ciphertext.is_empty()).count();

    if !skip_confirm {
        println!("\n  Key rotation will:");
        println!("    1. Generate a new age identity (encryption key)");
        println!("    2. Decrypt all {} secrets with current key", secret_count);
        println!("    3. Re-encrypt with new key");
        println!("    4. Replace ~/.sockt/key.txt");
        println!("    5. Back up old key to ~/.sockt/key.txt.bak\n");

        let proceed = dialoguer::Confirm::new()
            .with_prompt("Proceed?")
            .default(false)
            .interact()?;

        if !proceed {
            println!("  Aborted.");
            return Ok(());
        }
    }

    println!("\n  Generating new key...");
    let new_identity = km.generate_new()?;
    let new_recipient = new_identity.to_public();

    println!("  Re-encrypting {} secrets...", secret_count);

    let mut config = config;
    for (path, encrypted) in crate::config::secrets::all_secrets_mut(&mut config) {
        let name = format_secret_name(&path);

        if encrypted.ciphertext.is_empty() {
            continue; // Skip unset secrets
        }

        // Decrypt with old key
        let plaintext = crate::crypto::decrypt(encrypted, &old_identity).context(format!(
            "Could not decrypt '{}'. Key file may not match. Abort rotation.",
            name
        ))?;

        // Re-encrypt with new key
        let mut new_encrypted = crate::crypto::encrypt(&plaintext, &new_recipient)?;
        new_encrypted.set_at = encrypted.set_at.clone(); // Preserve timestamp

        *encrypted = new_encrypted;
        println!("    {:<22} ✓", name);
    }

    // Backup old key
    km.backup()?;

    // Save new key
    km.save(&new_identity)?;

    // Save config
    loader.save(&config)?;

    println!("\n  ✓ Rotation complete");
    println!("  ✓ Old key backed up to ~/.sockt/key.txt.bak");
    println!(
        "\n  New key fingerprint: {}",
        KeyManager::fingerprint(&new_identity)
    );
    println!("  Note: restart swarm for agents to use rotated secrets (`sockt restart`)\n");

    Ok(())
}

#[derive(Serialize, Deserialize)]
struct ExportFormat {
    version: String,
    exported_at: String,
    secrets: HashMap<String, EncryptedValue>,
}

async fn export_secrets(output: Option<&std::path::Path>, config_path: Option<PathBuf>) -> Result<()> {
    let loader = ConfigLoader::from_default_or_override(config_path);
    let config = loader.load()?;

    let mut secrets_map = HashMap::new();
    for (path, encrypted) in all_secrets(&config) {
        if !encrypted.ciphertext.is_empty() {
            secrets_map.insert(path, encrypted.clone());
        }
    }

    let export = ExportFormat {
        version: "1".to_string(),
        exported_at: chrono::Utc::now().to_rfc3339(),
        secrets: secrets_map,
    };

    let json = serde_json::to_string_pretty(&export)?;

    if let Some(path) = output {
        // Check if file exists
        if path.exists() {
            let confirm = dialoguer::Confirm::new()
                .with_prompt(format!("⚠ {} already exists. Overwrite?", path.display()))
                .default(false)
                .interact()?;
            if !confirm {
                println!("  Aborted.");
                return Ok(());
            }
        }

        std::fs::write(path, &json)?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        }

        println!("\n  ✓ Secrets exported to {}", path.display());
        println!("  Transfer this file securely. It is encrypted but contains all credentials.\n");
    } else {
        println!("\n  ⚠ This will output encrypted secrets (re-encrypted for portability).");
        println!("  They can be imported into another Sockt installation.\n");

        let proceed = dialoguer::Confirm::new()
            .with_prompt("Proceed?")
            .default(false)
            .interact()?;

        if !proceed {
            println!("  Aborted.");
            return Ok(());
        }

        println!("\n{}\n", json);
        println!("  To import on another machine:");
        println!("    sockt secrets import < exported-secrets.age\n");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_secret_name() {
        assert_eq!(format_secret_name("slack.bot_token"), "slack_bot_token");
        assert_eq!(format_secret_name("models.api_key"), "models_api_key");
    }

    #[test]
    fn test_format_timestamp_with_date() {
        let ts = Some("2026-06-27T10:00:00Z".to_string());
        assert_eq!(format_timestamp(&ts), "2026-06-27");
    }

    #[test]
    fn test_format_timestamp_missing() {
        assert_eq!(format_timestamp(&None), "unknown");
    }

    #[test]
    fn test_needs_restart_for_models() {
        assert!(needs_restart("models.api_key"));
    }

    #[test]
    fn test_needs_restart_for_slack() {
        assert!(needs_restart("slack.bot_token"));
    }

    #[test]
    fn test_needs_restart_false_for_integrations() {
        assert!(!needs_restart("integrations.github.token"));
    }

    #[test]
    fn test_map_secret_name_valid() {
        assert_eq!(map_secret_name("anthropic_api_key").unwrap(), "models.api_key");
        assert_eq!(map_secret_name("api_key").unwrap(), "models.api_key");
        assert_eq!(map_secret_name("slack_app_token").unwrap(), "slack.app_token");
        assert_eq!(map_secret_name("github_token").unwrap(), "integrations.github.token");
        assert_eq!(map_secret_name("hubspot_api_key").unwrap(), "integrations.hubspot.api_key");
        assert_eq!(map_secret_name("linear_api_key").unwrap(), "integrations.linear.api_key");
    }

    #[test]
    fn test_map_secret_name_invalid() {
        assert!(map_secret_name("invalid_name").is_err());
    }
}
