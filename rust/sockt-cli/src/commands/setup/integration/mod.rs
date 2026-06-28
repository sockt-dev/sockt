mod github;
mod hubspot;
mod linear;
mod sentry;
mod pagerduty;
mod apollo;
mod verify;

use crate::cli::SetupIntegrationArgs;
use std::path::PathBuf;

pub async fn run(args: SetupIntegrationArgs, config_path: Option<PathBuf>) -> anyhow::Result<()> {
    match args.name.to_lowercase().as_str() {
        "github" => github::run(args, config_path).await,
        "hubspot" => hubspot::run(args, config_path).await,
        "linear" => linear::run(args, config_path).await,
        "sentry" => sentry::run(args, config_path).await,
        "pagerduty" => pagerduty::run(args, config_path).await,
        "apollo" => apollo::run(args, config_path).await,
        name => {
            let available = ["github", "hubspot", "linear", "sentry", "pagerduty", "apollo"];
            anyhow::bail!(
                "Unknown integration: '{}'. Available: {}",
                name,
                available.join(", ")
            );
        }
    }
}
