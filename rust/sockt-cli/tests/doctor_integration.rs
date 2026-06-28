use assert_cmd::Command;
use predicates::prelude::*;
use std::fs;
use tempfile::TempDir;

fn sockt() -> Command {
    Command::cargo_bin("sockt").unwrap()
}

fn setup_valid_config(temp_dir: &TempDir) {
    let sockt_dir = temp_dir.path().join(".sockt");
    fs::create_dir_all(&sockt_dir).unwrap();

    let config = r#"
version: "0.1.0"
tier: local
deployment_id: test-id
models:
  provider: anthropic
  frontier: claude-sonnet-4-20250514
  fast: claude-haiku-4-20250514
  api_key: {ciphertext: "enc", recipient: "age1test"}
slack:
  app_token: {ciphertext: "enc", recipient: "age1test"}
  bot_token: {ciphertext: "enc", recipient: "age1test"}
  signing_secret: {ciphertext: "enc", recipient: "age1test"}
  socket_mode: true
gbrain:
  directory: ./gbrain
"#;
    fs::write(sockt_dir.join("config.yaml"), config).unwrap();
}

fn setup_key_file(temp_dir: &TempDir) {
    let sockt_dir = temp_dir.path().join(".sockt");
    fs::create_dir_all(&sockt_dir).unwrap();
    let key_path = sockt_dir.join("key.txt");
    fs::write(&key_path, "AGE-SECRET-KEY-FAKE").unwrap();

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        fs::set_permissions(&key_path, perms).unwrap();
    }
}

// =============================================================================
// Phase 1: Argument Parsing Tests
// =============================================================================

#[test]
fn test_doctor_help_shows_options() {
    sockt()
        .arg("doctor")
        .arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("--json"));
}

#[test]
fn test_doctor_accepts_json_flag() {
    let temp_dir = TempDir::new().unwrap();
    sockt()
        .env("HOME", temp_dir.path())
        .arg("doctor")
        .arg("--json")
        .assert()
        .code(predicate::in_iter(vec![0, 1, 2]));
}

// =============================================================================
// Phase 2: Missing Prerequisites
// =============================================================================

#[test]
fn test_doctor_no_config_shows_fail() {
    let temp_dir = TempDir::new().unwrap();

    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("doctor")
        .assert()
        .get_output()
        .stdout
        .clone();

    let stdout = String::from_utf8(output).unwrap();
    // Should show config check as failed or warning
    assert!(
        stdout.contains("Config") || stdout.contains("config"),
        "Expected config check in output, got: {}",
        stdout
    );
}

#[test]
fn test_doctor_no_key_shows_issue() {
    let temp_dir = TempDir::new().unwrap();
    setup_valid_config(&temp_dir);
    // No key.txt

    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("doctor")
        .assert()
        .get_output()
        .stdout
        .clone();

    let stdout = String::from_utf8(output).unwrap();
    assert!(
        stdout.contains("key") || stdout.contains("Key") || stdout.contains("Encryption"),
        "Expected key check in output, got: {}",
        stdout
    );
}

// =============================================================================
// Phase 3: Happy Path (Environment Checks)
// =============================================================================

#[test]
fn test_doctor_checks_bun_installed() {
    let temp_dir = TempDir::new().unwrap();

    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("doctor")
        .assert()
        .get_output()
        .stdout
        .clone();

    let stdout = String::from_utf8(output).unwrap();
    assert!(
        stdout.contains("Bun") || stdout.contains("bun"),
        "Expected bun check in output, got: {}",
        stdout
    );
}

#[test]
fn test_doctor_checks_git_installed() {
    let temp_dir = TempDir::new().unwrap();

    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("doctor")
        .assert()
        .get_output()
        .stdout
        .clone();

    let stdout = String::from_utf8(output).unwrap();
    assert!(
        stdout.contains("Git") || stdout.contains("git"),
        "Expected git check in output, got: {}",
        stdout
    );
}

#[test]
fn test_doctor_with_valid_config_passes() {
    let temp_dir = TempDir::new().unwrap();
    setup_valid_config(&temp_dir);
    setup_key_file(&temp_dir);

    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("doctor")
        .arg("--json")
        .assert()
        .get_output()
        .stdout
        .clone();

    let stdout = String::from_utf8(output).unwrap();
    let json: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    let checks = json.get("checks").unwrap().as_array().unwrap();

    let config_check = checks.iter().find(|c| {
        c.get("name")
            .unwrap()
            .as_str()
            .unwrap()
            .contains("Config")
    });
    assert!(config_check.is_some());
    assert_eq!(
        config_check
            .unwrap()
            .get("status")
            .unwrap()
            .as_str()
            .unwrap(),
        "pass"
    );
}

