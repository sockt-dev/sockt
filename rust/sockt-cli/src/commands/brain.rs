use std::path::{Path, PathBuf};
use std::process::Command as ProcessCommand;

use anyhow::{bail, Context, Result};

use crate::cli::{BrainArgs, BrainCommand, SkillsCommand};
use crate::config::loader::ConfigLoader;

pub async fn run(args: BrainArgs, config_path: Option<PathBuf>) -> Result<()> {
    let gbrain_dir = resolve_gbrain_dir(config_path)?;

    match args.command {
        None => show_summary(&gbrain_dir),
        Some(BrainCommand::Search { query, file, context, limit }) => {
            search(&gbrain_dir, &query, file.as_deref(), context, limit)
        }
        Some(BrainCommand::Log { agent, since, limit, oneline }) => {
            show_log(&gbrain_dir, agent.as_deref(), since.as_deref(), limit, oneline)
        }
        Some(BrainCommand::Show { file, raw, line }) => {
            show_file(&gbrain_dir, &file, raw, line.as_deref())
        }
        Some(BrainCommand::Edit { file }) => edit_file(&gbrain_dir, &file),
        Some(BrainCommand::Diff { since, stat }) => show_diff(&gbrain_dir, &since, stat),
        Some(BrainCommand::Skills { command }) => handle_skills(&gbrain_dir, command),
    }
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

fn git_cmd(gbrain_dir: &Path) -> ProcessCommand {
    let mut cmd = ProcessCommand::new("git");
    cmd.arg("-C").arg(gbrain_dir);
    cmd
}

fn show_summary(gbrain_dir: &Path) -> Result<()> {
    ensure_gbrain_exists(gbrain_dir)?;

    let mut file_count = 0u64;
    let mut total_size = 0u64;
    count_files(gbrain_dir, &mut file_count, &mut total_size)?;

    let last_commit = git_cmd(gbrain_dir)
        .args(["log", "-1", "--format=%ar (%an: %s)"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        });

    let commit_count = git_cmd(gbrain_dir)
        .args(["rev-list", "--count", "HEAD"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8_lossy(&o.stdout).trim().parse::<u64>().ok()
            } else {
                None
            }
        });

    let skills_dir = gbrain_dir.join("skills");
    let skill_count = if skills_dir.exists() {
        std::fs::read_dir(&skills_dir)
            .map(|entries| entries.filter_map(|e| e.ok()).filter(|e| {
                e.path().extension().map(|ext| ext == "md").unwrap_or(false)
            }).count())
            .unwrap_or(0)
    } else {
        0
    };

    let core_files: Vec<&str> = ["SOUL.md", "AGENTS.md", "MEMORY.md"]
        .iter()
        .filter(|f| gbrain_dir.join(f).exists())
        .copied()
        .collect();

    println!();
    println!("  GBrain — {}", gbrain_dir.display());
    println!("  {}", "─".repeat(50));
    println!("  Files:       {}", file_count);
    println!("  Size:        {}", format_size(total_size));
    if let Some(count) = commit_count {
        println!("  Commits:     {}", count);
    }
    if let Some(ref commit) = last_commit {
        println!("  Last commit: {}", commit);
    }
    println!();

    if !core_files.is_empty() {
        println!("  Core files:");
        for f in &core_files {
            println!("    {}", f);
        }
        println!();
    }

    println!("  Skills: {}", skill_count);
    println!();

    Ok(())
}

fn count_files(dir: &Path, count: &mut u64, size: &mut u64) -> Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.file_name().map(|n| n.to_string_lossy().starts_with('.')).unwrap_or(false) {
            continue;
        }
        if path.is_dir() {
            count_files(&path, count, size)?;
        } else {
            *count += 1;
            *size += entry.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    Ok(())
}

