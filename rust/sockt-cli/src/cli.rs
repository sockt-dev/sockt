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
    /// Tier: local, cloud, enterprise
    #[arg(short, long)]
    pub tier: Option<Tier>,
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
