use crate::cli::UpgradeArgs;
use crate::upgrade::{ReleaseInfo, UpgradeError};
use anyhow::{Context, Result};
use reqwest::Client;
use serde::Deserialize;
use std::time::Duration;

const DEFAULT_RELEASE_URL: &str = "https://api.github.com/repos/sockt/sockt/releases";

#[derive(Deserialize, Debug)]
struct GithubRelease {
    tag_name: String,
    published_at: String,
    body: String,
    assets: Vec<GithubAsset>,
}

#[derive(Deserialize, Debug)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

pub async fn run(args: UpgradeArgs) -> Result<()> {
    let current_version = env!("CARGO_PKG_VERSION");
    let platform = detect_platform();

    // Step 1: Check for updates
    let release = check_latest_version(&args.channel).await?;

    // Extract version from tag (remove 'v' prefix if present)
    let latest_version = release.tag_name.trim_start_matches('v');

    // Step 2: --check mode (early exit)
    if args.check {
        print_version_comparison(current_version, latest_version, &release.published_at);
        if latest_version != current_version {
            println!("\n  Update available. Run `sockt upgrade` to install.\n");
        } else {
            println!("\n  You're up to date. ✓\n");
        }
        return Ok(());
    }

    // Step 3: Already up to date check
    if latest_version == current_version && !args.force {
        println!("\n  You're up to date. ✓\n");
        return Ok(());
    }

    // TODO: Implement full upgrade flow (download, verify, install)
    println!("Full upgrade not yet implemented");
    Ok(())
}

fn detect_platform() -> String {
    let os = if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "unknown"
    };

    let arch = if cfg!(target_arch = "x86_64") {
        "amd64"
    } else if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "unknown"
    };

    format!("{}-{}", os, arch)
}

async fn check_latest_version(channel: &str) -> Result<GithubRelease> {
    let base_url = std::env::var("SOCKT_RELEASE_URL")
        .unwrap_or_else(|_| format!("{}/latest", DEFAULT_RELEASE_URL));

    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("sockt-cli")
        .build()
        .context("Failed to create HTTP client")?;

    let response = client
        .get(&base_url)
        .send()
        .await
        .context("Cannot reach release server. Check network and try again.")?;

    if !response.status().is_success() {
        anyhow::bail!("Failed to fetch release info: HTTP {}", response.status());
    }

    let release: GithubRelease = response
        .json()
        .await
        .context("Failed to parse release information")?;

    Ok(release)
}

fn print_version_comparison(current: &str, latest: &str, published_at: &str) {
    println!("\n  Current: v{}", current);
    println!(
        "  Latest:  v{} (released {})",
        latest,
        format_relative_time(published_at)
    );
}

fn format_relative_time(timestamp: &str) -> String {
    use chrono::{DateTime, Utc};

    let parsed = DateTime::parse_from_rfc3339(timestamp);
    if let Ok(dt) = parsed {
        let now = Utc::now();
        let duration = now.signed_duration_since(dt.with_timezone(&Utc));

        if duration.num_days() > 0 {
            let days = duration.num_days();
            if days == 1 {
                "1 day ago".to_string()
            } else {
                format!("{} days ago", days)
            }
        } else if duration.num_hours() > 0 {
            let hours = duration.num_hours();
            if hours == 1 {
                "1 hour ago".to_string()
            } else {
                format!("{} hours ago", hours)
            }
        } else {
            "just now".to_string()
        }
    } else {
        "recently".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_platform() {
        let platform = detect_platform();
        assert!(
            platform.contains("linux") || platform.contains("darwin"),
            "Platform should contain OS: {}",
            platform
        );
        assert!(
            platform.contains("amd64") || platform.contains("arm64"),
            "Platform should contain arch: {}",
            platform
        );
    }

    #[test]
    fn test_format_relative_time() {
        // Test with a known timestamp (2 days ago from 2024-06-28)
        let timestamp = "2024-06-26T10:00:00Z";
        let result = format_relative_time(timestamp);
        assert!(result.contains("day") || result.contains("hour"));
    }

    #[test]
    fn test_format_relative_time_invalid() {
        let result = format_relative_time("invalid");
        assert_eq!(result, "recently");
    }
}