fn format_size(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{} KB", bytes / 1024)
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

fn show_file(gbrain_dir: &Path, file: &str, _raw: bool, line_range: Option<&str>) -> Result<()> {
    ensure_gbrain_exists(gbrain_dir)?;
    let path = gbrain_dir.join(file);
    if !path.exists() {
        let available = list_available_files(gbrain_dir)?;
        bail!(
            "File '{}' not found in GBrain. Available: {}",
            file,
            available.join(", ")
        );
    }

    let content = std::fs::read_to_string(&path)
        .with_context(|| format!("Failed to read {}", file))?;

    if let Some(range) = line_range {
        let (start, end) = parse_line_range(range)?;
        let lines: Vec<&str> = content.lines().collect();
        let start_idx = start.saturating_sub(1);
        let end_idx = end.min(lines.len());
        for line in &lines[start_idx..end_idx] {
            println!("{}", line);
        }
    } else {
        print!("{}", content);
    }

    Ok(())
}

fn parse_line_range(range: &str) -> Result<(usize, usize)> {
    let parts: Vec<&str> = range.split('-').collect();
    if parts.len() != 2 {
        bail!("Invalid line range '{}'. Expected format: START-END (e.g. '10-30')", range);
    }
    let start: usize = parts[0].parse()
        .with_context(|| format!("Invalid start line in range '{}'", range))?;
    let end: usize = parts[1].parse()
        .with_context(|| format!("Invalid end line in range '{}'", range))?;
    if start == 0 || end < start {
        bail!("Invalid line range '{}'. Start must be >= 1 and end >= start.", range);
    }
    Ok((start, end))
}

fn list_available_files(gbrain_dir: &Path) -> Result<Vec<String>> {
    let mut files = Vec::new();
    collect_files_relative(gbrain_dir, gbrain_dir, &mut files)?;
    files.sort();
    Ok(files)
}

fn collect_files_relative(base: &Path, dir: &Path, files: &mut Vec<String>) -> Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.file_name().map(|n| n.to_string_lossy().starts_with('.')).unwrap_or(false) {
            continue;
        }
        if path.is_dir() {
            collect_files_relative(base, &path, files)?;
        } else {
            if let Ok(relative) = path.strip_prefix(base) {
                files.push(relative.to_string_lossy().to_string());
            }
        }
    }
    Ok(())
}

fn search(gbrain_dir: &Path, query: &str, file_glob: Option<&str>, context: usize, limit: usize) -> Result<()> {
    ensure_gbrain_exists(gbrain_dir)?;

    let mut cmd = ProcessCommand::new("grep");
    cmd.arg("-rn")
        .arg("--include=*.md")
        .arg(format!("-C{}", context));

    if let Some(glob) = file_glob {
        cmd.arg(format!("--include={}", glob));
    }

    cmd.arg(query).arg(gbrain_dir);

    let output = cmd.output().context("Failed to run grep")?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    if stdout.is_empty() {
        println!("  No results for '{}'. Try broader terms or check `sockt brain show MEMORY.md`", query);
        return Ok(());
    }

    let gbrain_prefix = format!("{}/", gbrain_dir.display());
    let mut result_count = 0usize;
    let mut current_file: Option<String> = None;

    for line in stdout.lines() {
        if result_count >= limit {
            break;
        }

        let display_line = line.strip_prefix(&gbrain_prefix).unwrap_or(line);

        if line.contains(':') && !line.starts_with('-') && !line.starts_with("--") {
            let is_new_match = display_line.split(':').nth(1)
                .and_then(|n| n.parse::<usize>().ok())
                .is_some();

            if is_new_match {
                let file_part = display_line.split(':').next().unwrap_or("");
                if current_file.as_deref() != Some(file_part) {
                    if current_file.is_some() {
                        println!();
                    }
                    current_file = Some(file_part.to_string());
                    let line_num = display_line.split(':').nth(1).unwrap_or("?");
                    println!("  {}:{}", file_part, line_num);
                }
                result_count += 1;
            }
        }

        let content_part = if let Some(stripped) = display_line.strip_prefix(&format!("{}:", current_file.as_deref().unwrap_or(""))) {
            if let Some(after_num) = stripped.split_once(':') {
                after_num.1
            } else {
                stripped
            }
        } else {
            display_line
        };
        println!("    │ {}", content_part);
    }

    println!();
    println!("  {} result{} across {} file{}",
        result_count.min(limit),
        if result_count.min(limit) == 1 { "" } else { "s" },
        current_file.iter().count().max(1),
        if current_file.iter().count().max(1) == 1 { "" } else { "s" }
    );

    Ok(())
}

fn show_log(gbrain_dir: &Path, agent: Option<&str>, since: Option<&str>, limit: usize, oneline: bool) -> Result<()> {
    ensure_gbrain_exists(gbrain_dir)?;

    let mut cmd = git_cmd(gbrain_dir);
    cmd.arg("log");

    if oneline {
        cmd.arg("--format=%h %an  %s (%ar)");
    } else {
        cmd.arg("--format=%h  %ar   %an   %s");
    }

    cmd.arg(format!("-{}", limit));

    if let Some(agent_name) = agent {
        cmd.arg(format!("--author={}", agent_name));
    }

    if let Some(duration) = since {
        let git_since = parse_duration_to_git_since(duration)?;
        cmd.arg(format!("--since={}", git_since));
    }

    let output = cmd.output().context("Failed to run git log")?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        bail!("git log failed: {}", err);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.is_empty() {
        println!("  No commits found.");
        return Ok(());
    }

    println!();
    for line in stdout.lines() {
        println!("  {}", line);
    }
    println!();

    Ok(())
}

