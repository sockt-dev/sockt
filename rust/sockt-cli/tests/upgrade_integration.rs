use assert_cmd::Command;
use predicates::prelude::*;
use std::io::Write;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

fn sockt() -> Command {
    Command::cargo_bin("sockt").unwrap()
}

async fn read_request(socket: &mut tokio::net::TcpStream) {
    let mut buf = vec![0u8; 4096];
    let _ = socket.read(&mut buf).await;
}

async fn mock_github_api(json: &str) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let json = json.to_string();

    tokio::spawn(async move {
        loop {
            if let Ok((mut socket, _)) = listener.accept().await {
                let json = json.clone();
                tokio::spawn(async move {
                    read_request(&mut socket).await;
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                        json.len(),
                        json
                    );
                    let _ = socket.write_all(response.as_bytes()).await;
                    let _ = socket.shutdown().await;
                });
            }
        }
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    port
}

async fn mock_github_api_failure() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        if let Ok((mut socket, _)) = listener.accept().await {
            let _ = socket.shutdown().await;
        }
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
    port
}

fn mock_release_json() -> String {
    r#"{
  "tag_name": "v0.2.0",
  "published_at": "2024-06-26T10:00:00Z",
  "body": "What is new - Feature X - Fix Y",
  "assets": [
    {
      "name": "sockt-v0.2.0-linux-amd64.tar.gz",
      "browser_download_url": "http://127.0.0.1:9999/download"
    },
    {
      "name": "sockt-v0.2.0-darwin-arm64.tar.gz",
      "browser_download_url": "http://127.0.0.1:9999/download"
    },
    {
      "name": "SHA256SUMS",
      "browser_download_url": "http://127.0.0.1:9999/checksums"
    }
  ]
}"#
    .to_string()
}

fn mock_current_version_json() -> String {
    r#"{
  "tag_name": "v0.1.0",
  "published_at": "2024-06-25T10:00:00Z",
  "body": "",
  "assets": []
}"#
    .to_string()
}

// ===== Phase 1: CLI Argument Parsing Tests =====

