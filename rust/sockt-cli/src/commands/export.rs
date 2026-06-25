use std::path::PathBuf;

use crate::cli::ExportArgs;

pub async fn run(_args: ExportArgs, _config_path: Option<PathBuf>) -> anyhow::Result<()> {
    println!("sockt export: not yet implemented");
    Ok(())
}
