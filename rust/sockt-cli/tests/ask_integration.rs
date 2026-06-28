use assert_cmd::Command;
use predicates::prelude::*;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::time::Duration;

fn sockt() -> Command {
    Command::cargo_bin("sockt").unwrap()
}

async fn read_request(socket: &mut tokio::net::TcpStream) -> String {
    let mut buf = vec![0u8; 8192];
    let n = socket.read(&mut buf).await.unwrap_or(0);
    String::from_utf8_lossy(&buf[..n]).to_string()
}

fn task_json(id: &str, status: &str, owner: Option<&str>, output: Option<&str>) -> String {
    let owner_json = match owner {
        Some(o) => format!("\"{}\"", o),
        None => "null".to_string(),
    };
    let output_json = match output {
        Some(o) => format!("\"{}\"", o),
        None => "null".to_string(),
    };
    format!(
        r#"{{"id":"{}","tenantId":"tenant-1","status":"{}","owner":{},"parentId":null,"description":"Test task","output":{},"llmCallsUsed":0,"llmCallsBudget":25,"attemptCount":0,"maxAttempts":3,"createdAt":"2026-06-27T10:00:00Z","updatedAt":"2026-06-27T10:00:00Z"}}"#,
        id, status, owner_json, output_json
    )
}

// --- CLI Parsing Tests ---