fn parse_duration_to_git_since(duration: &str) -> Result<String> {
    let s = duration.trim();
    if s.is_empty() {
        bail!("Empty duration");
    }

    let (num_str, unit) = s.split_at(s.len() - 1);
    let num: u64 = num_str.parse()
        .with_context(|| format!("Invalid duration '{}'. Expected format like '1d', '2h', '30m'", duration))?;

    let git_unit = match unit {
        "m" => "minutes",
        "h" => "hours",
        "d" => "days",
        "w" => "weeks",
        _ => bail!("Unknown duration unit '{}'. Use m (minutes), h (hours), d (days), w (weeks)", unit),
    };

    Ok(format!("{} {} ago", num, git_unit))
}

fn show_diff(gbrain_dir: &Path, since: &str, stat: bool) -> Result<()> {
    ensure_gbrain_exists(gbrain_dir)?;

    let mut cmd = git_cmd(gbrain_dir);
    cmd.arg("diff");

    if stat {
        cmd.arg("--stat");
    }

    if is_git_ref(since) {
        cmd.arg(format!("{}..HEAD", since));
    } else {
        let git_since = parse_duration_to_git_since(since)?;
        let rev_output = git_cmd(gbrain_dir)
            .args(["rev-list", "-1", &format!("--before={}", git_since), "HEAD"])
            .output()
            .context("Failed to find commit for duration")?;

        let rev = String::from_utf8_lossy(&rev_output.stdout).trim().to_string();
        if rev.is_empty() {
            cmd.arg("HEAD~1");
        } else {
            cmd.arg(format!("{}..HEAD", rev));
        }
    }

    let output = cmd.output().context("Failed to run git diff")?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    if stdout.is_empty() {
        println!("  No changes.");
    } else {
        print!("{}", stdout);
    }

    Ok(())
}

fn is_git_ref(s: &str) -> bool {
    s.starts_with("HEAD") || s.contains('~') || (s.len() >= 6 && s.chars().all(|c| c.is_ascii_hexdigit()))
}

fn edit_file(gbrain_dir: &Path, file: &str) -> Result<()> {
    ensure_gbrain_exists(gbrain_dir)?;

    let path = gbrain_dir.join(file);
    if !path.exists() {
        let available = list_available_files(gbrain_dir)?;
        bail!(
            "File '{}' not found in GBrain. Available: {}",
            file,
            available.join(", ")
        );
    }

    let editor = std::env::var("VISUAL")
        .or_else(|_| std::env::var("EDITOR"))
        .map_err(|_| anyhow::anyhow!("No editor configured. Set $EDITOR or $VISUAL environment variable."))?;

    if editor.is_empty() {
        bail!("No editor configured. Set $EDITOR or $VISUAL environment variable.");
    }

    let status = ProcessCommand::new(&editor)
        .arg(&path)
        .status()
        .with_context(|| format!("Failed to launch editor '{}'", editor))?;

    if !status.success() {
        bail!("Editor exited with non-zero status");
    }

    Ok(())
}

fn handle_skills(gbrain_dir: &Path, command: Option<SkillsCommand>) -> Result<()> {
    ensure_gbrain_exists(gbrain_dir)?;
    let skills_dir = gbrain_dir.join("skills");

    match command {
        None | Some(SkillsCommand::List) => list_skills(&skills_dir),
        Some(SkillsCommand::Show { name }) => show_skill(&skills_dir, &name),
        Some(SkillsCommand::Approve { name }) => approve_skill(&skills_dir, &name),
        Some(SkillsCommand::Reject { name }) => reject_skill(&skills_dir, &name),
    }
}

fn list_skills(skills_dir: &Path) -> Result<()> {
    if !skills_dir.exists() {
        println!("  No skills directory found.");
        return Ok(());
    }

    let mut production = Vec::new();
    let mut pending = Vec::new();

    for entry in std::fs::read_dir(skills_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().map(|e| e == "md").unwrap_or(false) {
            let name = path.file_stem().unwrap().to_string_lossy().to_string();
            let content = std::fs::read_to_string(&path).unwrap_or_default();
            let status = parse_skill_status(&content);
            match status.as_str() {
                "pending-review" => pending.push(name),
                _ => production.push(name),
            }
        }
    }

    println!();
    if !production.is_empty() {
        println!("  PRODUCTION ({}):", production.len());
        for name in &production {
            println!("    {}", name);
        }
    }
    if !pending.is_empty() {
        println!();
        println!("  PENDING REVIEW ({}):", pending.len());
        for name in &pending {
            println!("    {}", name);
        }
        println!();
        for name in &pending {
            println!("  Approve: sockt brain skills approve {}", name);
        }
    }
    println!();

    Ok(())
}

