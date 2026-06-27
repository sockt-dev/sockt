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
    /// Start all containers
    Up(UpArgs),
    /// Stop all containers
    Down(DownArgs),
    /// Show deployment status
    Status(StatusArgs),
    /// List and manage tasks
    Tasks(TasksArgs),
    /// Manage GBrain knowledge base
    Brain(BrainArgs),
    /// View/edit configuration
    Config(ConfigArgs),
    /// Connect to a running agent session
    Connect(ConnectArgs),
    /// Upgrade Sockt to latest version
    Upgrade(UpgradeArgs),
    /// Export deployment data
    Export(ExportArgs),
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
pub struct StatusArgs {
    /// Show detailed container info
    #[arg(long)]
    pub detailed: bool,
}

#[derive(Args)]
pub struct TasksArgs {
    #[command(subcommand)]
    pub command: Option<TasksCommand>,
}

#[derive(Subcommand)]
pub enum TasksCommand {
    /// List all tasks
    List,
    /// Show task details
    Show { id: String },
}

#[derive(Args)]
pub struct BrainArgs {
    #[command(subcommand)]
    pub command: Option<BrainCommand>,
}

#[derive(Subcommand)]
pub enum BrainCommand {
    /// Show GBrain status
    Status,
    /// Edit SOUL.md
    EditSoul,
    /// Edit AGENTS.md
    EditAgents,
}

#[derive(Args)]
pub struct ConfigArgs {
    #[command(subcommand)]
    pub command: Option<ConfigCommand>,
}

#[derive(Subcommand)]
pub enum ConfigCommand {
    /// Show current config
    Show,
    /// Set a config value
    Set { key: String, value: String },
    /// Get a config value
    Get { key: String },
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
