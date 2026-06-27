use crate::cli::LogsArgs;
use crate::logs::filter::LogFilter;
use crate::logs::formatter::LogFormatter;
use crate::logs::reader::LogReader;
use crate::runtime::{load_runtime_state, RuntimeState};
use anyhow::{bail, Context, Result};
use std::collections::HashSet;
use std::path::PathBuf;
use std::time::Duration;
use tokio::time::sleep;

pub async fn run(args: LogsArgs, _config_path: Option<PathBuf>) -> Result<()> {
    // 1. Validate swarm is running
    let runtime_state = validate_swarm(&args)?;

    // 2. Validate agent exists (if filtered)
    if let Some(ref agent) = args.agent {
        validate_agent_exists(agent, &runtime_state)?;
    }

    // 3. Get log directory
    let log_dir = get_log_directory()?;

    // 4. Create formatter
    let agents = runtime_state
        .pids
        .iter()
        .map(|p| p.name.clone())
        .collect();
    let formatter = LogFormatter::new(!args.no_color, agents);

    // 5. Create filter
    let tail = if args.tail > 0 {
        Some(args.tail)
    } else {
        None
    };
    let filter = LogFilter::new(args.level.as_deref(), args.since.as_deref(), tail)?;

    if args.follow {
        // Follow mode: show recent logs then stream new ones
        follow_logs(args, log_dir, filter, formatter).await?;
    } else {
        // Static mode: show logs and exit
        show_logs(args, log_dir, filter, formatter)?;
    }

    Ok(())
}

fn show_logs(
    args: LogsArgs,
    log_dir: PathBuf,
    filter: LogFilter,
    formatter: LogFormatter,
) -> Result<()> {
    let reader = LogReader::new(log_dir);
    let entries = reader.read_entries(args.agent.as_deref())?;

    if entries.is_empty() {
        println!("No logs found in ~/.sockt/logs/");
        return Ok(());
    }

    let filtered = filter.apply(entries);

    for entry in filtered {
        if args.json {
            println!("{}", formatter.format_json(&entry));
        } else {
            println!("{}", formatter.format(&entry));
        }
    }

    Ok(())
}

async fn follow_logs(
    args: LogsArgs,
    log_dir: PathBuf,
    filter: LogFilter,
    formatter: LogFormatter,
) -> Result<()> {
    let reader = LogReader::new(log_dir);

    // Show initial logs (last 10 lines by default for follow mode)
    let mut initial_entries = reader.read_entries(args.agent.as_deref())?;
    let initial_tail_count = 10;
    initial_entries.sort_by_key(|e| e.timestamp);

    let skip_count = if initial_entries.len() > initial_tail_count {
        initial_entries.len() - initial_tail_count
    } else {
        0
    };

    let initial_filtered: Vec<_> = initial_entries.into_iter().skip(skip_count).collect();

    // Track displayed entries to avoid duplicates
    let mut seen_entries = HashSet::new();
    for entry in &initial_filtered {
        let key = (entry.timestamp, entry.agent.clone(), entry.message.clone());
        seen_entries.insert(key);
        if args.json {
            println!("{}", formatter.format_json(entry));
        } else {
            println!("{}", formatter.format(entry));
        }
    }

    // Setup Ctrl+C handler
    let mut sigint = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())?;

    // Stream new entries
    loop {
        tokio::select! {
            _ = sigint.recv() => {
                // Graceful shutdown on Ctrl+C
                break;
            }
            _ = sleep(Duration::from_millis(500)) => {
                // Poll for new entries
                let current_entries = reader.read_entries(args.agent.as_deref())?;

                for entry in current_entries {
                    let key = (entry.timestamp, entry.agent.clone(), entry.message.clone());
                    if !seen_entries.contains(&key) {
                        // Apply filters to new entry
                        if filter.matches_entry(&entry) {
                            seen_entries.insert(key);
                            if args.json {
                                println!("{}", formatter.format_json(&entry));
                            } else {
                                println!("{}", formatter.format(&entry));
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

fn validate_swarm(args: &LogsArgs) -> Result<RuntimeState> {
    match load_runtime_state() {
        Ok(state) if !state.pids.is_empty() => Ok(state),
        _ => {
            if !args.raw {
                eprintln!("Swarm is not running.");
            }
            bail!("No active swarm. Run `sockt deploy` first.")
        }
    }
}

fn validate_agent_exists(agent: &str, state: &RuntimeState) -> Result<()> {
    let available: Vec<_> = state.pids.iter().map(|p| p.name.as_str()).collect();
    if !available.contains(&agent) {
        bail!(
            "Agent '{}' not found. Running agents: {}",
            agent,
            available.join(", ")
        );
    }
    Ok(())
}

fn get_log_directory() -> Result<PathBuf> {
    let home = dirs::home_dir().context("Could not determine home directory")?;
    Ok(home.join(".sockt/logs"))
}
