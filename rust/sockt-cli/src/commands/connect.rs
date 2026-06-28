use anyhow::{bail, Context, Result};
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use tokio::time::{sleep, Duration};

use crate::cli::ConnectArgs;
use crate::runtime::load_runtime_state;

pub async fn run(args: ConnectArgs, _config_path: Option<PathBuf>) -> Result<()> {
    // 1. Validate swarm is running
    let state = load_runtime_state()
        .context("No swarm running. Use `sockt deploy` first.")?;

    if state.pids.is_empty() {
        bail!("No agents running.");
    }

    // 2. Select agent to connect to
    let agent_name = if let Some(role) = args.role {
        // User specified agent role
        role
    } else {
        // Show interactive list using dialoguer
        let names: Vec<String> = state.pids.iter().map(|p| p.name.clone()).collect();

        let selection = dialoguer::Select::new()
            .with_prompt("Select agent to connect")
            .items(&names)
            .default(0)
            .interact()?;

        names[selection].clone()
    };

    // 3. Find log file
    let log_dir = dirs::home_dir()
        .context("Could not determine home directory")?
        .join(".sockt/logs");

    let log_file = log_dir.join(format!("{}.log", agent_name));

    if !log_file.exists() {
        bail!("Log file not found: {}. Agent may not have logged yet.", log_file.display());
    }

    // 4. Tail log file with color formatting
    println!("📡 Connected to {} (Ctrl+C to detach)\n", agent_name);

    // Setup signal handler for Ctrl+C
    let mut sigint = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())?;

    let mut last_pos = std::fs::metadata(&log_file)?.len();

    loop {
        tokio::select! {
            _ = sigint.recv() => {
                println!("\n✓ Detached from {}", agent_name);
                break;
            }
            _ = sleep(Duration::from_millis(500)) => {
                // Read new log entries
                let Ok(file) = std::fs::File::open(&log_file) else {
                    eprintln!("Warning: Log file disappeared");
                    break;
                };

                let current_len = file.metadata()?.len();

                if current_len > last_pos {
                    let mut file = file;
                    file.seek(SeekFrom::Start(last_pos))?;

                    let mut new_data = Vec::new();
                    file.read_to_end(&mut new_data)?;

                    // Print with basic ANSI color formatting
                    let text = String::from_utf8_lossy(&new_data);
                    for line in text.lines() {
                        if line.contains("ERROR") {
                            println!("\x1b[31m{}\x1b[0m", line); // red
                        } else if line.contains("WARN") {
                            println!("\x1b[33m{}\x1b[0m", line); // yellow
                        } else if line.contains("INFO") {
                            println!("\x1b[36m{}\x1b[0m", line); // cyan
                        } else {
                            println!("{}", line);
                        }
                    }

                    last_pos = current_len;
                }
            }
        }
    }

    Ok(())
}
