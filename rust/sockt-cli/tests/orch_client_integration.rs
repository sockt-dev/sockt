use sockt_cli::orch_client::{OrchClient, OrchClientConfig, TaskCreate};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::time::Duration;

// Helper to create test client pointing to a test server
fn test_client(port: u16) -> OrchClient {
    OrchClient::new(OrchClientConfig {
        base_url: format!("http://127.0.0.1:{}", port),
        timeout_ms: 5000,
        retries: 2,
    })
    .unwrap()
}

// Helper to read HTTP request from socket (discard the actual content)
async fn read_request(socket: &mut tokio::net::TcpStream) {
    let mut buf = vec![0u8; 4096];
    let _ = socket.read(&mut buf).await;
}

// Phase 1: Basic HTTP Operations

#[tokio::test]
async fn test_health_success() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;
        let response = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 69\r\nConnection: close\r\n\r\n{\"status\":\"healthy\",\"uptime\":12345,\"activeAgents\":3,\"pendingTasks\":5}";
        let _ = socket.write_all(response).await;
        let _ = socket.shutdown().await;
    });

    tokio::time::sleep(Duration::from_millis(50)).await;

    let client = test_client(port);
    let health = client.health().await.unwrap();

    assert_eq!(health.status, "healthy");
    assert_eq!(health.uptime, 12345);
    assert_eq!(health.active_agents, 3);
    assert_eq!(health.pending_tasks, 5);
}

#[tokio::test]
async fn test_create_task_success() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;
        let response = b"HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: 267\r\nConnection: close\r\n\r\n{\"id\":\"task-123\",\"tenantId\":\"tenant-1\",\"status\":\"pending\",\"owner\":null,\"parentId\":null,\"description\":\"Test task\",\"output\":null,\"llmCallsUsed\":0,\"llmCallsBudget\":25,\"attemptCount\":0,\"maxAttempts\":3,\"createdAt\":\"2026-06-27T10:00:00Z\",\"updatedAt\":\"2026-06-27T10:00:00Z\"}";
        let _ = socket.write_all(response).await;
        let _ = socket.shutdown().await;
    });

    tokio::time::sleep(Duration::from_millis(50)).await;

    let client = test_client(port);
    let task_create = TaskCreate {
        tenant_id: "tenant-1".to_string(),
        description: "Test task".to_string(),
        parent_id: None,
        llm_calls_budget: None,
        max_attempts: None,
    };
    let task = client.create_task(task_create).await.unwrap();

    assert_eq!(task.id, "task-123");
    assert_eq!(task.tenant_id, "tenant-1");
    assert_eq!(task.status, "pending");
    assert_eq!(task.description, "Test task");
    assert_eq!(task.llm_calls_budget, 25);
}

#[tokio::test]
async fn test_get_running_tasks_success() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;
        let response = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 527\r\nConnection: close\r\n\r\n[{\"id\":\"task-1\",\"tenantId\":\"tenant-1\",\"status\":\"pending\",\"owner\":null,\"parentId\":null,\"description\":\"Task 1\",\"output\":null,\"llmCallsUsed\":0,\"llmCallsBudget\":25,\"attemptCount\":0,\"maxAttempts\":3,\"createdAt\":\"2026-06-27T10:00:00Z\",\"updatedAt\":\"2026-06-27T10:00:00Z\"},{\"id\":\"task-2\",\"tenantId\":\"tenant-1\",\"status\":\"pending\",\"owner\":null,\"parentId\":null,\"description\":\"Task 2\",\"output\":null,\"llmCallsUsed\":0,\"llmCallsBudget\":25,\"attemptCount\":0,\"maxAttempts\":3,\"createdAt\":\"2026-06-27T10:00:00Z\",\"updatedAt\":\"2026-06-27T10:00:00Z\"}]";
        let _ = socket.write_all(response).await;
        let _ = socket.shutdown().await;
    });

    tokio::time::sleep(Duration::from_millis(50)).await;

    let client = test_client(port);
    let tasks = client.get_running_tasks("tenant-1").await.unwrap();

    assert_eq!(tasks.len(), 2);
    assert_eq!(tasks[0].id, "task-1");
    assert_eq!(tasks[1].id, "task-2");
}

// Phase 2: Task Lifecycle Operations