#[test]
fn test_ask_help_shows_options() {
    sockt()
        .args(["ask", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("--agent"))
        .stdout(predicate::str::contains("--priority"))
        .stdout(predicate::str::contains("--wait"))
        .stdout(predicate::str::contains("--timeout"))
        .stdout(predicate::str::contains("--json"));
}

#[test]
fn test_ask_requires_message() {
    sockt()
        .arg("ask")
        .assert()
        .failure();
}

#[test]
fn test_ask_priority_validates() {
    sockt()
        .args(["ask", "--priority", "invalid", "hello"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("invalid"));
}

// --- Integration Tests with Mock Server ---

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_ask_creates_task_and_prints_id() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let _ = read_request(&mut socket).await;
        let body = task_json("task-42", "pending", Some("lead-researcher"), None);
        let response = format!(
            "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;
    });

    tokio::time::sleep(Duration::from_millis(50)).await;

    let temp_dir = tempfile::TempDir::new().unwrap();
    let config_path = temp_dir.path().join("config.yaml");
    std::fs::write(
        &config_path,
        "version: '0.1.0'\ntier: local\ndeployment_id: tenant-1\nslack:\n  app_token:\n    ciphertext: ''\n    recipient: ''\n  signing_secret:\n    ciphertext: ''\n    recipient: ''\n  bot_token:\n    ciphertext: ''\n    recipient: ''\nmodels:\n  provider: anthropic\n  api_key:\n    ciphertext: ''\n    recipient: ''\n  frontier: claude-3\n  fast: claude-3-haiku\n",
    ).unwrap();

    sockt()
        .args(["--config", config_path.to_str().unwrap(), "ask", "Find leads"])
        .env("ORCH_URL", format!("http://127.0.0.1:{}", port))
        .assert()
        .success()
        .stdout(predicate::str::contains("task-42"))
        .stdout(predicate::str::contains("lead-researcher"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_ask_json_mode_outputs_task() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let _ = read_request(&mut socket).await;
        let body = task_json("task-99", "pending", None, None);
        let response = format!(
            "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;
    });

    tokio::time::sleep(Duration::from_millis(50)).await;

    let temp_dir = tempfile::TempDir::new().unwrap();
    let config_path = temp_dir.path().join("config.yaml");
    std::fs::write(
        &config_path,
        "version: '0.1.0'\ntier: local\ndeployment_id: tenant-1\nslack:\n  app_token:\n    ciphertext: ''\n    recipient: ''\n  signing_secret:\n    ciphertext: ''\n    recipient: ''\n  bot_token:\n    ciphertext: ''\n    recipient: ''\nmodels:\n  provider: anthropic\n  api_key:\n    ciphertext: ''\n    recipient: ''\n  frontier: claude-3\n  fast: claude-3-haiku\n",
    ).unwrap();

    let output = sockt()
        .args(["--config", config_path.to_str().unwrap(), "ask", "--json", "Find leads"])
        .env("ORCH_URL", format!("http://127.0.0.1:{}", port))
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();

    let parsed: serde_json::Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(parsed["id"], "task-99");
    assert_eq!(parsed["status"], "pending");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_ask_sends_correct_payload() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    let captured_body: Arc<tokio::sync::Mutex<String>> = Arc::new(tokio::sync::Mutex::new(String::new()));
    let captured_clone = captured_body.clone();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let request = read_request(&mut socket).await;
        // Extract body after the double CRLF
        if let Some(body_start) = request.find("\r\n\r\n") {
            let body = &request[body_start + 4..];
            *captured_clone.lock().await = body.to_string();
        }
        let body = task_json("task-1", "pending", Some("outbound-writer"), None);
        let response = format!(
            "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;
    });

    tokio::time::sleep(Duration::from_millis(50)).await;

    let temp_dir = tempfile::TempDir::new().unwrap();
    let config_path = temp_dir.path().join("config.yaml");
    std::fs::write(
        &config_path,
        "version: '0.1.0'\ntier: local\ndeployment_id: my-tenant\nslack:\n  app_token:\n    ciphertext: ''\n    recipient: ''\n  signing_secret:\n    ciphertext: ''\n    recipient: ''\n  bot_token:\n    ciphertext: ''\n    recipient: ''\nmodels:\n  provider: anthropic\n  api_key:\n    ciphertext: ''\n    recipient: ''\n  frontier: claude-3\n  fast: claude-3-haiku\n",
    ).unwrap();

    sockt()
        .args([
            "--config", config_path.to_str().unwrap(),
            "ask",
            "--agent", "outbound-writer",
            "--priority", "high",
            "Draft a follow-up email",
        ])
        .env("ORCH_URL", format!("http://127.0.0.1:{}", port))
        .assert()
        .success();

    tokio::time::sleep(Duration::from_millis(100)).await;
    let body = captured_body.lock().await;
    let parsed: serde_json::Value = serde_json::from_str(&body).unwrap();

    assert_eq!(parsed["tenantId"], "my-tenant");
    assert_eq!(parsed["description"], "Draft a follow-up email");
    assert_eq!(parsed["owner"], "outbound-writer");
    assert_eq!(parsed["priority"], "high");
    assert_eq!(parsed["source"], "cli");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_ask_wait_polls_until_complete() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let request_count = Arc::new(AtomicU32::new(0));
    let request_count_clone = request_count.clone();

    tokio::spawn(async move {
        // Request 1: POST /tasks (create)
        let (mut socket, _) = listener.accept().await.unwrap();
        let _ = read_request(&mut socket).await;
        request_count_clone.fetch_add(1, Ordering::SeqCst);
        let body = task_json("task-200", "pending", Some("lead-researcher"), None);
        let response = format!(
            "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(), body
        );
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;

        // Request 2: GET /tasks/task-200 (still pending)
        let (mut socket, _) = listener.accept().await.unwrap();
        let _ = read_request(&mut socket).await;
        request_count_clone.fetch_add(1, Ordering::SeqCst);
        let body = task_json("task-200", "in_progress", Some("lead-researcher"), None);
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(), body
        );
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;

        // Request 3: GET /tasks/task-200 (completed)
        let (mut socket, _) = listener.accept().await.unwrap();
        let _ = read_request(&mut socket).await;
        request_count_clone.fetch_add(1, Ordering::SeqCst);
        let body = task_json("task-200", "completed", Some("lead-researcher"), Some("Found 5 leads"));
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(), body
        );
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;
    });

    tokio::time::sleep(Duration::from_millis(50)).await;

    let temp_dir = tempfile::TempDir::new().unwrap();
    let config_path = temp_dir.path().join("config.yaml");
    std::fs::write(
        &config_path,
        "version: '0.1.0'\ntier: local\ndeployment_id: tenant-1\nslack:\n  app_token:\n    ciphertext: ''\n    recipient: ''\n  signing_secret:\n    ciphertext: ''\n    recipient: ''\n  bot_token:\n    ciphertext: ''\n    recipient: ''\nmodels:\n  provider: anthropic\n  api_key:\n    ciphertext: ''\n    recipient: ''\n  frontier: claude-3\n  fast: claude-3-haiku\n",
    ).unwrap();

    sockt()
        .args([
            "--config", config_path.to_str().unwrap(),
            "ask", "--wait", "--timeout", "30",
            "Find leads",
        ])
        .env("ORCH_URL", format!("http://127.0.0.1:{}", port))
        .timeout(std::time::Duration::from_secs(15))
        .assert()
        .success()
        .stdout(predicate::str::contains("Found 5 leads"))
        .stdout(predicate::str::contains("task-200"));

    assert!(request_count.load(Ordering::SeqCst) >= 3);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_ask_wait_shows_failed_task() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        // Request 1: POST /tasks
        let (mut socket, _) = listener.accept().await.unwrap();
        let _ = read_request(&mut socket).await;
        let body = task_json("task-300", "pending", None, None);
        let response = format!(
            "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(), body
        );
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;

        // Request 2: GET /tasks/task-300 (failed)
        let (mut socket, _) = listener.accept().await.unwrap();
        let _ = read_request(&mut socket).await;
        let body = task_json("task-300", "failed", None, Some("Budget exhausted"));
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(), body
        );
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;
    });

    tokio::time::sleep(Duration::from_millis(50)).await;

    let temp_dir = tempfile::TempDir::new().unwrap();
    let config_path = temp_dir.path().join("config.yaml");
    std::fs::write(
        &config_path,
        "version: '0.1.0'\ntier: local\ndeployment_id: tenant-1\nslack:\n  app_token:\n    ciphertext: ''\n    recipient: ''\n  signing_secret:\n    ciphertext: ''\n    recipient: ''\n  bot_token:\n    ciphertext: ''\n    recipient: ''\nmodels:\n  provider: anthropic\n  api_key:\n    ciphertext: ''\n    recipient: ''\n  frontier: claude-3\n  fast: claude-3-haiku\n",
    ).unwrap();

    sockt()
        .args([
            "--config", config_path.to_str().unwrap(),
            "ask", "--wait", "--timeout", "30",
            "Do something",
        ])
        .env("ORCH_URL", format!("http://127.0.0.1:{}", port))
        .timeout(std::time::Duration::from_secs(10))
        .assert()
        .success()
        .stdout(predicate::str::contains("failed"))
        .stdout(predicate::str::contains("Budget exhausted"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn test_ask_orch_unreachable_shows_error() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let config_path = temp_dir.path().join("config.yaml");
    std::fs::write(
        &config_path,
        "version: '0.1.0'\ntier: local\ndeployment_id: tenant-1\nslack:\n  app_token:\n    ciphertext: ''\n    recipient: ''\n  signing_secret:\n    ciphertext: ''\n    recipient: ''\n  bot_token:\n    ciphertext: ''\n    recipient: ''\nmodels:\n  provider: anthropic\n  api_key:\n    ciphertext: ''\n    recipient: ''\n  frontier: claude-3\n  fast: claude-3-haiku\n",
    ).unwrap();

    sockt()
        .args(["--config", config_path.to_str().unwrap(), "ask", "Find leads"])
        .env("ORCH_URL", "http://127.0.0.1:1")
        .assert()
        .failure()
        .stderr(predicate::str::contains("orchestrator").or(predicate::str::contains("swarm")));
}
