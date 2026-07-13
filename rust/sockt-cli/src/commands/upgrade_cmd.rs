use crate::cli::UpgradeArgs;
use crate::upgrade::UpgradeManager;
use anyhow::{Context, Result};
use dialoguer::Confirm;
use indicatif::{ProgressBar, ProgressStyle};
use reqwest::Client;
use serde::Deserialize;
use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;

const DEFAULT_RELEASE_URL: &str = "https://api.github.com/repos/sockt-dev/sockt/releases";

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
        print_changelog(&release.body);
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

    // Step 4: Show what's new
    print_version_comparison(current_version, latest_version, &release.published_at);
    print_changelog(&release.body);

    // Step 5: Beta warning
    if args.channel == "beta" {
        println!("\n  ⚠ Beta releases may have bugs. Not recommended for production.\n");
    }

    // Step 6: Confirmation
    if !args.yes && !confirm_upgrade(latest_version)? {
        println!("\n  Cancelled.\n");
        return Ok(());
    }

    // Step 7: Find platform asset
    let asset_name = format!("sockt-v{}-{}.tar.gz", latest_version, platform);
    let asset = release
        .assets
        .iter()
        .find(|a| a.name == asset_name)
        .ok_or_else(|| {
            anyhow::anyhow!(
                "No release available for {}. Build from source: cargo install sockt-cli",
                platform
            )
        })?;

    // Step 8: Download binary
    println!();
    let temp_binary = download_binary(&asset.browser_download_url, &asset_name).await?;

    // Step 9: Checksum verification
    if let Some(checksums_asset) = release.assets.iter().find(|a| a.name == "SHA256SUMS") {
        let checksums = download_checksums(&checksums_asset.browser_download_url).await?;
        if let Some(expected) = checksums.get(&asset_name) {
            print!("\n  Verifying SHA-256 checksum... ");
            UpgradeManager::verify_checksum(&temp_binary, expected)?;
            println!("✓ (matches)");
        }
    }

    // Step 10: Atomic replacement
    print!("  Replacing binary... ");
    let current_binary = std::env::current_exe()?;
    UpgradeManager::replace_binary(&current_binary, &temp_binary).map_err(|e| {
        if e.to_string().contains("Permission denied")
            || e.to_string().contains("permission")
        {
            anyhow::anyhow!(
                "Cannot write to {}. Try: sudo sockt upgrade",
                current_binary.display()
            )
        } else {
            e.into()
        }
    })?;
    println!("✓ (atomic rename)");

    // Step 11: Set executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o755);
        std::fs::set_permissions(&current_binary, perms)?;
    }

    // Step 12: Cleanup
    std::fs::remove_file(&temp_binary).ok();

    // Step 13: Success
    println!("\n  ✓ Upgraded to v{}\n", latest_version);
    println!("  Also recommended:");
    println!("    sockt restart --pull     Update container images to match CLI version\n");

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

fn print_changelog(body: &str) {
    let bullets = extract_changelog(body);
    if !bullets.is_empty() {
        println!("\n  What's new:");
        for bullet in bullets.iter().take(5) {
            println!("    • {}", bullet);
        }
    }
}

fn extract_changelog(body: &str) -> Vec<String> {
    body.lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.starts_with("- ") {
                Some(trimmed[2..].to_string())
            } else if trimmed.starts_with("* ") {
                Some(trimmed[2..].to_string())
            } else {
                None
            }
        })
        .collect()
}

fn confirm_upgrade(version: &str) -> Result<bool> {
    Confirm::new()
        .with_prompt(format!("Install v{}?", version))
        .default(true)
        .interact()
        .context("Failed to get confirmation")
}

async fn download_binary(url: &str, filename: &str) -> Result<PathBuf> {
    let client = Client::builder()
        .timeout(Duration::from_secs(300))
        .user_agent("sockt-cli")
        .build()?;

    println!("  Downloading {}...", filename);

    let response = client.get(url).send().await?;
    let total_size = response.content_length().unwrap_or(0);

    let pb = if total_size > 0 {
        let pb = ProgressBar::new(total_size);
        pb.set_style(
            ProgressStyle::default_bar()
                .template("  [{bar:40}] {bytes}/{total_bytes} ({eta})")
                .unwrap()
                .progress_chars("█▓▒░ "),
        );
        Some(pb)
    } else {
        None
    };

    let temp_dir = std::env::temp_dir();
    let temp_file = temp_dir.join(format!("sockt-upgrade-{}", filename));
    let mut file = File::create(&temp_file)?;

    let mut downloaded = 0u64;
    let mut stream = response.bytes_stream();

    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        file.write_all(&chunk)?;
        downloaded += chunk.len() as u64;
        if let Some(pb) = &pb {
            pb.set_position(downloaded);
        }
    }

    if let Some(pb) = pb {
        pb.finish_and_clear();
    }

    // Extract tarball
    println!("  Extracting...");
    let tar_gz = File::open(&temp_file)?;
    let tar = flate2::read::GzDecoder::new(tar_gz);
    let mut archive = tar::Archive::new(tar);

    let extract_dir = temp_dir.join("sockt-upgrade-extract");
    std::fs::create_dir_all(&extract_dir)?;
    archive.unpack(&extract_dir)?;

    // Find the binary in extracted files
    let binary_path = extract_dir.join("sockt");
    if !binary_path.exists() {
        anyhow::bail!("Binary not found in archive");
    }

    // Clean up tarball
    std::fs::remove_file(&temp_file).ok();

    Ok(binary_path)
}

async fn download_checksums(url: &str) -> Result<HashMap<String, String>> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("sockt-cli")
        .build()?;

    let response = client.get(url).send().await?;
    let text = response.text().await?;

    let mut checksums = HashMap::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            let checksum = parts[0];
            let filename = parts[1];
            checksums.insert(filename.to_string(), checksum.to_string());
        }
    }

    Ok(checksums)
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

    #[test]
    fn test_extract_changelog() {
        let body = "## What's new\n- Feature X\n- Fix Y\n* Another item";
        let bullets = extract_changelog(body);
        assert_eq!(bullets.len(), 3);
        assert_eq!(bullets[0], "Feature X");
        assert_eq!(bullets[1], "Fix Y");
        assert_eq!(bullets[2], "Another item");
    }

    #[test]
    fn test_extract_changelog_empty() {
        let bullets = extract_changelog("");
        assert!(bullets.is_empty());
    }

    #[test]
    fn test_extract_changelog_no_bullets() {
        let body = "## What's new\nSome text without bullets";
        let bullets = extract_changelog(body);
        assert!(bullets.is_empty());
    }
}
