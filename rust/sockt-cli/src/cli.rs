use clap::{Args, Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "sockt", version, about = "AI Operations Agent")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,

    /// Config file path (default: ~/.sockt/config.yaml)
    #[arg(long, global = true)]
    pub config: Option<PathBuf>,

    /// Verbosity level
    #[arg(short, long, action = clap::ArgAction::Count, global = true)]
    pub verbose: u8,
}

#[derive(Subcommand)]
pub enum Command {
    /// Initialize a new Sockt deployment (interactive wizard)
    Init(InitArgs),
    /// Configure Slack, company info, and other settings
    Setup(SetupArgs),
    /// Deploy the agent swarm (start all services)
    Deploy(DeployArgs),
    /// Start all containers (DEPRECATED: use `sockt deploy`)
    #[command(hide = true)]
    Up(DeployArgs),
    /// Stop all containers (DEPRECATED: use `sockt stop`)
    #[command(hide = true)]
    Down(DownArgs),
    /// Stop the swarm (graceful shutdown)
    Stop(StopArgs),
    /// Restart one or all services (stop + re-deploy)
    Restart(RestartArgs),
    /// Show deployment status
    Status(StatusArgs),
    /// List and manage tasks
    Tasks(TasksArgs),
    /// Manage GBrain knowledge base
    Brain(BrainArgs),
    /// Manage agent departments
    Department(DepartmentArgs),
    /// View/edit configuration
    Config(ConfigArgs),
    /// Connect to a running agent session
    Connect(ConnectArgs),
    /// Upgrade Sockt to latest version
    Upgrade(UpgradeArgs),
    /// Export deployment data
    Export(ExportArgs),
    /// Manage encrypted secrets
    Secrets(SecretsArgs),
    /// View agent logs
    Logs(LogsArgs),
    /// Runtime health diagnostics
    Health(HealthArgs),
    /// Pre-flight environment check
    Doctor(DoctorArgs),
    /// Send an instruction to your agent swarm
    Ask(AskArgs),
}

#[derive(Args)]
pub struct InitArgs {
    /// Skip interactive wizard (use defaults)
    #[arg(long)]
    pub non_interactive: bool,
    /// Target directory (default: current dir)
    #[arg(short, long)]
    pub dir: Option<PathBuf>,
    /// Overwrite existing config without prompting
    #[arg(long)]
    pub force: bool,
    /// LLM provider: anthropic|openai|bedrock|custom
    #[arg(long)]
    pub provider: Option<String>,
    /// API key (or env: SOCKT_API_KEY)
    #[arg(long)]
    pub api_key: Option<String>,
    /// Single model ID (auto-splits to frontier+fast)
    #[arg(long)]
    pub model: Option<String>,
    /// Frontier model override
    #[arg(long)]
    pub frontier: Option<String>,
    /// Fast model override
    #[arg(long)]
    pub fast: Option<String>,
    /// Custom endpoint URL (for custom provider)
    #[arg(long)]
    pub base_url: Option<String>,
    /// Don't test LLM connectivity
    #[arg(long)]
    pub skip_verify: bool,
}

#[derive(Args)]
pub struct DeployArgs {
    /// Run in background (default behavior)
    #[arg(short, long, conflicts_with = "watch")]
    pub detach: bool,

    /// Stay attached and stream logs
    #[arg(short, long, conflicts_with = "detach")]
    pub watch: bool,

    /// Only deploy services for a specific department
    #[arg(long)]
    pub department: Option<String>,

    /// Max seconds to wait for services to become healthy
    #[arg(long, default_value = "60")]
    pub timeout: u64,

    /// Show what would be deployed without starting services
    #[arg(long)]
    pub dry_run: bool,
}

#[derive(Args)]
pub struct UpArgs {
    /// Detach (run in background)
    #[arg(short, long)]
    pub detach: bool,
}

#[derive(Args)]
pub struct DownArgs {
    /// Remove volumes
    #[arg(long)]
    pub volumes: bool,
}

#[derive(Args)]
pub struct StopArgs {
    /// Kill immediately (SIGKILL, don't wait for graceful shutdown)
    #[arg(long)]
    pub force: bool,

    /// Remove runtime state and scratch data after stopping
    #[arg(long)]
    pub purge: bool,

    /// Max seconds to wait for graceful shutdown
    #[arg(long, default_value = "30")]
    pub timeout: u64,
}

