use std::fs::{self, File};
use std::path::{Path, PathBuf};
use anyhow::{bail, Context, Result};
use flate2::write::GzEncoder;
use flate2::Compression;
use fs2::statvfs;
use glob::Pattern;
use serde::{Deserialize, Serialize};
use tar::Builder;

use crate::cli::ExportArgs;
use crate::config::loader::ConfigLoader;

#[derive(Serialize, Deserialize)]
struct ExportManifest {
    files: Vec<FileEntry>,
    total_files: usize,
    total_size_bytes: u64,
    git_commits: Option<usize>,
    excluded: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct FileEntry {
    path: String,
    size: u64,
    last_modified: String,
}

pub async fn run(args: ExportArgs, config_path: Option<PathBuf>) -> Result<()> {
    if args.format != "tar.gz" && args.format != "zip" {
        bail!(
            "Unsupported format: {}. Use tar.gz or zip.",
            args.format
        );
    }

    let loader = ConfigLoader::from_default_or_override(config_path.clone());
    let gbrain_dir = resolve_gbrain_dir(config_path)?;
    ensure_gbrain_exists(&gbrain_dir)?;
    validate_core_files(&gbrain_dir)?;

    check_git_status(&gbrain_dir)?;

    let manifest = collect_files(&gbrain_dir, &loader, &args)?;

    if args.json {
        let json = serde_json::to_string_pretty(&manifest)?;
        println!("{}", json);
        return Ok(());
    }

    let output = args
        .output
        .clone()
        .unwrap_or_else(|| default_output_path());
    validate_output_path(&output)?;

    let estimated_size = estimate_archive_size(manifest.total_size_bytes);
    check_disk_space(&output, estimated_size)?;

    print_export_summary(&manifest, &args);

    if args.format == "tar.gz" {
        create_tar_gz(&output, &gbrain_dir, &manifest, &loader, &args)?;
    } else {
        bail!("zip format not yet implemented");
    }

    println!("\n  ✓ Exported to {}", output.display());
    print_export_info(&args);

    Ok(())
}

fn resolve_gbrain_dir(config_path: Option<PathBuf>) -> Result<PathBuf> {
    let loader = ConfigLoader::from_default_or_override(config_path);
    let config = loader.load().context("Failed to load config")?;
    let dir = config.gbrain.directory;
    if dir.is_relative() {
        if let Some(parent) = loader.path().parent() {
            Ok(parent.join(&dir))
        } else {
            Ok(dir)
        }
    } else {
        Ok(dir)
    }
}

fn ensure_gbrain_exists(dir: &Path) -> Result<()> {
    if !dir.exists() {
        bail!(
            "GBrain directory not found at '{}'. Run `sockt init` to scaffold.",
            dir.display()
        );
    }
    Ok(())
}

fn validate_core_files(dir: &Path) -> Result<()> {
    let mut missing = Vec::new();

    let core_files = ["SOUL.md", "AGENTS.md", "MEMORY.md"];
    for file in &core_files {
        if !dir.join(file).exists() {
            missing.push(*file);
        }
    }

    if !missing.is_empty() {
        println!(
            "  ⚠ Warning: Missing core files: {}",
            missing.join(", ")
        );
        println!("  Export will continue but may be incomplete.\n");
    }

    Ok(())
}

fn validate_output_path(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        if parent.as_os_str().is_empty() {
            return Ok(());
        }
        if !parent.exists() {
            bail!("Output directory '{}' does not exist", parent.display());
        }

        let test_file = parent.join(".sockt_write_test");
        if let Err(e) = std::fs::write(&test_file, b"test") {
            bail!(
                "Cannot write to '{}'. Check permissions. {}",
                parent.display(),
                e
            );
        }
        let _ = std::fs::remove_file(&test_file);
    }
    Ok(())
}

fn check_git_status(gbrain_dir: &Path) -> Result<()> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(gbrain_dir)
        .args(["status", "--porcelain"])
        .output()?;

    if !output.stdout.is_empty() {
        println!("  ⚠ Warning: GBrain has uncommitted changes.");
        println!("  Current state will be exported.\n");
    }
    Ok(())
}

