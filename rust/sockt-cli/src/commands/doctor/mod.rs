use std::path::PathBuf;

use anyhow::Result;

use crate::cli::DoctorArgs;
use crate::commands::checks::{exit_code, CheckResult, CheckStatus, DiagnosticReport};
use crate::config::loader::ConfigLoader;

pub async fn run(args: DoctorArgs, config_path: Option<PathBuf>) -> Result<()> {
    let mut checks = Vec::new();

    // Environment checks
    checks.push(check_bun_installed());
    checks.push(check_git_installed());
    checks.push(check_disk_space());

    // Configuration checks
    let config = check_config(&config_path);
    checks.push(config.0);
    checks.push(check_encryption_key());

    // GBrain check (only if config loaded)
    if let Some(ref cfg) = config.1 {
        checks.push(check_gbrain_dir(cfg));
        checks.push(check_slack_configured(cfg));
    } else {
        checks.push(CheckResult {
            name: "GBrain".to_string(),
            status: CheckStatus::Warn,
            message: "skipped (no config)".to_string(),
            fix: Some("sockt init".to_string()),
            latency_ms: None,
        });
    }

    output_and_exit(&checks, args.json);
}

fn check_bun_installed() -> CheckResult {
    match std::process::Command::new("bun").arg("--version").output() {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            CheckResult {
                name: "Bun".to_string(),
                status: CheckStatus::Pass,
                message: format!("installed (v{})", version),
                fix: None,
                latency_ms: None,
            }
        }
        _ => CheckResult {
            name: "Bun".to_string(),
            status: CheckStatus::Fail,
            message: "not installed".to_string(),
            fix: Some("Install Bun: https://bun.sh".to_string()),
            latency_ms: None,
        },
    }
}

fn check_git_installed() -> CheckResult {
    match std::process::Command::new("git").arg("--version").output() {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            CheckResult {
                name: "Git".to_string(),
                status: CheckStatus::Pass,
                message: format!("installed ({})", version),
                fix: None,
                latency_ms: None,
            }
        }
        _ => CheckResult {
            name: "Git".to_string(),
            status: CheckStatus::Fail,
            message: "not installed".to_string(),
            fix: Some("Install git".to_string()),
            latency_ms: None,
        },
    }
}

fn check_disk_space() -> CheckResult {
    #[cfg(unix)]
    {
        use nix::sys::statvfs::statvfs;
        match statvfs("/") {
            Ok(stat) => {
                let free_bytes = stat.blocks_available() as u64 * stat.fragment_size() as u64;
                let free_gb = free_bytes as f64 / 1_073_741_824.0;
                if free_gb < 5.0 {
                    CheckResult {
                        name: "Disk space".to_string(),
                        status: CheckStatus::Warn,
                        message: format!("{:.1} GB free (recommend >5 GB)", free_gb),
                        fix: Some("Free disk space".to_string()),
                        latency_ms: None,
                    }
                } else {
                    CheckResult {
                        name: "Disk space".to_string(),
                        status: CheckStatus::Pass,
                        message: format!("{:.1} GB free", free_gb),
                        fix: None,
                        latency_ms: None,
                    }
                }
            }
            Err(_) => CheckResult {
                name: "Disk space".to_string(),
                status: CheckStatus::Warn,
                message: "unable to check".to_string(),
                fix: None,
                latency_ms: None,
            },
        }
    }
    #[cfg(not(unix))]
    {
        CheckResult {
            name: "Disk space".to_string(),
            status: CheckStatus::Pass,
            message: "check not available on this platform".to_string(),
            fix: None,
            latency_ms: None,
        }
    }
}

fn check_config(
    config_path: &Option<PathBuf>,
) -> (CheckResult, Option<crate::config::SocktConfig>) {
    let loader = ConfigLoader::from_default_or_override(config_path.clone());
    match loader.load() {
        Ok(config) => (
            CheckResult {
                name: "Config file".to_string(),
                status: CheckStatus::Pass,
                message: format!("valid (version {})", config.version),
                fix: None,
                latency_ms: None,
            },
            Some(config),
        ),
        Err(_) => (
            CheckResult {
                name: "Config file".to_string(),
                status: CheckStatus::Warn,
                message: "not found or invalid".to_string(),
                fix: Some("sockt init".to_string()),
                latency_ms: None,
            },
            None,
        ),
    }
}

