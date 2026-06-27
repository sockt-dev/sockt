pub mod loader;
pub mod dot_path;
pub mod secrets;
pub mod accessor;
pub mod formatter;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use thiserror::Error;

use crate::cli::Tier;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("config file not found: {0}")]
    NotFound(PathBuf),
    #[error("invalid config: {0}")]
    Invalid(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("YAML error: {0}")]
    Yaml(#[from] serde_yaml::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModelProvider {
    Anthropic,
    Openai,
    Bedrock,
    Custom,
}

impl Default for ModelProvider {
    fn default() -> Self {
        Self::Anthropic
    }
}

impl std::fmt::Display for ModelProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Anthropic => write!(f, "anthropic"),
            Self::Openai => write!(f, "openai"),
            Self::Bedrock => write!(f, "bedrock"),
            Self::Custom => write!(f, "custom"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocktConfig {
    #[serde(default = "default_version")]
    pub version: String,
    pub tier: Tier,
    #[serde(default = "default_deployment_id")]
    pub deployment_id: String,
    pub slack: SlackConfig,
    pub models: ModelConfig,
    #[serde(default)]
    pub gbrain: GBrainConfig,
    #[serde(default)]
    pub integrations: IntegrationsConfig,
}

fn default_version() -> String {
    "0.1.0".to_string()
}

fn default_deployment_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

impl Default for SocktConfig {
    fn default() -> Self {
        Self {
            version: default_version(),
            tier: Tier::Local,
            deployment_id: default_deployment_id(),
            slack: SlackConfig::default(),
            models: ModelConfig::default(),
            gbrain: GBrainConfig::default(),
            integrations: IntegrationsConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackConfig {
    pub app_token: EncryptedValue,
    pub signing_secret: EncryptedValue,
    pub bot_token: EncryptedValue,
    #[serde(default = "default_true")]
    pub socket_mode: bool,
}

fn default_true() -> bool {
    true
}

impl Default for SlackConfig {
    fn default() -> Self {
        Self {
            app_token: EncryptedValue::default(),
            bot_token: EncryptedValue::default(),
            signing_secret: EncryptedValue::default(),
            socket_mode: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    #[serde(default)]
    pub provider: ModelProvider,
    #[serde(default = "default_frontier")]
    pub frontier: String,
    #[serde(default = "default_fast")]
    pub fast: String,
    pub api_key: EncryptedValue,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aws_region: Option<String>,
}

fn default_frontier() -> String {
    "claude-sonnet-4-20250514".to_string()
}

fn default_fast() -> String {
    "claude-haiku-4-20250514".to_string()
}

impl Default for ModelConfig {
    fn default() -> Self {
        Self {
            provider: ModelProvider::default(),
            frontier: default_frontier(),
            fast: default_fast(),
            api_key: EncryptedValue::default(),
            base_url: None,
            aws_region: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GBrainConfig {
    #[serde(default = "default_gbrain_dir")]
    pub directory: PathBuf,
    #[serde(default = "default_soul_file")]
    pub soul_file: String,
    #[serde(default = "default_agents_file")]
    pub agents_file: String,
}

fn default_gbrain_dir() -> PathBuf {
    PathBuf::from("./gbrain")
}

fn default_soul_file() -> String {
    "SOUL.md".to_string()
}

fn default_agents_file() -> String {
    "AGENTS.md".to_string()
}

impl Default for GBrainConfig {
    fn default() -> Self {
        Self {
            directory: default_gbrain_dir(),
            soul_file: default_soul_file(),
            agents_file: default_agents_file(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EncryptedValue {
    #[serde(default)]
    pub ciphertext: String,
    #[serde(default)]
    pub recipient: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IntegrationsConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github: Option<GitHubConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hubspot: Option<HubSpotConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linear: Option<LinearConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sentry: Option<SentryConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pagerduty: Option<PagerDutyConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub apollo: Option<ApolloConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubConfig {
    pub token: EncryptedValue,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organization: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub repositories: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HubSpotConfig {
    pub api_key: EncryptedValue,
    pub portal_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearConfig {
    pub api_key: EncryptedValue,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SentryConfig {
    pub auth_token: EncryptedValue,
    pub dsn: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organization_slug: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PagerDutyConfig {
    pub api_token: EncryptedValue,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub service_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApolloConfig {
    pub api_key: EncryptedValue,
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn tier_roundtrip_yaml() {
        for tier in [Tier::Local, Tier::Cloud, Tier::Enterprise] {
            let yaml = serde_yaml::to_string(&tier).unwrap();
            let parsed: Tier = serde_yaml::from_str(&yaml).unwrap();
            assert_eq!(parsed, tier);
        }
    }

    #[test]
    fn tier_serializes_lowercase() {
        assert_eq!(serde_yaml::to_string(&Tier::Local).unwrap().trim(), "local");
        assert_eq!(serde_yaml::to_string(&Tier::Cloud).unwrap().trim(), "cloud");
        assert_eq!(
            serde_yaml::to_string(&Tier::Enterprise).unwrap().trim(),
            "enterprise"
        );
    }

    #[test]
    fn tier_rejects_unknown_values() {
        let cases = ["staging", "dev", "prod", "LOCAL", "Cloud", "ENTERPRISE", ""];
        for case in cases {
            let yaml = format!("\"{}\"", case);
            let result = serde_yaml::from_str::<Tier>(&yaml);
            assert!(result.is_err(), "should reject tier value: {:?}", case);
        }
    }

    #[test]
    fn tier_json_roundtrip() {
        for tier in [Tier::Local, Tier::Cloud, Tier::Enterprise] {
            let json = serde_json::to_string(&tier).unwrap();
            let parsed: Tier = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed, tier);
        }
    }

    #[test]
    fn config_roundtrip() {
        let config = SocktConfig {
            version: "0.1.0".to_string(),
            tier: Tier::Local,
            deployment_id: "test-id".to_string(),
            slack: SlackConfig {
                app_token: EncryptedValue {
                    ciphertext: "enc_app".to_string(),
                    recipient: "age1recipient".to_string(),
                },
                bot_token: EncryptedValue {
                    ciphertext: "enc_bot".to_string(),
                    recipient: "age1recipient".to_string(),
                },
                signing_secret: EncryptedValue {
                    ciphertext: "enc_secret".to_string(),
                    recipient: "age1recipient".to_string(),
                },
                socket_mode: true,
            },
            models: ModelConfig {
                provider: ModelProvider::Anthropic,
                frontier: "claude-sonnet-4-20250514".to_string(),
                fast: "claude-haiku-4-20250514".to_string(),
                api_key: EncryptedValue {
                    ciphertext: "enc_key".to_string(),
                    recipient: "age1recipient".to_string(),
                },
                base_url: None,
                aws_region: None,
            },
            gbrain: GBrainConfig::default(),
            integrations: Default::default(),
        };

        let yaml = serde_yaml::to_string(&config).unwrap();
        let parsed: SocktConfig = serde_yaml::from_str(&yaml).unwrap();

        assert_eq!(parsed.version, config.version);
        assert_eq!(parsed.tier, config.tier);
        assert_eq!(parsed.deployment_id, config.deployment_id);
        assert_eq!(parsed.slack.app_token.ciphertext, "enc_app");
        assert_eq!(parsed.models.frontier, "claude-sonnet-4-20250514");
        assert_eq!(parsed.models.provider, ModelProvider::Anthropic);
    }

    #[test]
    fn config_roundtrip_all_tiers() {
        for tier in [Tier::Local, Tier::Cloud, Tier::Enterprise] {
            let config = SocktConfig {
                tier: tier.clone(),
                ..Default::default()
            };
            let yaml = serde_yaml::to_string(&config).unwrap();
            let parsed: SocktConfig = serde_yaml::from_str(&yaml).unwrap();
            assert_eq!(parsed.tier, tier);
        }
    }

    #[test]
    fn config_defaults_for_gbrain() {
        let yaml = r#"
tier: local
deployment_id: test
slack:
  app_token: { ciphertext: "", recipient: "" }
  bot_token: { ciphertext: "", recipient: "" }
  signing_secret: { ciphertext: "", recipient: "" }
models:
  frontier: claude-sonnet-4-20250514
  fast: claude-haiku-4-20250514
  api_key: { ciphertext: "", recipient: "" }
"#;
        let config: SocktConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(config.gbrain.directory, PathBuf::from("./gbrain"));
        assert_eq!(config.gbrain.soul_file, "SOUL.md");
        assert_eq!(config.gbrain.agents_file, "AGENTS.md");
    }

    #[test]
    fn config_defaults_for_version() {
        let yaml = r#"
tier: local
deployment_id: test
slack:
  app_token: { ciphertext: "", recipient: "" }
  bot_token: { ciphertext: "", recipient: "" }
  signing_secret: { ciphertext: "", recipient: "" }
models:
  frontier: test
  fast: test
  api_key: { ciphertext: "", recipient: "" }
"#;
        let config: SocktConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(config.version, "0.1.0");
    }

    #[test]
    fn config_socket_mode_defaults_true() {
        let yaml = r#"
tier: local
deployment_id: test
slack:
  app_token: { ciphertext: "", recipient: "" }
  bot_token: { ciphertext: "", recipient: "" }
  signing_secret: { ciphertext: "", recipient: "" }
models:
  frontier: test
  fast: test
  api_key: { ciphertext: "", recipient: "" }
"#;
        let config: SocktConfig = serde_yaml::from_str(yaml).unwrap();
        assert!(config.slack.socket_mode);
    }

    #[test]
    fn config_socket_mode_can_be_false() {
        let yaml = r#"
tier: cloud
deployment_id: test
slack:
  app_token: { ciphertext: "", recipient: "" }
  bot_token: { ciphertext: "", recipient: "" }
  signing_secret: { ciphertext: "", recipient: "" }
  socket_mode: false
models:
  frontier: test
  fast: test
  api_key: { ciphertext: "", recipient: "" }
"#;
        let config: SocktConfig = serde_yaml::from_str(yaml).unwrap();
        assert!(!config.slack.socket_mode);
    }

    #[test]
    fn invalid_yaml_produces_error() {
        let bad_yaml = "tier: [not valid{{{";
        let result = serde_yaml::from_str::<SocktConfig>(bad_yaml);
        assert!(result.is_err());
    }

    #[test]
    fn empty_yaml_produces_error() {
        let result = serde_yaml::from_str::<SocktConfig>("");
        assert!(result.is_err());
    }

    #[test]
    fn yaml_missing_required_fields_produces_error() {
        let cases = [
            "tier: local\n",
            "deployment_id: abc\n",
            "tier: local\nslack: {}\n",
        ];
        for yaml in cases {
            let result = serde_yaml::from_str::<SocktConfig>(yaml);
            assert!(result.is_err(), "should fail for: {:?}", yaml);
        }
    }

    #[test]
    fn encrypted_value_serializes_without_plaintext() {
        let ev = EncryptedValue {
            ciphertext: "AGE_ENCRYPTED_DATA".to_string(),
            recipient: "age1xyz".to_string(),
        };
        let yaml = serde_yaml::to_string(&ev).unwrap();
        assert!(yaml.contains("ciphertext"));
        assert!(yaml.contains("recipient"));
        assert!(!yaml.contains("plaintext"));
    }

    #[test]
    fn encrypted_value_empty_is_valid() {
        let ev = EncryptedValue::default();
        let yaml = serde_yaml::to_string(&ev).unwrap();
        let parsed: EncryptedValue = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed.ciphertext, "");
        assert_eq!(parsed.recipient, "");
    }

    #[test]
    fn config_preserves_custom_gbrain_path() {
        let yaml = r#"
tier: local
deployment_id: test
slack:
  app_token: { ciphertext: "", recipient: "" }
  bot_token: { ciphertext: "", recipient: "" }
  signing_secret: { ciphertext: "", recipient: "" }
models:
  frontier: test
  fast: test
  api_key: { ciphertext: "", recipient: "" }
gbrain:
  directory: /opt/custom/gbrain
  soul_file: MY_SOUL.md
  agents_file: MY_AGENTS.md
"#;
        let config: SocktConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(config.gbrain.directory, PathBuf::from("/opt/custom/gbrain"));
        assert_eq!(config.gbrain.soul_file, "MY_SOUL.md");
        assert_eq!(config.gbrain.agents_file, "MY_AGENTS.md");
    }

    #[test]
    fn config_deployment_id_uniqueness() {
        let c1 = SocktConfig::default();
        let c2 = SocktConfig::default();
        assert_ne!(c1.deployment_id, c2.deployment_id);
    }

    #[test]
    fn config_handles_unicode_values() {
        let config = SocktConfig {
            deployment_id: "テスト-deployment-🚀".to_string(),
            ..Default::default()
        };
        let yaml = serde_yaml::to_string(&config).unwrap();
        let parsed: SocktConfig = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed.deployment_id, "テスト-deployment-🚀");
    }

    #[test]
    fn config_handles_special_yaml_characters() {
        let config = SocktConfig {
            deployment_id: "id: with-colons & ampersands # and comments".to_string(),
            ..Default::default()
        };
        let yaml = serde_yaml::to_string(&config).unwrap();
        let parsed: SocktConfig = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(
            parsed.deployment_id,
            "id: with-colons & ampersands # and comments"
        );
    }

    #[test]
    fn config_handles_very_long_values() {
        let long_value = "x".repeat(10_000);
        let config = SocktConfig {
            deployment_id: long_value.clone(),
            ..Default::default()
        };
        let yaml = serde_yaml::to_string(&config).unwrap();
        let parsed: SocktConfig = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed.deployment_id, long_value);
    }

    #[test]
    fn encrypted_value_handles_multiline_ciphertext() {
        let ev = EncryptedValue {
            ciphertext: "line1\nline2\nline3".to_string(),
            recipient: "age1abc".to_string(),
        };
        let yaml = serde_yaml::to_string(&ev).unwrap();
        let parsed: EncryptedValue = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed.ciphertext, ev.ciphertext);
    }

    // Property-based tests
    proptest! {
        #[test]
        fn encrypted_value_roundtrip_any_string(
            ciphertext in ".*",
            recipient in "age1[a-z0-9]{10,20}",
        ) {
            let ev = EncryptedValue { ciphertext: ciphertext.clone(), recipient: recipient.clone() };
            let yaml = serde_yaml::to_string(&ev).unwrap();
            let parsed: EncryptedValue = serde_yaml::from_str(&yaml).unwrap();
            prop_assert_eq!(parsed.ciphertext, ciphertext);
            prop_assert_eq!(parsed.recipient, recipient);
        }

        #[test]
        fn deployment_id_survives_roundtrip(id in "[a-zA-Z0-9_-]{1,100}") {
            let config = SocktConfig {
                deployment_id: id.clone(),
                ..Default::default()
            };
            let yaml = serde_yaml::to_string(&config).unwrap();
            let parsed: SocktConfig = serde_yaml::from_str(&yaml).unwrap();
            prop_assert_eq!(parsed.deployment_id, id);
        }

        #[test]
        fn model_names_survive_roundtrip(
            frontier in "[a-z]+-[a-z0-9-]+",
            fast in "[a-z]+-[a-z0-9-]+",
        ) {
            let config = SocktConfig {
                models: ModelConfig {
                    frontier: frontier.clone(),
                    fast: fast.clone(),
                    ..Default::default()
                },
                ..Default::default()
            };
            let yaml = serde_yaml::to_string(&config).unwrap();
            let parsed: SocktConfig = serde_yaml::from_str(&yaml).unwrap();
            prop_assert_eq!(parsed.models.frontier, frontier);
            prop_assert_eq!(parsed.models.fast, fast);
        }
    }
}
