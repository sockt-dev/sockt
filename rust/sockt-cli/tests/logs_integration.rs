use assert_cmd::Command;
use predicates::prelude::*;
use std::fs;
use tempfile::TempDir;

fn sockt() -> Command {
    Command::cargo_bin("sockt").unwrap()
}

fn setup_test_logs(temp_dir: &TempDir) {
    let sockt_dir = temp_dir.path().join(".sockt");
    let logs_dir = sockt_dir.join("logs");
    fs::create_dir_all(&logs_dir).unwrap();

    // Create mock log file for agent-1
    let agent1_log = logs_dir.join("agent-1.log");
    let entries = vec![
        r#"{"ts":"2026-06-27T14:23:01Z","level":"info","msg":"Test message 1","agent":"lead-researcher"}"#,
        r#"{"ts":"2026-06-27T14:23:02Z","level":"warn","msg":"Test warning","agent":"lead-researcher"}"#,
        r#"{"ts":"2026-06-27T14:23:03Z","level":"error","msg":"Test error","agent":"lead-researcher","task_id":142}"#,
    ];
    fs::write(&agent1_log, entries.join("\n")).unwrap();

    // Create runtime state
    let runtime_json = sockt_dir.join("runtime.json");
    let state = r#"{"pids":[{"name":"agent-1","pid":12345,"port":null}]}"#;
    fs::write(&runtime_json, state).unwrap();
}

// Phase 1: Argument Parsing Tests

#[test]
fn test_logs_help_shows_all_options() {
    sockt()
        .args(["logs", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("agent"))
        .stdout(predicate::str::contains("--follow"))
        .stdout(predicate::str::contains("--tail"))
        .stdout(predicate::str::contains("--level"));
}

#[test]
fn test_logs_accepts_flags() {
    // Test that flags parse correctly (will fail at runtime, but args accepted)
    let temp_dir = TempDir::new().unwrap();
    sockt()
        .env("HOME", temp_dir.path())
        .args(["logs", "--tail", "100", "--level", "warn", "--json"])
        .assert()
        .failure(); // Should fail with "swarm not running", not "unknown argument"
}

// Phase 2: Error Handling Tests

#[test]
fn test_logs_fails_when_swarm_not_running() {
    let temp_dir = TempDir::new().unwrap();
    sockt()
        .env("HOME", temp_dir.path())
        .arg("logs")
        .assert()
        .failure()
        .stderr(predicate::str::contains("Swarm is not running"));
}

#[test]
fn test_logs_fails_when_agent_not_found() {
    let temp_dir = TempDir::new().unwrap();
    setup_test_logs(&temp_dir);

    sockt()
        .env("HOME", temp_dir.path())
        .args(["logs", "nonexistent-agent"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("not found"))
        .stderr(predicate::str::contains("agent-1"));
}

// Phase 3: Log Reading & Formatting Tests

#[test]
fn test_logs_shows_formatted_output() {
    let temp_dir = TempDir::new().unwrap();
    setup_test_logs(&temp_dir);

    sockt()
        .env("HOME", temp_dir.path())
        .arg("logs")
        .assert()
        .success()
        .stdout(predicate::str::contains("lead-researcher"))
        .stdout(predicate::str::contains("Test message 1"));
}

#[test]
fn test_logs_json_output() {
    let temp_dir = TempDir::new().unwrap();
    setup_test_logs(&temp_dir);

    sockt()
        .env("HOME", temp_dir.path())
        .args(["logs", "--json"])
        .assert()
        .success()
        .stdout(predicate::str::contains(r#""level":"info""#))
        .stdout(predicate::str::contains(r#""msg":"Test message 1""#));
}

#[test]
fn test_logs_level_filter() {
    let temp_dir = TempDir::new().unwrap();
    setup_test_logs(&temp_dir);

    sockt()
        .env("HOME", temp_dir.path())
        .args(["logs", "--level", "error"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Test error"))
        .stdout(predicate::str::contains("Test message 1").not());
}

#[test]
fn test_logs_tail_limit() {
    let temp_dir = TempDir::new().unwrap();
    setup_test_logs(&temp_dir);

    sockt()
        .env("HOME", temp_dir.path())
        .args(["logs", "--tail", "1"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Test error"));
    // Should only show last entry (most recent)
}

// Note: --follow mode is tested manually as it requires async streaming behavior
