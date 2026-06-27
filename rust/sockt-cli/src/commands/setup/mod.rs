mod company;
mod slack;

use crate::cli::{SetupArgs, SetupCommand};
use std::path::PathBuf;

pub async fn run(args: SetupArgs, config_path: Option<PathBuf>) -> anyhow::Result<()> {
    match args.command {
        SetupCommand::Slack(slack_args) => slack::run(slack_args, config_path).await,
        SetupCommand::Company(company_args) => company::run(company_args, config_path).await,
    }
}