fn default_output_path() -> PathBuf {
    let date = chrono::Local::now().format("%Y-%m-%d");
    PathBuf::from(format!("./sockt-export-{}.tar.gz", date))
}

fn collect_files(
    gbrain_dir: &Path,
    loader: &ConfigLoader,
    args: &ExportArgs,
) -> Result<ExportManifest> {
    let mut files = Vec::new();
    let mut excluded = Vec::new();

    collect_dir_recursive(gbrain_dir, gbrain_dir, &mut files, args)?;

    if !args.include_logs && !args.include_all {
        files.retain(|f| !f.path.starts_with("gbrain/logs/"));
        excluded.push("gbrain/logs/".to_string());
    }

    if args.include_config || args.include_all {
        if let Ok(metadata) = fs::metadata(loader.path()) {
            files.push(FileEntry {
                path: "config.yaml".to_string(),
                size: metadata.len(),
                last_modified: format_modified_time(&metadata)?,
            });
        } else {
            excluded.push("config.yaml (not found)".to_string());
        }
    } else {
        excluded.push("config.yaml".to_string());
    }

    let git_commits = get_commit_count(gbrain_dir).ok();

    let total_files = files.len();
    let total_size_bytes = files.iter().map(|f| f.size).sum();

    Ok(ExportManifest {
        files,
        total_files,
        total_size_bytes,
        git_commits,
        excluded,
    })
}

fn collect_dir_recursive(
    base: &Path,
    dir: &Path,
    files: &mut Vec<FileEntry>,
    args: &ExportArgs,
) -> Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let relative = path
            .strip_prefix(base.parent().unwrap_or(base))
            .unwrap_or(&path);

        if should_exclude_path(&relative, &args.exclude) {
            continue;
        }

        if path.is_dir() {
            collect_dir_recursive(base, &path, files, args)?;
        } else {
            let metadata = entry.metadata()?;

            files.push(FileEntry {
                path: relative.to_string_lossy().to_string(),
                size: metadata.len(),
                last_modified: format_modified_time(&metadata)?,
            });
        }
    }
    Ok(())
}

fn should_exclude_path(path: &Path, patterns: &[String]) -> bool {
    if patterns.is_empty() {
        return false;
    }

    let path_str = path.to_string_lossy();
    let file_name = path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default();

    for pattern_str in patterns {
        if let Ok(pattern) = Pattern::new(pattern_str) {
            if pattern.matches(&path_str) || pattern.matches(&file_name) {
                return true;
            }
        }
    }
    false
}

fn create_tar_gz(
    output: &Path,
    gbrain_dir: &Path,
    manifest: &ExportManifest,
    loader: &ConfigLoader,
    args: &ExportArgs,
) -> Result<()> {
    let tar_gz = File::create(output)?;
    let enc = GzEncoder::new(tar_gz, Compression::default());
    let mut tar = Builder::new(enc);

    add_gbrain_to_tar(&mut tar, gbrain_dir, args)?;

    if (args.include_config || args.include_all)
        && manifest.files.iter().any(|f| f.path == "config.yaml")
    {
        tar.append_path_with_name(loader.path(), "config.yaml")?;
    }

    tar.finish()?;
    Ok(())
}

fn add_gbrain_to_tar(
    tar: &mut Builder<GzEncoder<File>>,
    gbrain_dir: &Path,
    args: &ExportArgs,
) -> Result<()> {
    add_dir_to_tar_recursive(tar, gbrain_dir, gbrain_dir, "gbrain", args)?;
    Ok(())
}

fn add_dir_to_tar_recursive(
    tar: &mut Builder<GzEncoder<File>>,
    base_dir: &Path,
    current_dir: &Path,
    archive_prefix: &str,
    args: &ExportArgs,
) -> Result<()> {
    for entry in fs::read_dir(current_dir)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name();

        let relative = path.strip_prefix(base_dir).unwrap_or(&path);
        if should_exclude_path(&relative, &args.exclude) {
            continue;
        }

        if name == "logs" && current_dir == base_dir && !args.include_logs && !args.include_all {
            continue;
        }

        let archive_path = PathBuf::from(archive_prefix).join(relative);

        if path.is_dir() {
            tar.append_dir(&archive_path, &path)?;
            add_dir_to_tar_recursive(tar, base_dir, &path, archive_prefix, args)?;
        } else {
            tar.append_path_with_name(&path, &archive_path)?;
        }
    }
    Ok(())
}

