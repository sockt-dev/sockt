use std::collections::HashMap;
use std::path::PathBuf;
use tempfile::TempDir;

// Import runtime module types
use sockt_cli::runtime::{RuntimeState, ServicePid, save_runtime_state, load_runtime_state, remove_runtime_state, is_process_alive, kill_process, spawn_bun_service, check_health};

// Helper to get runtime state path in test environment
fn runtime_state_path(temp_dir: &TempDir) -> PathBuf {
    temp_dir.path().join(".sockt").join("runtime.json")
}

// Helper to set up test environment with .sockt directory
fn setup_test_env() -> TempDir {
    let dir = TempDir::new().unwrap();
    std::fs::create_dir_all(dir.path().join(".sockt")).unwrap();
    dir
}

// Phase 1: State Management Tests

#[test]
fn test_save_runtime_state_creates_file() {
    let temp_dir = setup_test_env();
    unsafe {
        std::env::set_var("HOME", temp_dir.path());
    }

    let state = RuntimeState {
        pids: vec![ServicePid {
            name: "test-service".to_string(),
            pid: 12345,
            port: Some(3000),
        }],
    };

    save_runtime_state(&state).unwrap();

    let path = runtime_state_path(&temp_dir);
    assert!(path.exists());

    let contents = std::fs::read_to_string(&path).unwrap();
    assert!(contents.contains("test-service"));
    assert!(contents.contains("12345"));
}

#[test]
fn test_load_runtime_state_empty() {
    let temp_dir = setup_test_env();
    unsafe {
        std::env::set_var("HOME", temp_dir.path());
    }

    // Test when file doesn't exist
    let state = load_runtime_state().unwrap();
    assert_eq!(state.pids.len(), 0);

    // Test when file is empty
    let path = runtime_state_path(&temp_dir);
    std::fs::write(&path, "").unwrap();
    let state = load_runtime_state().unwrap();
    assert_eq!(state.pids.len(), 0);
}

#[test]
fn test_save_load_roundtrip() {
    let temp_dir = setup_test_env();
    unsafe {
        std::env::set_var("HOME", temp_dir.path());
    }

    let original = RuntimeState {
        pids: vec![ServicePid {
            name: "single-service".to_string(),
            pid: 99999,
            port: Some(8080),
        }],
    };

    save_runtime_state(&original).unwrap();
    let loaded = load_runtime_state().unwrap();

    assert_eq!(loaded, original);
}

#[test]
fn test_save_load_multiple_services() {
    let temp_dir = setup_test_env();
    unsafe {
        std::env::set_var("HOME", temp_dir.path());
    }

    let original = RuntimeState {
        pids: vec![
            ServicePid {
                name: "service-a".to_string(),
                pid: 100,
                port: Some(3000),
            },
            ServicePid {
                name: "service-b".to_string(),
                pid: 200,
                port: Some(4000),
            },
            ServicePid {
                name: "service-c".to_string(),
                pid: 300,
                port: None,
            },
        ],
    };

    save_runtime_state(&original).unwrap();
    let loaded = load_runtime_state().unwrap();

    assert_eq!(loaded.pids.len(), 3);
    assert_eq!(loaded, original);
}

#[test]
fn test_remove_runtime_state() {
    let temp_dir = setup_test_env();
    unsafe {
        std::env::set_var("HOME", temp_dir.path());
    }

    let state = RuntimeState {
        pids: vec![ServicePid {
            name: "temp".to_string(),
            pid: 111,
            port: None,
        }],
    };

    save_runtime_state(&state).unwrap();
    let path = runtime_state_path(&temp_dir);
    assert!(path.exists());

    remove_runtime_state().unwrap();
    assert!(!path.exists());

    // Test idempotency - removing when already deleted should not error
    remove_runtime_state().unwrap();
}

#[test]
fn test_runtime_state_path_uses_home_dir() {
    let temp_dir = setup_test_env();
    unsafe {
        std::env::set_var("HOME", temp_dir.path());
    }

    let state = RuntimeState::default();
    save_runtime_state(&state).unwrap();

    let path = runtime_state_path(&temp_dir);
    let path_str = path.to_string_lossy();
    assert!(path_str.contains(".sockt"));
    assert!(path_str.ends_with("runtime.json"));
}

// Phase 2: Process Lifecycle Tests

#[test]
fn test_is_process_alive_self() {
    let current_pid = std::process::id();
    assert!(is_process_alive(current_pid), "Current process should be alive");
}

#[test]
fn test_is_process_alive_invalid_pid() {
    // Use a very high PID that's unlikely to exist
    let invalid_pid = 999_999_999;
    assert!(!is_process_alive(invalid_pid), "Invalid PID should not be alive");
}

