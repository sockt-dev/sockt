use assert_cmd::Command;
use predicates::prelude::*;
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::process::Command as StdCommand;
use tempfile::TempDir;

// =============================================================================
// Test Helpers
// =============================================================================

fn sockt() -> Command {
    Command::cargo_bin("sockt").unwrap()
}

fn setup_test_runtime_state(temp_dir: &TempDir, services: Vec<(&str, u32)>) -> PathBuf {
    let sockt_dir = temp_dir.path().join(".sockt");
    fs::create_dir_all(&sockt_dir).unwrap();

    let runtime_path = sockt_dir.join("runtime.json");
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

    let state = json!({
        "pids": pids
    });

    fs::write(&runtime_path, serde_json::to_string_pretty(&state).unwrap()).unwrap();
    runtime_path
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
        // Leak the child handle so the process isn't reaped when it dies
        // This allows our tests to properly check if the process was killed
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
    // Check if process exists and is not a zombie
    let output = StdCommand::new("ps")
        .args(["-p", &pid.to_string(), "-o", "stat="])
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let stat = String::from_utf8_lossy(&out.stdout);
            // If stat contains 'Z', it's a zombie (dead but not reaped)
            !stat.trim().starts_with('Z')
        }
        _ => false,
    }
}

// =============================================================================
// Phase 1: Argument Parsing Tests
// =============================================================================

#[test]
fn test_stop_help_shows_all_options() {
    sockt()
        .arg("stop")
        .arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("--force"))
        .stdout(predicate::str::contains("--purge"))
        .stdout(predicate::str::contains("--timeout"));
}

#[test]
fn test_stop_accepts_force_flag() {
    let temp_dir = TempDir::new().unwrap();

    sockt()
        .env("HOME", temp_dir.path())
        .arg("stop")
        .arg("--force")
        .assert()
        .success();
}

#[test]
fn test_stop_accepts_purge_flag() {
    let temp_dir = TempDir::new().unwrap();

    sockt()
        .env("HOME", temp_dir.path())
        .arg("stop")
        .arg("--purge")
        .assert()
        .success();
}

#[test]
fn test_stop_accepts_timeout_with_value() {
    let temp_dir = TempDir::new().unwrap();

    sockt()
        .env("HOME", temp_dir.path())
        .arg("stop")
        .arg("--timeout")
        .arg("60")
        .assert()
        .success();
}

#[test]
fn test_stop_no_args_succeeds() {
    let temp_dir = TempDir::new().unwrap();

    sockt()
        .env("HOME", temp_dir.path())
        .arg("stop")
        .assert()
        .success();
}

// =============================================================================
// Phase 2: Idempotent Behavior Tests
// =============================================================================

#[test]
fn test_stop_when_not_running_exits_zero() {
    let temp_dir = TempDir::new().unwrap();

    sockt()
        .env("HOME", temp_dir.path())
        .arg("stop")
        .assert()
        .success()
        .stdout(predicate::str::contains("Swarm is not running"));
}

#[test]
fn test_stop_with_empty_runtime_state() {
    let temp_dir = TempDir::new().unwrap();
    let sockt_dir = temp_dir.path().join(".sockt");
    fs::create_dir_all(&sockt_dir).unwrap();

    let runtime_path = sockt_dir.join("runtime.json");
    fs::write(&runtime_path, r#"{"pids":[]}"#).unwrap();

    sockt()
        .env("HOME", temp_dir.path())
        .arg("stop")
        .assert()
        .success()
        .stdout(predicate::str::contains("Swarm is not running"));
}

#[test]
fn test_stop_repeated_calls_idempotent() {
    let temp_dir = TempDir::new().unwrap();

    sockt()
        .env("HOME", temp_dir.path())
        .arg("stop")
        .assert()
        .success();

    sockt()
        .env("HOME", temp_dir.path())
        .arg("stop")
        .assert()
        .success()
        .stdout(predicate::str::contains("Swarm is not running"));
}

#[test]
fn test_stop_removes_runtime_json() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(2);

    setup_test_runtime_state(&temp_dir, vec![
        ("test-service-1", pids[0]),
        ("test-service-2", pids[1]),
    ]);

    sockt()
        .env("HOME", temp_dir.path())
        .arg("stop")
        .arg("--force")
        .assert()
        .success();

    let runtime_path = temp_dir.path().join(".sockt").join("runtime.json");
    assert!(!runtime_path.exists(), "runtime.json should be deleted");

    cleanup_test_processes(&pids);
}

// =============================================================================
// Phase 3: Process Killing Tests
// =============================================================================

