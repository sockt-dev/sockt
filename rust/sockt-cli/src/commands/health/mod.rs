use std::path::PathBuf;
use std::time::Instant;

use anyhow::Result;

use crate::cli::HealthArgs;
use crate::commands::checks::{exit_code, CheckResult, CheckStatus, DiagnosticReport};
use crate::orch_client::{OrchClient, OrchClientConfig};
use crate::runtime::{is_process_alive, load_runtime_state};

pub async fn run(args: HealthArgs, _config_path: Option<PathBuf>) -> Result<()> {
    let runtime_state = load_runtime_state().unwrap_or_default();

    if runtime_state.pids.is_empty() {
        let checks = vec![CheckResult {
            name: "Services".to_string(),
            status: CheckStatus::Fail,
            message: "No services running (swarm not running)".to_string(),
            fix: Some("sockt deploy".to_string()),
            latency_ms: None,
        }];
        output_and_exit(&checks, args.json);
    }

    let mut checks = Vec::new();

    // Check each service individually
    for service in &runtime_state.pids {
        let alive = is_process_alive(service.pid);
        if alive {
            checks.push(CheckResult {
                name: service.name.clone(),
                status: CheckStatus::Pass,
                message: "running".to_string(),
                fix: None,
                latency_ms: None,
            });
        } else {
            checks.push(CheckResult {
                name: service.name.clone(),
                status: CheckStatus::Fail,
                message: "not running (process dead)".to_string(),
                fix: Some("sockt deploy".to_string()),
                latency_ms: None,
            });
        }
    }

    // Check Orch API
    let orch_check = check_orch().await;
    checks.push(orch_check);

    // Check disk space
    checks.push(check_disk());

    // Check GBrain
    checks.push(check_gbrain());

    if args.fix {
        run_fix(&checks);
    }

    output_and_exit(&checks, args.json);
}

async fn check_orch() -> CheckResult {
    let orch_url =
        std::env::var("ORCH_URL").unwrap_or_else(|_| "http://localhost:3100".to_string());

    let client = match OrchClient::new(OrchClientConfig {
        base_url: orch_url.clone(),
        timeout_ms: 3000,
        retries: 0,
    }) {
        Ok(c) => c,
        Err(e) => {
            return CheckResult {
                name: "Orch API".to_string(),
                status: CheckStatus::Fail,
                message: format!("client error: {}", e),
                fix: Some("sockt deploy".to_string()),
                latency_ms: None,
            };
        }
    };

    let start = Instant::now();
    match client.health().await {
        Ok(health) => {
            let latency = start.elapsed().as_millis() as u64;
            CheckResult {
                name: "Orch API".to_string(),
                status: CheckStatus::Pass,
                message: format!("responding ({}ms, {})", latency, health.status),
                fix: None,
                latency_ms: Some(latency),
            }
        }
        Err(e) => {
            let latency = start.elapsed().as_millis() as u64;
            CheckResult {
                name: "Orch API".to_string(),
                status: CheckStatus::Warn,
                message: format!("unreachable: {}", e),
                fix: Some(format!("Check orchestrator at {}", orch_url)),
                latency_ms: Some(latency),
            }
        }
    }
}

fn check_disk() -> CheckResult {
    #[cfg(unix)]
    {
        use nix::sys::statvfs::statvfs;
        match statvfs("/") {
            Ok(stat) => {
                let free_bytes = stat.blocks_available() as u64 * stat.fragment_size() as u64;
                let free_gb = free_bytes as f64 / 1_073_741_824.0;
                if free_gb < 1.0 {
                    CheckResult {
                        name: "Disk".to_string(),
                        status: CheckStatus::Warn,
                        message: format!("{:.1} GB free (low)", free_gb),
                        fix: Some("Free disk space (recommend >5 GB)".to_string()),
                        latency_ms: None,
                    }
                } else {
                    CheckResult {
                        name: "Disk".to_string(),
                        status: CheckStatus::Pass,
                        message: format!("{:.1} GB free", free_gb),
                        fix: None,
                        latency_ms: None,
                    }
                }
            }
            Err(_) => CheckResult {
                name: "Disk".to_string(),
                status: CheckStatus::Warn,
                message: "unable to check disk space".to_string(),
                fix: None,
                latency_ms: None,
            },
        }
    }
    #[cfg(not(unix))]
    {
        CheckResult {
            name: "Disk".to_string(),
            status: CheckStatus::Pass,
            message: "disk check not available on this platform".to_string(),
            fix: None,
            latency_ms: None,
        }
    }
}

