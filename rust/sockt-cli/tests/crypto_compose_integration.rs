use assert_cmd::Command;
use predicates::prelude::*;
use tempfile::TempDir;
use std::path::PathBuf;

fn sockt() -> Command {
    Command::cargo_bin("sockt").unwrap()
}

// ─── Edge Cases on CLI Argument Parsing ──────────────────────────────────────

#[test]
fn provider_is_case_insensitive() {
    sockt()
        .args([
            "init",
            "--provider", "ANTHROPIC",
            "--frontier", "claude-sonnet-4-20250514",
            "--fast", "claude-haiku-4-20250514",
            "--non-interactive",
            "--force"
        ])
        .assert()
        .success();
}

#[test]
fn empty_provider_value_rejected() {
    sockt()
        .args(["init", "--provider", "", "--non-interactive", "--force"])
        .assert()
        .failure();
}

#[test]
fn very_long_provider_value_rejected() {
    let long_val = "x".repeat(10000);
    sockt()
        .args(["init", "--provider", &long_val, "--non-interactive", "--force"])
        .assert()
        .failure();
}

#[test]
fn dir_flag_accepts_path_with_spaces() {
    let dir = TempDir::new().unwrap();
    let path_with_spaces = dir.path().join("path with spaces");
    std::fs::create_dir_all(&path_with_spaces).unwrap();

    sockt()
        .args([
            "init",
            "--non-interactive",
            "--provider", "anthropic",
            "--frontier", "claude-sonnet-4-20250514",
            "--fast", "claude-haiku-4-20250514",
            "--force",
            "--dir", path_with_spaces.to_str().unwrap(),
        ])
        .assert()
        .success();
}

#[test]
fn dir_flag_accepts_unicode_path() {
    let dir = TempDir::new().unwrap();
    let unicode_path = dir.path().join("配置目录");
    std::fs::create_dir_all(&unicode_path).unwrap();

    sockt()
        .args([
            "init",
            "--non-interactive",
            "--provider", "anthropic",
            "--frontier", "claude-sonnet-4-20250514",
            "--fast", "claude-haiku-4-20250514",
            "--force",
            "--dir", unicode_path.to_str().unwrap(),
        ])
        .assert()
        .success();
}

// ─── Multiple Subcommand Combinations ────────────────────────────────────────

#[test]
fn all_commands_respond_to_help() {
    let commands = [
        "init", "up", "down", "status", "tasks", "brain",
        "config", "connect", "upgrade", "export",
    ];

    for cmd in commands {
        sockt()
            .args([cmd, "--help"])
            .assert()
            .success()
            .stdout(predicate::str::contains("Usage"));
    }
}

#[test]
fn global_flags_work_with_all_commands() {
    // Exclude config (needs valid config file), tasks (needs config), and up/down (deprecated aliases that trigger deploy/stop)
    let commands = ["status", "brain", "connect", "export"];

    for cmd in commands {
        sockt()
            .args(["--config", "/tmp/nonexistent.yaml", "-vv", cmd])
            .assert()
            .success();
    }
}

// ─── Exit Code Consistency ───────────────────────────────────────────────────

#[test]
fn success_commands_exit_zero() {
    // Exclude config (needs valid config) and up/down (deprecated aliases that trigger deploy/stop)
    let commands = vec![
        vec!["status"],
        vec!["tasks"],
        vec!["brain"],
        vec!["connect"],
        vec!["export"],
    ];

    for args in commands {
        sockt()
            .args(&args)
            .assert()
            .success();
    }
}

#[test]
fn help_on_nested_subcommands() {
    // Exclude config and tasks subcommands since they now have real implementations
    // that require valid config files
    let nested = vec![
        vec!["brain", "status"],
    ];

    for args in nested {
        sockt()
            .args(&args)
            .assert()
            .success();
    }
}

// ─── Robustness ──────────────────────────────────────────────────────────────

#[test]
fn double_dash_separates_args() {
    sockt()
        .args(["--", "--help"])
        .assert()
        .failure(); // --help after -- is treated as positional arg
}

#[test]
fn many_verbose_flags() {
    sockt()
        .args(["-vvvvvvvvvvvv", "status"])
        .assert()
        .success();
}

#[test]
fn config_flag_with_relative_path() {
    sockt()
        .args(["--config", "./relative/path.yaml", "status"])
        .assert()
        .success();
}
