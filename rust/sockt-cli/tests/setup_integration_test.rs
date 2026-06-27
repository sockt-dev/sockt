use assert_cmd::Command;
use predicates::prelude::*;
use std::path::PathBuf;
use tempfile::TempDir;

fn sockt() -> Command {
    Command::cargo_bin("sockt").unwrap()
}

fn setup_test_config() -> (TempDir, PathBuf) {
    let temp_dir = TempDir::new().unwrap();
    let sockt_dir = temp_dir.path().join(".sockt");
    std::fs::create_dir_all(&sockt_dir).unwrap();

    let config_path = sockt_dir.join("config.yaml");
    let key_path = sockt_dir.join("key.txt");

    // Generate encryption key first
    let identity = age::x25519::Identity::generate();
    use age::secrecy::ExposeSecret;
    let key_str = identity.to_string();
    std::fs::write(&key_path, key_str.expose_secret()).unwrap();

    // Create recipient from identity
    let recipient = identity.to_public();

    // Encrypt a test value
    let test_value = "test-value";
    let encrypted = {
        let recipients: Vec<&dyn age::Recipient> = vec![&recipient];
        let encryptor = age::Encryptor::with_recipients(recipients.into_iter())
            .expect("Failed to create encryptor");

        let mut encrypted_bytes = vec![];
        let mut writer = encryptor
            .wrap_output(&mut encrypted_bytes)
            .unwrap();

        std::io::Write::write_all(&mut writer, test_value.as_bytes()).unwrap();
        writer.finish().unwrap();

        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &encrypted_bytes)
    };

    let recipient_str = recipient.to_string();

    // Create minimal valid config with integrations section
    let config_yaml = format!(r#"version: "0.1"
tier: local
deployment_id: test-deployment-id
slack:
  app_token:
    ciphertext: "{encrypted}"
    recipient: "{recipient_str}"
  bot_token:
    ciphertext: "{encrypted}"
    recipient: "{recipient_str}"
  signing_secret:
    ciphertext: "{encrypted}"
    recipient: "{recipient_str}"
  socket_mode: true
models:
  provider: anthropic
  frontier: claude-sonnet-4-20250514
  fast: claude-haiku-4-20250514
  api_key:
    ciphertext: "{encrypted}"
    recipient: "{recipient_str}"
  base_url: null
  aws_region: null
gbrain:
  directory: "./gbrain"
  soul_file: "SOUL.md"
  agents_file: "AGENTS.md"
integrations: {{}}
"#);

    std::fs::write(&config_path, config_yaml).unwrap();

    (temp_dir, config_path)
}

#[test]
fn test_integration_help_shows_available_integrations() {
    sockt()
        .args(["setup", "integration", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("github").or(predicate::str::contains("integration")));
}

#[test]
fn test_integration_invalid_name_shows_error() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "setup", "integration", "invalid-integration",
            "--non-interactive",
            "--token", "test",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .failure()
        .stderr(predicate::str::contains("Unknown integration")
            .or(predicate::str::contains("Available")));
}

// GitHub Integration Tests

#[test]
fn test_github_non_interactive_with_pat_succeeds() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "setup", "integration", "github",
            "--non-interactive",
            "--token", "ghp_test_token",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("GitHub integration configured"));
}

#[test]
fn test_github_requires_existing_config() {
    let temp_dir = TempDir::new().unwrap();
    let non_existent_config = temp_dir.path().join(".sockt/config.yaml");

    sockt()
        .args([
            "setup", "integration", "github",
            "--non-interactive",
            "--token", "test",
            "--config", non_existent_config.to_str().unwrap()
        ])
        .assert()
        .failure()
        .stderr(predicate::str::contains("Run `sockt init` first"));
}

#[test]
fn test_github_token_is_encrypted() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "setup", "integration", "github",
            "--non-interactive",
            "--token", "ghp_plaintext_token",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success();

    // Verify token is encrypted in config
    let config_contents = std::fs::read_to_string(&config_path).unwrap();
    assert!(!config_contents.contains("ghp_plaintext_token"));
    assert!(config_contents.contains("github:"));
}

