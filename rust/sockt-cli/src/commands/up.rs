use std::path::PathBuf;

use crate::cli::UpArgs;

pub async fn run(_args: UpArgs, _config_path: Option<PathBuf>) -> anyhow::Result<()> {
    println!("sockt up: not yet implemented");
    Ok(())
}
