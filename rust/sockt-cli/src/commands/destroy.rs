use anyhow::{Context, Result};
use dialoguer::Confirm;
use std::path::PathBuf;

use crate::cli::DestroyArgs;
use crate::runtime::{is_process_alive, kill_process, load_runtime_state, remove_runtime_state};

pub async fn run(args: DestroyArgs, _config_path: Option<PathBuf>) -> Result<()> {
    // 1. Check if swarm is running
    let state = load_runtime_state().unwrap_or_default();

    if state.pids.is_empty() {
        println!("No swarm is currently running.");
    }

    // 2. Show warning and confirm
    println!("\n⚠️  WARNING: This will DELETE:");
    println!("  - All running processes");
    println!("  - ~/.sockt/scratch/ (SQLite databases, checkpoints)");
    println!("  - ~/.sockt/runtime.json");
    if !args.keep_config {
        println!("  - ~/.sockt/config.yaml (can be preserved with --keep-config)");
    }
    if !args.keep_gbrain {
        println!("  - ./gbrain/ directory (can be preserved with --keep-gbrain)");
    }
    println!();

    // Skip confirmation if --confirm flag is provided
    if !args.confirm {
        let confirmed = Confirm::new()
            .with_prompt("Are you sure you want to destroy the deployment?")
            .default(false)
            .interact()?;

        if !confirmed {
            println!("Cancelled.");
            return Ok(());
        }
    }

    // 3. Kill all processes (reverse order like stop.rs)
    if !state.pids.is_empty() {
        println!("\n  Stopping processes...");
        let mut reversed = state.pids.clone();
        reversed.reverse();

        for service in reversed {
            if is_process_alive(service.pid) {
                kill_process(service.pid, true)?; // force kill
                println!("  ✓ Killed {}", service.name);
            }
        }
    }

    // 4. Remove directories
    let home = dirs::home_dir().context("Could not determine home directory")?;
    let sockt_dir = home.join(".sockt");

    // Remove scratch/
    let scratch = sockt_dir.join("scratch");
    if scratch.exists() {
        std::fs::remove_dir_all(&scratch)?;
        println!("  ✓ Removed scratch directory");
    }

    // Remove runtime.json
    if let Err(e) = remove_runtime_state() {
        eprintln!("  ⚠ Failed to remove runtime state: {}", e);
    } else {
        println!("  ✓ Removed runtime state");
    }

    // Optionally remove config.yaml
    if !args.keep_config {
        let config = sockt_dir.join("config.yaml");
        if config.exists() {
            std::fs::remove_file(&config)?;
            println!("  ✓ Removed config.yaml");
        }
    }

    // Optionally remove gbrain/
    if !args.keep_gbrain {
        let gbrain = PathBuf::from("./gbrain");
        if gbrain.exists() {
            std::fs::remove_dir_all(&gbrain)?;
            println!("  ✓ Removed gbrain/ directory");
        }
    }

    println!("\n✅ Deployment destroyed successfully.\n");
    Ok(())
}
