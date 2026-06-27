use crate::config::dot_path::DotPath;
use crate::config::{EncryptedValue, SocktConfig};

pub struct SecretDetector;

impl SecretDetector {
    pub fn is_secret(path: &DotPath) -> bool {
        let segments: Vec<&str> = path.segments().iter().map(|s| s.as_str()).collect();
        match segments.as_slice() {
            ["models", "api_key"] => true,
            ["slack", field] if field.contains("token") || field.contains("secret") => true,
            ["integrations", _, field] if field.contains("token") || field.contains("key") || field.contains("secret") => true,
            _ => false,
        }
    }

    pub fn is_read_only(path: &DotPath) -> bool {
        let segments: Vec<&str> = path.segments().iter().map(|s| s.as_str()).collect();
        matches!(segments.as_slice(), ["version"] | ["tier"] | ["deployment_id"])
    }

    pub fn needs_restart(path: &DotPath) -> bool {
        matches!(path.segments().first().map(|s| s.as_str()), Some("models") | Some("schedule"))
    }
}

/// Iterator over all secrets in a config (immutable references)
pub fn all_secrets(config: &SocktConfig) -> impl Iterator<Item = (String, &EncryptedValue)> {
    let mut secrets = vec![
        ("models.api_key".to_string(), &config.models.api_key),
        ("slack.app_token".to_string(), &config.slack.app_token),
        ("slack.bot_token".to_string(), &config.slack.bot_token),
        ("slack.signing_secret".to_string(), &config.slack.signing_secret),
    ];

    // Add integration secrets if present
    if let Some(ref github) = config.integrations.github {
        secrets.push(("integrations.github.token".to_string(), &github.token));
    }
    if let Some(ref hubspot) = config.integrations.hubspot {
        secrets.push(("integrations.hubspot.api_key".to_string(), &hubspot.api_key));
    }
    if let Some(ref linear) = config.integrations.linear {
        secrets.push(("integrations.linear.api_key".to_string(), &linear.api_key));
    }
    if let Some(ref sentry) = config.integrations.sentry {
        secrets.push(("integrations.sentry.auth_token".to_string(), &sentry.auth_token));
    }
    if let Some(ref pagerduty) = config.integrations.pagerduty {
        secrets.push(("integrations.pagerduty.api_token".to_string(), &pagerduty.api_token));
    }
    if let Some(ref apollo) = config.integrations.apollo {
        secrets.push(("integrations.apollo.api_key".to_string(), &apollo.api_key));
    }

    secrets.into_iter()
}

/// Iterator over all secrets in a config (mutable references)
pub fn all_secrets_mut(config: &mut SocktConfig) -> impl Iterator<Item = (String, &mut EncryptedValue)> {
    let mut secrets: Vec<(String, &mut EncryptedValue)> = vec![
        ("models.api_key".to_string(), &mut config.models.api_key),
        ("slack.app_token".to_string(), &mut config.slack.app_token),
        ("slack.bot_token".to_string(), &mut config.slack.bot_token),
        ("slack.signing_secret".to_string(), &mut config.slack.signing_secret),
    ];

    // Add integration secrets if present
    if let Some(ref mut github) = config.integrations.github {
        secrets.push(("integrations.github.token".to_string(), &mut github.token));
    }
    if let Some(ref mut hubspot) = config.integrations.hubspot {
        secrets.push(("integrations.hubspot.api_key".to_string(), &mut hubspot.api_key));
    }
    if let Some(ref mut linear) = config.integrations.linear {
        secrets.push(("integrations.linear.api_key".to_string(), &mut linear.api_key));
    }
    if let Some(ref mut sentry) = config.integrations.sentry {
        secrets.push(("integrations.sentry.auth_token".to_string(), &mut sentry.auth_token));
    }
    if let Some(ref mut pagerduty) = config.integrations.pagerduty {
        secrets.push(("integrations.pagerduty.api_token".to_string(), &mut pagerduty.api_token));
    }
    if let Some(ref mut apollo) = config.integrations.apollo {
        secrets.push(("integrations.apollo.api_key".to_string(), &mut apollo.api_key));
    }

    secrets.into_iter()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::dot_path::DotPath;

    #[test]
    fn api_key_is_secret() {
        let path = DotPath::parse("models.api_key").unwrap();
        assert!(SecretDetector::is_secret(&path));
    }

    #[test]
    fn app_token_is_secret() {
        let path = DotPath::parse("slack.app_token").unwrap();
        assert!(SecretDetector::is_secret(&path));
    }

    #[test]
    fn bot_token_is_secret() {
        let path = DotPath::parse("slack.bot_token").unwrap();
        assert!(SecretDetector::is_secret(&path));
    }

    #[test]
    fn signing_secret_is_secret() {
        let path = DotPath::parse("slack.signing_secret").unwrap();
        assert!(SecretDetector::is_secret(&path));
    }

    #[test]
    fn frontier_is_not_secret() {
        let path = DotPath::parse("models.frontier").unwrap();
        assert!(!SecretDetector::is_secret(&path));
    }

    #[test]
    fn provider_is_not_secret() {
        let path = DotPath::parse("models.provider").unwrap();
        assert!(!SecretDetector::is_secret(&path));
    }

    #[test]
    fn tier_is_read_only() {
        let path = DotPath::parse("tier").unwrap();
        assert!(SecretDetector::is_read_only(&path));
    }

    #[test]
    fn version_is_read_only() {
        let path = DotPath::parse("version").unwrap();
        assert!(SecretDetector::is_read_only(&path));
    }

    #[test]
    fn deployment_id_is_read_only() {
        let path = DotPath::parse("deployment_id").unwrap();
        assert!(SecretDetector::is_read_only(&path));
    }

    #[test]
    fn frontier_is_not_read_only() {
        let path = DotPath::parse("models.frontier").unwrap();
        assert!(!SecretDetector::is_read_only(&path));
    }

    #[test]
    fn secret_iterator_yields_core_secrets() {
        use crate::config::SocktConfig;
        let config = SocktConfig::default();
        let secrets: Vec<_> = super::all_secrets(&config).collect();
        assert_eq!(secrets.len(), 4); // models.api_key + 3 slack
    }

    #[test]
    fn secret_iterator_paths_are_correct() {
        use crate::config::SocktConfig;
        let config = SocktConfig::default();
        let paths: Vec<_> = super::all_secrets(&config).map(|(path, _)| path).collect();
        assert!(paths.contains(&"models.api_key".to_string()));
        assert!(paths.contains(&"slack.app_token".to_string()));
        assert!(paths.contains(&"slack.bot_token".to_string()));
        assert!(paths.contains(&"slack.signing_secret".to_string()));
    }

    #[test]
    fn secret_iterator_with_integration() {
        use crate::config::{EncryptedValue, GitHubConfig, SocktConfig};
        let mut config = SocktConfig::default();
        config.integrations.github = Some(GitHubConfig {
            token: EncryptedValue::default(),
            organization: None,
            repositories: vec![],
        });
        let paths: Vec<_> = super::all_secrets(&config).map(|(path, _)| path).collect();
        assert!(paths.contains(&"integrations.github.token".to_string()));
    }

    #[test]
    fn secret_iterator_mut_allows_modification() {
        use crate::config::SocktConfig;
        let mut config = SocktConfig::default();
        for (_, encrypted) in super::all_secrets_mut(&mut config) {
            encrypted.ciphertext = "modified".to_string();
        }
        assert_eq!(config.models.api_key.ciphertext, "modified");
    }
}
