use std::path::PathBuf;

use crate::cli::TasksArgs;

pub async fn run(_args: TasksArgs, _config_path: Option<PathBuf>) -> anyhow::Result<()> {
    println!("sockt tasks: not yet implemented");
    Ok(())
}