#[derive(Args)]
pub struct RestartArgs {
    /// Agent to restart (omit for all). Accepts human names (e.g. "lead-researcher") or service names.
    pub agent: Option<String>,

    /// Full stop + start (SIGKILL, guarantees clean state)
    #[arg(long)]
    pub hard: bool,

    /// Max seconds to wait for healthy state
    #[arg(long, default_value = "60")]
    pub timeout: u64,
}

#[derive(Args)]
pub struct StatusArgs {
    /// Show detailed info (PIDs, ports, uptime)
    #[arg(long, short)]
    pub detailed: bool,

    /// Continuous refresh (TUI mode, 2s interval)
    #[arg(long, short)]
    pub watch: bool,

    /// Machine-readable JSON output
    #[arg(long)]
    pub json: bool,

    /// Just exit code: 0=healthy, 1=degraded, 2=down
    #[arg(long, short)]
    pub quiet: bool,
}

#[derive(Args)]
pub struct TasksArgs {
    #[command(subcommand)]
    pub command: Option<TasksCommand>,
}

#[derive(Subcommand)]
pub enum TasksCommand {
    /// List all tasks (default)
    List(ListArgs),
    /// Show task details
    Show {
        id: String,
        #[arg(long)]
        json: bool,
    },
    /// Approve a pending HITL action
    Approve {
        id: String,
        #[arg(long)]
        comment: Option<String>,
        #[arg(long)]
        edit: bool,
    },
    /// Reject a pending action
    Reject {
        id: String,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Cancel a running task
    Cancel {
        id: String,
        #[arg(long)]
        confirm: bool,
    },
    /// Retry a failed/escalated task
    Retry {
        id: String,
        #[arg(long)]
        priority: Option<String>,
    },
}

#[derive(Args)]
pub struct ListArgs {
    /// Filter by status (pending|running|completed|failed|escalated|approval)
    #[arg(long)]
    pub status: Option<String>,
    /// Filter by agent name
    #[arg(long)]
    pub agent: Option<String>,
    /// Time filter (e.g. "1h", "24h", "7d")
    #[arg(long)]
    pub since: Option<String>,
    /// Maximum results to return
    #[arg(long, default_value = "20")]
    pub limit: usize,
    /// Include completed tasks (omitted by default)
    #[arg(long)]
    pub all: bool,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Args)]
pub struct BrainArgs {
    #[command(subcommand)]
    pub command: Option<BrainCommand>,
}

#[derive(Subcommand)]
pub enum BrainCommand {
    /// Full-text search across GBrain
    Search {
        /// Search query
        query: String,
        /// Limit to matching files (e.g. "skills/*")
        #[arg(long)]
        file: Option<String>,
        /// Lines of context around match
        #[arg(long, default_value = "2")]
        context: usize,
        /// Max results
        #[arg(long, default_value = "10")]
        limit: usize,
    },
    /// Git commit history of GBrain
    Log {
        /// Filter by commit author (agent name)
        #[arg(long)]
        agent: Option<String>,
        /// Time filter (e.g. "1d", "2h")
        #[arg(long)]
        since: Option<String>,
        /// Max commits
        #[arg(long, default_value = "20")]
        limit: usize,
        /// Compact one-line-per-commit format
        #[arg(long)]
        oneline: bool,
    },
    /// Display a GBrain file with syntax highlighting
    Show {
        /// File path relative to GBrain root
        file: String,
        /// No highlighting, raw content
        #[arg(long)]
        raw: bool,
        /// Show specific lines (e.g. "10-30")
        #[arg(long)]
        line: Option<String>,
    },
    /// Open file in $EDITOR
    Edit {
        /// File path relative to GBrain root
        file: String,
    },
    /// Show recent changes (git diff)
    Diff {
        /// Compare point — commit hash or duration (default: "1d")
        #[arg(long, default_value = "1d")]
        since: String,
        /// File-level summary only
        #[arg(long)]
        stat: bool,
    },
    /// Skill management
    Skills {
        #[command(subcommand)]
        command: Option<SkillsCommand>,
    },
}

#[derive(Subcommand)]
pub enum SkillsCommand {
    /// List all skills with status
    List,
    /// Display skill file content
    Show {
        /// Skill name
        name: String,
    },
    /// Move pending-review skill to production
    Approve {
        /// Skill name
        name: String,
    },
    /// Delete a pending skill
    Reject {
        /// Skill name
        name: String,
    },
}

