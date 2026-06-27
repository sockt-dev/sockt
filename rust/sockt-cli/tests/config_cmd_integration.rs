use assert_cmd::Command;
use predicates::prelude::*;
use tempfile::TempDir;
use std::fs;
use std::path::PathBuf;
use age::secrecy::ExposeSecret;

fn sockt() -> Command {
    Command::cargo_bin("sockt").unwrap()
}

fn setup_test_config() -> (TempDir, PathBuf) {
    let temp_dir = TempDir::new().unwrap();
    let sockt_dir = temp_dir.path().join(".sockt");
    fs::create_dir_all(&sockt_dir).unwrap();

    // Generate key
    let key_path = sockt_dir.join("key.txt");
    let identity = age::x25519::Identity::generate();
    fs::write(&key_path, identity.to_string().expose_secret()).unwrap();

    // Create basic config YAML
    let config_yaml = r#"
version: "0.1.0"
tier: local
deployment_id: test-deployment-id
models:
  provider: anthropic
  frontier: claude-sonnet-4
  fast: claude-haiku-4
  api_key:
    ciphertext: "test-ciphertext"
    recipient: "test-recipient"
slack:
  app_token:
    ciphertext: "test-app-token-ciphertext"
    recipient: "test-recipient"
  bot_token:
    ciphertext: "test-bot-token-ciphertext"
    recipient: "test-recipient"
  signing_secret:
    ciphertext: "test-signing-secret-ciphertext"
    recipient: "test-recipient"
  socket_mode: true
gbrain:
  directory: ./gbrain
  soul_file: SOUL.md
  agents_file: AGENTS.md
integrations: {}
"#;

    let config_path = sockt_dir.join("config.yaml");
    fs::write(&config_path, config_yaml).unwrap();

    (temp_dir, config_path)
}

#[test]
fn config_path_prints_location() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .env("HOME", _temp_dir.path())
        .arg("config")
        .arg("path")
        .assert()
        .success()
        .stdout(predicate::str::contains(config_path.to_str().unwrap()));
}

#[test]
fn config_show_displays_tier() {
    let (_temp_dir, _config_path) = setup_test_config();

    sockt()
        .env("HOME", _temp_dir.path())
        .arg("config")
        .arg("show")
        .assert()
        .success()
        .stdout(predicate::str::contains("tier:"))
        .stdout(predicate::str::contains("local"));
}

#[test]
fn config_show_redacts_secrets() {
    let (_temp_dir, _config_path) = setup_test_config();

    sockt()
        .env("HOME", _temp_dir.path())
        .arg("config")
        .arg("show")
        .assert()
        .success()
        .stdout(predicate::str::contains("••••••••"));
}

#[test]
fn config_get_simple_field() {
    let (_temp_dir, _config_path) = setup_test_config();

    sockt()
        .env("HOME", _temp_dir.path())
        .arg("config")
        .arg("get")
        .arg("tier")
        .assert()
        .success()
        .stdout(predicate::str::contains("local"));
}

#[test]
fn config_get_nested_field() {
    let (_temp_dir, _config_path) = setup_test_config();

    sockt()
        .env("HOME", _temp_dir.path())
        .arg("config")
        .arg("get")
        .arg("models.frontier")
        .assert()
        .success()
        .stdout(predicate::str::contains("claude-sonnet-4"));
}

#[test]
fn config_get_secret_redacts() {
    let (_temp_dir, _config_path) = setup_test_config();

    sockt()
        .env("HOME", _temp_dir.path())
        .arg("config")
        .arg("get")
        .arg("models.api_key")
        .assert()
        .success()
        .stdout(predicate::str::contains("••••••••"));
}

#[test]
fn config_set_simple_field() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .env("HOME", _temp_dir.path())
        .arg("config")
        .arg("set")
        .arg("models.frontier")
        .arg("claude-opus-4")
        .assert()
        .success()
        .stdout(predicate::str::contains("✓"));

    // Verify it was saved
    let config_content = fs::read_to_string(&config_path).unwrap();
    assert!(config_content.contains("claude-opus-4"));
}

#[test]
fn config_set_read_only_field_fails() {
    let (_temp_dir, _config_path) = setup_test_config();

    sockt()
        .env("HOME", _temp_dir.path())
        .arg("config")
        .arg("set")
        .arg("tier")
        .arg("cloud")
        .assert()
        .failure()
        .stderr(predicate::str::contains("read-only"));
}

#[test]
fn config_get_unknown_key_fails() {
    let (_temp_dir, _config_path) = setup_test_config();

    sockt()
        .env("HOME", _temp_dir.path())
        .arg("config")
        .arg("get")
        .arg("unknown.field")
        .assert()
        .failure()
        .stderr(predicate::str::contains("unknown key"));
}

#[test]
fn config_set_boolean_field() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .env("HOME", _temp_dir.path())
        .arg("config")
        .arg("set")
        .arg("slack.socket_mode")
        .arg("false")
        .assert()
        .success()
        .stdout(predicate::str::contains("✓"));

    // Verify it was saved
    let config_content = fs::read_to_string(&config_path).unwrap();
    assert!(config_content.contains("socket_mode: false"));
}

#[test]
fn config_reset_restores_default() {
    let (_temp_dir, config_path) = setup_test_config();

    // First change the value
    sockt()
        .env("HOME", _temp_dir.path())
        .arg("config")
        .arg("set")
        .arg("models.frontier")
        .arg("custom-model")
        .assert()
        .success();

    // Verify it changed
    let config_content = fs::read_to_string(&config_path).unwrap();
    assert!(config_content.contains("custom-model"));

    // Reset it
    sockt()
        .env("HOME", _temp_dir.path())
        .arg("config")
        .arg("reset")
        .arg("models.frontier")
        .assert()
        .success()
        .stdout(predicate::str::contains("reset to default"));

    // Verify it was reset
    let config_content = fs::read_to_string(&config_path).unwrap();
    assert!(config_content.contains("claude-sonnet-4-20250514"));
}

#[test]
fn config_show_json_flag() {
    let (_temp_dir, _config_path) = setup_test_config();

    sockt()
        .env("HOME", _temp_dir.path())
        .arg("config")
        .arg("show")
        .arg("--json")
        .assert()
        .success()
        .stdout(predicate::str::contains("{"))
        .stdout(predicate::str::contains("version"));
}

#[test]
fn config_show_raw_flag() {
    let (_temp_dir, _config_path) = setup_test_config();

    sockt()
        .env("HOME", _temp_dir.path())
        .arg("config")
        .arg("show")
        .arg("--raw")
        .assert()
        .success()
        .stdout(predicate::str::contains("version:"))
        .stdout(predicate::str::contains("tier:"));
}
