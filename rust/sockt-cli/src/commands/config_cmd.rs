use std::path::PathBuf;

use crate::cli::ConfigArgs;

pub async fn run(_args: ConfigArgs, _config_path: Option<PathBuf>) -> anyhow::Result<()> {
    println!("sockt config: not yet implemented");
    Ok(())
}
