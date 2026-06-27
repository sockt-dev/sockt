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

    // Encrypt a test API key
    let test_api_key = "sk-test-key";
    let encrypted = {
        let recipients: Vec<&dyn age::Recipient> = vec![&recipient];
        let encryptor = age::Encryptor::with_recipients(recipients.into_iter())
            .expect("Failed to create encryptor");

        let mut encrypted_bytes = vec![];
        let mut writer = encryptor
            .wrap_output(&mut encrypted_bytes)
            .unwrap();

        std::io::Write::write_all(&mut writer, test_api_key.as_bytes()).unwrap();
        writer.finish().unwrap();

        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &encrypted_bytes)
    };

    let recipient_str = recipient.to_string();

    // Create minimal valid config
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
"#);

    std::fs::write(&config_path, config_yaml).unwrap();

    (temp_dir, config_path)
}

#[test]
fn test_llm_help_shows_options() {
    sockt()
        .args(["setup", "llm", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("LLM"))
        .stdout(predicate::str::contains("--provider"))
        .stdout(predicate::str::contains("--api-key"));
}

#[test]
fn test_llm_non_interactive_anthropic_succeeds() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "setup", "llm",
            "--non-interactive",
            "--provider", "anthropic",
            "--api-key", "sk-ant-test",
            "--frontier", "claude-sonnet-4",
            "--fast", "claude-haiku-4",
            "--skip-verify",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("LLM configuration updated"));
}

#[test]
fn test_llm_non_interactive_openai_succeeds() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "setup", "llm",
            "--non-interactive",
            "--provider", "openai",
            "--api-key", "sk-test-openai",
            "--frontier", "gpt-4",
            "--fast", "gpt-3.5-turbo",
            "--skip-verify",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("LLM configuration updated"));
}

#[test]
fn test_llm_non_interactive_bedrock_succeeds() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "setup", "llm",
            "--non-interactive",
            "--provider", "bedrock",
            "--api-key", "test-aws-key",
            "--frontier", "anthropic.claude-v2",
            "--fast", "anthropic.claude-instant-v1",
            "--aws-region", "us-west-2",
            "--skip-verify",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("LLM configuration updated"));
}

#[test]
fn test_llm_non_interactive_custom_succeeds() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "setup", "llm",
            "--non-interactive",
            "--provider", "custom",
            "--api-key", "test-custom-key",
            "--base-url", "http://localhost:11434",
            "--frontier", "llama2",
            "--fast", "llama2",
            "--skip-verify",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("LLM configuration updated"));
}

#[test]
fn test_llm_requires_existing_config() {
    let temp_dir = TempDir::new().unwrap();
    let non_existent_config = temp_dir.path().join(".sockt/config.yaml");

    sockt()
        .args([
            "setup", "llm",
            "--non-interactive",
            "--provider", "anthropic",
            "--api-key", "sk-ant-test",
            "--skip-verify",
            "--config", non_existent_config.to_str().unwrap()
        ])
        .assert()
        .failure()
        .stderr(predicate::str::contains("Run `sockt init` first"));
}

#[test]
fn test_llm_updates_existing_config_idempotent() {
    let (_temp_dir, config_path) = setup_test_config();

    // Run setup twice
    sockt()
        .args([
            "setup", "llm",
            "--non-interactive",
            "--provider", "anthropic",
            "--api-key", "sk-ant-new",
            "--frontier", "claude-opus-4",
            "--fast", "claude-sonnet-4",
            "--skip-verify",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success();

    sockt()
        .args([
            "setup", "llm",
            "--non-interactive",
            "--provider", "anthropic",
            "--api-key", "sk-ant-newer",
            "--frontier", "claude-sonnet-4",
            "--fast", "claude-haiku-4",
            "--skip-verify",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("LLM configuration updated"));
}

#[test]
fn test_llm_encrypts_api_key() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "setup", "llm",
            "--non-interactive",
            "--provider", "anthropic",
            "--api-key", "sk-ant-plaintext-key",
            "--model", "claude-sonnet-4",
            "--skip-verify",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success();

    // Read config and verify key is encrypted
    let config_contents = std::fs::read_to_string(&config_path).unwrap();
    assert!(!config_contents.contains("sk-ant-plaintext-key"));
    assert!(config_contents.contains("ciphertext"));
    assert!(config_contents.contains("recipient"));
}

#[test]
fn test_llm_accepts_frontier_and_fast_separately() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "setup", "llm",
            "--non-interactive",
            "--provider", "anthropic",
            "--api-key", "sk-ant-test",
            "--frontier", "claude-opus-4",
            "--fast", "claude-haiku-4",
            "--skip-verify",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success();

    let config_contents = std::fs::read_to_string(&config_path).unwrap();
    assert!(config_contents.contains("claude-opus-4"));
    assert!(config_contents.contains("claude-haiku-4"));
}

#[test]
fn test_llm_model_flag_auto_splits() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "setup", "llm",
            "--non-interactive",
            "--provider", "anthropic",
            "--api-key", "sk-ant-test",
            "--model", "claude-sonnet-4",
            "--skip-verify",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success();

    // Both frontier and fast should be set to the same model
    let config_contents = std::fs::read_to_string(&config_path).unwrap();
    let sonnet_count = config_contents.matches("claude-sonnet-4").count();
    assert!(sonnet_count >= 2, "Expected model to be set for both frontier and fast");
}

#[test]
fn test_llm_preserves_other_config_sections() {
    let (_temp_dir, config_path) = setup_test_config();

    // Read original deployment_id
    let original_config = std::fs::read_to_string(&config_path).unwrap();
    assert!(original_config.contains("test-deployment-id"));

    sockt()
        .args([
            "setup", "llm",
            "--non-interactive",
            "--provider", "openai",
            "--api-key", "sk-test",
            "--model", "gpt-4",
            "--skip-verify",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success();

    // Verify deployment_id and slack config are preserved
    let updated_config = std::fs::read_to_string(&config_path).unwrap();
    assert!(updated_config.contains("test-deployment-id"));
    assert!(updated_config.contains("slack:"));
    assert!(updated_config.contains("gbrain:"));
}

#[test]
fn test_llm_missing_api_key_in_non_interactive_fails() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "setup", "llm",
            "--non-interactive",
            "--provider", "anthropic",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .failure()
        .stderr(predicate::str::contains("required"));
}

#[test]
fn test_llm_invalid_provider_rejected() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "setup", "llm",
            "--non-interactive",
            "--provider", "invalid-provider",
            "--api-key", "test",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .failure()
        .stderr(predicate::str::contains("provider").or(predicate::str::contains("Invalid")));
}

#[test]
fn test_llm_base_url_required_for_custom() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "setup", "llm",
            "--non-interactive",
            "--provider", "custom",
            "--api-key", "test",
            "--skip-verify",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .failure()
        .stderr(predicate::str::contains("base-url").or(predicate::str::contains("required")));
}

#[test]
fn test_llm_skip_verify_flag_skips_api_check() {
    let (_temp_dir, config_path) = setup_test_config();

    // Should succeed even with invalid key when skip-verify is set
    sockt()
        .args([
            "setup", "llm",
            "--non-interactive",
            "--provider", "anthropic",
            "--api-key", "invalid-key-format",
            "--model", "claude-sonnet-4",
            "--skip-verify",
            "--config", config_path.to_str().unwrap()
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("LLM configuration updated"));
}
