use std::path::PathBuf;

use anyhow::Context;

use crate::cli::SetupIntegrationArgs;
use crate::config::loader::ConfigLoader;
use crate::config::GitHubConfig;
use crate::crypto::{self, KeyManager};
use crate::tui::llm_verify;
use crate::tui::password_input::PasswordInput;

use super::verify;

pub async fn run(args: SetupIntegrationArgs, config_path: Option<PathBuf>) -> anyhow::Result<()> {
    let config_loader = ConfigLoader::from_default_or_override(config_path);

    if !config_loader.path().exists() {
        anyhow::bail!(
            "Config not found at {}. Run `sockt init` first.",
            config_loader.path().display()
        );
    }

    let mut config = config_loader
        .load()
        .context("Failed to load existing config")?;

    // Check if already configured
    if !args.non_interactive && config.integrations.github.is_some() {
        println!();
        println!("  GitHub is already configured.");
        println!();

        let reconfigure = dialoguer::Confirm::new()
            .with_prompt("  Reconfigure?")
            .default(false)
            .interact()
            .map_err(|_| anyhow::anyhow!("Setup cancelled."))?;

        if !reconfigure {
            println!();
            println!("  GitHub configuration unchanged.");
            println!();
            return Ok(());
        }
    }

    let github_info = if args.non_interactive {
        collect_non_interactive(&args)?
    } else {
        collect_interactive(&args).await?
    };

    // Verify token
    if !args.non_interactive {
        print!("  Verifying GitHub token... ");
        std::io::Write::flush(&mut std::io::stdout()).ok();

        match verify::verify_github(&github_info.token).await {
            Ok(_) => println!("✓"),
            Err(e) => {
                println!("✗");
                llm_verify::print_error(&format!("Verification failed: {}", e));

                let continue_anyway = dialoguer::Confirm::new()
                    .with_prompt("  Continue without verification? (not recommended)")
                    .default(false)
                    .interact()
                    .unwrap_or(false);

                if !continue_anyway {
                    anyhow::bail!("Setup cancelled.");
                }
            }
        }
    }

    // Load encryption key
    let key_manager = KeyManager::new(KeyManager::default_path());
    let identity = key_manager
        .load()
        .context("Failed to load encryption key. Run `sockt init` first.")?;
    let recipient = identity.to_public();

    // Encrypt token
    let encrypted_token = crypto::encrypt(&github_info.token, &recipient)
        .context("Encrypting GitHub token")?;

    // Update config
    config.integrations.github = Some(GitHubConfig {
        token: encrypted_token,
        organization: github_info.organization,
        repositories: github_info.repositories,
    });

    config_loader
        .save(&config)
        .context("Failed to save config")?;

    println!();
    println!("  ✓ GitHub integration configured");
    println!();

    Ok(())
}

struct GitHubInfo {
    token: String,
    organization: Option<String>,
    repositories: Vec<String>,
}

fn collect_non_interactive(args: &SetupIntegrationArgs) -> anyhow::Result<GitHubInfo> {
    let token = args
        .token
        .clone()
        .or_else(|| args.api_key.clone())
        .or_else(|| std::env::var("SOCKT_GITHUB_TOKEN").ok())
        .ok_or_else(|| anyhow::anyhow!("--token required for GitHub in non-interactive mode"))?;

    let organization = args.org_id.clone();

    let repositories = args
        .repositories
        .as_ref()
        .map(|r| r.split(',').map(|s| s.trim().to_string()).collect())
        .unwrap_or_default();

    Ok(GitHubInfo {
        token,
        organization,
        repositories,
    })
}

async fn collect_interactive(args: &SetupIntegrationArgs) -> anyhow::Result<GitHubInfo> {
    println!();
    llm_verify::print_header("GitHub Integration");
    println!();

    llm_verify::print_hint("Create a Personal Access Token at:");
    llm_verify::print_hint("https://github.com/settings/tokens/new");
    llm_verify::print_hint("Required scopes: repo, read:org");
    println!();

    let open_browser = dialoguer::Confirm::new()
        .with_prompt("  Open GitHub token creation page?")
        .default(true)
        .interact()
        .map_err(|_| anyhow::anyhow!("Setup cancelled."))?;

    if open_browser {
        let _ = open::that("https://github.com/settings/tokens/new?scopes=repo,read:org&description=Sockt+Integration");
    }

    let token = PasswordInput::new("  GitHub Personal Access Token: ")
        .allow_empty(false)
        .interact()
        .map_err(|_| anyhow::anyhow!("Setup cancelled."))?;

    let organization = dialoguer::Input::<String>::new()
        .with_prompt("  Organization (optional)")
        .allow_empty(true)
        .interact()
        .ok()
        .filter(|s: &String| !s.is_empty());

    let repositories_input = dialoguer::Input::<String>::new()
        .with_prompt("  Repositories to monitor (comma-separated, optional)")
        .allow_empty(true)
        .interact()
        .ok()
        .unwrap_or_default();

    let repositories = if repositories_input.is_empty() {
        vec![]
    } else {
        repositories_input
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    };

    Ok(GitHubInfo {
        token,
        organization,
        repositories,
    })
}
