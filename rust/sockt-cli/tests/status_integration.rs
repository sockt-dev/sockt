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

fn setup_runtime_with_services(temp_dir: &TempDir, services: Vec<(&str, u32, Option<u16>)>) -> PathBuf {
    let sockt_dir = temp_dir.path().join(".sockt");
    fs::create_dir_all(&sockt_dir).unwrap();

    let runtime_path = sockt_dir.join("runtime.json");
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

fn validate_json_structure(json_str: &str, expected_health: &str) -> bool {
    let parsed: serde_json::Result<serde_json::Value> = serde_json::from_str(json_str);
    if let Ok(json) = parsed {
        json.get("health").and_then(|h| h.as_str()) == Some(expected_health)
            && json.get("services").is_some()
    } else {
        false
    }
}

// =============================================================================
// Phase 1: Argument Parsing Tests
// =============================================================================

#[test]
fn test_status_help_shows_all_options() {
    sockt()
        .arg("status")
        .arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("--detailed"))
        .stdout(predicate::str::contains("--watch"))
        .stdout(predicate::str::contains("--json"))
        .stdout(predicate::str::contains("--quiet"));
}

#[test]
fn test_status_accepts_detailed_flag() {
    let temp_dir = TempDir::new().unwrap();
    sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .arg("--detailed")
        .assert()
        .success();
}

#[test]
fn test_status_accepts_watch_flag() {
    let temp_dir = TempDir::new().unwrap();
    sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .arg("--watch")
        .assert()
        .failure() // Should fail with "not yet implemented" initially
        .stderr(predicate::str::contains("Watch mode not yet implemented"));
}

#[test]
fn test_status_accepts_json_flag() {
    let temp_dir = TempDir::new().unwrap();
    sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .arg("--json")
        .assert()
        .success()
        .stdout(predicate::str::contains(r#""health""#));
}

#[test]
fn test_status_accepts_quiet_flag() {
    let temp_dir = TempDir::new().unwrap();
    sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .arg("--quiet")
        .assert()
        .code(predicate::in_iter(vec![0, 1, 2]));
}

// =============================================================================
// Phase 2: Swarm Not Running Tests
// =============================================================================

#[test]
fn test_status_when_not_running() {
    let temp_dir = TempDir::new().unwrap();
    sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .assert()
        .success()
        .stdout(predicate::str::contains("not running"));
}

#[test]
fn test_status_empty_runtime_state() {
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
        .arg("status")
        .assert()
        .success()
        .stdout(predicate::str::contains("not running"));
}

#[test]
fn test_status_quiet_exit_code_when_down() {
    let temp_dir = TempDir::new().unwrap();
    sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .arg("--quiet")
        .assert()
        .code(2); // Down = exit code 2
}

#[test]
fn test_status_json_when_down() {
    let temp_dir = TempDir::new().unwrap();
    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .arg("--json")
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();

    let stdout = String::from_utf8(output).unwrap();
    assert!(validate_json_structure(&stdout, "down"));
}

// =============================================================================
// Phase 3: Basic Status Display Tests
// =============================================================================

#[test]
fn test_status_shows_running_services() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(3);

    setup_runtime_with_services(
        &temp_dir,
        vec![
            ("gbrain-mcp", pids[0], Some(3200)),
            ("orch", pids[1], Some(3100)),
            ("cadvp", pids[2], Some(3002)),
        ],
    );

    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();

    let stdout = String::from_utf8(output).unwrap();
    assert!(stdout.contains("gbrain-mcp"));
    assert!(stdout.contains("orch"));
    assert!(stdout.contains("cadvp"));

    cleanup_processes(&pids);
}

#[test]
fn test_status_shows_service_names() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(2);

    setup_runtime_with_services(
        &temp_dir,
        vec![("service-one", pids[0], None), ("service-two", pids[1], None)],
    );

    sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .assert()
        .success()
        .stdout(predicate::str::contains("service-one"))
        .stdout(predicate::str::contains("service-two"));

    cleanup_processes(&pids);
}

#[test]
fn test_status_healthy_exit_code() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(2);

    setup_runtime_with_services(
        &temp_dir,
        vec![("service-a", pids[0], None), ("service-b", pids[1], None)],
    );

    sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .arg("--quiet")
        .assert()
        .code(0); // Healthy = exit code 0

    cleanup_processes(&pids);
}

#[test]
fn test_status_shows_uptime() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(1);

    setup_runtime_with_services(&temp_dir, vec![("test-service", pids[0], None)]);

    sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .assert()
        .success();
    // Uptime display is optional initially, just verify no crash

    cleanup_processes(&pids);
}

