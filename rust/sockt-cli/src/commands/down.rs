use std::path::PathBuf;
use anyhow::Result;

use crate::cli::{DownArgs, StopArgs};
use super::stop;

pub async fn run(args: DownArgs, config_path: Option<PathBuf>) -> Result<()> {
    eprintln!("Note: `sockt down` is now `sockt stop`");

    let stop_args = StopArgs {
        force: true,
        purge: args.volumes,
        timeout: 30,
    };

    stop::run(stop_args, config_path).await
}
