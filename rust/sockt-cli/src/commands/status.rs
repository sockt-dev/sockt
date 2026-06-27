use std::path::PathBuf;

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::cli::StatusArgs;
use crate::config::loader::ConfigLoader;
use crate::config::SocktConfig;
use crate::orch_client::{OrchClient, OrchClientConfig};
use crate::runtime::{is_process_alive, load_runtime_state, RuntimeState};

// =============================================================================
// Data Structures
// =============================================================================

/// Overall health status of the swarm
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SwarmHealth {
    Healthy,
    Degraded,
    Down,
}

/// Status of a single service/agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceStatus {
    pub name: String,
    pub status: ServiceState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uptime: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_output: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServiceState {
    Running,
    Crashed,
    Stopped,
}

impl std::fmt::Display for ServiceState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Running => write!(f, "running"),
            Self::Crashed => write!(f, "crashed"),
            Self::Stopped => write!(f, "stopped"),
        }
    }
}

/// Task statistics from orch API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStats {
    pub completed_24h: u32,
    pub running: u32,
    pub pending_approval: u32,
    pub failed: u32,
    pub escalated: u32,
}

/// Pending approval task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingApproval {
    pub id: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_in_seconds: Option<u64>,
}

/// Connection statuses
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionStatus {
    pub slack: SlackStatus,
    pub llm: LlmStatus,
    pub gbrain: GBrainStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackStatus {
    pub status: ConnectionState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmStatus {
    pub status: ConnectionState,
    pub provider: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GBrainStatus {
    pub status: GitState,
    pub entries: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_commit_seconds_ago: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionState {
    Connected,
    Disconnected,
    Unknown,
}

impl std::fmt::Display for ConnectionState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Connected => write!(f, "● connected"),
            Self::Disconnected => write!(f, "✖ disconnected"),
            Self::Unknown => write!(f, "? unknown"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitState {
    Clean,
    Dirty,
    Unknown,
}

/// Complete swarm status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwarmStatus {
    pub health: SwarmHealth,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uptime_seconds: Option<u64>,
    pub deployment_id: String,
    pub services: Vec<ServiceStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tasks: Option<TaskStats>,
    pub pending_approvals: Vec<PendingApproval>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connections: Option<ConnectionStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_active: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,
}

impl SwarmStatus {
    /// Exit code for quiet mode
    pub fn exit_code(&self) -> i32 {
        match self.health {
            SwarmHealth::Healthy => 0,
            SwarmHealth::Degraded => 1,
            SwarmHealth::Down => 2,
        }
    }
}

// =============================================================================
// Main Entry Point
// =============================================================================

pub async fn run(args: StatusArgs, config_path: Option<PathBuf>) -> Result<()> {
    // Handle watch mode (stub)
    if args.watch {
        anyhow::bail!("Watch mode not yet implemented. Use `sockt status` without --watch.");
    }

    // Gather status from all sources
    let status = gather_status(config_path).await?;

    // Quiet mode: just exit with code
    if args.quiet {
        std::process::exit(status.exit_code());
    }

    // JSON mode: serialize and print
    if args.json {
        let json = serde_json::to_string_pretty(&status)?;
        println!("{}", json);
        return Ok(());
    }

    // Standard output
    render_status(&status, args.detailed);
    Ok(())
}

// =============================================================================
// Data Gathering
// =============================================================================

async fn gather_status(config_path: Option<PathBuf>) -> Result<SwarmStatus> {
    // Load runtime state
    let runtime_state = load_runtime_state().unwrap_or_default();

    // Gather service statuses first
    let service_statuses = gather_service_statuses(&runtime_state);

    // If no services in runtime state, swarm was never started
    if runtime_state.pids.is_empty() {
        return Ok(SwarmStatus {
            health: SwarmHealth::Down,
            uptime_seconds: None,
            deployment_id: "unknown".to_string(),
            services: vec![],
            tasks: None,
            pending_approvals: vec![],
            connections: None,
            last_active: None, // TODO: load from file
            stop_reason: Some("Swarm not running".to_string()),
        });
    }

    // Load config (use defaults if missing)
    let loader = ConfigLoader::from_default_or_override(config_path);
    let config = loader.load().ok();

    let deployment_id = config
        .as_ref()
        .map(|c| c.deployment_id.clone())
        .unwrap_or_else(|| "unknown".to_string());

    // Try to gather task stats (may fail if orch unreachable)
    let task_stats = if let Some(ref cfg) = config {
        gather_task_stats(cfg).await.ok()
    } else {
        None
    };

    // Try to gather connection status
    let connections = if let Some(ref cfg) = config {
        gather_connection_status(cfg).await.ok()
    } else {
        None
    };

    // Determine overall health
    let health = determine_health(&service_statuses);

    // Calculate uptime (TODO: track actual start time)
    let uptime = None;

    Ok(SwarmStatus {
        health,
        uptime_seconds: uptime,
        deployment_id,
        services: service_statuses,
        tasks: task_stats,
        pending_approvals: vec![], // TODO: fetch from orch
        connections,
        last_active: None,
        stop_reason: None,
    })
}

/// Check each service process and build status
fn gather_service_statuses(runtime_state: &RuntimeState) -> Vec<ServiceStatus> {
    let mut statuses = Vec::new();

    for service_pid in &runtime_state.pids {
        let is_alive = is_process_alive(service_pid.pid);

        let status = ServiceStatus {
            name: service_pid.name.clone(),
            status: if is_alive {
                ServiceState::Running
            } else {
                ServiceState::Crashed
            },
            pid: Some(service_pid.pid),
            port: service_pid.port,
            uptime: None,       // TODO: track start time
            last_output: None,  // TODO: fetch from orch
        };

        statuses.push(status);
    }

    statuses
}

/// Fetch task statistics from orch
async fn gather_task_stats(_config: &SocktConfig) -> Result<TaskStats> {
    let orch_client = create_orch_client()?;

    let health = orch_client.health().await?;

    // TODO: fetch actual 24h stats from a new endpoint
    Ok(TaskStats {
        completed_24h: 0,
        running: health.active_agents,
        pending_approval: health.pending_tasks,
        failed: 0,
        escalated: 0,
    })
}

/// Check connection statuses
async fn gather_connection_status(config: &SocktConfig) -> Result<ConnectionStatus> {
    Ok(ConnectionStatus {
        slack: SlackStatus {
            status: ConnectionState::Unknown,
            workspace: None,
        },
        llm: LlmStatus {
            status: ConnectionState::Unknown,
            provider: config.models.provider.to_string(),
        },
        gbrain: check_gbrain_status(config),
    })
}

fn check_gbrain_status(config: &SocktConfig) -> GBrainStatus {
    let dir = &config.gbrain.directory;

    if !dir.exists() {
        return GBrainStatus {
            status: GitState::Unknown,
            entries: 0,
            last_commit_seconds_ago: None,
        };
    }

    // Count entries (files in directory)
    let entries = count_directory_files(dir);

    // TODO: Get last commit time from git

    GBrainStatus {
        status: GitState::Unknown,
        entries,
        last_commit_seconds_ago: None,
    }
}

fn count_directory_files(dir: &PathBuf) -> u32 {
    std::fs::read_dir(dir)
        .map(|entries| entries.filter_map(Result::ok).count() as u32)
        .unwrap_or(0)
}

/// Determine overall health from service states
fn determine_health(services: &[ServiceStatus]) -> SwarmHealth {
    if services.is_empty() {
        return SwarmHealth::Down;
    }

    let all_healthy = services
        .iter()
        .all(|s| s.status == ServiceState::Running);
    let any_running = services
        .iter()
        .any(|s| s.status == ServiceState::Running);

    if all_healthy {
        SwarmHealth::Healthy
    } else if any_running {
        SwarmHealth::Degraded
    } else {
        SwarmHealth::Down
    }
}

// =============================================================================
// Output Rendering
// =============================================================================

fn render_status(status: &SwarmStatus, detailed: bool) {
    if status.health == SwarmHealth::Down && status.services.is_empty() {
        render_down_status(status);
        return;
    }

    // Header
    print!("\n  Sockt — {}", status.deployment_id);
    if let Some(uptime) = status.uptime_seconds {
        print!("                    uptime: {}", format_duration(uptime));
    }
    if status.health == SwarmHealth::Degraded {
        println!("  ⚠ degraded");
    } else {
        println!();
    }

    // Services box
    println!("\n  ┌─ Services ────────────────────────────────────────────────┐");
    for service in &status.services {
        let status_icon = match service.status {
            ServiceState::Running => "●",
            ServiceState::Crashed => "✖",
            ServiceState::Stopped => "○",
        };

        print!("  │ {:<20} {} {}", service.name, status_icon, service.status);

        if detailed {
            if let Some(pid) = service.pid {
                print!("  (PID {})", pid);
            }
            if let Some(port) = service.port {
                print!("  port {}", port);
            }
        }

        let padding_needed = if detailed { 10 } else { 30 };
        println!("{:width$}│", "", width = padding_needed);
    }
    println!("  └───────────────────────────────────────────────────────────┘");

    // Tasks (if available)
    if let Some(ref tasks) = status.tasks {
        println!("\n  ┌─ Tasks (24h) ─────────────────────────────────────────────┐");
        println!(
            "  │ completed: {}   running: {}   pending approval: {}   failed: {} │",
            tasks.completed_24h, tasks.running, tasks.pending_approval, tasks.failed
        );
        println!("  └───────────────────────────────────────────────────────────┘");
    }

    // Connections (if available)
    if let Some(ref conn) = status.connections {
        println!("\n  ┌─ Connections ─────────────────────────────────────────────┐");
        println!(
            "  │ Slack: {}  LLM: {}  GBrain: {} entries │",
            conn.slack.status, conn.llm.provider, conn.gbrain.entries
        );
        println!("  └───────────────────────────────────────────────────────────┘");
    }

    println!();
}

fn render_down_status(status: &SwarmStatus) {
    println!("\n  Sockt — not running\n");

    if let Some(ref last_active) = status.last_active {
        println!("  Last active: {}", last_active);
    }

    if let Some(ref reason) = status.stop_reason {
        println!("  Reason: {}\n", reason);
    }

    println!("  Run `sockt deploy` to start your swarm.\n");
}

fn format_duration(seconds: u64) -> String {
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    if hours > 0 {
        format!("{}h {}m", hours, minutes)
    } else {
        format!("{}m", minutes)
    }
}

/// Create orch client from config
fn create_orch_client() -> Result<OrchClient> {
    let orch_url =
        std::env::var("ORCH_URL").unwrap_or_else(|_| "http://localhost:3100".to_string());

    OrchClient::new(OrchClientConfig {
        base_url: orch_url,
        timeout_ms: 2000,
        retries: 1,
    })
    .map_err(|e| anyhow::anyhow!("Failed to create orch client: {}", e))
}
