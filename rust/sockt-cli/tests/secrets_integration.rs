use assert_cmd::Command;
use predicates::prelude::*;
use std::path::PathBuf;
use tempfile::TempDir;

// Helper to create a test environment with config and key
fn setup() -> (TempDir, PathBuf) {
    let dir = TempDir::new().unwrap();
    let sockt_dir = dir.path().join(".sockt");
    std::fs::create_dir_all(&sockt_dir).unwrap();

    // Generate key
    let key_path = sockt_dir.join("key.txt");
    let identity = age::x25519::Identity::generate();
    std::fs::write(&key_path, identity.to_string().expose_secret()).unwrap();

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }

    // Create minimal config
    let config_yaml = r#"
version: "0.1.0"
tier: local
deployment_id: test-deployment
slack:
  app_token: { ciphertext: "", recipient: "" }
  bot_token: { ciphertext: "", recipient: "" }
  signing_secret: { ciphertext: "", recipient: "" }
  socket_mode: true
models:
  provider: anthropic
  frontier: claude-sonnet-4-20250514
  fast: claude-haiku-4-20250514
  api_key: { ciphertext: "", recipient: "" }
gbrain:
  directory: ./gbrain
  soul_file: SOUL.md
  agents_file: AGENTS.md
integrations: {}
"#;
    let config_path = sockt_dir.join("config.yaml");
    std::fs::write(&config_path, config_yaml).unwrap();

    (dir, config_path)
}

// Phase 3 Tests: CLI Parsing

