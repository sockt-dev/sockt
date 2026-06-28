use assert_cmd::Command;
use predicates::prelude::*;
use serde_json::json;
use std::fs;
use std::process::Command as StdCommand;
use tempfile::TempDir;

// =============================================================================
// Test Helpers
// =============================================================================

fn sockt() -> Command {
    Command::cargo_bin("sockt").unwrap()
}

fn setup_test_runtime_state(temp_dir: &TempDir, services: Vec<(&str, u32)>) {
    let sockt_dir = temp_dir.path().join(".sockt");
    fs::create_dir_all(&sockt_dir).unwrap();

    let pids: Vec<_> = services
        .into_iter()
        .map(|(name, pid)| {
            json!({
                "name": name,
                "pid": pid,
                "port": null
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
        let pid = child.id();
        pids.push(pid);
        std::mem::forget(child);
    }
    pids
}

fn cleanup_test_processes(pids: &[u32]) {
    for &pid in pids {
        let _ = StdCommand::new("kill")
            .args(["-9", &pid.to_string()])
            .output();
    }
}

fn is_process_alive(pid: u32) -> bool {
    let output = StdCommand::new("ps")
        .args(["-p", &pid.to_string(), "-o", "stat="])
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let stat = String::from_utf8_lossy(&out.stdout);
            !stat.trim().starts_with('Z')
        }
        _ => false,
    }
}

// =============================================================================
// Phase 1: Argument Parsing Tests
// =============================================================================

#[test]
fn test_restart_help_shows_all_options() {
    sockt()
        .arg("restart")
        .arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("--hard"))
        .stdout(predicate::str::contains("--timeout"));
}

#[test]
fn test_restart_accepts_hard_flag() {
    let temp_dir = TempDir::new().unwrap();

    sockt()
        .env("HOME", temp_dir.path())
        .args(["restart", "--hard"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("not running"));
}

#[test]
fn test_restart_accepts_timeout_with_value() {
    let temp_dir = TempDir::new().unwrap();

    sockt()
        .env("HOME", temp_dir.path())
        .args(["restart", "--timeout", "120"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("not running"));
}

#[test]
fn test_restart_accepts_agent_name_argument() {
    let temp_dir = TempDir::new().unwrap();

    sockt()
        .env("HOME", temp_dir.path())
        .args(["restart", "lead-researcher"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("not running"));
}

// =============================================================================
// Phase 2: Error Cases
// =============================================================================

#[test]
fn test_restart_when_not_running_suggests_deploy() {
    let temp_dir = TempDir::new().unwrap();

    sockt()
        .env("HOME", temp_dir.path())
        .arg("restart")
        .assert()
        .failure()
        .stderr(predicate::str::contains("not running"))
        .stderr(predicate::str::contains("sockt deploy"));
}

#[test]
fn test_restart_empty_runtime_state_suggests_deploy() {
    let temp_dir = TempDir::new().unwrap();
    let sockt_dir = temp_dir.path().join(".sockt");
    fs::create_dir_all(&sockt_dir).unwrap();
    fs::write(sockt_dir.join("runtime.json"), r#"{"pids":[]}"#).unwrap();

    sockt()
        .env("HOME", temp_dir.path())
        .arg("restart")
        .assert()
        .failure()
        .stderr(predicate::str::contains("not running"));
}

#[test]
fn test_restart_unknown_agent_lists_running_services() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(2);

    setup_test_runtime_state(&temp_dir, vec![("gbrain-mcp", pids[0]), ("orch", pids[1])]);

    sockt()
        .env("HOME", temp_dir.path())
        .args(["restart", "nonexistent-agent"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("gbrain-mcp"))
        .stderr(predicate::str::contains("orch"));

    cleanup_test_processes(&pids);
}

// =============================================================================
// Phase 3: Process Killing (Soft Restart)
// =============================================================================

#[test]
fn test_restart_soft_kills_processes() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(2);

    std::thread::sleep(std::time::Duration::from_millis(100));
    for &pid in &pids {
        assert!(is_process_alive(pid), "Process {} should be alive", pid);
    }

    setup_test_runtime_state(&temp_dir, vec![("service-1", pids[0]), ("service-2", pids[1])]);

    let _ = sockt()
        .env("HOME", temp_dir.path())
        .arg("restart")
        .assert();

    std::thread::sleep(std::time::Duration::from_millis(2000));

    for &pid in &pids {
        assert!(!is_process_alive(pid), "Process {} should be killed after restart", pid);
    }

    cleanup_test_processes(&pids);
}

#[test]
fn test_restart_single_agent_only_kills_that_agent() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(3);

    setup_test_runtime_state(
        &temp_dir,
        vec![
            ("gbrain-mcp", pids[0]),
            ("orch", pids[1]),
            ("agent-1", pids[2]),
        ],
    );

    let _ = sockt()
        .env("HOME", temp_dir.path())
        .args(["restart", "orch"])
        .assert();

    std::thread::sleep(std::time::Duration::from_millis(2000));

    assert!(is_process_alive(pids[0]), "gbrain-mcp should still be alive");
    assert!(!is_process_alive(pids[1]), "orch should be killed");
    assert!(is_process_alive(pids[2]), "agent-1 should still be alive");

    cleanup_test_processes(&pids);
}

#[test]
fn test_restart_all_kills_all_processes() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(3);

    setup_test_runtime_state(
        &temp_dir,
        vec![
            ("gbrain-mcp", pids[0]),
            ("orch", pids[1]),
            ("agent-1", pids[2]),
        ],
    );

    let _ = sockt()
        .env("HOME", temp_dir.path())
        .arg("restart")
        .assert();

    std::thread::sleep(std::time::Duration::from_millis(2000));

    for &pid in &pids {
        assert!(!is_process_alive(pid), "Process {} should be killed", pid);
    }

    cleanup_test_processes(&pids);
}

// =============================================================================
// Phase 4: Process Killing (Hard Restart)
// =============================================================================

#[test]
fn test_restart_hard_kills_processes() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(2);

    setup_test_runtime_state(&temp_dir, vec![("service-1", pids[0]), ("service-2", pids[1])]);

    let _ = sockt()
        .env("HOME", temp_dir.path())
        .args(["restart", "--hard"])
        .assert();

    std::thread::sleep(std::time::Duration::from_millis(2000));

    for &pid in &pids {
        assert!(!is_process_alive(pid), "Process {} should be killed with --hard", pid);
    }

    cleanup_test_processes(&pids);
}

