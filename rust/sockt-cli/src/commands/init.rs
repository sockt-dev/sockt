use std::path::PathBuf;

use crate::cli::InitArgs;

pub async fn run(args: InitArgs, _config_path: Option<PathBuf>) -> anyhow::Result<()> {
    let dir = args.dir.unwrap_or_else(|| PathBuf::from("."));
    tracing::info!(?dir, "Initializing Sockt deployment");
    println!("sockt init: not yet implemented");
    Ok(())
}