#[derive(Args)]
pub struct ConfigArgs {
    #[command(subcommand)]
    pub command: Option<ConfigCommand>,
}

#[derive(Subcommand)]
pub enum ConfigCommand {
    /// Show current config (default)
    Show {
        /// Show decrypted secret values (prompts confirmation)
        #[arg(long)]
        reveal: bool,
        /// JSON output
        #[arg(long)]
        json: bool,
        /// Raw YAML file content
        #[arg(long)]
        raw: bool,
    },
    /// Set a config value using dot-notation
    Set {
        key: String,
        value: String
    },
    /// Get a specific value
    Get {
        key: String,
        /// Decrypt if it's a secret
        #[arg(long)]
        reveal: bool,
    },
    /// Reset a key to its default value
    Reset {
        key: String
    },
    /// Print the config file path
    Path,
}

#[derive(Args)]
pub struct ConnectArgs {
    /// Agent role to connect to
    pub role: Option<String>,
}

#[derive(Args)]
pub struct UpgradeArgs {
    /// Check for updates without installing
    #[arg(long)]
    pub check: bool,
}

#[derive(Args)]
pub struct ExportArgs {
    /// Output file path
    #[arg(short, long)]
    pub output: Option<PathBuf>,
}

#[derive(Clone, Debug, PartialEq, Eq, ValueEnum, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Local,
    Cloud,
    Enterprise,
}

#[derive(Args)]
pub struct SetupArgs {
    #[command(subcommand)]
    pub command: SetupCommand,
}

#[derive(Subcommand)]
pub enum SetupCommand {
    /// Configure Slack integration
    Slack(SetupSlackArgs),
    /// Configure company context
    Company(SetupCompanyArgs),
    /// Reconfigure LLM provider and models
    Llm(SetupLlmArgs),
    /// Add or reconfigure third-party integrations
    Integration(SetupIntegrationArgs),
}

#[derive(Args)]
pub struct SetupSlackArgs {
    /// Skip interactive prompts (use flags/env vars)
    #[arg(long)]
    pub non_interactive: bool,
    /// Slack App Token (xapp-...)
    #[arg(long)]
    pub app_token: Option<String>,
    /// Slack Bot Token (xoxb-...)
    #[arg(long)]
    pub bot_token: Option<String>,
    /// Slack Signing Secret
    #[arg(long)]
    pub signing_secret: Option<String>,
}

#[derive(Args)]
pub struct SetupCompanyArgs {
    /// Skip interactive prompts (use flags)
    #[arg(long)]
    pub non_interactive: bool,
    /// Company name
    #[arg(long)]
    pub name: Option<String>,
    /// Industry
    #[arg(long)]
    pub industry: Option<String>,
    /// Team size (e.g., "1-10", "11-50")
    #[arg(long)]
    pub team_size: Option<String>,
    /// Primary use case
    #[arg(long)]
    pub use_case: Option<String>,
    /// Communication tone (professional|casual|friendly|technical)
    #[arg(long)]
    pub tone: Option<String>,
    /// Approval threshold (conservative|balanced|permissive)
    #[arg(long)]
    pub approval: Option<String>,
}

#[derive(Args)]
pub struct SetupLlmArgs {
    /// Skip interactive prompts (use flags/env vars)
    #[arg(long)]
    pub non_interactive: bool,
    /// LLM provider: anthropic|openai|bedrock|custom
    #[arg(long)]
    pub provider: Option<String>,
    /// API key (or env: SOCKT_API_KEY)
    #[arg(long)]
    pub api_key: Option<String>,
    /// Single model ID (auto-splits to frontier+fast)
    #[arg(long)]
    pub model: Option<String>,
    /// Frontier model override
    #[arg(long)]
    pub frontier: Option<String>,
    /// Fast model override
    #[arg(long)]
    pub fast: Option<String>,
    /// Custom endpoint URL (for custom provider)
    #[arg(long)]
    pub base_url: Option<String>,
    /// AWS region (for Bedrock)
    #[arg(long)]
    pub aws_region: Option<String>,
    /// Don't test LLM connectivity
    #[arg(long)]
    pub skip_verify: bool,
}