#[test]
fn secrets_list_help_works() {
    Command::cargo_bin("sockt")
        .unwrap()
        .args(&["secrets", "list", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("List stored secret names"));
}

#[test]
fn secrets_set_requires_arguments() {
    Command::cargo_bin("sockt")
        .unwrap()
        .args(&["secrets", "set"])
        .assert()
        .failure();
}

#[test]
fn secrets_rotate_accepts_confirm_flag() {
    let (_dir, config_path) = setup();
    Command::cargo_bin("sockt")
        .unwrap()
        .args(&[
            "secrets",
            "rotate",
            "--confirm",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success();
}

#[test]
fn secrets_export_accepts_output_flag() {
    let (dir, config_path) = setup();
    let output = dir.path().join("export.json");

    Command::cargo_bin("sockt")
        .unwrap()
        .args(&[
            "secrets",
            "export",
            "--output",
            output.to_str().unwrap(),
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success();
}

#[test]
fn secrets_command_is_registered() {
    Command::cargo_bin("sockt")
        .unwrap()
        .args(&["secrets", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Manage encrypted secrets"));
}

#[test]
fn global_config_flag_works() {
    let (_dir, config_path) = setup();
    Command::cargo_bin("sockt")
        .unwrap()
        .args(&["--config", config_path.to_str().unwrap(), "secrets", "list"])
        .assert()
        .success();
}

// Phase 4 Tests: secrets list

#[test]
fn list_shows_secret_names() {
    let (_dir, config_path) = setup();
    Command::cargo_bin("sockt")
        .unwrap()
        .args(&["secrets", "list", "--config", config_path.to_str().unwrap()])
        .assert()
        .success()
        .stdout(predicate::str::contains("models_api_key"))
        .stdout(predicate::str::contains("slack_app_token"));
}

#[test]
fn list_shows_encrypted_status() {
    let (_dir, config_path) = setup();
    Command::cargo_bin("sockt")
        .unwrap()
        .args(&["secrets", "list", "--config", config_path.to_str().unwrap()])
        .assert()
        .success()
        .stdout(predicate::str::contains("not set"));
}

#[test]
fn list_shows_secret_count() {
    let (_dir, config_path) = setup();
    Command::cargo_bin("sockt")
        .unwrap()
        .args(&["secrets", "list", "--config", config_path.to_str().unwrap()])
        .assert()
        .success()
        .stdout(predicate::str::contains("4 secrets stored"));
}

#[test]
fn list_shows_key_fingerprint() {
    let (_dir, config_path) = setup();
    Command::cargo_bin("sockt")
        .unwrap()
        .args(&["secrets", "list", "--config", config_path.to_str().unwrap()])
        .assert()
        .success()
        .stdout(predicate::str::contains("Key fingerprint: age1"));
}

#[test]
fn list_missing_key_shows_error() {
    let dir = TempDir::new().unwrap();
    let sockt_dir = dir.path().join(".sockt");
    std::fs::create_dir_all(&sockt_dir).unwrap();

    // Create config without key
    let config_yaml = r#"
version: "0.1.0"
tier: local
deployment_id: test-deployment
slack:
  app_token: { ciphertext: "", recipient: "" }
  bot_token: { ciphertext: "", recipient: "" }
  signing_secret: { ciphertext: "", recipient: "" }
models:
  api_key: { ciphertext: "", recipient: "" }
"#;
    let config_path = sockt_dir.join("config.yaml");
    std::fs::write(&config_path, config_yaml).unwrap();

    Command::cargo_bin("sockt")
        .unwrap()
        .args(&["secrets", "list", "--config", config_path.to_str().unwrap()])
        .assert()
        .failure()
        .stderr(predicate::str::contains("No encryption key found"));
}

// Phase 5 Tests: secrets set

#[test]
fn set_new_secret_works() {
    let (_dir, config_path) = setup();
    Command::cargo_bin("sockt")
        .unwrap()
        .args(&[
            "secrets",
            "set",
            "anthropic_api_key",
            "sk-ant-test-key",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("encrypted and stored"));
}

#[test]
fn set_shows_restart_reminder() {
    let (_dir, config_path) = setup();
    Command::cargo_bin("sockt")
        .unwrap()
        .args(&[
            "secrets",
            "set",
            "anthropic_api_key",
            "test",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("restart swarm"));
}

#[test]
fn set_invalid_name_fails() {
    let (_dir, config_path) = setup();
    Command::cargo_bin("sockt")
        .unwrap()
        .args(&[
            "secrets",
            "set",
            "invalid_name",
            "test",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .failure()
        .stderr(predicate::str::contains("Unknown secret"));
}

// Phase 6 Tests: secrets rotate

#[test]
fn rotate_with_confirm_flag_works() {
    let (_dir, config_path) = setup();
    // Set a secret first
    Command::cargo_bin("sockt")
        .unwrap()
        .args(&[
            "secrets",
            "set",
            "anthropic_api_key",
            "test-value",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("sockt")
        .unwrap()
        .args(&[
            "secrets",
            "rotate",
            "--confirm",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Rotation complete"));
}

#[test]
fn rotate_backs_up_old_key() {
    let (dir, config_path) = setup();
    // Set a secret first
    Command::cargo_bin("sockt")
        .unwrap()
        .args(&[
            "secrets",
            "set",
            "anthropic_api_key",
            "test-value",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("sockt")
        .unwrap()
        .args(&[
            "secrets",
            "rotate",
            "--confirm",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success();

    assert!(dir.path().join(".sockt/key.txt.bak").exists());
}

#[test]
fn rotate_shows_progress() {
    let (_dir, config_path) = setup();
    // Set a secret first
    Command::cargo_bin("sockt")
        .unwrap()
        .args(&[
            "secrets",
            "set",
            "anthropic_api_key",
            "test-value",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("sockt")
        .unwrap()
        .args(&[
            "secrets",
            "rotate",
            "--confirm",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("models_api_key"))
        .stdout(predicate::str::contains("✓"));
}

// Phase 7 Tests: secrets export

#[test]
fn export_to_file_creates_file() {
    let (dir, config_path) = setup();
    let output = dir.path().join("export.json");

    Command::cargo_bin("sockt")
        .unwrap()
        .args(&[
            "secrets",
            "export",
            "--output",
            output.to_str().unwrap(),
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success();

    assert!(output.exists());
}

#[test]
fn export_format_is_valid_json() {
    let (dir, config_path) = setup();
    let output = dir.path().join("export.json");

    Command::cargo_bin("sockt")
        .unwrap()
        .args(&[
            "secrets",
            "export",
            "--output",
            output.to_str().unwrap(),
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success();

    let content = std::fs::read_to_string(&output).unwrap();
    let json: serde_json::Value = serde_json::from_str(&content).unwrap();
    assert!(json.get("version").is_some());
    assert!(json.get("secrets").is_some());
}

#[test]
fn export_includes_metadata() {
    let (dir, config_path) = setup();
    let output = dir.path().join("export.json");

    Command::cargo_bin("sockt")
        .unwrap()
        .args(&[
            "secrets",
            "export",
            "--output",
            output.to_str().unwrap(),
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success();

    let content = std::fs::read_to_string(&output).unwrap();
    let json: serde_json::Value = serde_json::from_str(&content).unwrap();
    assert_eq!(json["version"], "1");
    assert!(json.get("exported_at").is_some());
}

use age::secrecy::ExposeSecret;
