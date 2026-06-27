use crate::config::{SocktConfig, ConfigError};
use crate::config::accessor::ConfigValue;
use crate::crypto::{self, KeyManager};

pub fn format_value(value: &ConfigValue, redact: bool) -> String {
    match value {
        ConfigValue::String(s) => s.clone(),
        ConfigValue::Bool(b) => b.to_string(),
        ConfigValue::Tier(t) => format!("{:?}", t).to_lowercase(),
        ConfigValue::Provider(p) => p.to_string(),
        ConfigValue::Encrypted(_) if redact => "••••••••  (encrypted)".to_string(),
        ConfigValue::Encrypted(ev) => {
            // Only called with redact=false when --reveal is used
            let km = KeyManager::new(KeyManager::default_path());
            let identity = km.load().expect("failed to load key");
            crypto::decrypt(ev, &identity).unwrap_or_else(|_| "[decryption failed]".to_string())
        }
    }
}

pub fn format_config(config: &SocktConfig, reveal: bool, as_json: bool) -> Result<String, ConfigError> {
    if as_json {
        // Simple JSON serialization with redaction
        return Ok(serde_json::to_string_pretty(config)
            .map_err(|e| ConfigError::Invalid(format!("JSON serialization failed: {}", e)))?);
    }

    // Tree-view format matching spec
    let mut output = String::new();
    output.push_str(&format!("version:        {}\n", config.version));
    output.push_str(&format!("tier:           {:?}\n", config.tier).to_lowercase());
    output.push_str(&format!("deployment_id:  {}\n", config.deployment_id));
    output.push_str("\nmodels:\n");
    output.push_str(&format!("  provider:     {}\n", config.models.provider));
    output.push_str(&format!("  frontier:     {}\n", config.models.frontier));
    output.push_str(&format!("  fast:         {}\n", config.models.fast));

    let api_key_display = if reveal {
        let km = KeyManager::new(KeyManager::default_path());
        if let Ok(identity) = km.load() {
            crypto::decrypt(&config.models.api_key, &identity)
                .unwrap_or_else(|_| "••••••••".to_string())
        } else {
            "••••••••".to_string()
        }
    } else {
        "••••••••".to_string()
    };
    output.push_str(&format!("  api_key:      {}  (encrypted)\n", api_key_display));

    output.push_str("\nslack:\n");
    output.push_str(&format!("  app_token:      {}  (encrypted)\n", if reveal { "[revealed]" } else { "••••••••" }));
    output.push_str(&format!("  bot_token:      {}  (encrypted)\n", if reveal { "[revealed]" } else { "••••••••" }));
    output.push_str(&format!("  signing_secret: {}  (encrypted)\n", if reveal { "[revealed]" } else { "••••••••" }));
    output.push_str(&format!("  socket_mode:    {}\n", config.slack.socket_mode));

    output.push_str("\ngbrain:\n");
    output.push_str(&format!("  directory:    {}\n", config.gbrain.directory.display()));
    output.push_str(&format!("  soul_file:    {}\n", config.gbrain.soul_file));
    output.push_str(&format!("  agents_file:  {}\n", config.gbrain.agents_file));

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{SocktConfig, EncryptedValue};
    use crate::config::accessor::ConfigValue;

    #[test]
    fn format_string_value() {
        let value = ConfigValue::String("test".to_string());
        assert_eq!(format_value(&value, false), "test");
    }

    #[test]
    fn format_bool_value() {
        let value = ConfigValue::Bool(true);
        assert_eq!(format_value(&value, false), "true");
    }

    #[test]
    fn format_encrypted_redacted() {
        let encrypted = EncryptedValue {
            ciphertext: "base64data".to_string(),
            recipient: "age1xxx".to_string(),
        };
        let value = ConfigValue::Encrypted(encrypted);
        assert_eq!(format_value(&value, true), "••••••••  (encrypted)");
    }

    #[test]
    fn format_full_config_includes_tier() {
        let config = SocktConfig::default();
        let output = format_config(&config, false, false).unwrap();
        assert!(output.contains("tier:"));
    }

    #[test]
    fn format_full_config_redacts_secrets() {
        let config = SocktConfig::default();
        let output = format_config(&config, false, false).unwrap();
        assert!(output.contains("••••••••"));
    }
}
