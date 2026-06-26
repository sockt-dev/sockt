mod brain;
mod config_cmd;
mod connect;
mod down;
mod export;
mod init;
pub(crate) mod slack_setup;
mod status;
mod tasks;
mod up;
mod upgrade_cmd;

use crate::cli::{Cli, Command};

pub async fn dispatch(cli: Cli) -> anyhow::Result<()> {
    match cli.command {
        Command::Init(args) => init::run(args, cli.config).await,
        Command::Up(args) => up::run(args, cli.config).await,
        Command::Down(args) => down::run(args, cli.config).await,
        Command::Status(args) => status::run(args, cli.config).await,
        Command::Tasks(args) => tasks::run(args, cli.config).await,
        Command::Brain(args) => brain::run(args, cli.config).await,
        Command::Config(args) => config_cmd::run(args, cli.config).await,
        Command::Connect(args) => connect::run(args, cli.config).await,
        Command::Upgrade(args) => upgrade_cmd::run(args).await,
        Command::Export(args) => export::run(args, cli.config).await,
    }
}
