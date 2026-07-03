use assert_cmd::Command;
use predicates::prelude::*;

fn sockt() -> Command {
    Command::cargo_bin("sockt").unwrap()
}

// ===== Phase 1: CLI Argument Parsing Tests =====

#[test]
fn test_upgrade_help_shows_all_options() {
    sockt()
        .args(["upgrade", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("--check"))
        .stdout(predicate::str::contains("--channel"))
        .stdout(predicate::str::contains("--force"))
        .stdout(predicate::str::contains("--yes"));
}

#[test]
fn test_upgrade_accepts_all_flags() {
    // Test that all flags parse correctly (will fail with network error, but that's OK)
    sockt()
        .env("SOCKT_RELEASE_URL", "http://invalid.test/releases/latest")
        .args(["upgrade", "--check", "--channel", "beta", "--force", "--yes"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("Cannot reach release server"));
}

#[test]
fn test_upgrade_network_error_handling() {
    sockt()
        .env("SOCKT_RELEASE_URL", "http://127.0.0.1:1/releases/latest")
        .args(["upgrade", "--check"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("Cannot reach release server").or(
            predicate::str::contains("Connection refused")
        ));
}

#[test]
fn test_upgrade_default_channel_is_stable() {
    // Just verify the command accepts the default channel
    sockt()
        .args(["upgrade", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("stable"));
}

#[test]
fn test_upgrade_short_yes_flag() {
    sockt()
        .env("SOCKT_RELEASE_URL", "http://invalid.test/releases/latest")
        .args(["upgrade", "-y"])
        .assert()
        .failure();
}
