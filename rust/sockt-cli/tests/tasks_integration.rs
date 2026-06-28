use assert_cmd::Command;
use predicates::prelude::*;
use tempfile::TempDir;
use std::fs;

fn sockt() -> Command {
    Command::cargo_bin("sockt").unwrap()
}

// ========================================
// Phase 1: Argument Parsing Tests
// ========================================

#[test]
fn test_tasks_help_shows_subcommands() {
    sockt()
        .args(["tasks", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("list"))
        .stdout(predicate::str::contains("show"))
        .stdout(predicate::str::contains("approve"))
        .stdout(predicate::str::contains("reject"))
        .stdout(predicate::str::contains("cancel"))
        .stdout(predicate::str::contains("retry"));
}

#[test]
fn test_tasks_list_accepts_filters() {
    // This will fail until we implement the command
    // For now, just verify the CLI accepts the flags without error
    sockt()
        .args(["tasks", "list", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("--status"))
        .stdout(predicate::str::contains("--agent"))
        .stdout(predicate::str::contains("--since"))
        .stdout(predicate::str::contains("--limit"))
        .stdout(predicate::str::contains("--all"))
        .stdout(predicate::str::contains("--json"));
}

#[test]
fn test_tasks_show_requires_id() {
    sockt()
        .args(["tasks", "show"])
        .assert()
        .failure();
}

#[test]
fn test_tasks_approve_requires_id() {
    sockt()
        .args(["tasks", "approve"])
        .assert()
        .failure();
}

// ========================================
// Phase 3: Core Functionality Tests
// ========================================

use tokio::io::{AsyncReadExt, AsyncWriteExt};

async fn read_request(socket: &mut tokio::net::TcpStream) {
    let mut buf = vec![0u8; 4096];
    let _ = socket.read(&mut buf).await;
}

fn setup_test_config(temp_dir: &TempDir) -> std::path::PathBuf {
    let config_path = temp_dir.path().join("config.yaml");
    fs::write(
        &config_path,
        "version: '0.1.0'\ntier: local\ndeployment_id: tenant-1\nslack:\n  app_token:\n    ciphertext: ''\n    recipient: ''\n  signing_secret:\n    ciphertext: ''\n    recipient: ''\n  bot_token:\n    ciphertext: ''\n    recipient: ''\nmodels:\n  provider: anthropic\n  api_key:\n    ciphertext: ''\n    recipient: ''\n  frontier: claude-3\n  fast: claude-3-haiku\n",
    )
    .unwrap();
    config_path
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_tasks_list_empty() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;
        let response = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n[]";
        let _ = socket.write_all(response).await;
        let _ = socket.shutdown().await;
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let temp_dir = TempDir::new().unwrap();
    let config_path = setup_test_config(&temp_dir);

    sockt()
        .args(["tasks", "--config", config_path.to_str().unwrap()])
        .env("ORCH_URL", format!("http://127.0.0.1:{}", port))
        .assert()
        .success()
        .stdout(predicate::str::contains("No tasks"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_tasks_list_displays_grouped() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;

        let tasks = r#"[{"id":"142","tenantId":"tenant-1","status":"pending_approval","owner":"outbound-writer","parentId":null,"description":"Send email to james@acme.com","output":null,"llmCallsUsed":0,"llmCallsBudget":25,"attemptCount":0,"maxAttempts":3,"createdAt":"2026-06-28T10:00:00Z","updatedAt":"2026-06-28T10:00:00Z"},{"id":"156","tenantId":"tenant-1","status":"in_progress","owner":"lead-researcher","parentId":null,"description":"Healthcare lead search","output":null,"llmCallsUsed":2,"llmCallsBudget":25,"attemptCount":0,"maxAttempts":3,"createdAt":"2026-06-28T10:10:00Z","updatedAt":"2026-06-28T10:10:00Z"}]"#;
        let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", tasks.len(), tasks);
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let temp_dir = TempDir::new().unwrap();
    let config_path = setup_test_config(&temp_dir);

    sockt()
        .args(["tasks", "--config", config_path.to_str().unwrap()])
        .env("ORCH_URL", format!("http://127.0.0.1:{}", port))
        .assert()
        .success()
        .stdout(predicate::str::contains("PENDING APPROVAL"))
        .stdout(predicate::str::contains("#142"))
        .stdout(predicate::str::contains("outbound-writer"))
        .stdout(predicate::str::contains("RUNNING"))
        .stdout(predicate::str::contains("#156"))
        .stdout(predicate::str::contains("lead-researcher"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_tasks_list_json_output() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;

        let tasks = r#"[{"id":"142","tenantId":"tenant-1","status":"pending","owner":null,"parentId":null,"description":"Test","output":null,"llmCallsUsed":0,"llmCallsBudget":25,"attemptCount":0,"maxAttempts":3,"createdAt":"2026-06-28T10:00:00Z","updatedAt":"2026-06-28T10:00:00Z"}]"#;
        let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", tasks.len(), tasks);
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let temp_dir = TempDir::new().unwrap();
    let config_path = setup_test_config(&temp_dir);

    let output = sockt()
        .args(["tasks", "list", "--json", "--config", config_path.to_str().unwrap()])
        .env("ORCH_URL", format!("http://127.0.0.1:{}", port))
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();

    let json: serde_json::Value = serde_json::from_slice(&output).unwrap();
    assert!(json.is_array());
}

// ========================================
// Phase 4: Show Command Tests
// ========================================

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_tasks_show_displays_detail() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;

        let task = r#"{"id":"142","tenantId":"tenant-1","status":"pending_approval","owner":"outbound-writer","parentId":null,"description":"Send email to james@acme.com","output":null,"llmCallsUsed":0,"llmCallsBudget":25,"attemptCount":0,"maxAttempts":3,"createdAt":"2026-06-28T14:23:08Z","updatedAt":"2026-06-28T14:23:08Z","actionPayload":{"type":"send_email","to":"james@acme.com","subject":"Following up"},"context":{"leadScore":87},"expiresAt":"2026-06-28T18:23:08Z"}"#;
        let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", task.len(), task);
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let temp_dir = TempDir::new().unwrap();
    let config_path = setup_test_config(&temp_dir);

    sockt()
        .args(["tasks", "show", "142", "--config", config_path.to_str().unwrap()])
        .env("ORCH_URL", format!("http://127.0.0.1:{}", port))
        .assert()
        .success()
        .stdout(predicate::str::contains("Task #142"))
        .stdout(predicate::str::contains("pending_approval"))
        .stdout(predicate::str::contains("outbound-writer"))
        .stdout(predicate::str::contains("james@acme.com"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_tasks_show_not_found() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;

        let response = b"HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nContent-Length: 27\r\n\r\n{\"error\":\"Task not found\"}";
        let _ = socket.write_all(response).await;
        let _ = socket.shutdown().await;
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let temp_dir = TempDir::new().unwrap();
    let config_path = setup_test_config(&temp_dir);

    sockt()
        .args(["tasks", "show", "999", "--config", config_path.to_str().unwrap()])
        .env("ORCH_URL", format!("http://127.0.0.1:{}", port))
        .assert()
        .failure()
        .stderr(predicate::str::contains("No task with ID 999"));
}

// ========================================
// Phase 5: HITL Operations Tests
// ========================================

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_tasks_approve_success() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;

        let task = r#"{"id":"142","tenantId":"tenant-1","status":"approved","owner":"agent-1","parentId":null,"description":"Send email","output":null,"llmCallsUsed":0,"llmCallsBudget":25,"attemptCount":0,"maxAttempts":3,"createdAt":"2026-06-28T14:23:08Z","updatedAt":"2026-06-28T14:25:00Z"}"#;
        let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", task.len(), task);
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let temp_dir = TempDir::new().unwrap();
    let config_path = setup_test_config(&temp_dir);

    sockt()
        .args(["tasks", "approve", "142", "--config", config_path.to_str().unwrap()])
        .env("ORCH_URL", format!("http://127.0.0.1:{}", port))
        .assert()
        .success()
        .stdout(predicate::str::contains("✓ Task #142 approved"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_tasks_reject_with_reason() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;

        let task = r#"{"id":"142","tenantId":"tenant-1","status":"rejected","owner":"agent-1","parentId":null,"description":"Send email","output":null,"llmCallsUsed":0,"llmCallsBudget":25,"attemptCount":1,"maxAttempts":3,"createdAt":"2026-06-28T14:23:08Z","updatedAt":"2026-06-28T14:26:00Z"}"#;
        let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", task.len(), task);
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let temp_dir = TempDir::new().unwrap();
    let config_path = setup_test_config(&temp_dir);

    sockt()
        .args(["tasks", "reject", "142", "--reason", "tone is too salesy", "--config", config_path.to_str().unwrap()])
        .env("ORCH_URL", format!("http://127.0.0.1:{}", port))
        .assert()
        .success()
        .stdout(predicate::str::contains("✓ Task #142 rejected"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_tasks_cancel_with_confirm() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        // First request: GET task
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;
        let task = r#"{"id":"156","tenantId":"tenant-1","status":"in_progress","owner":"agent-2","parentId":null,"description":"Lead search","output":null,"llmCallsUsed":3,"llmCallsBudget":25,"attemptCount":1,"maxAttempts":3,"createdAt":"2026-06-28T14:58:00Z","updatedAt":"2026-06-28T15:00:00Z"}"#;
        let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", task.len(), task);
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;

        // Second request: POST cancel
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;
        let task = r#"{"id":"156","tenantId":"tenant-1","status":"cancelled","owner":"agent-2","parentId":null,"description":"Lead search","output":null,"llmCallsUsed":3,"llmCallsBudget":25,"attemptCount":1,"maxAttempts":3,"createdAt":"2026-06-28T14:58:00Z","updatedAt":"2026-06-28T15:01:00Z"}"#;
        let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", task.len(), task);
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let temp_dir = TempDir::new().unwrap();
    let config_path = setup_test_config(&temp_dir);

    sockt()
        .args(["tasks", "cancel", "156", "--confirm", "--config", config_path.to_str().unwrap()])
        .env("ORCH_URL", format!("http://127.0.0.1:{}", port))
        .assert()
        .success()
        .stdout(predicate::str::contains("✓ Task #156 cancelled"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_tasks_retry_with_priority() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        // First request: GET task
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;
        let task = r#"{"id":"148","tenantId":"tenant-1","status":"failed","owner":null,"parentId":null,"description":"Lead enrichment","output":"Apollo API timeout","llmCallsUsed":2,"llmCallsBudget":25,"attemptCount":2,"maxAttempts":3,"createdAt":"2026-06-28T13:00:00Z","updatedAt":"2026-06-28T15:00:00Z"}"#;
        let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", task.len(), task);
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;

        // Second request: POST retry
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;
        let task = r#"{"id":"148","tenantId":"tenant-1","status":"pending","owner":null,"parentId":null,"description":"Lead enrichment","output":"Apollo API timeout","llmCallsUsed":2,"llmCallsBudget":25,"attemptCount":2,"maxAttempts":3,"createdAt":"2026-06-28T13:00:00Z","updatedAt":"2026-06-28T15:01:00Z"}"#;
        let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", task.len(), task);
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let temp_dir = TempDir::new().unwrap();
    let config_path = setup_test_config(&temp_dir);

    sockt()
        .args(["tasks", "retry", "148", "--priority", "high", "--config", config_path.to_str().unwrap()])
        .env("ORCH_URL", format!("http://127.0.0.1:{}", port))
        .assert()
        .success()
        .stdout(predicate::str::contains("✓ Task #148 requeued"))
        .stdout(predicate::str::contains("priority: high"));
}