fn show_skill(skills_dir: &Path, name: &str) -> Result<()> {
    let path = find_skill_file(skills_dir, name)?;
    let content = std::fs::read_to_string(&path)
        .with_context(|| format!("Failed to read skill '{}'", name))?;
    print!("{}", content);
    Ok(())
}

fn approve_skill(skills_dir: &Path, name: &str) -> Result<()> {
    let path = find_skill_file(skills_dir, name)?;
    let content = std::fs::read_to_string(&path)?;
    let updated = content.replace("status: pending-review", "status: production");
    std::fs::write(&path, updated)?;
    println!("  ✓ {} moved to production.", name);
    Ok(())
}

fn reject_skill(skills_dir: &Path, name: &str) -> Result<()> {
    let path = find_skill_file(skills_dir, name)?;
    std::fs::remove_file(&path)?;
    println!("  ✓ {} rejected and removed.", name);
    Ok(())
}

fn find_skill_file(skills_dir: &Path, name: &str) -> Result<PathBuf> {
    let path = skills_dir.join(format!("{}.md", name));
    if path.exists() {
        return Ok(path);
    }

    let available = list_skill_names(skills_dir)?;
    bail!(
        "No skill named '{}'. Available: {}",
        name,
        available.join(", ")
    );
}

fn list_skill_names(skills_dir: &Path) -> Result<Vec<String>> {
    if !skills_dir.exists() {
        return Ok(Vec::new());
    }
    let mut names = Vec::new();
    for entry in std::fs::read_dir(skills_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().map(|e| e == "md").unwrap_or(false) && path.file_stem().is_some() {
            let stem = path.file_stem().unwrap();
            names.push(stem.to_string_lossy().to_string());
        }
    }
    names.sort();
    Ok(names)
}

fn parse_skill_status(content: &str) -> String {
    for line in content.lines() {
        if line.starts_with("status:") {
            return line.trim_start_matches("status:").trim().to_string();
        }
    }
    "production".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_line_range_valid() {
        assert_eq!(parse_line_range("10-30").unwrap(), (10, 30));
        assert_eq!(parse_line_range("1-1").unwrap(), (1, 1));
        assert_eq!(parse_line_range("5-100").unwrap(), (5, 100));
    }

    #[test]
    fn test_parse_line_range_invalid() {
        assert!(parse_line_range("abc").is_err());
        assert!(parse_line_range("30-10").is_err());
        assert!(parse_line_range("0-5").is_err());
        assert!(parse_line_range("").is_err());
    }

    #[test]
    fn test_parse_duration_hours() {
        let result = parse_duration_to_git_since("2h").unwrap();
        assert_eq!(result, "2 hours ago");
    }

    #[test]
    fn test_parse_duration_days() {
        let result = parse_duration_to_git_since("7d").unwrap();
        assert_eq!(result, "7 days ago");
    }

    #[test]
    fn test_parse_duration_minutes() {
        let result = parse_duration_to_git_since("30m").unwrap();
        assert_eq!(result, "30 minutes ago");
    }

    #[test]
    fn test_parse_duration_weeks() {
        let result = parse_duration_to_git_since("2w").unwrap();
        assert_eq!(result, "2 weeks ago");
    }

    #[test]
    fn test_parse_duration_invalid() {
        assert!(parse_duration_to_git_since("abc").is_err());
        assert!(parse_duration_to_git_since("").is_err());
        assert!(parse_duration_to_git_since("5x").is_err());
    }

    #[test]
    fn test_is_git_ref() {
        assert!(is_git_ref("HEAD~1"));
        assert!(is_git_ref("HEAD"));
        assert!(is_git_ref("abc123"));
        assert!(!is_git_ref("1d"));
        assert!(!is_git_ref("2h"));
    }

    #[test]
    fn test_parse_skill_status() {
        assert_eq!(parse_skill_status("---\nstatus: pending-review\n---\n# Skill"), "pending-review");
        assert_eq!(parse_skill_status("---\nstatus: production\n---\n# Skill"), "production");
        assert_eq!(parse_skill_status("# Skill\nNo frontmatter"), "production");
    }

    #[test]
    fn test_format_size() {
        assert_eq!(format_size(500), "500 B");
        assert_eq!(format_size(2048), "2 KB");
        assert_eq!(format_size(1_500_000), "1.4 MB");
    }

    #[test]
    fn test_ensure_gbrain_exists_missing() {
        let result = ensure_gbrain_exists(Path::new("/nonexistent/gbrain"));
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not found"));
    }

    #[test]
    fn test_ensure_gbrain_exists_present() {
        let dir = tempfile::TempDir::new().unwrap();
        assert!(ensure_gbrain_exists(dir.path()).is_ok());
    }
}
