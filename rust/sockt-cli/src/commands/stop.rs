//! Stop command implementation.
//!
//! Provides graceful and forceful shutdown of the sockt swarm with:
//! - Reverse dependency order killing (agents → cadvp → orch → gbrain-mcp)
//! - Per-process timeout with automatic escalation to SIGKILL
//! - Idempotent operation (safe to call when nothing is running)
//! - Optional scratch data purging with interactive confirmation

use std::path::PathBuf;
use anyhow::{Context, Result};

use crate::cli::StopArgs;
use crate::runtime::{
    is_process_alive, kill_process, load_runtime_state, remove_runtime_state, RuntimeState,
};

pub async fn run(args: StopArgs, _config_path: Option<PathBuf>) -> Result<()> {
    let state = load_runtime_state()?;

    if state.pids.is_empty() {
        if args.purge {
            purge_scratch_data(args.force)?;
            println!("\n  ✓ Scratch data purged.");
        } else {
            println!("  Swarm is not running. Nothing to stop.");
        }
        return Ok(());
    }

    if args.force {
        force_stop(&state)?;
    } else {
        graceful_stop(&state, args.timeout).await?;
    }

    remove_runtime_state()?;

    if args.purge {
        purge_scratch_data(args.force)?;
    }

    print_success_message(args.purge);
    Ok(())
}

async fn graceful_stop(state: &RuntimeState, timeout: u64) -> Result<()> {
    println!("  Stopping swarm...\n");

    let mut reversed_pids = state.pids.clone();
    reversed_pids.reverse();

    let mut errors = Vec::new();

    for service in &reversed_pids {
        if !is_process_alive(service.pid) {
            println!(
                "    {:<15} (PID {}) already stopped",
                service.name, service.pid
            );
            continue;
        }

        if let Err(e) = kill_process(service.pid, false) {
            errors.push(format!("{} (PID {}): {}", service.name, service.pid, e));
            println!(
                "    {:<15} (PID {}) error: {}",
                service.name, service.pid, e
            );
            continue;
        }

        print!("    {:<15} (PID {}) stopping... ", service.name, service.pid);
        std::io::Write::flush(&mut std::io::stdout())?;

        let deadline =
            tokio::time::Instant::now() + tokio::time::Duration::from_secs(timeout);

        loop {
            if !is_process_alive(service.pid) {
                println!("killed");
                break;
            }

            if tokio::time::Instant::now() > deadline {
                print!("timeout, force killing... ");
                std::io::Write::flush(&mut std::io::stdout())?;

                if let Err(e) = kill_process(service.pid, true) {
                    println!("error: {}", e);
                    errors.push(format!("{} (PID {}): force kill failed: {}", service.name, service.pid, e));
                } else {
                    println!("killed");
                }
                break;
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
    }

    if !errors.is_empty() {
        eprintln!("\n  ⚠ Some processes could not be stopped:");
        for error in &errors {
            eprintln!("    - {}", error);
        }
        eprintln!("  You may need to kill these processes manually.");
    }

    Ok(())
}

fn force_stop(state: &RuntimeState) -> Result<()> {
    println!("  ⚠ Force stopping...\n");

    let mut reversed_pids = state.pids.clone();
    reversed_pids.reverse();

    let mut errors = Vec::new();

    for service in &reversed_pids {
        if !is_process_alive(service.pid) {
            println!(
                "    {:<15} (PID {}) already stopped",
                service.name, service.pid
            );
            continue;
        }

        match kill_process(service.pid, true) {
            Ok(_) => {
                println!("    {:<15} (PID {}) killed", service.name, service.pid);
            }
            Err(e) => {
                println!("    {:<15} (PID {}) error: {}", service.name, service.pid, e);
                errors.push(format!("{} (PID {}): {}", service.name, service.pid, e));
            }
        }
    }

    if !errors.is_empty() {
        eprintln!("\n  ⚠ Some processes could not be stopped:");
        for error in &errors {
            eprintln!("    - {}", error);
        }
        eprintln!("  You may need to kill these processes manually.");
    }

    Ok(())
}

fn purge_scratch_data(force: bool) -> Result<()> {
    let scratch_path = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".sockt")
        .join("scratch");

    if !scratch_path.exists() {
        return Ok(());
    }

    if !force {
        println!("\n  This will remove runtime state and scratch data.");
        println!("  GBrain data at ./gbrain/ is preserved.");
        println!();

        let confirmed = dialoguer::Confirm::new()
            .with_prompt("Proceed with purge?")
            .default(false)
            .interact()
            .map_err(|_| anyhow::anyhow!("Purge cancelled"))?;

        if !confirmed {
            println!("  Purge cancelled.");
            return Ok(());
        }
    }

    if let Err(e) = std::fs::remove_dir_all(&scratch_path) {
        eprintln!("\n  ⚠ Failed to remove scratch directory: {}", e);
        eprintln!("  Path: {}", scratch_path.display());
        eprintln!("  You may need to remove it manually.");
    }

    Ok(())
}

fn print_success_message(purged: bool) {
    if purged {
        println!("\n  ✓ Swarm stopped and purged.");
    } else {
        println!("\n  ✓ Swarm stopped. GBrain preserved at ./gbrain/");
        println!("  Run `sockt deploy` to restart.");
    }
}
