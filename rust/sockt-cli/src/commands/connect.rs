use std::path::PathBuf;

use crate::cli::ConnectArgs;

pub async fn run(_args: ConnectArgs, _config_path: Option<PathBuf>) -> anyhow::Result<()> {
    println!("sockt connect: not yet implemented");
    Ok(())
}