// =============================================================================
// Phase 5: Agent Name Resolution
// =============================================================================

#[test]
fn test_restart_resolves_human_name_to_service_name() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(3);

    setup_test_runtime_state(
        &temp_dir,
        vec![
            ("agent-1", pids[0]),
            ("agent-2", pids[1]),
            ("agent-3", pids[2]),
        ],
    );

    let _ = sockt()
        .env("HOME", temp_dir.path())
        .args(["restart", "lead-researcher"])
        .assert();

    std::thread::sleep(std::time::Duration::from_millis(2000));

    assert!(!is_process_alive(pids[0]), "agent-1 (lead-researcher) should be killed");
    assert!(is_process_alive(pids[1]), "agent-2 should still be alive");
    assert!(is_process_alive(pids[2]), "agent-3 should still be alive");

    cleanup_test_processes(&pids);
}

#[test]
fn test_restart_accepts_raw_service_names() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(2);

    setup_test_runtime_state(&temp_dir, vec![("gbrain-mcp", pids[0]), ("orch", pids[1])]);

    let _ = sockt()
        .env("HOME", temp_dir.path())
        .args(["restart", "gbrain-mcp"])
        .assert();

    std::thread::sleep(std::time::Duration::from_millis(2000));

    assert!(!is_process_alive(pids[0]), "gbrain-mcp should be killed");
    assert!(is_process_alive(pids[1]), "orch should still be alive");

    cleanup_test_processes(&pids);
}

// =============================================================================
// Phase 6: Output Format
// =============================================================================

#[test]
fn test_restart_shows_restarting_message() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(1);

    setup_test_runtime_state(&temp_dir, vec![("orch", pids[0])]);

    sockt()
        .env("HOME", temp_dir.path())
        .arg("restart")
        .assert()
        .stdout(predicate::str::contains("Restarting"));

    cleanup_test_processes(&pids);
}

#[test]
fn test_restart_shows_service_name_and_pid() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(1);

    setup_test_runtime_state(&temp_dir, vec![("orch", pids[0])]);

    sockt()
        .env("HOME", temp_dir.path())
        .arg("restart")
        .assert()
        .stdout(predicate::str::contains("orch"))
        .stdout(predicate::str::contains(&format!("PID {}", pids[0])));

    cleanup_test_processes(&pids);
}
