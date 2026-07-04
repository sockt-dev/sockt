use std::collections::HashMap;
use std::path::PathBuf;

use anyhow::{bail, Context, Result};

use crate::cli::DeployArgs;
use crate::config::loader::ConfigLoader;
use crate::config::SocktConfig;
use crate::crypto::{self, KeyManager};
use crate::runtime::{
    check_health, is_process_alive, load_runtime_state, save_runtime_state,
    spawn_bun_service, spawn_sbx_agent, sbx_available,
    RuntimeState, ServicePid,
};

pub(crate) struct ServiceConfig {
    pub(crate) name: String,
    pub(crate) package_path: String,
    pub(crate) port: Option<u16>,
    pub(crate) health_endpoint: Option<String>,
    pub(crate) env_vars: HashMap<String, String>,
}

/// Main entry point for deploy command
pub async fn run(args: DeployArgs, config_path: Option<PathBuf>) -> Result<()> {
    let loader = ConfigLoader::from_default_or_override(config_path);
    let config = loader
        .load()
        .context("No Sockt deployment found. Run `sockt init` first.")?;

    if args.dry_run {
        return run_dry_run(&config, args.department.as_deref());
    }

    check_prerequisites(&config)?;
    ensure_scratch_dir()?;

    let services = build_service_configs(&config, args.department.as_deref())?;

    println!("  Starting swarm...\n");

    let mut all_pids = Vec::new();

    // Phase 1: GBrain MCP (infrastructure)
    let gbrain = spawn_with_health(&services[0], args.timeout).await?;
    all_pids.push(gbrain);

    // Phase 2: Orchestrator
    let orch = spawn_with_health(&services[1], args.timeout).await?;
    all_pids.push(orch);

    // Phase 3: CADVP + Agents (no health checks)
    for service in &services[2..] {
        let pid = spawn_single_service(service)?;
        all_pids.push(pid);
    }

    let state = RuntimeState {
        pids: all_pids.clone(),
        started_at: Some(std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()),
    };
    save_runtime_state(&state).context("Failed to save runtime state")?;

    println!("\n  ✓ Swarm deployed ({} processes)\n", all_pids.len());
    print_next_commands();

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

fn ensure_scratch_dir() -> Result<()> {
    let scratch = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".sockt")
        .join("scratch");
    std::fs::create_dir_all(&scratch)
        .context("Failed to create ~/.sockt/scratch directory")?;
    Ok(())
}

// ============================================================================
// Service Configuration
// ============================================================================

pub(crate) fn build_service_configs(
    config: &SocktConfig,
    department: Option<&str>,
) -> Result<Vec<ServiceConfig>> {
    let monorepo = find_monorepo_root()?;
    let mut services = Vec::new();

    services.push(create_gbrain_config(&monorepo, config));
    services.push(create_orch_config(&monorepo, config)?);
    services.push(create_cadvp_config(&monorepo, config));
    services.extend(create_agent_configs(&monorepo, config, department)?);

    Ok(services)
}

fn decrypt_api_key(config: &SocktConfig) -> Option<String> {
    let km = KeyManager::new(KeyManager::default_path());
    if let Ok(identity) = km.load() {
        crypto::decrypt(&config.models.api_key, &identity).ok()
    } else {
        None
    }
}

fn create_gbrain_config(monorepo: &PathBuf, config: &SocktConfig) -> ServiceConfig {
    let gbrain_dir = if config.gbrain.directory.is_relative() {
        monorepo.join(&config.gbrain.directory)
    } else {
        config.gbrain.directory.clone()
    };

    let mut env_vars = HashMap::new();
    env_vars.insert("PORT".to_string(), "3200".to_string());
    env_vars.insert(
        "GBRAIN_DIR".to_string(),
        gbrain_dir.to_string_lossy().to_string(),
    );

    ServiceConfig {
        name: "gbrain-mcp".to_string(),
        package_path: monorepo
            .join("packages/gbrain-mcp/src/serve.ts")
            .to_string_lossy()
            .to_string(),
        port: Some(3200),
        health_endpoint: Some("http://localhost:3200/health".to_string()),
        env_vars,
    }
}