fn check_gbrain() -> CheckResult {
    let gbrain_dir = PathBuf::from("./gbrain");
    if !gbrain_dir.exists() {
        return CheckResult {
            name: "GBrain".to_string(),
            status: CheckStatus::Warn,
            message: "directory not found".to_string(),
            fix: Some("sockt init".to_string()),
            latency_ms: None,
        };
    }

    let output = std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&gbrain_dir)
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let changes = String::from_utf8_lossy(&out.stdout);
            if changes.trim().is_empty() {
                CheckResult {
                    name: "GBrain".to_string(),
                    status: CheckStatus::Pass,
                    message: "clean".to_string(),
                    fix: None,
                    latency_ms: None,
                }
            } else {
                let file_count = changes.lines().count();
                CheckResult {
                    name: "GBrain".to_string(),
                    status: CheckStatus::Warn,
                    message: format!("{} uncommitted changes", file_count),
                    fix: None,
                    latency_ms: None,
                }
            }
        }
        _ => CheckResult {
            name: "GBrain".to_string(),
            status: CheckStatus::Warn,
            message: "not a git repository".to_string(),
            fix: Some("sockt init".to_string()),
            latency_ms: None,
        },
    }
}

fn run_fix(checks: &[CheckResult]) {
    let fixable: Vec<_> = checks
        .iter()
        .filter(|c| c.status != CheckStatus::Pass && c.fix.is_some())
        .collect();

    if fixable.is_empty() {
        println!("\n  No issues to fix.\n");
        return;
    }

    println!("\n  Auto-fix not yet implemented. Manual fixes:");
    for check in fixable {
        if let Some(fix) = &check.fix {
            println!("    {} → {}", check.name, fix);
        }
    }
    println!();
}

fn output_and_exit(checks: &[CheckResult], json: bool) -> ! {
    let code = exit_code(checks);

    if json {
        let report = DiagnosticReport {
            checks: checks.to_vec(),
            exit_code: code,
        };
        println!("{}", serde_json::to_string_pretty(&report).unwrap());
    } else {
        render_text(checks, code);
    }

    std::process::exit(code);
}

fn render_text(checks: &[CheckResult], code: i32) {
    println!("\n  Health Check");
    println!("  {}", "─".repeat(55));

    for check in checks {
        let icon = match check.status {
            CheckStatus::Pass => "●",
            CheckStatus::Warn => "⚠",
            CheckStatus::Fail => "✖",
        };
        let latency = check
            .latency_ms
            .map(|ms| format!(" ({}ms)", ms))
            .unwrap_or_default();
        println!("  {:12} {} {}{}", check.name, icon, check.message, latency);
    }

    println!();
    match code {
        0 => println!("  Status: healthy ✓\n"),
        1 => {
            println!("  Issues:");
            for check in checks.iter().filter(|c| c.status == CheckStatus::Warn) {
                print!("    ⚠ {}", check.message);
                if let Some(fix) = &check.fix {
                    print!(" → {}", fix);
                }
                println!();
            }
            println!();
        }
        _ => {
            println!("  Issues:");
            for check in checks.iter().filter(|c| c.status != CheckStatus::Pass) {
                let icon = if check.status == CheckStatus::Fail {
                    "✖"
                } else {
                    "⚠"
                };
                print!("    {} {} — {}", icon, check.name, check.message);
                if let Some(fix) = &check.fix {
                    print!("\n      Fix: {}", fix);
                }
                println!();
            }
            println!();
        }
    }
}
