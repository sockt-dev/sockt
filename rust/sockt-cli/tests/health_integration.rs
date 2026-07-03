use assert_cmd::Command;
use predicates::prelude::*;
use serde_json::json;
use std::fs;
use std::process::Command as StdCommand;
use tempfile::TempDir;

fn sockt() -> Command {
    Command::cargo_bin("sockt").unwrap()
}

fn setup_runtime_with_services(temp_dir: &TempDir, services: Vec<(&str, u32, Option<u16>)>) {
    let sockt_dir = temp_dir.path().join(".sockt");
    fs::create_dir_all(&sockt_dir).unwrap();

    let pids: Vec<_> = services
        .into_iter()
        .map(|(name, pid, port)| {
            json!({
                "name": name,
                "pid": pid,
                "port": port
            })
        })
        .collect();

    let state = json!({ "pids": pids });
    fs::write(
        sockt_dir.join("runtime.json"),
        serde_json::to_string_pretty(&state).unwrap(),
    )
    .unwrap();
}

fn spawn_sleep_processes(count: usize) -> Vec<u32> {
    let mut pids = Vec::new();
    for _ in 0..count {
        let child = StdCommand::new("sleep")
            .arg("300")
            .spawn()
            .expect("Failed to spawn sleep process");
        pids.push(child.id());
        std::mem::forget(child);
    }
    pids
}

fn cleanup_processes(pids: &[u32]) {
    for &pid in pids {
        let _ = StdCommand::new("kill")
            .args(["-9", &pid.to_string()])
            .output();
    }
}

// =============================================================================
// Phase 1: Argument Parsing Tests
// =============================================================================

#[test]
fn test_health_help_shows_all_options() {
    sockt()
        .arg("health")
        .arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("--json"))
        .stdout(predicate::str::contains("--fix"));
}

#[test]
fn test_health_accepts_json_flag() {
    let temp_dir = TempDir::new().unwrap();
    sockt()
        .env("HOME", temp_dir.path())
        .arg("health")
        .arg("--json")
        .assert()
        .code(predicate::in_iter(vec![0, 1, 2]));
}

#[test]
fn test_health_accepts_fix_flag() {
    let temp_dir = TempDir::new().unwrap();
    sockt()
        .env("HOME", temp_dir.path())
        .arg("health")
        .arg("--fix")
        .assert()
        .code(predicate::in_iter(vec![0, 1, 2]));
}

// =============================================================================
// Phase 2: No Swarm Running
// =============================================================================

#[test]
fn test_health_no_runtime_state_exit_code_2() {
    let temp_dir = TempDir::new().unwrap();
    sockt()
        .env("HOME", temp_dir.path())
        .arg("health")
        .assert()
        .code(2);
}

#[test]
fn test_health_no_runtime_shows_not_running() {
    let temp_dir = TempDir::new().unwrap();
    sockt()
        .env("HOME", temp_dir.path())
        .arg("health")
        .assert()
        .code(2)
        .stdout(
            predicate::str::contains("not running")
                .or(predicate::str::contains("No services")),
        );
}

#[test]
fn test_health_empty_runtime_exit_code_2() {
    let temp_dir = TempDir::new().unwrap();
    let sockt_dir = temp_dir.path().join(".sockt");
    fs::create_dir_all(&sockt_dir).unwrap();
    fs::write(
        sockt_dir.join("runtime.json"),
        json!({"pids": []}).to_string(),
    )
    .unwrap();

    sockt()
        .env("HOME", temp_dir.path())
        .arg("health")
        .assert()
        .code(2);
}

#[test]
fn test_health_json_when_no_swarm() {
    let temp_dir = TempDir::new().unwrap();
    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("health")
        .arg("--json")
        .assert()
        .code(2)
        .get_output()
        .stdout
        .clone();

    let stdout = String::from_utf8(output).unwrap();
    let json: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert!(json.get("checks").is_some() || json.get("status").is_some());
}

// =============================================================================
// Phase 3: Services Alive/Dead
// =============================================================================

#[test]
fn test_health_all_services_running_exit_0() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(3);

    setup_runtime_with_services(
        &temp_dir,
        vec![
            ("gbrain-mcp", pids[0], None),
            ("orch", pids[1], None),
            ("cadvp", pids[2], None),
        ],
    );

    sockt()
        .env("HOME", temp_dir.path())
        .env("ORCH_URL", "http://127.0.0.1:1") // unreachable, but services alive
        .arg("health")
        .assert()
        .code(predicate::in_iter(vec![0, 1])); // 0 or 1 (warn for unreachable orch)

    cleanup_processes(&pids);
}

