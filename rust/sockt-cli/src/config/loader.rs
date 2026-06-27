use std::path::{Path, PathBuf};

use super::{ConfigError, SocktConfig};

pub struct ConfigLoader {
    path: PathBuf,
}

impl ConfigLoader {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn from_default_or_override(config_override: Option<PathBuf>) -> Self {
        let path = config_override.unwrap_or_else(|| config_dir().join("config.yaml"));
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> Result<SocktConfig, ConfigError> {
        if !self.path.exists() {
            return Err(ConfigError::NotFound(self.path.clone()));
        }
        let contents = std::fs::read_to_string(&self.path)?;
        let config: SocktConfig = serde_yaml::from_str(&contents)?;
        Ok(config)
    }

    pub fn save(&self, config: &SocktConfig) -> Result<(), ConfigError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let yaml = serde_yaml::to_string(config)?;
        std::fs::write(&self.path, yaml)?;
        Ok(())
    }
}

pub fn config_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".sockt")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::Tier;
    use crate::config::{EncryptedValue, GBrainConfig, ModelConfig, SlackConfig};
    use tempfile::TempDir;

    #[test]
    fn load_from_valid_yaml() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("config.yaml");
        let config = SocktConfig::default();
        let yaml = serde_yaml::to_string(&config).unwrap();
        std::fs::write(&path, &yaml).unwrap();

        let loader = ConfigLoader::new(path);
        let loaded = loader.load().unwrap();
        assert_eq!(loaded.tier, Tier::Local);
    }

    #[test]
    fn load_nonexistent_returns_not_found() {
        let loader = ConfigLoader::new(PathBuf::from("/nonexistent/config.yaml"));
        let result = loader.load();
        assert!(matches!(result, Err(ConfigError::NotFound(_))));
    }

    #[test]
    fn load_invalid_yaml_returns_yaml_error() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("config.yaml");
        std::fs::write(&path, "not: [valid{yaml").unwrap();

        let loader = ConfigLoader::new(path);
        let result = loader.load();
        assert!(matches!(result, Err(ConfigError::Yaml(_))));
    }

    #[test]
    fn load_empty_file_returns_error() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("config.yaml");
        std::fs::write(&path, "").unwrap();

        let loader = ConfigLoader::new(path);
        let result = loader.load();
        assert!(result.is_err());
    }

    #[test]
    fn load_partial_yaml_returns_error() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("config.yaml");
        std::fs::write(&path, "tier: local\n").unwrap();

        let loader = ConfigLoader::new(path);
        let result = loader.load();
        assert!(result.is_err());
    }

    #[test]
    fn save_creates_parent_dirs() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("nested").join("deep").join("config.yaml");
        let loader = ConfigLoader::new(path.clone());
        let config = SocktConfig::default();
        loader.save(&config).unwrap();
        assert!(path.exists());
    }

    #[test]
    fn save_then_load_roundtrip() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("config.yaml");
        let loader = ConfigLoader::new(path);

        let mut config = SocktConfig::default();
        config.deployment_id = "roundtrip-test".to_string();
        loader.save(&config).unwrap();

        let loaded = loader.load().unwrap();
        assert_eq!(loaded.deployment_id, "roundtrip-test");
    }

    #[test]
    fn save_then_load_preserves_all_fields() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("config.yaml");
        let loader = ConfigLoader::new(path);

        let config = SocktConfig {
            version: "1.2.3".to_string(),
            tier: Tier::Enterprise,
            deployment_id: "ent-123".to_string(),
            slack: SlackConfig {
                app_token: EncryptedValue {
                    ciphertext: "ct1".to_string(),
                    recipient: "r1".to_string(),
                },
                bot_token: EncryptedValue {
                    ciphertext: "ct2".to_string(),
                    recipient: "r2".to_string(),
                },
                signing_secret: EncryptedValue {
                    ciphertext: "ct3".to_string(),
                    recipient: "r3".to_string(),
                },
                socket_mode: false,
            },
            models: ModelConfig {
                provider: crate::config::ModelProvider::Anthropic,
                frontier: "custom-frontier".to_string(),
                fast: "custom-fast".to_string(),
                api_key: EncryptedValue {
                    ciphertext: "ct4".to_string(),
                    recipient: "r4".to_string(),
                },
                base_url: None,
                aws_region: None,
            },
            gbrain: GBrainConfig {
                directory: PathBuf::from("/custom/gbrain"),
                soul_file: "CUSTOM_SOUL.md".to_string(),
                agents_file: "CUSTOM_AGENTS.md".to_string(),
            },
        };

        loader.save(&config).unwrap();
        let loaded = loader.load().unwrap();

        assert_eq!(loaded.version, "1.2.3");
        assert_eq!(loaded.tier, Tier::Enterprise);
        assert_eq!(loaded.deployment_id, "ent-123");
        assert!(!loaded.slack.socket_mode);
        assert_eq!(loaded.slack.app_token.ciphertext, "ct1");
        assert_eq!(loaded.models.frontier, "custom-frontier");
        assert_eq!(loaded.gbrain.directory, PathBuf::from("/custom/gbrain"));
        assert_eq!(loaded.gbrain.soul_file, "CUSTOM_SOUL.md");
    }

    #[test]
    fn save_overwrites_existing_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("config.yaml");
        let loader = ConfigLoader::new(path);

        let mut config = SocktConfig::default();
        config.deployment_id = "first".to_string();
        loader.save(&config).unwrap();

        config.deployment_id = "second".to_string();
        loader.save(&config).unwrap();

        let loaded = loader.load().unwrap();
        assert_eq!(loaded.deployment_id, "second");
    }

    #[test]
    fn from_default_or_override_uses_override() {
        let loader = ConfigLoader::from_default_or_override(Some(PathBuf::from("/custom/path.yaml")));
        assert_eq!(loader.path(), Path::new("/custom/path.yaml"));
    }

    #[test]
    fn from_default_or_override_uses_default_when_none() {
        let loader = ConfigLoader::from_default_or_override(None);
        let path_str = loader.path().to_string_lossy();
        assert!(path_str.contains(".sockt"));
        assert!(path_str.ends_with("config.yaml"));
    }

    #[test]
    fn config_dir_ends_with_sockt() {
        let dir = config_dir();
        assert!(dir.ends_with(".sockt"));
    }

    #[test]
    fn save_produces_readable_yaml() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("config.yaml");
        let loader = ConfigLoader::new(path.clone());
        let config = SocktConfig::default();
        loader.save(&config).unwrap();

        let contents = std::fs::read_to_string(&path).unwrap();
        // Should be human-readable YAML, not binary
        assert!(contents.contains("tier:"));
        assert!(contents.contains("deployment_id:"));
        assert!(contents.contains("slack:"));
        assert!(contents.contains("models:"));
    }

    #[test]
    fn multiple_saves_do_not_corrupt() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("config.yaml");
        let loader = ConfigLoader::new(path);

        for i in 0..20 {
            let mut config = SocktConfig::default();
            config.deployment_id = format!("id-{}", i);
            loader.save(&config).unwrap();

            let loaded = loader.load().unwrap();
            assert_eq!(loaded.deployment_id, format!("id-{}", i));
        }
    }
}
