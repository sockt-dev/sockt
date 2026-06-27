use assert_cmd::Command;
use predicates::prelude::*;
use tempfile::TempDir;

fn sockt() -> Command {
    Command::cargo_bin("sockt").unwrap()
}

// ─── Help & Version ──────────────────────────────────────────────────────────

#[test]
fn help_exits_zero_and_shows_usage() {
    sockt()
        .arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("AI Operations Agent"))
        .stdout(predicate::str::contains("init"))
        .stdout(predicate::str::contains("up"))
        .stdout(predicate::str::contains("down"))
        .stdout(predicate::str::contains("status"))
        .stdout(predicate::str::contains("tasks"))
        .stdout(predicate::str::contains("brain"))
        .stdout(predicate::str::contains("config"))
        .stdout(predicate::str::contains("connect"))
        .stdout(predicate::str::contains("upgrade"))
        .stdout(predicate::str::contains("export"));
}

#[test]
fn version_exits_zero_and_shows_version() {
    sockt()
        .arg("--version")
        .assert()
        .success()
        .stdout(predicate::str::contains("sockt 0.1.0"));
}

// ─── Subcommand Help ─────────────────────────────────────────────────────────

#[test]
fn init_help_shows_provider_option() {
    sockt()
        .args(["init", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("--provider"))
        .stdout(predicate::str::contains("--api-key"))
        .stdout(predicate::str::contains("--non-interactive"))
        .stdout(predicate::str::contains("--dir"));
}

#[test]
fn up_help_shows_detach_option() {
    sockt()
        .args(["up", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("--detach"));
}

#[test]
fn down_help_shows_volumes_option() {
    sockt()
        .args(["down", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("--volumes"));
}

#[test]
fn status_help_shows_detailed_option() {
    sockt()
        .args(["status", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("--detailed"));
}

#[test]
fn upgrade_help_shows_check_option() {
    sockt()
        .args(["upgrade", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("--check"));
}

#[test]
fn config_show_help() {
    sockt()
        .args(["config", "show", "--help"])
        .assert()
        .success();
}

#[test]
fn config_set_help() {
    sockt()
        .args(["config", "set", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("<KEY>"))
        .stdout(predicate::str::contains("<VALUE>"));
}

#[test]
fn export_help_shows_output_option() {
    sockt()
        .args(["export", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("--output"));
}

// ─── Invalid Input ───────────────────────────────────────────────────────────

#[test]
fn invalid_provider_value_exits_nonzero() {
    sockt()
        .args(["init", "--provider", "invalid", "--non-interactive", "--force"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("Invalid provider"));
}

#[test]
fn unknown_subcommand_exits_nonzero() {
    sockt()
        .arg("nonexistent")
        .assert()
        .failure()
        .stderr(predicate::str::is_match("(unrecognized|invalid)").unwrap());
}

#[test]
fn no_subcommand_exits_nonzero() {
    sockt()
        .assert()
        .failure()
        .stderr(predicate::str::is_match("(Usage|required)").unwrap());
}

#[test]
fn config_set_missing_value_exits_nonzero() {
    sockt()
        .args(["config", "set", "key-only"])
        .assert()
        .failure();
}

// ─── Global Options ──────────────────────────────────────────────────────────

#[test]
fn global_verbose_flag_accepted() {
    sockt()
        .args(["-vvv", "up", "--help"])
        .assert()
        .success();
}

#[test]
fn global_config_flag_accepted() {
    sockt()
        .args(["--config", "/tmp/nonexistent.yaml", "status", "--help"])
        .assert()
        .success();
}

// ─── Provider Validation ─────────────────────────────────────────────────────

#[test]
fn provider_anthropic_accepted() {
    let temp_dir = TempDir::new().unwrap();
    sockt()
        .args([
            "init",
            "--provider", "anthropic",
            "--frontier", "claude-sonnet-4-20250514",
            "--fast", "claude-haiku-4-20250514",
            "--non-interactive",
            "--force",
            "--dir", temp_dir.path().to_str().unwrap()
        ])
        .assert()
        .success();
}

#[test]
fn provider_openai_accepted() {
    let temp_dir = TempDir::new().unwrap();
    sockt()
        .args([
            "init",
            "--provider", "openai",
            "--frontier", "gpt-4o",
            "--fast", "gpt-4o-mini",
            "--non-interactive",
            "--force",
            "--dir", temp_dir.path().to_str().unwrap()
        ])
        .assert()
        .success();
}

#[test]
fn provider_custom_accepted() {
    let temp_dir = TempDir::new().unwrap();
    sockt()
        .args([
            "init",
            "--provider", "custom",
            "--frontier", "llama3",
            "--fast", "llama3",
            "--non-interactive",
            "--force",
            "--dir", temp_dir.path().to_str().unwrap()
        ])
        .assert()
        .success();
}

// ─── Repeated Invocation ─────────────────────────────────────────────────────

#[test]
fn help_is_idempotent() {
    for _ in 0..5 {
        sockt().arg("--help").assert().success();
    }
}

// ─── Tasks Subcommands ───────────────────────────────────────────────────────

#[test]
fn tasks_list_subcommand() {
    sockt()
        .args(["tasks", "list"])
        .assert()
        .success();
}

#[test]
fn tasks_show_subcommand() {
    sockt()
        .args(["tasks", "show", "task-123"])
        .assert()
        .success();
}

// ─── Brain Subcommands ───────────────────────────────────────────────────────

#[test]
fn brain_status_subcommand() {
    sockt()
        .args(["brain", "status"])
        .assert()
        .success();
}

// ─── Connect ─────────────────────────────────────────────────────────────────

#[test]
fn connect_with_role() {
    sockt()
        .args(["connect", "worker"])
        .assert()
        .success();
}

#[test]
fn connect_without_role() {
    sockt()
        .args(["connect"])
        .assert()
        .success();
}
