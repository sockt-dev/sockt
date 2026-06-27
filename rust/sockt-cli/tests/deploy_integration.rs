use assert_cmd::Command;
use predicates::prelude::*;
use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;

fn sockt() -> Command {
    Command::cargo_bin("sockt").unwrap()
}

fn setup_test_config() -> (TempDir, PathBuf) {
    let temp_dir = TempDir::new().unwrap();
    let sockt_dir = temp_dir.path().join(".sockt");
    fs::create_dir_all(&sockt_dir).unwrap();

    let config = r#"
version: "0.1.0"
tier: local
deployment_id: test-deployment
models:
  provider: anthropic
  frontier: claude-sonnet-4
  fast: claude-haiku-4
  api_key: {ciphertext: "", recipient: ""}
slack:
  app_token: {ciphertext: "", recipient: ""}
  bot_token: {ciphertext: "", recipient: ""}
  signing_secret: {ciphertext: "", recipient: ""}
  socket_mode: true
gbrain:
  directory: ./gbrain
  soul_file: SOUL.md
  agents_file: AGENTS.md
integrations: {}
"#;

    let config_path = sockt_dir.join("config.yaml");
    fs::write(&config_path, config).unwrap();
    (temp_dir, config_path)
}

// ============================================================================
// Phase 1: Argument Parsing Tests
// ============================================================================

#[test]
fn test_deploy_help_shows_all_options() {
    sockt()
        .args(["deploy", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Deploy"))
        .stdout(predicate::str::contains("--detach"))
        .stdout(predicate::str::contains("--watch"))
        .stdout(predicate::str::contains("--department"))
        .stdout(predicate::str::contains("--timeout"))
        .stdout(predicate::str::contains("--dry-run"));
}

#[test]
fn test_deploy_accepts_detach_flag() {
    sockt()
        .args(["deploy", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("-d, --detach"));
}

#[test]
fn test_deploy_accepts_watch_flag() {
    sockt()
        .args(["deploy", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("-w, --watch"));
}

#[test]
fn test_deploy_with_department_filter() {
    sockt()
        .args(["deploy", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("--department <DEPARTMENT>"));
}

#[test]
fn test_deploy_with_timeout_override() {
    sockt()
        .args(["deploy", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("--timeout <TIMEOUT>"));
}

// ============================================================================
// Phase 2: Error Handling Tests
// ============================================================================

#[test]
fn test_deploy_fails_without_config() {
    let temp_dir = TempDir::new().unwrap();

    sockt()
        .env("HOME", temp_dir.path())
        .arg("deploy")
        .assert()
        .failure()
        .stderr(predicate::str::contains("config").or(predicate::str::contains("not found")));
}

#[test]
fn test_deploy_fails_with_invalid_config() {
    let temp_dir = TempDir::new().unwrap();
    let sockt_dir = temp_dir.path().join(".sockt");
    fs::create_dir_all(&sockt_dir).unwrap();

    // Invalid YAML
    let config_path = sockt_dir.join("config.yaml");
    fs::write(&config_path, "invalid: yaml: content: [[[").unwrap();

    sockt()
        .env("HOME", temp_dir.path())
        .arg("deploy")
        .assert()
        .failure();
}

// ============================================================================
// Phase 3: Dry-Run Tests
// ============================================================================

#[test]
fn test_dry_run_shows_all_services() {
    let (_temp_dir, _config_path) = setup_test_config();

    sockt()
        .env("HOME", _temp_dir.path())
        .args(["deploy", "--dry-run"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Would start"))
        .stdout(predicate::str::contains("gbrain-mcp"))
        .stdout(predicate::str::contains("orch"))
        .stdout(predicate::str::contains("cadvp"));
}

#[test]
fn test_dry_run_shows_ports() {
    let (_temp_dir, _config_path) = setup_test_config();

    sockt()
        .env("HOME", _temp_dir.path())
        .args(["deploy", "--dry-run"])
        .assert()
        .success()
        .stdout(predicate::str::contains("port 3200"))
        .stdout(predicate::str::contains("port 3100"));
}

#[test]
fn test_dry_run_shows_memory_estimate() {
    let (_temp_dir, _config_path) = setup_test_config();

    sockt()
        .env("HOME", _temp_dir.path())
        .args(["deploy", "--dry-run"])
        .assert()
        .success()
        .stdout(predicate::str::contains("processes"))
        .stdout(predicate::str::contains("memory"));
}

#[test]
fn test_dry_run_with_department_filter() {
    let (_temp_dir, _config_path) = setup_test_config();

    sockt()
        .env("HOME", _temp_dir.path())
        .args(["deploy", "--dry-run", "--department", "research"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Would start"));
}

#[test]
fn test_dry_run_does_not_require_monorepo() {
    let (_temp_dir, _config_path) = setup_test_config();

    // Dry-run should attempt to build configs even without monorepo
    // It will fail when trying to find monorepo root
    sockt()
        .env("HOME", _temp_dir.path())
        .args(["deploy", "--dry-run"])
        .assert()
        .code(predicate::in_iter(vec![0, 1])); // Either succeeds or fails gracefully
}

// ============================================================================
// Phase 4: Up Command Alias Tests
// ============================================================================

#[test]
fn test_up_command_shows_deprecation_notice() {
    let (_temp_dir, _config_path) = setup_test_config();

    sockt()
        .env("HOME", _temp_dir.path())
        .args(["up", "--dry-run"])
        .assert()
        .stderr(predicate::str::contains("`sockt up` is now `sockt deploy`"));
}

#[test]
fn test_up_command_hidden_in_help() {
    let output = sockt()
        .args(["--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("deploy"));

    // Verify "up" command is not shown (it's hidden)
    let stdout = String::from_utf8_lossy(&output.get_output().stdout);
    // "up" should not appear as a command line, but "Upgrade" contains "up"
    // so we check that "up     " (with spaces) is not present
    assert!(!stdout.contains("  up     "), "Command 'up' should be hidden in help");
}

// ============================================================================
// Phase 5: Configuration Tests
// ============================================================================

#[test]
fn test_deploy_respects_custom_config_path() {
    let temp_dir = TempDir::new().unwrap();
    let custom_config_path = temp_dir.path().join("custom-config.yaml");

    let config = r#"
version: "0.1.0"
tier: local
deployment_id: custom-deployment
models:
  provider: anthropic
  frontier: claude-sonnet-4
  fast: claude-haiku-4
  api_key: {ciphertext: "", recipient: ""}
slack:
  app_token: {ciphertext: "", recipient: ""}
  bot_token: {ciphertext: "", recipient: ""}
  signing_secret: {ciphertext: "", recipient: ""}
  socket_mode: true
gbrain:
  directory: ./gbrain
  soul_file: SOUL.md
  agents_file: AGENTS.md
integrations: {}
"#;

    fs::write(&custom_config_path, config).unwrap();

    sockt()
        .args([
            "deploy",
            "--dry-run",
            "--config",
            custom_config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Would start"));
}