#[test]
fn test_spawn_simple_process() {
    // Spawn a sleep process using the same pattern as spawn_bun_service
    let mut cmd = std::process::Command::new("sleep");
    cmd.arg("10")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    let mut child = cmd.spawn().unwrap();
    let pid = child.id();

    // Verify process is alive
    assert!(is_process_alive(pid), "Spawned process should be alive");

    // Clean up
    kill_process(pid, true).unwrap();
    let _ = child.wait();  // Reap the process
    assert!(!is_process_alive(pid), "Process should be dead after kill");
}

#[test]
fn test_kill_process_sigterm() {
    // Spawn a sleep process
    let mut cmd = std::process::Command::new("sleep");
    cmd.arg("100");
    let mut child = cmd.spawn().unwrap();
    let pid = child.id();

    assert!(is_process_alive(pid));

    // Kill with SIGTERM (graceful)
    kill_process(pid, false).unwrap();

    // Wait for the process to terminate and be reaped
    let _ = child.wait();

    // Verify process is dead
    assert!(!is_process_alive(pid), "Process should be dead after SIGTERM");
}

#[test]
fn test_kill_process_sigkill() {
    // Spawn a sleep process
    let mut cmd = std::process::Command::new("sleep");
    cmd.arg("100");
    let mut child = cmd.spawn().unwrap();
    let pid = child.id();

    assert!(is_process_alive(pid));

    // Kill with SIGKILL (force)
    kill_process(pid, true).unwrap();

    // Wait for the process to be reaped
    let _ = child.wait();

    // Verify process is dead
    assert!(!is_process_alive(pid), "Process should be dead after SIGKILL");
}

// Phase 3: Health Check Tests

#[tokio::test]
async fn test_health_check_success() {
    use tokio::io::{AsyncWriteExt};

    // Start a simple HTTP server that responds with 200 OK
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let response = b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK";
        let _ = socket.write_all(response).await;
    });

    // Give server time to start
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let url = format!("http://127.0.0.1:{}/health", port);
    let result = check_health(&url, 5000).await.unwrap();
    assert!(result, "Health check should succeed for 200 OK");
}

#[tokio::test]
async fn test_health_check_timeout() {
    // Bind to a port but don't accept connections - this will timeout
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    // Don't spawn an accept task - connections will hang

    let url = format!("http://127.0.0.1:{}/health", port);
    let result = check_health(&url, 100).await;  // Short timeout
    assert!(result.is_err(), "Health check should fail on timeout");
}

#[tokio::test]
async fn test_health_check_invalid_url() {
    let result = check_health("not-a-valid-url", 1000).await;
    assert!(result.is_err(), "Health check should fail for invalid URL");
}

#[tokio::test]
async fn test_health_check_non_200_status() {
    use tokio::io::{AsyncWriteExt};

    // Start a server that responds with 500
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let response = b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 5\r\n\r\nError";
        let _ = socket.write_all(response).await;
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let url = format!("http://127.0.0.1:{}/health", port);
    let result = check_health(&url, 5000).await.unwrap();
    assert!(!result, "Health check should return false for 500 status");
}

// Phase 4: Bun Integration Tests

#[test]
fn test_spawn_bun_service_basic() {
    // Create a simple JS file for bun to execute
    let temp_dir = tempfile::TempDir::new().unwrap();
    let script_path = temp_dir.path().join("test.js");
    std::fs::write(&script_path, "setTimeout(() => {}, 10000);").unwrap();

    let env_vars = HashMap::new();
    let service = spawn_bun_service(
        script_path.to_str().unwrap(),
        env_vars.clone(),
        "test-bun-service"
    ).unwrap();

    assert_eq!(service.name, "test-bun-service");
    assert!(is_process_alive(service.pid), "Bun process should be alive");
    assert_eq!(service.port, None, "No port should be set");

    // Clean up
    kill_process(service.pid, true).unwrap();
}

#[test]
fn test_spawn_bun_with_env_vars() {
    // Create a simple JS file
    let temp_dir = tempfile::TempDir::new().unwrap();
    let script_path = temp_dir.path().join("test.js");
    std::fs::write(&script_path, "setTimeout(() => {}, 10000);").unwrap();

    let mut env_vars = HashMap::new();
    env_vars.insert("PORT".to_string(), "3000".to_string());
    env_vars.insert("NODE_ENV".to_string(), "test".to_string());

    let service = spawn_bun_service(
        script_path.to_str().unwrap(),
        env_vars,
        "test-with-env"
    ).unwrap();

    assert_eq!(service.name, "test-with-env");
    assert!(is_process_alive(service.pid), "Bun process should be alive");
    assert_eq!(service.port, Some(3000), "Port should be extracted from env");

    // Clean up
    kill_process(service.pid, true).unwrap();
}