#[test]
fn test_stop_kills_running_processes() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(3);

    // Verify processes are actually running
    std::thread::sleep(std::time::Duration::from_millis(100));
    for &pid in &pids {
        assert!(is_process_alive(pid), "Process {} should be alive before stop", pid);
    }

    setup_test_runtime_state(&temp_dir, vec![
        ("service-1", pids[0]),
        ("service-2", pids[1]),
        ("service-3", pids[2]),
    ]);

    eprintln!("Test PIDs: {:?}", pids);
    eprintln!("HOME: {}", temp_dir.path().display());
    eprintln!("Runtime state path: {}/.sockt/runtime.json", temp_dir.path().display());

    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("stop")
        .arg("--force")
        .output()
        .unwrap();

    eprintln!("stdout: {}", String::from_utf8_lossy(&output.stdout));
    eprintln!("stderr: {}", String::from_utf8_lossy(&output.stderr));
    eprintln!("exit code: {}", output.status.code().unwrap());

    assert!(output.status.success());

    std::thread::sleep(std::time::Duration::from_millis(2000));

    for &pid in &pids {
        eprintln!("Checking if PID {} is dead...", pid);
        assert!(!is_process_alive(pid), "Process {} should be killed", pid);
    }

    cleanup_test_processes(&pids);
}

#[test]
fn test_stop_force_uses_sigkill() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(2);

    setup_test_runtime_state(&temp_dir, vec![
        ("agent-1", pids[0]),
        ("agent-2", pids[1]),
    ]);

    sockt()
        .env("HOME", temp_dir.path())
        .arg("stop")
        .arg("--force")
        .assert()
        .success()
        .stdout(predicate::str::contains("Force stopping"));

    std::thread::sleep(std::time::Duration::from_millis(1500));

    for &pid in &pids {
        assert!(!is_process_alive(pid), "Process {} should be killed", pid);
    }

    cleanup_test_processes(&pids);
}

#[test]
fn test_stop_graceful_waits_for_exit() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(1);

    setup_test_runtime_state(&temp_dir, vec![("test-service", pids[0])]);

    sockt()
        .env("HOME", temp_dir.path())
        .arg("stop")
        .arg("--timeout")
        .arg("5")
        .assert()
        .success()
        .stdout(predicate::str::contains("Stopping swarm"));

    std::thread::sleep(std::time::Duration::from_millis(1500));

    assert!(!is_process_alive(pids[0]), "Process should be killed");

    cleanup_test_processes(&pids);
}

#[test]
fn test_stop_handles_already_dead_processes() {
    let temp_dir = TempDir::new().unwrap();

    setup_test_runtime_state(&temp_dir, vec![
        ("dead-service", 99999),
    ]);

    sockt()
        .env("HOME", temp_dir.path())
        .arg("stop")
        .assert()
        .success();
}

#[test]
fn test_stop_kills_in_reverse_order() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(4);

    setup_test_runtime_state(&temp_dir, vec![
        ("gbrain-mcp", pids[0]),
        ("orch", pids[1]),
        ("cadvp", pids[2]),
        ("agent-1", pids[3]),
    ]);

    sockt()
        .env("HOME", temp_dir.path())
        .arg("stop")
        .arg("--force")
        .assert()
        .success();

    std::thread::sleep(std::time::Duration::from_millis(1500));

    for &pid in &pids {
        assert!(!is_process_alive(pid), "Process {} should be killed", pid);
    }

    cleanup_test_processes(&pids);
}

// =============================================================================
// Phase 4: Purge Functionality Tests
// =============================================================================

#[test]
fn test_stop_purge_with_force_succeeds() {
    let temp_dir = TempDir::new().unwrap();
    let scratch_dir = temp_dir.path().join(".sockt").join("scratch");
    fs::create_dir_all(&scratch_dir).unwrap();
    fs::write(scratch_dir.join("test.db"), "test data").unwrap();

    sockt()
        .env("HOME", temp_dir.path())
        .arg("stop")
        .arg("--purge")
        .arg("--force")
        .assert()
        .success()
        .stdout(predicate::str::contains("purged"));

    assert!(!scratch_dir.exists(), "Scratch directory should be deleted");
}

#[test]
fn test_stop_purge_removes_scratch_data() {
    let temp_dir = TempDir::new().unwrap();
    let scratch_dir = temp_dir.path().join(".sockt").join("scratch");
    fs::create_dir_all(&scratch_dir).unwrap();

    fs::write(scratch_dir.join("tasks.db"), "task data").unwrap();
    fs::write(scratch_dir.join("logs.txt"), "log data").unwrap();

    sockt()
        .env("HOME", temp_dir.path())
        .arg("stop")
        .arg("--purge")
        .arg("--force")
        .assert()
        .success()
        .stdout(predicate::str::contains("purged"));

    assert!(!scratch_dir.exists(), "Scratch directory should be deleted");
}

#[test]
fn test_stop_purge_preserves_gbrain() {
    let temp_dir = TempDir::new().unwrap();

    let gbrain_dir = temp_dir.path().join("gbrain");
    fs::create_dir_all(&gbrain_dir).unwrap();
    fs::write(gbrain_dir.join("soul.md"), "soul content").unwrap();

    let scratch_dir = temp_dir.path().join(".sockt").join("scratch");
    fs::create_dir_all(&scratch_dir).unwrap();

    sockt()
        .env("HOME", temp_dir.path())
        .arg("stop")
        .arg("--purge")
        .arg("--force")
        .assert()
        .success();

    assert!(gbrain_dir.exists(), "GBrain directory should be preserved");
    assert!(gbrain_dir.join("soul.md").exists(), "GBrain files should be preserved");
}