#[test]
fn test_health_shows_service_names() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(2);

    setup_runtime_with_services(
        &temp_dir,
        vec![("my-service-a", pids[0], None), ("my-service-b", pids[1], None)],
    );

    sockt()
        .env("HOME", temp_dir.path())
        .env("ORCH_URL", "http://127.0.0.1:1")
        .arg("health")
        .assert()
        .stdout(predicate::str::contains("my-service-a"))
        .stdout(predicate::str::contains("my-service-b"));

    cleanup_processes(&pids);
}

#[test]
fn test_health_dead_process_shows_fail() {
    let temp_dir = TempDir::new().unwrap();

    setup_runtime_with_services(&temp_dir, vec![("dead-service", 999999, None)]);

    sockt()
        .env("HOME", temp_dir.path())
        .env("ORCH_URL", "http://127.0.0.1:1")
        .arg("health")
        .assert()
        .code(2)
        .stdout(predicate::str::contains("dead-service"));

    cleanup_processes(&[]);
}

#[test]
fn test_health_mixed_alive_dead_exit_code() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(1);

    setup_runtime_with_services(
        &temp_dir,
        vec![
            ("alive-service", pids[0], None),
            ("dead-service", 999999, None),
        ],
    );

    sockt()
        .env("HOME", temp_dir.path())
        .env("ORCH_URL", "http://127.0.0.1:1")
        .arg("health")
        .assert()
        .code(2); // fail because a service is dead

    cleanup_processes(&pids);
}

// =============================================================================
// Phase 4: JSON Output
// =============================================================================

#[test]
fn test_health_json_structure() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(1);

    setup_runtime_with_services(&temp_dir, vec![("service-a", pids[0], None)]);

    let output = sockt()
        .env("HOME", temp_dir.path())
        .env("ORCH_URL", "http://127.0.0.1:1")
        .arg("health")
        .arg("--json")
        .assert()
        .get_output()
        .stdout
        .clone();

    let stdout = String::from_utf8(output).unwrap();
    let json: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    let checks = json.get("checks").unwrap().as_array().unwrap();

    // Each check should have name, status, message
    for check in checks {
        assert!(check.get("name").is_some());
        assert!(check.get("status").is_some());
        assert!(check.get("message").is_some());
    }

    cleanup_processes(&pids);
}

#[test]
fn test_health_json_parseable() {
    let temp_dir = TempDir::new().unwrap();

    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("health")
        .arg("--json")
        .assert()
        .get_output()
        .stdout
        .clone();

    let stdout = String::from_utf8(output).unwrap();
    assert!(stdout.trim().starts_with('{'));
    assert!(stdout.trim().ends_with('}'));
    let result: serde_json::Result<serde_json::Value> = serde_json::from_str(&stdout);
    assert!(result.is_ok());
}

#[test]
fn test_health_json_no_extra_output() {
    let temp_dir = TempDir::new().unwrap();

    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("health")
        .arg("--json")
        .assert()
        .get_output()
        .stdout
        .clone();

    let stdout = String::from_utf8(output).unwrap();
    // Pure JSON, no extra text
    assert!(stdout.trim().starts_with('{'));
    assert!(stdout.trim().ends_with('}'));
}

// =============================================================================
// Phase 5: Orch API Check with Mock Server
// =============================================================================

#[test]
fn test_health_orch_reachable_shows_pass() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(1);
    setup_runtime_with_services(&temp_dir, vec![("service", pids[0], None)]);

    // Start a mock orch server
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();

    let handle = std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            use std::io::{Read, Write};
            let mut buf = [0u8; 1024];
            let _ = stream.read(&mut buf);
            let body = r#"{"status":"healthy","uptime":12345,"activeAgents":3,"pendingTasks":5}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
        }
    });

    let output = sockt()
        .env("HOME", temp_dir.path())
        .env("ORCH_URL", format!("http://127.0.0.1:{}", port))
        .arg("health")
        .arg("--json")
        .assert()
        .get_output()
        .stdout
        .clone();

    let stdout = String::from_utf8(output).unwrap();
    let json: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    let checks = json.get("checks").unwrap().as_array().unwrap();

    let orch_check = checks.iter().find(|c| {
        c.get("name")
            .unwrap()
            .as_str()
            .unwrap()
            .contains("Orch")
    });
    assert!(orch_check.is_some());
    assert_eq!(
        orch_check.unwrap().get("status").unwrap().as_str().unwrap(),
        "pass"
    );

    cleanup_processes(&pids);
    let _ = handle.join();
}

// =============================================================================
// Phase 6: Fix Mode
// =============================================================================

#[test]
fn test_health_fix_with_no_issues_noop() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(1);
    setup_runtime_with_services(&temp_dir, vec![("service", pids[0], None)]);

    // With fix, healthy services should just report "nothing to fix"
    sockt()
        .env("HOME", temp_dir.path())
        .env("ORCH_URL", "http://127.0.0.1:1")
        .arg("health")
        .arg("--fix")
        .assert()
        .code(predicate::in_iter(vec![0, 1]));

    cleanup_processes(&pids);
}