fn print_export_summary(manifest: &ExportManifest, args: &ExportArgs) {
    println!("\n  Exporting Sockt deployment...\n");

    let skills_count = manifest
        .files
        .iter()
        .filter(|f| f.path.starts_with("gbrain/skills/") && f.path.ends_with(".md"))
        .count();
    let decisions_count = manifest
        .files
        .iter()
        .filter(|f| f.path.starts_with("gbrain/decisions/"))
        .count();

    println!("  Included:");
    println!(
        "    ./gbrain/                   {} files ({} KB)",
        manifest.total_files,
        manifest.total_size_bytes / 1024
    );

    if manifest.files.iter().any(|f| f.path == "gbrain/SOUL.md") {
        println!("      ├── SOUL.md               Company identity");
    }
    if manifest.files.iter().any(|f| f.path == "gbrain/AGENTS.md") {
        println!("      ├── AGENTS.md             Agent configuration");
    }
    if manifest.files.iter().any(|f| f.path == "gbrain/MEMORY.md") {
        println!("      ├── MEMORY.md             Knowledge entries");
    }
    if skills_count > 0 {
        println!("      ├── skills/               {} files", skills_count);
    }
    if decisions_count > 0 {
        println!("      └── decisions/            {} files", decisions_count);
    }

    if let Some(commits) = manifest.git_commits {
        println!("    Full git history            {} commits", commits);
    }

    if args.include_logs || args.include_all {
        let log_count = manifest
            .files
            .iter()
            .filter(|f| f.path.starts_with("gbrain/logs/"))
            .count();
        if log_count > 0 {
            println!("    ./gbrain/logs/              {} files", log_count);
        }
    }

    if args.include_config || args.include_all {
        println!("    config.yaml                 Encrypted config");
    }

    if !manifest.excluded.is_empty() {
        println!("\n  Excluded (add with flags):");
        for excl in &manifest.excluded {
            println!("    {}", excl);
        }
    }
}

fn print_export_info(args: &ExportArgs) {
    println!("\n  This archive is:");
    println!("    • A complete git repo (clone it, browse history)");
    println!("    • Human-readable (just Markdown files)");
    println!("    • Importable to another Sockt deployment");
    println!("    • Independent of Sockt (it's your data, plain files)");

    if args.include_config || args.include_all {
        println!("\n  Note: config.yaml contains encrypted secrets.");
        println!("  They require ~/.sockt/key.txt to decrypt.");
        println!("  Export key separately: sockt secrets export");
    }
}

fn get_commit_count(gbrain_dir: &Path) -> Result<usize> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(gbrain_dir)
        .args(["rev-list", "--count", "HEAD"])
        .output()?;

    if output.status.success() {
        let count_str = String::from_utf8(output.stdout)?;
        Ok(count_str.trim().parse()?)
    } else {
        Ok(0)
    }
}

fn format_modified_time(metadata: &fs::Metadata) -> Result<String> {
    let modified = metadata.modified()?;
    let datetime: chrono::DateTime<chrono::Local> = modified.into();
    Ok(datetime.format("%Y-%m-%d").to_string())
}

fn estimate_archive_size(total_size: u64) -> u64 {
    (total_size as f64 * 1.2) as u64
}

fn check_disk_space(output: &Path, estimated_size: u64) -> Result<()> {
    let dir = output.parent().unwrap_or_else(|| Path::new("."));

    match statvfs(dir) {
        Ok(stat) => {
            let available = stat.available_space();
            if available < estimated_size {
                bail!(
                    "Not enough space to create archive. Estimated: {} KB needed, {} KB available.",
                    estimated_size / 1024,
                    available / 1024
                );
            }
        }
        Err(_) => {
            // If we can't check disk space, just warn and continue
            println!("  ⚠ Warning: Could not verify available disk space.\n");
        }
    }
    Ok(())
}