#[test]
fn test_doctor_with_key_file_passes() {
    let temp_dir = TempDir::new().unwrap();
    setup_valid_config(&temp_dir);
    setup_key_file(&temp_dir);

    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("doctor")
        .arg("--json")
        .assert()
        .get_output()
        .stdout
        .clone();

    let stdout = String::from_utf8(output).unwrap();
    let json: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    let checks = json.get("checks").unwrap().as_array().unwrap();

    let key_check = checks.iter().find(|c| {
        let name = c.get("name").unwrap().as_str().unwrap();
        name.contains("Encryption") || name.contains("key") || name.contains("Key")
    });
    assert!(key_check.is_some());
    assert_eq!(
        key_check
            .unwrap()
            .get("status")
            .unwrap()
            .as_str()
            .unwrap(),
        "pass"
    );
}

// =============================================================================
// Phase 4: JSON Output
// =============================================================================

#[test]
fn test_doctor_json_structure() {
    let temp_dir = TempDir::new().unwrap();

    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("doctor")
        .arg("--json")
        .assert()
        .get_output()
        .stdout
        .clone();

    let stdout = String::from_utf8(output).unwrap();
    let json: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    let checks = json.get("checks").unwrap().as_array().unwrap();

    for check in checks {
        assert!(check.get("name").is_some());
        assert!(check.get("status").is_some());
        assert!(check.get("message").is_some());
    }
}

#[test]
fn test_doctor_json_parseable() {
    let temp_dir = TempDir::new().unwrap();

    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("doctor")
        .arg("--json")
        .assert()
        .get_output()
        .stdout
        .clone();

    let stdout = String::from_utf8(output).unwrap();
    assert!(stdout.trim().starts_with('{'));
    assert!(stdout.trim().ends_with('}'));
    let result: serde_json::Result<serde_json::Value> = serde_json::from_str(&stdout);
    assert!(result.is_ok());
}

#[test]
fn test_doctor_json_no_extra_output() {
    let temp_dir = TempDir::new().unwrap();

    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("doctor")
        .arg("--json")
        .assert()
        .get_output()
        .stdout
        .clone();

    let stdout = String::from_utf8(output).unwrap();
    assert!(stdout.trim().starts_with('{'));
    assert!(stdout.trim().ends_with('}'));
}

// =============================================================================
// Phase 5: Exit Codes
// =============================================================================

#[test]
fn test_doctor_exit_code_with_missing_config() {
    let temp_dir = TempDir::new().unwrap();
    // No config = at least a warning
    sockt()
        .env("HOME", temp_dir.path())
        .arg("doctor")
        .assert()
        .code(predicate::in_iter(vec![1, 2]));
}

#[test]
fn test_doctor_valid_setup_exit_code() {
    let temp_dir = TempDir::new().unwrap();
    setup_valid_config(&temp_dir);
    setup_key_file(&temp_dir);

    // Even with valid config, some checks may warn (e.g., network, gbrain dir missing)
    sockt()
        .env("HOME", temp_dir.path())
        .arg("doctor")
        .assert()
        .code(predicate::in_iter(vec![0, 1]));
}

// =============================================================================
// Phase 6: Key Permissions (Unix only)
// =============================================================================

#[cfg(unix)]
#[test]
fn test_doctor_key_wrong_permissions_shows_warn() {
    let temp_dir = TempDir::new().unwrap();
    setup_valid_config(&temp_dir);

    let sockt_dir = temp_dir.path().join(".sockt");
    let key_path = sockt_dir.join("key.txt");
    fs::write(&key_path, "AGE-SECRET-KEY-FAKE").unwrap();

    // Set wrong permissions (world-readable)
    use std::os::unix::fs::PermissionsExt;
    let perms = std::fs::Permissions::from_mode(0o644);
    fs::set_permissions(&key_path, perms).unwrap();

    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("doctor")
        .arg("--json")
        .assert()
        .get_output()
        .stdout
        .clone();

    let stdout = String::from_utf8(output).unwrap();
    let json: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    let checks = json.get("checks").unwrap().as_array().unwrap();

    let key_check = checks.iter().find(|c| {
        let name = c.get("name").unwrap().as_str().unwrap();
        name.contains("Encryption") || name.contains("key") || name.contains("Key")
    });
    assert!(key_check.is_some());
    assert_eq!(
        key_check
            .unwrap()
            .get("status")
            .unwrap()
            .as_str()
            .unwrap(),
        "warn"
    );
}
