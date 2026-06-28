use std::path::PathBuf;

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::cli::StatusArgs;
use crate::config::loader::ConfigLoader;
use crate::config::SocktConfig;
use crate::orch_client::{OrchClient, OrchClientConfig};
use crate::runtime::{is_process_alive, load_runtime_state, RuntimeState};

use crossterm::{
    event::{self, Event, KeyCode},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph},
    Terminal,
};

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
    // Handle watch mode
    if args.watch {
        return run_watch_mode(config_path).await;
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

    // Calculate uptime from started_at timestamp
    let uptime = runtime_state.started_at.map(|started_at| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            .saturating_sub(started_at)
    });

    Ok(SwarmStatus {
        health,
        uptime_seconds: uptime,
        deployment_id,
        services: service_statuses,
        tasks: task_stats,
        pending_approvals: vec![], // Will be populated if orch API is extended
        connections,
        last_active: runtime_state.started_at.map(format_time_ago),
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
            uptime: runtime_state.started_at.map(|started_at| {
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs()
                    .saturating_sub(started_at)
            }),
            last_output: None, // Will be populated if orch API is extended
        };

        statuses.push(status);
    }

    statuses
}

/// Fetch task statistics from orch
async fn gather_task_stats(_config: &SocktConfig) -> Result<TaskStats> {
    let orch_client = create_orch_client()?;

    let health = orch_client.health().await?;

    // Note: 24h stats, failed, and escalated counts require new orch API endpoints
    // For now, we show what's available from the health endpoint
    Ok(TaskStats {
        completed_24h: 0, // Will be populated when /stats API endpoint is added
        running: health.active_agents,
        pending_approval: health.pending_tasks,
        failed: 0, // Will be populated when /stats API endpoint is added
        escalated: 0, // Will be populated when /stats API endpoint is added
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

    // Get last commit time from git
    let last_commit_seconds_ago = get_last_commit_time(dir);

    GBrainStatus {
        status: if last_commit_seconds_ago.is_some() {
            GitState::Clean
        } else {
            GitState::Unknown
        },
        entries,
        last_commit_seconds_ago,
    }
}

fn count_directory_files(dir: &PathBuf) -> u32 {
    std::fs::read_dir(dir)
        .map(|entries| entries.filter_map(Result::ok).count() as u32)
        .unwrap_or(0)
}

/// Get the timestamp of the last git commit in the GBrain directory
fn get_last_commit_time(dir: &PathBuf) -> Option<u64> {
    use std::process::Command;

    // Run: git -C <dir> log -1 --format=%ct
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .arg("log")
        .arg("-1")
        .arg("--format=%ct")
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let timestamp_str = String::from_utf8_lossy(&output.stdout);
    let timestamp: u64 = timestamp_str.trim().parse().ok()?;

    // Calculate seconds ago
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    Some(now.saturating_sub(timestamp))
}

/// Format a Unix timestamp as a human-readable "time ago" string
fn format_time_ago(timestamp: u64) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let seconds_ago = now.saturating_sub(timestamp);

    if seconds_ago < 60 {
        format!("{} seconds ago", seconds_ago)
    } else if seconds_ago < 3600 {
        format!("{} minutes ago", seconds_ago / 60)
    } else if seconds_ago < 86400 {
        format!("{} hours ago", seconds_ago / 3600)
    } else {
        format!("{} days ago", seconds_ago / 86400)
    }
}

// =============================================================================
// Watch Mode (TUI)
// =============================================================================

/// Run status in watch mode with a live-updating TUI
async fn run_watch_mode(config_path: Option<PathBuf>) -> Result<()> {
    // 1. Setup terminal
    enable_raw_mode()?;
    let mut stdout = std::io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // 2. Main loop with 2-second refresh
    let mut last_refresh = tokio::time::Instant::now();
    let refresh_interval = tokio::time::Duration::from_secs(2);

    let result: Result<()> = loop {
        // Gather current status
        let status = match gather_status(config_path.clone()).await {
            Ok(s) => s,
            Err(e) => {
                // If we can't gather status, show error and exit
                break Err(e);
            }
        };

        // Render TUI
        if let Err(e) = terminal.draw(|f| {
            render_watch_ui(f, &status);
        }) {
            break Err(e.into());
        }

        // Handle keyboard events with timeout
        let timeout = refresh_interval
            .checked_sub(last_refresh.elapsed())
            .unwrap_or(tokio::time::Duration::from_millis(100));

        if crossterm::event::poll(timeout)? {
            if let Event::Key(key) = event::read()? {
                match key.code {
                    KeyCode::Char('q') | KeyCode::Esc => break Ok(()),
                    KeyCode::Char('r') => {
                        // Force immediate refresh
                        last_refresh = tokio::time::Instant::now() - refresh_interval;
                    }
                    _ => {}
                }
            }
        }

        // Auto-refresh every 2 seconds
        if last_refresh.elapsed() >= refresh_interval {
            last_refresh = tokio::time::Instant::now();
        }
    };

    // 3. Cleanup terminal
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    result
}

/// Render the TUI for watch mode
fn render_watch_ui(f: &mut ratatui::Frame, status: &SwarmStatus) {
    // Create layout with 5 sections
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),  // Header
            Constraint::Min(5),     // Services
            Constraint::Length(4),  // Tasks
            Constraint::Length(4),  // GBrain
            Constraint::Length(1),  // Footer
        ])
        .split(f.size());

    // Header: Overall health
    let health_color = match status.health {
        SwarmHealth::Healthy => Color::Green,
        SwarmHealth::Degraded => Color::Yellow,
        SwarmHealth::Down => Color::Red,
    };

    let uptime_str = status
        .uptime_seconds
        .map(format_uptime)
        .unwrap_or_else(|| "unknown".to_string());

    let header_text = format!(
        "Sockt Status: {} | Deployment: {} | Uptime: {}",
        format!("{:?}", status.health).to_uppercase(),
        status.deployment_id,
        uptime_str
    );

    let header = Paragraph::new(header_text)
        .style(
            Style::default()
                .fg(health_color)
                .add_modifier(Modifier::BOLD),
        )
        .block(Block::default().borders(Borders::ALL));
    f.render_widget(header, chunks[0]);

    // Services panel
    let service_items: Vec<ListItem> = status
        .services
        .iter()
        .map(|s| {
            let icon = match s.status {
                ServiceState::Running => "●",
                ServiceState::Crashed => "✖",
                ServiceState::Stopped => "○",
            };
            let color = match s.status {
                ServiceState::Running => Color::Green,
                ServiceState::Crashed => Color::Red,
                ServiceState::Stopped => Color::Gray,
            };

            let pid_str = s.pid.map(|p| format!(" (PID {})", p)).unwrap_or_default();
            let port_str = s.port.map(|p| format!(" :{}", p)).unwrap_or_default();

            ListItem::new(format!("{} {}{}{}", icon, s.name, pid_str, port_str))
                .style(Style::default().fg(color))
        })
        .collect();

    let services = List::new(service_items)
        .block(Block::default().title("Services").borders(Borders::ALL));
    f.render_widget(services, chunks[1]);

    // Tasks panel
    let task_text = if let Some(ref tasks) = status.tasks {
        format!(
            "Pending Approval: {}  |  Running: {}  |  Completed (24h): {}",
            tasks.pending_approval, tasks.running, tasks.completed_24h,
        )
    } else {
        "Tasks: N/A (orchestrator unreachable)".to_string()
    };

    let tasks = Paragraph::new(task_text)
        .block(Block::default().title("Tasks").borders(Borders::ALL));
    f.render_widget(tasks, chunks[2]);

    // GBrain panel
    let gbrain_text = if let Some(ref conn) = status.connections {
        let commit_str = conn
            .gbrain
            .last_commit_seconds_ago
            .map(|s| format_uptime(s))
            .unwrap_or_else(|| "never".to_string());
        format!(
            "Entries: {}  |  Last commit: {}  |  Status: {:?}",
            conn.gbrain.entries, commit_str, conn.gbrain.status
        )
    } else {
        "GBrain: N/A".to_string()
    };

    let gbrain = Paragraph::new(gbrain_text)
        .block(Block::default().title("GBrain").borders(Borders::ALL));
    f.render_widget(gbrain, chunks[3]);

    // Footer: Key hints
    let footer = Paragraph::new(Line::from(vec![
        Span::raw("Press "),
        Span::styled("q", Style::default().add_modifier(Modifier::BOLD)),
        Span::raw(" to quit, "),
        Span::styled("r", Style::default().add_modifier(Modifier::BOLD)),
        Span::raw(" to refresh now"),
    ]));
    f.render_widget(footer, chunks[4]);
}

/// Format seconds as uptime string (e.g., "2h 34m")
fn format_uptime(seconds: u64) -> String {
    if seconds < 60 {
        format!("{}s", seconds)
    } else if seconds < 3600 {
        format!("{}m", seconds / 60)
    } else if seconds < 86400 {
        let hours = seconds / 3600;
        let mins = (seconds % 3600) / 60;
        format!("{}h {}m", hours, mins)
    } else {
        let days = seconds / 86400;
        let hours = (seconds % 86400) / 3600;
        format!("{}d {}h", days, hours)
    }
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
