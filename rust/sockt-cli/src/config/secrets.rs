use crate::config::dot_path::DotPath;

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
}
