mod company;
mod slack;
mod llm;
mod integration;

use crate::cli::{SetupArgs, SetupCommand};
use std::path::PathBuf;

pub async fn run(args: SetupArgs, config_path: Option<PathBuf>) -> anyhow::Result<()> {
    match args.command {
        SetupCommand::Slack(slack_args) => slack::run(slack_args, config_path).await,
        SetupCommand::Company(company_args) => company::run(company_args, config_path).await,
        SetupCommand::Llm(llm_args) => llm::run(llm_args, config_path).await,
        SetupCommand::Integration(integration_args) => integration::run(integration_args, config_path).await,
    }
}