#[test]
fn test_status_handles_dead_processes() {
    let temp_dir = TempDir::new().unwrap();

    // Use a PID that definitely doesn't exist
    setup_runtime_with_services(&temp_dir, vec![("dead-service", 999999, None)]);

    sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .assert()
        .success()
        .stdout(
            predicate::str::contains("crashed")
                .or(predicate::str::contains("stopped"))
                .or(predicate::str::contains("dead-service")),
        );
}

#[test]
fn test_status_degraded_state() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(1);

    // Mix of running and dead processes
    setup_runtime_with_services(
        &temp_dir,
        vec![("running-service", pids[0], None), ("dead-service", 999999, None)],
    );

    sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .arg("--quiet")
        .assert()
        .code(1); // Degraded = exit code 1

    cleanup_processes(&pids);
}

// =============================================================================
// Phase 4: Detailed Mode Tests
// =============================================================================

#[test]
fn test_status_detailed_shows_pids() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(1);

    setup_runtime_with_services(&temp_dir, vec![("test-service", pids[0], None)]);

    sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .arg("--detailed")
        .assert()
        .success()
        .stdout(predicate::str::contains(pids[0].to_string()));

    cleanup_processes(&pids);
}

#[test]
fn test_status_detailed_shows_ports() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(1);

    setup_runtime_with_services(&temp_dir, vec![("test-service", pids[0], Some(3100))]);

    sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .arg("--detailed")
        .assert()
        .success()
        .stdout(predicate::str::contains("3100"));

    cleanup_processes(&pids);
}

#[test]
fn test_status_detailed_shows_uptime_per_service() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(1);

    setup_runtime_with_services(&temp_dir, vec![("test-service", pids[0], None)]);

    sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .arg("--detailed")
        .assert()
        .success();
    // Per-service uptime is optional initially

    cleanup_processes(&pids);
}

#[test]
fn test_status_detailed_vs_normal_output() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(1);

    setup_runtime_with_services(&temp_dir, vec![("test-service", pids[0], Some(3100))]);

    let normal_output = sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();

    let detailed_output = sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .arg("--detailed")
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();

    // Detailed output should be longer
    assert!(detailed_output.len() >= normal_output.len());

    cleanup_processes(&pids);
}

#[test]
fn test_status_detailed_with_json() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(1);

    setup_runtime_with_services(&temp_dir, vec![("test-service", pids[0], Some(3100))]);

    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .arg("--detailed")
        .arg("--json")
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();

    let stdout = String::from_utf8(output).unwrap();
    let json: serde_json::Value = serde_json::from_str(&stdout).unwrap();

    // Should include services with PID and port
    assert!(json.get("services").is_some());

    cleanup_processes(&pids);
}

// =============================================================================
// Phase 5: JSON Mode Tests
// =============================================================================

#[test]
fn test_status_json_structure_healthy() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(2);

    setup_runtime_with_services(
        &temp_dir,
        vec![("service-a", pids[0], None), ("service-b", pids[1], None)],
    );

    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .arg("--json")
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();

    let stdout = String::from_utf8(output).unwrap();
    assert!(validate_json_structure(&stdout, "healthy"));

    cleanup_processes(&pids);
}

#[test]
fn test_status_json_structure_degraded() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(1);

    setup_runtime_with_services(
        &temp_dir,
        vec![("running", pids[0], None), ("dead", 999999, None)],
    );

    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .arg("--json")
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();

    let stdout = String::from_utf8(output).unwrap();
    assert!(validate_json_structure(&stdout, "degraded"));

    cleanup_processes(&pids);
}

#[test]
fn test_status_json_structure_down() {
    let temp_dir = TempDir::new().unwrap();

    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .arg("--json")
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();

    let stdout = String::from_utf8(output).unwrap();
    assert!(validate_json_structure(&stdout, "down"));
}

#[test]
fn test_status_json_includes_all_services() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(3);

    setup_runtime_with_services(
        &temp_dir,
        vec![
            ("service-1", pids[0], None),
            ("service-2", pids[1], None),
            ("service-3", pids[2], None),
        ],
    );

    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .arg("--json")
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();

    let stdout = String::from_utf8(output).unwrap();
    let json: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    let services = json.get("services").unwrap().as_array().unwrap();

    assert_eq!(services.len(), 3);

    cleanup_processes(&pids);
}

#[test]
fn test_status_json_parseable() {
    let temp_dir = TempDir::new().unwrap();

    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .arg("--json")
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();

    let stdout = String::from_utf8(output).unwrap();
    let result: serde_json::Result<serde_json::Value> = serde_json::from_str(&stdout);
    assert!(result.is_ok());
}

#[test]
fn test_status_json_no_extra_output() {
    let temp_dir = TempDir::new().unwrap();

    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .arg("--json")
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();

    let stdout = String::from_utf8(output).unwrap();
    // Should be pure JSON - no extra text
    assert!(stdout.trim().starts_with('{'));
    assert!(stdout.trim().ends_with('}'));
}