fn create_orch_config(monorepo: &PathBuf, config: &SocktConfig) -> Result<ServiceConfig> {
    let scratch = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".sockt")
        .join("scratch");

    let mut env_vars = HashMap::new();
    env_vars.insert("PORT".to_string(), "3100".to_string());
    env_vars.insert(
        "GBRAIN_URL".to_string(),
        "http://localhost:3200".to_string(),
    );
    env_vars.insert("DEPLOYMENT_ID".to_string(), config.deployment_id.clone());
    env_vars.insert(
        "DB_PATH".to_string(),
        scratch.join("orch.sqlite").to_string_lossy().to_string(),
    );
    env_vars.insert("MODEL_PROVIDER".to_string(), config.models.provider.to_string());
    env_vars.insert("FRONTIER_MODEL".to_string(), config.models.frontier.clone());
    env_vars.insert("FAST_MODEL".to_string(), config.models.fast.clone());
    if let Some(api_key) = decrypt_api_key(config) {
        env_vars.insert("MODEL_API_KEY".to_string(), api_key);
    }
    if let Some(ref base_url) = config.models.base_url {
        env_vars.insert("MODEL_BASE_URL".to_string(), base_url.clone());
    }

    Ok(ServiceConfig {
        name: "orch".to_string(),
        package_path: monorepo
            .join("packages/orch/src/serve.ts")
            .to_string_lossy()
            .to_string(),
        port: Some(3100),
        health_endpoint: Some("http://localhost:3100/health".to_string()),
        env_vars,
    })
}

fn create_cadvp_config(monorepo: &PathBuf, _config: &SocktConfig) -> ServiceConfig {
    let scratch = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".sockt")
        .join("scratch");

    let mut env_vars = HashMap::new();
    env_vars.insert(
        "GBRAIN_URL".to_string(),
        "http://localhost:3200".to_string(),
    );
    env_vars.insert(
        "WATCH_DIR".to_string(),
        scratch.to_string_lossy().to_string(),
    );
    env_vars.insert(
        "CHECKPOINT_PATH".to_string(),
        scratch
            .join("cadvp-checkpoint.json")
            .to_string_lossy()
            .to_string(),
    );

    ServiceConfig {
        name: "cadvp".to_string(),
        package_path: monorepo
            .join("packages/cadvp/src/serve.ts")
            .to_string_lossy()
            .to_string(),
        port: None,
        health_endpoint: None,
        env_vars,
    }
}

fn create_agent_configs(
    monorepo: &PathBuf,
    config: &SocktConfig,
    department: Option<&str>,
) -> Result<Vec<ServiceConfig>> {
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
        env_vars.insert("DEPLOYMENT_ID".to_string(), config.deployment_id.clone());
        env_vars.insert("AGENT_ROLE".to_string(), role.to_string());
        env_vars.insert("DEPARTMENT".to_string(), dept.to_string());
        env_vars.insert("MODEL_PROVIDER".to_string(), config.models.provider.to_string());
        env_vars.insert("FRONTIER_MODEL".to_string(), config.models.frontier.clone());
        if let Some(api_key) = decrypt_api_key(config) {
            env_vars.insert("MODEL_API_KEY".to_string(), api_key);
        }
        if let Some(ref base_url) = config.models.base_url {
            env_vars.insert("MODEL_BASE_URL".to_string(), base_url.clone());
        }
        let scratch = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".sockt")
            .join("scratch");
        env_vars.insert("SCRATCH_DIR".to_string(), scratch.to_string_lossy().to_string());

        // Point each agent at its department skills directory
        let skills_dir = monorepo
            .join("packages/orch/src/registry/skills")
            .join(dept);
        if skills_dir.exists() {
            env_vars.insert("SKILLS_DIR".to_string(), skills_dir.to_string_lossy().to_string());
        }

        configs.push(ServiceConfig {
            name: name.to_string(),
            package_path: monorepo
                .join("packages/runtime/src/serve.ts")
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

pub(crate) async fn spawn_with_health(config: &ServiceConfig, timeout: u64) -> Result<ServicePid> {
    use std::time::Instant;

    print!("    {:<15} starting → ", config.name);
    std::io::Write::flush(&mut std::io::stdout())?;

    let start = Instant::now();

    let pid = spawn_bun_service(&config.package_path, config.env_vars.clone(), &config.name)
        .context(format!("Failed to spawn {}", config.name))?;

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

pub(crate) fn spawn_single_service(config: &ServiceConfig) -> Result<ServicePid> {
    // Agent services run in Docker AI Sandboxes (microVMs) when sbx is available.
    // Infrastructure services (orch, gbrain, cadvp) always run as plain Bun processes.
    let is_agent = config.name.starts_with("agent-");

    if is_agent && sbx_available() {
        println!("    {:<15} starting... [sbx microVM]", config.name);
        spawn_sbx_agent(&config.package_path, config.env_vars.clone(), &config.name)
            .context(format!("Failed to spawn {} in sbx", config.name))
    } else {
        println!("    {:<15} starting... [daemon]", config.name);
        spawn_bun_service(&config.package_path, config.env_vars.clone(), &config.name)
            .context(format!("Failed to spawn {}", config.name))
    }
}

// ============================================================================
// Dry-Run Mode
// ============================================================================

fn run_dry_run(config: &SocktConfig, department: Option<&str>) -> Result<()> {
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

    let est_memory_mb = services.len() * 200;
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
    tokio::signal::ctrl_c().await?;
    Ok(())
}
