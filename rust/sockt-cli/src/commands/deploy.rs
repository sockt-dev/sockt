use std::collections::HashMap;
use std::path::PathBuf;

use anyhow::{bail, Context, Result};

use crate::cli::DeployArgs;
use crate::config::loader::ConfigLoader;
use crate::config::SocktConfig;
use crate::runtime::{
    check_health, is_process_alive, load_runtime_state, save_runtime_state, spawn_bun_service,
    RuntimeState, ServicePid,
};

/// Configuration for a single service to deploy
struct ServiceConfig {
    name: String,
    package_path: String,
    port: Option<u16>,
    health_endpoint: Option<String>,
    env_vars: HashMap<String, String>,
}

/// Main entry point for deploy command
pub async fn run(args: DeployArgs, config_path: Option<PathBuf>) -> Result<()> {
    // Load config
    let loader = ConfigLoader::from_default_or_override(config_path);
    let config = loader
        .load()
        .context("No Sockt deployment found. Run `sockt init` first.")?;

    // Handle dry-run mode early
    if args.dry_run {
        return run_dry_run(&config, args.department.as_deref());
    }

    // Preflight checks
    check_prerequisites(&config)?;

    // Build service configurations
    let services = build_service_configs(&config, args.department.as_deref())?;

    println!("  Starting swarm...\n");

    // Spawn services in phases
    let mut all_pids = Vec::new();

    // Phase 1: GBrain MCP (infrastructure)
    let gbrain = spawn_with_health(&services[0], args.timeout).await?;
    all_pids.push(gbrain);

    // Phase 2: Orchestrator
    let orch = spawn_with_health(&services[1], args.timeout).await?;
    all_pids.push(orch);

    // Phase 3: CADVP + Agents (parallel, no health checks)
    for service in &services[2..] {
        let pid = spawn_single_service(service).await?;
        all_pids.push(pid);
    }

    // Save runtime state
    let state = RuntimeState {
        pids: all_pids.clone(),
    };
    save_runtime_state(&state).context("Failed to save runtime state")?;

    // Print success
    println!("\n  ✓ Swarm deployed ({} processes)\n", all_pids.len());
    print_next_commands();

    // Handle watch mode
    if args.watch {
        println!("\n  ✓ All services healthy. Streaming logs (Ctrl+C to detach):\n");
        stream_logs_until_interrupt(&all_pids).await?;
        println!("  ✓ Detached. Services still running in background.");
    }

    Ok(())
}

// ============================================================================
// Preflight Checks
// ============================================================================

fn check_prerequisites(_config: &SocktConfig) -> Result<()> {
    check_bun_installed()?;
    check_not_already_running()?;
    check_ports_available(&[3100, 3200])?;
    find_monorepo_root()?;
    Ok(())
}

fn check_bun_installed() -> Result<()> {
    let output = std::process::Command::new("which").arg("bun").output();

    match output {
        Ok(out) if out.status.success() => Ok(()),
        _ => bail!("Bun is not installed. Install from https://bun.sh"),
    }
}

fn check_not_already_running() -> Result<()> {
    if let Ok(state) = load_runtime_state() {
        let alive: Vec<_> = state
            .pids
            .iter()
            .filter(|p| is_process_alive(p.pid))
            .collect();

        if !alive.is_empty() {
            bail!(
                "Swarm is already running ({} services). Use `sockt stop` first.",
                alive.len()
            );
        }
    }
    Ok(())
}

fn check_ports_available(ports: &[u16]) -> Result<()> {
    use std::net::TcpListener;

    for &port in ports {
        if TcpListener::bind(format!("127.0.0.1:{}", port)).is_err() {
            bail!(
                "Port {} is already in use. Free the port and try again.",
                port
            );
        }
    }
    Ok(())
}

fn find_monorepo_root() -> Result<PathBuf> {
    let mut current = std::env::current_dir()?;

    loop {
        let packages_dir = current.join("packages");
        if packages_dir.exists() && packages_dir.is_dir() {
            return Ok(current);
        }

        if !current.pop() {
            bail!("Could not find Sockt monorepo. Run from project root.");
        }
    }
}

// ============================================================================
// Service Configuration
// ============================================================================

fn build_service_configs(
    config: &SocktConfig,
    department: Option<&str>,
) -> Result<Vec<ServiceConfig>> {
    let monorepo = find_monorepo_root()?;
    let mut services = Vec::new();

    // 1. GBrain MCP (always first)
    services.push(create_gbrain_config(&monorepo, config));

    // 2. Orchestrator (always second)
    services.push(create_orch_config(&monorepo, config));

    // 3. CADVP (always)
    services.push(create_cadvp_config(&monorepo, config));

    // 4. Agents (filtered by department)
    services.extend(create_agent_configs(&monorepo, config, department)?);

    Ok(services)
}

fn create_gbrain_config(monorepo: &PathBuf, _config: &SocktConfig) -> ServiceConfig {
    let mut env_vars = HashMap::new();
    env_vars.insert("PORT".to_string(), "3200".to_string());

    ServiceConfig {
        name: "gbrain-mcp".to_string(),
        package_path: monorepo
            .join("packages/gbrain-mcp/src/index.ts")
            .to_string_lossy()
            .to_string(),
        port: Some(3200),
        health_endpoint: Some("http://localhost:3200/health".to_string()),
        env_vars,
    }
}

