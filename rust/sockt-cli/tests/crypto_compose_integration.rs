use assert_cmd::Command;
use predicates::prelude::*;
use tempfile::TempDir;
use std::path::PathBuf;

fn sockt() -> Command {
    Command::cargo_bin("sockt").unwrap()
}

// ─── Edge Cases on CLI Argument Parsing ──────────────────────────────────────

#[test]
fn tier_is_case_insensitive_in_error_message() {
    sockt()
        .args(["init", "--tier", "LOCAL"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("local"));
}

#[test]
fn empty_tier_value_rejected() {
    sockt()
        .args(["init", "--tier", ""])
        .assert()
        .failure();
}

#[test]
fn very_long_tier_value_rejected() {
    let long_val = "x".repeat(10000);
    sockt()
        .args(["init", "--tier", &long_val])
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
            "--tier", "local",
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
            "--tier", "local",
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
    let commands = ["up", "down", "status", "tasks", "brain", "config", "connect", "export"];

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
    let commands = vec![
        vec!["up"],
        vec!["down"],
        vec!["status"],
        vec!["tasks"],
        vec!["brain"],
        vec!["config"],
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
    let nested = vec![
        vec!["tasks", "list"],
        vec!["tasks", "show", "some-id"],
        vec!["brain", "status"],
        vec!["config", "show"],
        vec!["config", "get", "some.key"],
        vec!["config", "set", "some.key", "some.value"],
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