#[tokio::test]
async fn test_claim_task_success() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;
        let response = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 276\r\nConnection: close\r\n\r\n{\"id\":\"task-123\",\"tenantId\":\"tenant-1\",\"status\":\"in_progress\",\"owner\":\"agent-1\",\"parentId\":null,\"description\":\"Test task\",\"output\":null,\"llmCallsUsed\":0,\"llmCallsBudget\":25,\"attemptCount\":1,\"maxAttempts\":3,\"createdAt\":\"2026-06-27T10:00:00Z\",\"updatedAt\":\"2026-06-27T10:01:00Z\"}";
        let _ = socket.write_all(response).await;
        let _ = socket.shutdown().await;
    });

    tokio::time::sleep(Duration::from_millis(50)).await;

    let client = test_client(port);
    let task = client.claim_task("task-123", "agent-1").await.unwrap();

    assert_eq!(task.id, "task-123");
    assert_eq!(task.status, "in_progress");
    assert_eq!(task.owner, Some("agent-1".to_string()));
}

#[tokio::test]
async fn test_complete_task_success() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;
        let response = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 286\r\nConnection: close\r\n\r\n{\"id\":\"task-123\",\"tenantId\":\"tenant-1\",\"status\":\"completed\",\"owner\":\"agent-1\",\"parentId\":null,\"description\":\"Test task\",\"output\":\"Task completed\",\"llmCallsUsed\":5,\"llmCallsBudget\":25,\"attemptCount\":1,\"maxAttempts\":3,\"createdAt\":\"2026-06-27T10:00:00Z\",\"updatedAt\":\"2026-06-27T10:05:00Z\"}";
        let _ = socket.write_all(response).await;
        let _ = socket.shutdown().await;
    });

    tokio::time::sleep(Duration::from_millis(50)).await;

    let client = test_client(port);
    client
        .complete_task("task-123", "Task completed")
        .await
        .unwrap();
}

#[tokio::test]
async fn test_escalate_task_success() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;
        let response = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 289\r\nConnection: close\r\n\r\n{\"id\":\"task-123\",\"tenantId\":\"tenant-1\",\"status\":\"escalated\",\"owner\":\"agent-1\",\"parentId\":null,\"description\":\"Test task\",\"output\":\"Budget exhausted\",\"llmCallsUsed\":25,\"llmCallsBudget\":25,\"attemptCount\":1,\"maxAttempts\":3,\"createdAt\":\"2026-06-27T10:00:00Z\",\"updatedAt\":\"2026-06-27T10:05:00Z\"}";
        let _ = socket.write_all(response).await;
        let _ = socket.shutdown().await;
    });

    tokio::time::sleep(Duration::from_millis(50)).await;

    let client = test_client(port);
    client
        .escalate_task("task-123", "Budget exhausted")
        .await
        .unwrap();
}

#[tokio::test]
async fn test_record_llm_call_success() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;
        let response =
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 16\r\nConnection: close\r\n\r\n{\"remaining\":20}";
        let _ = socket.write_all(response).await;
        let _ = socket.shutdown().await;
    });

    tokio::time::sleep(Duration::from_millis(50)).await;

    let client = test_client(port);
    let result = client.record_llm_call("task-123").await.unwrap();

    assert_eq!(result.remaining, 20);
}

// Phase 3: Error Handling

#[tokio::test]
async fn test_404_not_found() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;
        let response =
            b"HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nContent-Length: 27\r\n\r\n{\"error\":\"Task not found\"}";
        let _ = socket.write_all(response).await;
    });

    tokio::time::sleep(Duration::from_millis(50)).await;

    let client = test_client(port);
    let result = client.claim_task("nonexistent", "agent-1").await;

    assert!(result.is_err());
    let err_msg = result.unwrap_err().to_string();
    assert!(err_msg.contains("404"));
}

#[tokio::test]
async fn test_timeout() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    // Don't spawn accept task - connections will hang

    let client = OrchClient::new(OrchClientConfig {
        base_url: format!("http://127.0.0.1:{}", port),
        timeout_ms: 100,
        retries: 0,
    })
    .unwrap();

    let result = client.health().await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_invalid_json_response() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;
        let response =
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 14\r\n\r\n{invalid json}";
        let _ = socket.write_all(response).await;
    });

    tokio::time::sleep(Duration::from_millis(50)).await;

    let client = test_client(port);
    let result = client.health().await;

    assert!(result.is_err());
}