// =============================================================================
// Phase 6: Quiet Mode Tests
// =============================================================================

#[test]
fn test_status_quiet_exit_codes() {
    let temp_dir = TempDir::new().unwrap();

    // Test down (exit 2)
    sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .arg("-q")
        .assert()
        .code(2);

    // Test healthy (exit 0)
    let pids = spawn_sleep_processes(1);
    setup_runtime_with_services(&temp_dir, vec![("service", pids[0], None)]);

    sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .arg("-q")
        .assert()
        .code(0);

    cleanup_processes(&pids);
}

#[test]
fn test_status_quiet_no_output() {
    let temp_dir = TempDir::new().unwrap();

    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .arg("--quiet")
        .assert()
        .get_output()
        .stdout
        .clone();

    // Should produce no output
    assert!(output.is_empty());
}

#[test]
fn test_status_quiet_with_other_flags() {
    let temp_dir = TempDir::new().unwrap();

    // -q should take precedence over --json
    let output = sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .arg("--quiet")
        .arg("--json")
        .assert()
        .get_output()
        .stdout
        .clone();

    assert!(output.is_empty());
}

#[test]
fn test_status_quiet_fast_execution() {
    let temp_dir = TempDir::new().unwrap();

    let start = std::time::Instant::now();
    let _ = sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .arg("-q")
        .assert();
    let elapsed = start.elapsed();

    // Should complete in under 1 second
    assert!(elapsed.as_secs() < 1);
}

// =============================================================================
// Phase 7: Error Handling Tests
// =============================================================================

#[test]
fn test_status_corrupt_runtime_json() {
    let temp_dir = TempDir::new().unwrap();
    let sockt_dir = temp_dir.path().join(".sockt");
    fs::create_dir_all(&sockt_dir).unwrap();
    fs::write(sockt_dir.join("runtime.json"), "{ invalid json }").unwrap();

    sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .assert()
        .success()
        .stdout(predicate::str::contains("not running"));
}

#[test]
fn test_status_missing_home_dir() {
    sockt()
        .env_remove("HOME")
        .arg("status")
        .assert()
        .success();
    // Should use fallback and not crash
}

#[test]
fn test_status_partial_orch_failure() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(1);

    setup_runtime_with_services(&temp_dir, vec![("service", pids[0], None)]);

    // Should still show runtime services even if orch is unreachable
    sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .assert()
        .success()
        .stdout(predicate::str::contains("service"));

    cleanup_processes(&pids);
}

#[test]
fn test_status_no_config_file() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(1);

    setup_runtime_with_services(&temp_dir, vec![("service", pids[0], None)]);

    // Should work with default config
    sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .assert()
        .success();

    cleanup_processes(&pids);
}

#[test]
fn test_status_invalid_pid_in_state() {
    let temp_dir = TempDir::new().unwrap();

    // PID 0 is invalid
    setup_runtime_with_services(&temp_dir, vec![("invalid", 0, None)]);

    sockt()
        .env("HOME", temp_dir.path())
        .arg("status")
        .assert()
        .success();
    // Should handle gracefully
}

#[test]
fn test_status_concurrent_status_calls() {
    let temp_dir = TempDir::new().unwrap();
    let pids = spawn_sleep_processes(1);

    setup_runtime_with_services(&temp_dir, vec![("service", pids[0], None)]);

    // Run two status calls concurrently
    let handles: Vec<_> = (0..2)
        .map(|_| {
            let path = temp_dir.path().to_path_buf();
            std::thread::spawn(move || {
                sockt()
                    .env("HOME", &path)
                    .arg("status")
                    .arg("-q")
                    .assert()
                    .success();
            })
        })
        .collect();

    for handle in handles {
        handle.join().unwrap();
    }

    cleanup_processes(&pids);
}

#[test]
fn test_status_with_no_permissions() {
    // Skip on systems where we can't test permissions
    if cfg!(unix) {
        let temp_dir = TempDir::new().unwrap();
        let sockt_dir = temp_dir.path().join(".sockt");
        fs::create_dir_all(&sockt_dir).unwrap();
        let runtime_path = sockt_dir.join("runtime.json");
        fs::write(&runtime_path, json!({"pids": []}).to_string()).unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&runtime_path).unwrap().permissions();
            perms.set_mode(0o000);
            fs::set_permissions(&runtime_path, perms).unwrap();
        }

        sockt()
            .env("HOME", temp_dir.path())
            .arg("status")
            .assert()
            .success();
        // Should handle gracefully (treat as down)

        // Cleanup: restore permissions so temp_dir can be deleted
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&runtime_path).unwrap().permissions();
            perms.set_mode(0o644);
            fs::set_permissions(&runtime_path, perms).unwrap();
        }
    }
}
