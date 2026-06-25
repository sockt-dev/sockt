use std::path::PathBuf;

use crate::cli::BrainArgs;

pub async fn run(_args: BrainArgs, _config_path: Option<PathBuf>) -> anyhow::Result<()> {
    println!("sockt brain: not yet implemented");
    Ok(())
}