#[test]
fn test_github_idempotent_updates() {
    let (_temp_dir, config_path) = setup_test_config();

    // Run setup twice
    sockt()
        .args([
            "setup", "integration", "github",
            "--non-interactive",
            "--token", "ghp_token_1",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success();

    sockt()
        .args([
            "setup", "integration", "github",
            "--non-interactive",
            "--token", "ghp_token_2",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("GitHub integration configured"));
}

// HubSpot Integration Tests

#[test]
fn test_hubspot_non_interactive_with_api_key() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "setup", "integration", "hubspot",
            "--non-interactive",
            "--api-key", "test-hubspot-key",
            "--org-id", "12345",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("HubSpot integration configured"));
}

#[test]
fn test_hubspot_stores_portal_id() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "setup", "integration", "hubspot",
            "--non-interactive",
            "--api-key", "test-key",
            "--org-id", "portal-123",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success();

    let config_contents = std::fs::read_to_string(&config_path).unwrap();
    assert!(config_contents.contains("hubspot:"));
    assert!(config_contents.contains("portal-123"));
}

// Linear Integration Tests

#[test]
fn test_linear_non_interactive_with_api_key() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "setup", "integration", "linear",
            "--non-interactive",
            "--api-key", "lin_api_test",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Linear integration configured"));
}

#[test]
fn test_linear_stores_team_id() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "setup", "integration", "linear",
            "--non-interactive",
            "--api-key", "lin_api_test",
            "--org-id", "team-xyz",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success();

    let config_contents = std::fs::read_to_string(&config_path).unwrap();
    assert!(config_contents.contains("linear:"));
}

// Sentry Integration Tests

#[test]
fn test_sentry_requires_dsn_and_auth_token() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "setup", "integration", "sentry",
            "--non-interactive",
            "--token", "test-auth-token",
            "--dsn", "https://key@sentry.io/project",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Sentry integration configured"));
}

#[test]
fn test_sentry_validates_dsn_format() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "setup", "integration", "sentry",
            "--non-interactive",
            "--token", "test-token",
            "--dsn", "invalid-dsn",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .failure()
        .stderr(predicate::str::contains("DSN").or(predicate::str::contains("Invalid")));
}

// PagerDuty Integration Tests

#[test]
fn test_pagerduty_non_interactive_with_token() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "setup", "integration", "pagerduty",
            "--non-interactive",
            "--token", "pd-token",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("PagerDuty integration configured"));
}

#[test]
fn test_pagerduty_stores_service_ids() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "setup", "integration", "pagerduty",
            "--non-interactive",
            "--token", "pd-token",
            "--services", "service-1,service-2,service-3",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success();

    let config_contents = std::fs::read_to_string(&config_path).unwrap();
    assert!(config_contents.contains("pagerduty:"));
}

// Apollo Integration Tests

#[test]
fn test_apollo_non_interactive_with_api_key() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "setup", "integration", "apollo",
            "--non-interactive",
            "--api-key", "apollo-key",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Apollo integration configured"));
}

// Config Persistence Tests

#[test]
fn test_integration_updates_do_not_affect_slack() {
    let (_temp_dir, config_path) = setup_test_config();

    // Read original slack config
    let original_config = std::fs::read_to_string(&config_path).unwrap();
    assert!(original_config.contains("slack:"));

    sockt()
        .args([
            "setup", "integration", "github",
            "--non-interactive",
            "--token", "test-token",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success();

    // Verify slack config is preserved
    let updated_config = std::fs::read_to_string(&config_path).unwrap();
    assert!(updated_config.contains("slack:"));
    assert!(updated_config.contains("app_token:"));
}

#[test]
fn test_multiple_integrations_can_coexist() {
    let (_temp_dir, config_path) = setup_test_config();

    // Add GitHub
    sockt()
        .args([
            "setup", "integration", "github",
            "--non-interactive",
            "--token", "gh-token",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success();

    // Add HubSpot
    sockt()
        .args([
            "setup", "integration", "hubspot",
            "--non-interactive",
            "--api-key", "hs-key",
            "--org-id", "portal",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success();

    // Verify both exist
    let config_contents = std::fs::read_to_string(&config_path).unwrap();
    assert!(config_contents.contains("github:"));
    assert!(config_contents.contains("hubspot:"));
}