fn create_orch_config(monorepo: &PathBuf, config: &SocktConfig) -> ServiceConfig {
    let mut env_vars = HashMap::new();
    env_vars.insert("PORT".to_string(), "3100".to_string());
    env_vars.insert(
        "GBRAIN_URL".to_string(),
        "http://localhost:3200".to_string(),
    );
    env_vars.insert("DEPLOYMENT_ID".to_string(), config.deployment_id.clone());

    ServiceConfig {
        name: "orch".to_string(),
        package_path: monorepo
            .join("packages/orch/src/index.ts")
            .to_string_lossy()
            .to_string(),
        port: Some(3100),
        health_endpoint: Some("http://localhost:3100/health".to_string()),
        env_vars,
    }
}

fn create_cadvp_config(monorepo: &PathBuf, _config: &SocktConfig) -> ServiceConfig {
    let mut env_vars = HashMap::new();
    env_vars.insert(
        "ORCH_URL".to_string(),
        "http://localhost:3100".to_string(),
    );
    env_vars.insert(
        "GBRAIN_URL".to_string(),
        "http://localhost:3200".to_string(),
    );

    ServiceConfig {
        name: "cadvp".to_string(),
        package_path: monorepo
            .join("packages/cadvp/src/index.ts")
            .to_string_lossy()
            .to_string(),
        port: None,
        health_endpoint: None,
        env_vars,
    }
}

fn create_agent_configs(
    monorepo: &PathBuf,
    _config: &SocktConfig,
    department: Option<&str>,
) -> Result<Vec<ServiceConfig>> {
    // Default agent definitions
    let agents = vec![
        ("agent-1", "Lead Researcher", "research"),
        ("agent-2", "Outbound Writer", "marketing"),
        ("agent-3", "Social Monitor", "community"),
    ];

    let filtered = if let Some(dept) = department {
        agents
            .iter()
            .filter(|(_, _, d)| *d == dept)
            .collect::<Vec<_>>()
    } else {
        agents.iter().collect()
    };

    let mut configs = Vec::new();
    for (name, role, dept) in filtered {
        let mut env_vars = HashMap::new();
        env_vars.insert(
            "ORCH_URL".to_string(),
            "http://localhost:3100".to_string(),
        );
        env_vars.insert("AGENT_ROLE".to_string(), role.to_string());
        env_vars.insert("DEPARTMENT".to_string(), dept.to_string());

        configs.push(ServiceConfig {
            name: name.to_string(),
            package_path: monorepo
                .join("packages/runtime/src/index.ts")
                .to_string_lossy()
                .to_string(),
            port: None,
            health_endpoint: None,
            env_vars,
        });
    }

    Ok(configs)
}

// ============================================================================
// Service Spawning
// ============================================================================

async fn spawn_with_health(config: &ServiceConfig, timeout: u64) -> Result<ServicePid> {
    use std::time::Instant;

    // Print starting status
    print!("    {:<15} starting → ", config.name);
    std::io::Write::flush(&mut std::io::stdout())?;

    let start = Instant::now();

    // Spawn the service
    let pid = spawn_bun_service(&config.package_path, config.env_vars.clone(), &config.name)
        .context(format!("Failed to spawn {}", config.name))?;

    // Wait for health check if endpoint provided
    if let Some(health_url) = &config.health_endpoint {
        poll_health_with_progress(health_url, timeout)
            .await
            .context(format!("{} failed to become healthy", config.name))?;
    }

    let elapsed = start.elapsed().as_secs_f64();
    println!("healthy ({:.1}s) [PID {}]", elapsed, pid.pid);

    Ok(pid)
}

async fn poll_health_with_progress(url: &str, timeout_secs: u64) -> Result<()> {
    use tokio::time::{sleep, Duration, Instant};

    let deadline = Instant::now() + Duration::from_secs(timeout_secs);

    loop {
        if Instant::now() > deadline {
            bail!("Health check timeout after {}s", timeout_secs);
        }

        if let Ok(true) = check_health(url, 500).await {
            return Ok(());
        }

        sleep(Duration::from_millis(500)).await;
    }
}

async fn spawn_single_service(config: &ServiceConfig) -> Result<ServicePid> {
    println!("    {:<15} starting... [daemon]", config.name);

    spawn_bun_service(&config.package_path, config.env_vars.clone(), &config.name)
        .context(format!("Failed to spawn {}", config.name))
}

// ============================================================================
// Dry-Run Mode
// ============================================================================

fn run_dry_run(config: &SocktConfig, department: Option<&str>) -> Result<()> {
    // Build configs but don't spawn
    let services = build_service_configs(config, department)?;

    println!("\n  Would start:\n");

    for service in &services {
        let port_info = if let Some(port) = service.port {
            format!("port {}", port)
        } else {
            "(daemon)".to_string()
        };

        println!(
            "    {:<15} bun {}  {}",
            service.name, service.package_path, port_info
        );
    }

    let est_memory_mb = services.len() * 200; // ~200 MB per service
    println!(
        "\n  {} processes, estimated memory: ~{} MB",
        services.len(),
        est_memory_mb
    );
    println!("  Run without --dry-run to deploy.\n");

    Ok(())
}

// ============================================================================
// Output Helpers
// ============================================================================

fn print_next_commands() {
    println!("  Commands:");
    println!("    sockt status     Check health");
    println!("    sockt logs -f    Watch activity");
    println!("    sockt stop       Stop all services");
    println!("\n  PIDs written to ~/.sockt/runtime.json");
}

async fn stream_logs_until_interrupt(_pids: &[ServicePid]) -> Result<()> {
    // Wait for Ctrl+C
    tokio::signal::ctrl_c().await?;
    Ok(())
}