fn check_encryption_key() -> CheckResult {
    let key_path = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".sockt")
        .join("key.txt");

    if !key_path.exists() {
        return CheckResult {
            name: "Encryption key".to_string(),
            status: CheckStatus::Warn,
            message: "not found".to_string(),
            fix: Some("sockt init (generates key automatically)".to_string()),
            latency_ms: None,
        };
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = std::fs::metadata(&key_path) {
            let mode = metadata.permissions().mode() & 0o777;
            if mode != 0o600 {
                return CheckResult {
                    name: "Encryption key".to_string(),
                    status: CheckStatus::Warn,
                    message: format!("permissions {:o} (should be 600)", mode),
                    fix: Some(format!("chmod 600 {}", key_path.display())),
                    latency_ms: None,
                };
            }
        }
    }

    CheckResult {
        name: "Encryption key".to_string(),
        status: CheckStatus::Pass,
        message: format!("present ({})", key_path.display()),
        fix: None,
        latency_ms: None,
    }
}

fn check_gbrain_dir(config: &crate::config::SocktConfig) -> CheckResult {
    let dir = &config.gbrain.directory;
    if !dir.exists() {
        return CheckResult {
            name: "GBrain directory".to_string(),
            status: CheckStatus::Warn,
            message: "not found".to_string(),
            fix: Some("sockt init".to_string()),
            latency_ms: None,
        };
    }

    let is_git = dir.join(".git").exists();
    if is_git {
        CheckResult {
            name: "GBrain directory".to_string(),
            status: CheckStatus::Pass,
            message: "exists (git repository)".to_string(),
            fix: None,
            latency_ms: None,
        }
    } else {
        CheckResult {
            name: "GBrain directory".to_string(),
            status: CheckStatus::Warn,
            message: "exists but not a git repository".to_string(),
            fix: Some("cd gbrain && git init".to_string()),
            latency_ms: None,
        }
    }
}

fn check_slack_configured(config: &crate::config::SocktConfig) -> CheckResult {
    let has_token = !config.slack.app_token.ciphertext.is_empty();
    if has_token {
        CheckResult {
            name: "Slack".to_string(),
            status: CheckStatus::Pass,
            message: "configured".to_string(),
            fix: None,
            latency_ms: None,
        }
    } else {
        CheckResult {
            name: "Slack".to_string(),
            status: CheckStatus::Warn,
            message: "not configured (optional)".to_string(),
            fix: Some("sockt setup slack".to_string()),
            latency_ms: None,
        }
    }
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
    println!("\n  Sockt Doctor");
    println!("  {}", "─".repeat(55));

    for check in checks {
        let icon = match check.status {
            CheckStatus::Pass => "[✓]",
            CheckStatus::Warn => "[!]",
            CheckStatus::Fail => "[✖]",
        };
        println!("    {} {} — {}", icon, check.name, check.message);
    }

    println!("  {}", "─".repeat(55));

    match code {
        0 => println!("  All checks passed ✓\n  Ready to deploy: sockt deploy\n"),
        1 => {
            let warns = checks
                .iter()
                .filter(|c| c.status == CheckStatus::Warn)
                .count();
            println!("  {} warnings\n", warns);
            println!("  To resolve:");
            for check in checks.iter().filter(|c| c.status == CheckStatus::Warn) {
                if let Some(fix) = &check.fix {
                    println!("    {} → {}", check.name, fix);
                }
            }
            println!();
        }
        _ => {
            let fails = checks
                .iter()
                .filter(|c| c.status == CheckStatus::Fail)
                .count();
            println!("  {} errors — cannot deploy\n", fails);
            println!("  Fix required:");
            for (i, check) in checks
                .iter()
                .filter(|c| c.status == CheckStatus::Fail)
                .enumerate()
            {
                if let Some(fix) = &check.fix {
                    println!("    {}. {}", i + 1, fix);
                }
            }
            println!();
        }
    }
}
