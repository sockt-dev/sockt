use crate::config::{SocktConfig, ConfigError, EncryptedValue, ModelProvider};
use crate::config::dot_path::DotPath;
use crate::cli::Tier;

#[derive(Debug, Clone)]
pub enum ConfigValue {
    String(String),
    Bool(bool),
    Encrypted(EncryptedValue),
    Provider(ModelProvider),
    Tier(Tier),
}

pub struct ConfigAccessor;

impl ConfigAccessor {
    pub fn get(config: &SocktConfig, path: &DotPath) -> Result<ConfigValue, ConfigError> {
        let segments: Vec<&str> = path.segments().iter().map(|s| s.as_str()).collect();
        match segments.as_slice() {
            ["version"] => Ok(ConfigValue::String(config.version.clone())),
            ["tier"] => Ok(ConfigValue::Tier(config.tier.clone())),
            ["deployment_id"] => Ok(ConfigValue::String(config.deployment_id.clone())),

            ["models", "provider"] => Ok(ConfigValue::Provider(config.models.provider.clone())),
            ["models", "frontier"] => Ok(ConfigValue::String(config.models.frontier.clone())),
            ["models", "fast"] => Ok(ConfigValue::String(config.models.fast.clone())),
            ["models", "api_key"] => Ok(ConfigValue::Encrypted(config.models.api_key.clone())),
            ["models", "base_url"] => Ok(ConfigValue::String(
                config.models.base_url.clone().unwrap_or_default()
            )),

            ["slack", "app_token"] => Ok(ConfigValue::Encrypted(config.slack.app_token.clone())),
            ["slack", "bot_token"] => Ok(ConfigValue::Encrypted(config.slack.bot_token.clone())),
            ["slack", "signing_secret"] => Ok(ConfigValue::Encrypted(config.slack.signing_secret.clone())),
            ["slack", "socket_mode"] => Ok(ConfigValue::Bool(config.slack.socket_mode)),

            ["gbrain", "directory"] => Ok(ConfigValue::String(
                config.gbrain.directory.to_string_lossy().to_string()
            )),
            ["gbrain", "soul_file"] => Ok(ConfigValue::String(config.gbrain.soul_file.clone())),
            ["gbrain", "agents_file"] => Ok(ConfigValue::String(config.gbrain.agents_file.clone())),

            _ => Err(ConfigError::Invalid(format!("unknown key '{}'", path.to_string()))),
        }
    }

    pub fn set(config: &mut SocktConfig, path: &DotPath, value: &str) -> Result<(), ConfigError> {
        let segments: Vec<&str> = path.segments().iter().map(|s| s.as_str()).collect();
        match segments.as_slice() {
            ["models", "provider"] => {
                config.models.provider = parse_provider(value)?;
            }
            ["models", "frontier"] => {
                config.models.frontier = value.to_string();
            }
            ["models", "fast"] => {
                config.models.fast = value.to_string();
            }
            ["models", "base_url"] => {
                config.models.base_url = if value.is_empty() {
                    None
                } else {
                    Some(value.to_string())
                };
            }

            ["slack", "socket_mode"] => {
                config.slack.socket_mode = parse_bool(value)?;
            }

            ["gbrain", "directory"] => {
                config.gbrain.directory = std::path::PathBuf::from(value);
            }
            ["gbrain", "soul_file"] => {
                config.gbrain.soul_file = value.to_string();
            }
            ["gbrain", "agents_file"] => {
                config.gbrain.agents_file = value.to_string();
            }

            _ => return Err(ConfigError::Invalid(
                format!("cannot set '{}': field not settable or doesn't exist", path.to_string())
            )),
        }

        Ok(())
    }
}

fn parse_bool(value: &str) -> Result<bool, ConfigError> {
    match value.to_lowercase().as_str() {
        "true" | "yes" | "1" => Ok(true),
        "false" | "no" | "0" => Ok(false),
        _ => Err(ConfigError::Invalid(
            format!("invalid boolean value '{}': expected true/false/yes/no", value)
        )),
    }
}

fn parse_provider(value: &str) -> Result<ModelProvider, ConfigError> {
    match value.to_lowercase().as_str() {
        "anthropic" => Ok(ModelProvider::Anthropic),
        "openai" => Ok(ModelProvider::Openai),
        "bedrock" => Ok(ModelProvider::Bedrock),
        "custom" => Ok(ModelProvider::Custom),
        _ => Err(ConfigError::Invalid(
            format!("unknown provider '{}': supported values are anthropic, openai, bedrock, custom", value)
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{SocktConfig, ModelProvider};
    use crate::config::dot_path::DotPath;
    use crate::cli::Tier;

    fn test_config() -> SocktConfig {
        SocktConfig {
            tier: Tier::Local,
            ..Default::default()
        }
    }

    #[test]
    fn get_root_tier() {
        let config = test_config();
        let path = DotPath::parse("tier").unwrap();
        let value = ConfigAccessor::get(&config, &path).unwrap();
        assert!(matches!(value, ConfigValue::Tier(_)));
    }

    #[test]
    fn get_models_provider() {
        let config = test_config();
        let path = DotPath::parse("models.provider").unwrap();
        let value = ConfigAccessor::get(&config, &path).unwrap();
        assert!(matches!(value, ConfigValue::Provider(_)));
    }

    #[test]
    fn get_models_frontier() {
        let config = test_config();
        let path = DotPath::parse("models.frontier").unwrap();
        let value = ConfigAccessor::get(&config, &path).unwrap();
        assert!(matches!(value, ConfigValue::String(_)));
    }

    #[test]
    fn get_slack_socket_mode() {
        let config = test_config();
        let path = DotPath::parse("slack.socket_mode").unwrap();
        let value = ConfigAccessor::get(&config, &path).unwrap();
        assert!(matches!(value, ConfigValue::Bool(_)));
    }

    #[test]
    fn get_models_api_key() {
        let config = test_config();
        let path = DotPath::parse("models.api_key").unwrap();
        let value = ConfigAccessor::get(&config, &path).unwrap();
        assert!(matches!(value, ConfigValue::Encrypted(_)));
    }

    #[test]
    fn get_unknown_key_fails() {
        let config = test_config();
        let path = DotPath::parse("unknown").unwrap();
        assert!(ConfigAccessor::get(&config, &path).is_err());
    }

    #[test]
    fn set_models_frontier() {
        let mut config = test_config();
        let path = DotPath::parse("models.frontier").unwrap();
        ConfigAccessor::set(&mut config, &path, "claude-opus-4").unwrap();
        assert_eq!(config.models.frontier, "claude-opus-4");
    }

    #[test]
    fn set_slack_socket_mode_true() {
        let mut config = test_config();
        let path = DotPath::parse("slack.socket_mode").unwrap();
        ConfigAccessor::set(&mut config, &path, "true").unwrap();
        assert!(config.slack.socket_mode);
    }

    #[test]
    fn set_slack_socket_mode_false() {
        let mut config = test_config();
        let path = DotPath::parse("slack.socket_mode").unwrap();
        ConfigAccessor::set(&mut config, &path, "false").unwrap();
        assert!(!config.slack.socket_mode);
    }

    #[test]
    fn set_invalid_bool_fails() {
        let mut config = test_config();
        let path = DotPath::parse("slack.socket_mode").unwrap();
        assert!(ConfigAccessor::set(&mut config, &path, "maybe").is_err());
    }
}
