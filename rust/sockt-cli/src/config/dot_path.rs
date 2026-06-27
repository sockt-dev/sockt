use crate::config::ConfigError;

#[derive(Debug, Clone, PartialEq)]
pub struct DotPath {
    segments: Vec<String>,
}

impl DotPath {
    pub fn parse(path: &str) -> Result<Self, ConfigError> {
        if path.is_empty() {
            return Err(ConfigError::Invalid("empty key path".to_string()));
        }

        if path.starts_with('.') || path.ends_with('.') {
            return Err(ConfigError::Invalid(
                format!("invalid key path '{}': cannot start or end with '.'", path)
            ));
        }

        let segments: Vec<String> = path.split('.').map(|s| s.to_string()).collect();

        if segments.iter().any(|s| s.is_empty()) {
            return Err(ConfigError::Invalid(
                format!("invalid key path '{}': empty segment", path)
            ));
        }

        Ok(Self { segments })
    }

    pub fn segments(&self) -> &[String] {
        &self.segments
    }

    pub fn to_string(&self) -> String {
        self.segments.join(".")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple_key() {
        let path = DotPath::parse("tier").unwrap();
        assert_eq!(path.segments(), &["tier"]);
    }

    #[test]
    fn parse_nested_key() {
        let path = DotPath::parse("models.frontier").unwrap();
        assert_eq!(path.segments(), &["models", "frontier"]);
    }

    #[test]
    fn parse_deeply_nested() {
        let path = DotPath::parse("integrations.github.api_key").unwrap();
        assert_eq!(path.segments(), &["integrations", "github", "api_key"]);
    }

    #[test]
    fn parse_empty_string_fails() {
        assert!(DotPath::parse("").is_err());
    }

    #[test]
    fn parse_leading_dot_fails() {
        assert!(DotPath::parse(".models").is_err());
    }

    #[test]
    fn parse_trailing_dot_fails() {
        assert!(DotPath::parse("models.").is_err());
    }

    #[test]
    fn parse_double_dot_fails() {
        assert!(DotPath::parse("models..frontier").is_err());
    }
}
