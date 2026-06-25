use std::path::PathBuf;

use crate::cli::StatusArgs;

pub async fn run(_args: StatusArgs, _config_path: Option<PathBuf>) -> anyhow::Result<()> {
    println!("sockt status: not yet implemented");
    Ok(())
}
