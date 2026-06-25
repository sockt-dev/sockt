use std::path::PathBuf;

use crate::cli::DownArgs;

pub async fn run(_args: DownArgs, _config_path: Option<PathBuf>) -> anyhow::Result<()> {
    println!("sockt down: not yet implemented");
    Ok(())
}