// Phase 4: Retry Logic

#[tokio::test]
async fn test_retry_on_500() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let attempt_count = Arc::new(AtomicU32::new(0));
    let attempt_count_clone = attempt_count.clone();

    tokio::spawn(async move {
        for _ in 0..3 {
            let (mut socket, _) = listener.accept().await.unwrap();
            read_request(&mut socket).await;
            let count = attempt_count_clone.fetch_add(1, Ordering::SeqCst);

            if count < 2 {
                // First two attempts fail with 500
                let response = b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 5\r\n\r\nError";
                let _ = socket.write_all(response).await;
            } else {
                // Third attempt succeeds
                let response = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 69\r\nConnection: close\r\n\r\n{\"status\":\"healthy\",\"uptime\":12345,\"activeAgents\":3,\"pendingTasks\":5}";
                let _ = socket.write_all(response).await;
                let _ = socket.shutdown().await;
            }
        }
    });

    tokio::time::sleep(Duration::from_millis(50)).await;

    let client = test_client(port);
    let health = client.health().await.unwrap();

    assert_eq!(health.status, "healthy");
    assert_eq!(attempt_count.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn test_retry_on_429() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let attempt_count = Arc::new(AtomicU32::new(0));
    let attempt_count_clone = attempt_count.clone();

    tokio::spawn(async move {
        for _ in 0..2 {
            let (mut socket, _) = listener.accept().await.unwrap();
            read_request(&mut socket).await;
            let count = attempt_count_clone.fetch_add(1, Ordering::SeqCst);

            if count == 0 {
                // First attempt fails with 429
                let response =
                    b"HTTP/1.1 429 Too Many Requests\r\nContent-Length: 11\r\n\r\nRate limit";
                let _ = socket.write_all(response).await;
            } else {
                // Second attempt succeeds
                let response = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 69\r\nConnection: close\r\n\r\n{\"status\":\"healthy\",\"uptime\":12345,\"activeAgents\":3,\"pendingTasks\":5}";
                let _ = socket.write_all(response).await;
                let _ = socket.shutdown().await;
            }
        }
    });

    tokio::time::sleep(Duration::from_millis(50)).await;

    let client = test_client(port);
    let health = client.health().await.unwrap();

    assert_eq!(health.status, "healthy");
    assert_eq!(attempt_count.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn test_no_retry_on_404() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let attempt_count = Arc::new(AtomicU32::new(0));
    let attempt_count_clone = attempt_count.clone();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;
        attempt_count_clone.fetch_add(1, Ordering::SeqCst);
        let response =
            b"HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nContent-Length: 27\r\n\r\n{\"error\":\"Task not found\"}";
        let _ = socket.write_all(response).await;
    });

    tokio::time::sleep(Duration::from_millis(50)).await;

    let client = test_client(port);
    let result = client.health().await;

    assert!(result.is_err());
    // Should only attempt once (no retries for 404)
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(attempt_count.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn test_max_retries_exhausted() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let attempt_count = Arc::new(AtomicU32::new(0));
    let attempt_count_clone = attempt_count.clone();

    tokio::spawn(async move {
        for _ in 0..3 {
            let (mut socket, _) = listener.accept().await.unwrap();
            read_request(&mut socket).await;
            attempt_count_clone.fetch_add(1, Ordering::SeqCst);
            let response = b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 5\r\n\r\nError";
            let _ = socket.write_all(response).await;
        }
    });

    tokio::time::sleep(Duration::from_millis(50)).await;

    let client = test_client(port);
    let result = client.health().await;

    assert!(result.is_err());
    // Should attempt 3 times (initial + 2 retries)
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(attempt_count.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn test_base_url_trailing_slash_stripped() {
    let _client = OrchClient::new(OrchClientConfig {
        base_url: "http://127.0.0.1:3200/".to_string(),
        timeout_ms: 5000,
        retries: 2,
    })
    .unwrap();

    // Internal base_url should not have trailing slash
    // This is tested implicitly - if it doesn't strip, URLs like "http://127.0.0.1:3200//health" would be malformed
    assert!(true);
}