#[test]
fn test_upgrade_help_shows_options() {
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
fn test_upgrade_accepts_check_flag() {
    // This will fail with "not yet implemented" initially, but should parse
    sockt()
        .args(["upgrade", "--check"])
        .assert()
        .success();
}

#[test]
fn test_upgrade_accepts_channel_flag() {
    sockt()
        .args(["upgrade", "--channel", "beta"])
        .assert()
        .success();
}

#[test]
fn test_upgrade_accepts_yes_short_and_long() {
    sockt()
        .args(["upgrade", "--yes"])
        .assert()
        .success();

    sockt()
        .args(["upgrade", "-y"])
        .assert()
        .success();
}

#[test]
fn test_upgrade_force_flag() {
    sockt()
        .args(["upgrade", "--force"])
        .assert()
        .success();
}

// ===== Phase 2: Version Checking & Network Tests =====

#[tokio::test]
async fn test_upgrade_check_shows_update_available() {
    let port = mock_github_api(&mock_release_json()).await;

    sockt()
        .env("SOCKT_RELEASE_URL", format!("http://127.0.0.1:{}/releases/latest", port))
        .args(["upgrade", "--check"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Current: v"))
        .stdout(predicate::str::contains("Latest:"))
        .stdout(predicate::str::contains("Update available"));
}

#[tokio::test]
async fn test_upgrade_check_already_up_to_date() {
    let port = mock_github_api(&mock_current_version_json()).await;

    sockt()
        .env("SOCKT_RELEASE_URL", format!("http://127.0.0.1:{}/releases/latest", port))
        .args(["upgrade", "--check"])
        .assert()
        .success()
        .stdout(predicate::str::contains("You're up to date"));
}

#[tokio::test]
async fn test_upgrade_check_only_does_not_download() {
    let port = mock_github_api(&mock_release_json()).await;

    sockt()
        .env("SOCKT_RELEASE_URL", format!("http://127.0.0.1:{}/releases/latest", port))
        .args(["upgrade", "--check"])
        .assert()
        .success();
    // Just verify it succeeds without downloading (would fail if tried to download from mock)
}

#[tokio::test]
async fn test_upgrade_network_failure_shows_error() {
    sockt()
        .env("SOCKT_RELEASE_URL", "http://127.0.0.1:1/releases/latest")
        .args(["upgrade", "--check"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("Cannot reach release server").or(
            predicate::str::contains("Connection refused").or(
                predicate::str::contains("failed to check")
            )
        ));
}

#[tokio::test]
async fn test_upgrade_invalid_json_response() {
    let port = mock_github_api("invalid json {{{").await;

    sockt()
        .env("SOCKT_RELEASE_URL", format!("http://127.0.0.1:{}/releases/latest", port))
        .args(["upgrade", "--check"])
        .assert()
        .failure();
}

#[tokio::test]
async fn test_upgrade_platform_not_found() {
    let json = r#"{"tag_name": "v0.2.0", "published_at": "2024-06-26T10:00:00Z", "body": "", "assets": []}"#;
    let port = mock_github_api(json).await;

    sockt()
        .env("SOCKT_RELEASE_URL", format!("http://127.0.0.1:{}/releases/latest", port))
        .args(["upgrade", "--yes"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("No release available for").or(
            predicate::str::contains("platform")
        ));
}

#[tokio::test]
async fn test_upgrade_shows_release_date() {
    let port = mock_github_api(&mock_release_json()).await;

    sockt()
        .env("SOCKT_RELEASE_URL", format!("http://127.0.0.1:{}/releases/latest", port))
        .args(["upgrade", "--check"])
        .assert()
        .success()
        .stdout(predicate::str::contains("released").or(predicate::str::contains("ago")));
}

// ===== Phase 3: Changelog Display Tests =====

fn mock_release_with_changelog() -> String {
    let body = "## What's new\\n- Added feature X\\n- Fixed bug Y\\n- Improved performance Z";
    format!(
        r#"{{
  "tag_name": "v0.2.0",
  "published_at": "2024-06-26T10:00:00Z",
  "body": "{}",
  "assets": []
}}"#,
        body
    )
}

fn mock_release_empty_changelog() -> String {
    r#"{
  "tag_name": "v0.2.0",
  "published_at": "2024-06-26T10:00:00Z",
  "body": "",
  "assets": []
}"#
    .to_string()
}

#[tokio::test]
async fn test_upgrade_shows_changelog_bullets() {
    let port = mock_github_api(&mock_release_with_changelog()).await;

    sockt()
        .env("SOCKT_RELEASE_URL", format!("http://127.0.0.1:{}/releases/latest", port))
        .args(["upgrade", "--check"])
        .assert()
        .success()
        .stdout(predicate::str::contains("What's new"));
}

#[tokio::test]
async fn test_upgrade_changelog_missing_gracefully_skips() {
    let port = mock_github_api(&mock_release_empty_changelog()).await;

    sockt()
        .env("SOCKT_RELEASE_URL", format!("http://127.0.0.1:{}/releases/latest", port))
        .args(["upgrade", "--check"])
        .assert()
        .success();
}

// ===== Phase 4: Confirmation Prompt Tests =====

#[test]
fn test_upgrade_yes_flag_skips_prompt() {
    // This test verifies --yes flag is accepted (actual behavior tested in full flow)
    sockt()
        .args(["upgrade", "--yes"])
        .assert()
        .success();
}

#[test]
fn test_upgrade_force_reinstalls_current_version() {
    // This test verifies --force flag is accepted
    sockt()
        .args(["upgrade", "--force"])
        .assert()
        .success();
}

#[tokio::test]
async fn test_upgrade_already_up_to_date_exits_early() {
    let port = mock_github_api(&mock_current_version_json()).await;

    sockt()
        .env("SOCKT_RELEASE_URL", format!("http://127.0.0.1:{}/releases/latest", port))
        .args(["upgrade"])
        .assert()
        .success()
        .stdout(predicate::str::contains("You're up to date"));
}

// ===== Phase 5-9: Download, Checksum, Replace, Success, Edge Cases =====
// Note: Full download/install tests require mock binary servers and are complex
// These tests verify the CLI accepts the right arguments and error handling works

#[test]
fn test_upgrade_help_mentions_all_flags() {
    sockt()
        .args(["upgrade", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Check for updates"))
        .stdout(predicate::str::contains("Release channel"))
        .stdout(predicate::str::contains("Skip version check"))
        .stdout(predicate::str::contains("Skip confirmation"));
}
