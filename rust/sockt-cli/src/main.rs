mod cli;
mod commands;
mod compose;
mod config;
mod crypto;
mod docker;
mod gbrain;
mod socket_mode;
mod tui;
mod upgrade;

use clap::Parser;
use cli::Cli;

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                match cli.verbose {
                    0 => "warn",
                    1 => "info",
                    2 => "debug",
                    _ => "trace",
                }
                .into()
            }),
        )
        .init();

    let runtime = tokio::runtime::Runtime::new()?;
    runtime.block_on(commands::dispatch(cli))
}