#[derive(Args)]
pub struct SetupIntegrationArgs {
    /// Integration name: github|hubspot|linear|sentry|pagerduty|apollo
    pub name: String,
    /// Skip interactive prompts
    #[arg(long)]
    pub non_interactive: bool,
    /// API token/key (or env: SOCKT_<INTEGRATION>_TOKEN)
    #[arg(long)]
    pub token: Option<String>,
    /// API key (alternative to token for some services)
    #[arg(long)]
    pub api_key: Option<String>,
    /// Organization/Portal/Team ID
    #[arg(long)]
    pub org_id: Option<String>,
    /// Sentry DSN (for Sentry integration)
    #[arg(long)]
    pub dsn: Option<String>,
    /// Comma-separated repository list (for GitHub)
    #[arg(long)]
    pub repositories: Option<String>,
    /// Comma-separated service IDs (for PagerDuty)
    #[arg(long)]
    pub services: Option<String>,
}

#[derive(Args)]
pub struct SecretsArgs {
    #[command(subcommand)]
    pub command: SecretsCommand,
}

#[derive(Subcommand)]
pub enum SecretsCommand {
    /// List stored secret names and metadata
    List,
    /// Encrypt and store a secret
    Set {
        /// Secret name (e.g., anthropic_api_key)
        name: String,
        /// Secret value
        value: String,
    },
    /// Re-encrypt all secrets with a fresh key
    Rotate {
        /// Skip confirmation prompt
        #[arg(long)]
        confirm: bool,
    },
    /// Export secrets in encrypted format
    Export {
        /// Output file path (default: stdout)
        #[arg(short, long)]
        output: Option<PathBuf>,
    },
}

#[derive(Args)]
pub struct HealthArgs {
    /// Machine-readable JSON output
    #[arg(long)]
    pub json: bool,

    /// Attempt auto-repair of common issues
    #[arg(long)]
    pub fix: bool,
}

#[derive(Args)]
pub struct DoctorArgs {
    /// Machine-readable JSON output
    #[arg(long)]
    pub json: bool,
}

#[derive(Args)]
pub struct AskArgs {
    /// The instruction to send to the swarm
    pub message: String,

    /// Direct to a specific agent (default: auto-route)
    #[arg(long)]
    pub agent: Option<String>,

    /// Task priority
    #[arg(long, value_enum, default_value = "normal")]
    pub priority: Priority,

    /// Block until task completes and show output
    #[arg(long, short)]
    pub wait: bool,

    /// Max seconds to wait (only applies with --wait)
    #[arg(long, default_value = "300")]
    pub timeout: u64,

    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, ValueEnum)]
pub enum Priority {
    Low,
    Normal,
    High,
}

impl std::fmt::Display for Priority {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Low => write!(f, "low"),
            Self::Normal => write!(f, "normal"),
            Self::High => write!(f, "high"),
        }
    }
}

#[derive(Args)]
pub struct LogsArgs {
    /// Agent name to filter (optional, shows all if omitted)
    pub agent: Option<String>,

    /// Stream continuously (tail -f style)
    #[arg(short, long)]
    pub follow: bool,

    /// Last N entries to show (default: 50)
    #[arg(long, default_value = "50")]
    pub tail: usize,

    /// Filter by time (e.g., "1h", "30m", "2d")
    #[arg(long)]
    pub since: Option<String>,

    /// Filter by level: debug|info|warn|error
    #[arg(long)]
    pub level: Option<String>,

    /// Output raw JSON events (for piping to jq)
    #[arg(long)]
    pub json: bool,

    /// Disable color output
    #[arg(long)]
    pub no_color: bool,

    /// Show raw logs (fallback/debug mode)
    #[arg(long)]
    pub raw: bool,
}

#[derive(Args)]
pub struct DepartmentArgs {
    #[command(subcommand)]
    pub command: Option<DepartmentCommand>,
}

#[derive(Subcommand)]
pub enum DepartmentCommand {
    /// List all available department templates
    List {
        /// Only show templates not yet deployed
        #[arg(long)]
        available: bool,
    },
    /// Add a department to your deployment
    Add {
        name: String,
        /// Use defaults (no integration prompts)
        #[arg(long)]
        non_interactive: bool,
    },
    /// Remove a department
    Remove {
        name: String,
        /// Skip confirmation prompt
        #[arg(long)]
        confirm: bool,
        /// Preserve GBrain data from this department
        #[arg(long, default_value_t = true, action = clap::ArgAction::Set)]
        keep_data: bool,
    },
    /// Detailed department view
    Info {
        name: String,
        /// JSON output
        #[arg(long)]
        json: bool,
    },
}