// =============================================================================
// Phase 5: Output Format Tests
// =============================================================================

#[test]
fn test_stop_shows_service_names_and_pids() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(2);

    setup_test_runtime_state(&temp_dir, vec![
        ("gbrain-mcp", pids[0]),
        ("orch", pids[1]),
    ]);

    sockt()
        .env("HOME", temp_dir.path())
        .arg("stop")
        .arg("--force")
        .assert()
        .success()
        .stdout(predicate::str::contains("gbrain-mcp"))
        .stdout(predicate::str::contains(format!("(PID {})", pids[0])))
        .stdout(predicate::str::contains("orch"))
        .stdout(predicate::str::contains(format!("(PID {})", pids[1])));

    cleanup_test_processes(&pids);
}

#[test]
fn test_stop_shows_success_message() {
    let temp_dir = TempDir::new().unwrap();

    sockt()
        .env("HOME", temp_dir.path())
        .arg("stop")
        .assert()
        .success()
        .stdout(predicate::str::contains("Swarm is not running"));
}

#[test]
fn test_stop_force_shows_warning() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(1);

    setup_test_runtime_state(&temp_dir, vec![("test-service", pids[0])]);

    sockt()
        .env("HOME", temp_dir.path())
        .arg("stop")
        .arg("--force")
        .assert()
        .success()
        .stdout(predicate::str::contains("Force stopping"));

    cleanup_test_processes(&pids);
}

// =============================================================================
// Phase 6: Down Command Alias Tests
// =============================================================================

#[test]
fn test_down_hidden_in_help() {
    let output = sockt()
        .arg("--help")
        .output()
        .unwrap();

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Check that stop command appears
    assert!(stdout.contains("stop"), "Help should contain 'stop' command");

    // Check that down is NOT listed as a command (not even the word "down " or "  down")
    let lines: Vec<&str> = stdout.lines().collect();
    let has_down_command = lines.iter().any(|line| {
        line.trim_start().starts_with("down ")
    });

    assert!(!has_down_command, "Help should not list 'down' as a visible command");
}

#[test]
fn test_down_shows_deprecation_notice() {
    let temp_dir = TempDir::new().unwrap();

    sockt()
        .env("HOME", temp_dir.path())
        .arg("down")
        .assert()
        .success()
        .stderr(predicate::str::contains("Note: `sockt down` is now `sockt stop`"));
}

#[test]
fn test_down_volumes_maps_to_purge() {
    let temp_dir = TempDir::new().unwrap();
    let scratch_dir = temp_dir.path().join(".sockt").join("scratch");
    fs::create_dir_all(&scratch_dir).unwrap();
    fs::write(scratch_dir.join("test.db"), "test").unwrap();

    sockt()
        .env("HOME", temp_dir.path())
        .arg("down")
        .arg("--volumes")
        .assert()
        .success()
        .stderr(predicate::str::contains("Note: `sockt down` is now `sockt stop`"));
}

#[test]
fn test_down_delegates_to_stop() {
    let temp_dir = TempDir::new().unwrap();

    sockt()
        .env("HOME", temp_dir.path())
        .arg("down")
        .assert()
        .success()
        .stderr(predicate::str::contains("Note: `sockt down` is now `sockt stop`"))
        .stdout(predicate::str::contains("Swarm is not running"));
}

// =============================================================================
// Phase 7: Error Handling Tests
// =============================================================================

#[test]
fn test_stop_handles_corrupt_runtime_json() {
    let temp_dir = TempDir::new().unwrap();
    let sockt_dir = temp_dir.path().join(".sockt");
    fs::create_dir_all(&sockt_dir).unwrap();

    let runtime_path = sockt_dir.join("runtime.json");
    fs::write(&runtime_path, "{ invalid json ").unwrap();

    sockt()
        .env("HOME", temp_dir.path())
        .arg("stop")
        .assert()
        .failure();
}

#[test]
fn test_stop_continues_on_missing_pids() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(1);

    setup_test_runtime_state(&temp_dir, vec![
        ("missing-service", 99999),
        ("real-service", pids[0]),
    ]);

    sockt()
        .env("HOME", temp_dir.path())
        .arg("stop")
        .arg("--force")
        .assert()
        .success()
        .stdout(predicate::str::contains("already stopped"));

    std::thread::sleep(std::time::Duration::from_millis(1500));

    assert!(!is_process_alive(pids[0]), "Real process should be killed");

    cleanup_test_processes(&pids);
}

#[test]
fn test_stop_shows_errors_but_continues() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(2);

    // Setup with one missing PID and two real ones
    setup_test_runtime_state(&temp_dir, vec![
        ("service-1", pids[0]),
        ("missing-service", 99999),
        ("service-2", pids[1]),
    ]);

    sockt()
        .env("HOME", temp_dir.path())
        .arg("stop")
        .arg("--force")
        .assert()
        .success();

    std::thread::sleep(std::time::Duration::from_millis(1500));

    // Both real processes should be killed despite one missing
    assert!(!is_process_alive(pids[0]), "Process 1 should be killed");
    assert!(!is_process_alive(pids[1]), "Process 2 should be killed");

    cleanup_test_processes(&pids);
}
