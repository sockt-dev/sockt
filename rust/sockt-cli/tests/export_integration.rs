use assert_cmd::Command;
use predicates::prelude::*;
use std::fs;
use std::path::PathBuf;
use std::process::Command as StdCommand;
use tempfile::TempDir;

fn sockt() -> Command {
    Command::cargo_bin("sockt").unwrap()
}

fn setup_gbrain_fixture() -> (TempDir, PathBuf) {
    let temp_dir = TempDir::new().unwrap();
    let gbrain_dir = temp_dir.path().join("gbrain");
    fs::create_dir_all(gbrain_dir.join("skills")).unwrap();
    fs::create_dir_all(gbrain_dir.join("decisions")).unwrap();

    fs::write(
        gbrain_dir.join("SOUL.md"),
        "# Company Identity\n\n## Who We Are\nAcme Corp — developer tools for API monitoring\n\n## Ideal Customer\nB2B SaaS teams\n",
    )
    .unwrap();
    fs::write(
        gbrain_dir.join("AGENTS.md"),
        "# Agents\n\n## lead-researcher\nEnriches leads from signals\n\n## social-monitor\nMonitors social channels\n",
    )
    .unwrap();
    fs::write(
        gbrain_dir.join("MEMORY.md"),
        "# Memory\n\n- 2026-06-25: Identified 3 healthcare leads via LinkedIn\n  Companies: MedTech Inc, HealthFlow, CareStack\n  Status: enrichment complete, pending outreach\n",
    )
    .unwrap();
    fs::write(
        gbrain_dir.join("skills").join("lead-research.md"),
        "---\nstatus: production\n---\n# Lead Research Skill\n\n## Pattern\nWhen tasked with enriching a lead from a social signal\n\n## Steps\n1. Extract company name\n2. Query Apollo.io\n3. Calculate relevance score\n",
    )
    .unwrap();

    let git = |args: &[&str]| {
        StdCommand::new("git")
            .args(args)
            .current_dir(&gbrain_dir)
            .output()
            .expect("git command failed");
    };

    git(&["init"]);
    git(&["config", "user.email", "test@test.com"]);
    git(&["config", "user.name", "test-user"]);
    git(&["add", "."]);
    git(&["commit", "-m", "Initial scaffold"]);

    fs::write(
        gbrain_dir.join("MEMORY.md"),
        "# Memory\n\n- 2026-06-25: Identified 3 healthcare leads via LinkedIn\n  Companies: MedTech Inc, HealthFlow, CareStack\n  Status: enrichment complete, pending outreach\n- 2026-06-27: Updated monitoring patterns\n",
    )
    .unwrap();

    git(&[
        "commit",
        "-am",
        "Updated memory",
    ]);

    let sockt_dir = temp_dir.path().join(".sockt");
    fs::create_dir_all(&sockt_dir).unwrap();
    let config_yaml = format!(
        r#"version: "0.1.0"
tier: local
deployment_id: test-export
slack:
  app_token:
    ciphertext: ""
    recipient: ""
  bot_token:
    ciphertext: ""
    recipient: ""
  signing_secret:
    ciphertext: ""
    recipient: ""
models:
  provider: anthropic
  frontier: claude-sonnet-4-20250514
  fast: claude-haiku-4-20250514
  api_key:
    ciphertext: ""
    recipient: ""
gbrain:
  directory: "{}"
  soul_file: SOUL.md
  agents_file: AGENTS.md
"#,
        gbrain_dir.display()
    );
    let config_path = sockt_dir.join("config.yaml");
    fs::write(&config_path, config_yaml).unwrap();

    (temp_dir, config_path)
}

// ========================================
// Phase 0: Argument Parsing Tests
// ========================================

#[test]
fn export_help_shows_all_flags() {
    sockt()
        .args(["export", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("--output"))
        .stdout(predicate::str::contains("--format"))
        .stdout(predicate::str::contains("--include-config"))
        .stdout(predicate::str::contains("--include-logs"))
        .stdout(predicate::str::contains("--include-all"))
        .stdout(predicate::str::contains("--exclude"))
        .stdout(predicate::str::contains("--json"));
}

#[test]
fn export_accepts_output_flag() {
    let temp_dir = TempDir::new().unwrap();
    sockt()
        .args(["export", "--output", "/tmp/test.tar.gz"])
        .env("HOME", temp_dir.path())
        .assert()
        .failure()
        .stderr(predicate::str::contains("GBrain").or(predicate::str::contains("config")));
}

#[test]
fn export_accepts_format_flag() {
    let temp_dir = TempDir::new().unwrap();
    sockt()
        .args(["export", "--format", "zip"])
        .env("HOME", temp_dir.path())
        .assert()
        .failure()
        .stderr(predicate::str::contains("GBrain").or(predicate::str::contains("config")));
}

#[test]
fn export_accepts_boolean_flags() {
    let temp_dir = TempDir::new().unwrap();
    sockt()
        .args(["export", "--include-config", "--include-logs", "--json"])
        .env("HOME", temp_dir.path())
        .assert()
        .failure()
        .stderr(predicate::str::contains("GBrain").or(predicate::str::contains("config")));
}

#[test]
fn export_accepts_exclude_pattern() {
    let temp_dir = TempDir::new().unwrap();
    sockt()
        .args(["export", "--exclude", "*.log"])
        .env("HOME", temp_dir.path())
        .assert()
        .failure()
        .stderr(predicate::str::contains("GBrain").or(predicate::str::contains("config")));
}

// ========================================
// Phase 1: Error Handling Tests
// ========================================

#[test]
fn export_fails_when_gbrain_not_found() {
    let temp_dir = TempDir::new().unwrap();
    let sockt_dir = temp_dir.path().join(".sockt");
    fs::create_dir_all(&sockt_dir).unwrap();

    let config_yaml = r#"version: "0.1.0"
tier: local
deployment_id: test-export
slack:
  app_token:
    ciphertext: ""
    recipient: ""
  bot_token:
    ciphertext: ""
    recipient: ""
  signing_secret:
    ciphertext: ""
    recipient: ""
models:
  provider: anthropic
  frontier: claude-sonnet-4-20250514
  fast: claude-haiku-4-20250514
  api_key:
    ciphertext: ""
    recipient: ""
gbrain:
  directory: "/nonexistent/gbrain"
  soul_file: SOUL.md
  agents_file: AGENTS.md
"#;
    let config_path = sockt_dir.join("config.yaml");
    fs::write(&config_path, config_yaml).unwrap();

    sockt()
        .args(["export", "--config", config_path.to_str().unwrap()])
        .assert()
        .failure()
        .stderr(predicate::str::contains("GBrain directory not found"))
        .stderr(predicate::str::contains("Run `sockt init`"));
}

#[test]
fn export_fails_when_output_not_writable() {
    let (_temp, config_path) = setup_gbrain_fixture();

    sockt()
        .args([
            "export",
            "--output",
            "/root/forbidden.tar.gz",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .failure()
        .stderr(predicate::str::contains("Cannot write").or(predicate::str::contains("permission")));
}

#[test]
fn export_fails_with_invalid_format() {
    let (_temp, config_path) = setup_gbrain_fixture();

    sockt()
        .args([
            "export",
            "--format",
            "rar",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .failure()
        .stderr(predicate::str::contains("Unsupported format"));
}

#[test]
fn export_warns_about_dirty_repo() {
    let (_temp, config_path) = setup_gbrain_fixture();
    let gbrain_dir = _temp.path().join("gbrain");

    fs::write(
        gbrain_dir.join("MEMORY.md"),
        "# Memory\n\nNew uncommitted entry\n",
    )
    .unwrap();

    sockt()
        .args(["export", "--config", config_path.to_str().unwrap()])
        .assert()
        .success()
        .stdout(predicate::str::contains("uncommitted changes").or(predicate::str::contains("Warning")));
}

// ========================================
// Phase 2: Core Functionality Tests
// ========================================

#[test]
fn export_creates_default_archive() {
    let (_temp, config_path) = setup_gbrain_fixture();
    let work_dir = TempDir::new().unwrap();

    sockt()
        .args(["export", "--config", config_path.to_str().unwrap()])
        .current_dir(work_dir.path())
        .assert()
        .success()
        .stdout(predicate::str::contains("Exporting"))
        .stdout(predicate::str::contains("sockt-export-"))
        .stdout(predicate::str::contains(".tar.gz"));

    let archives: Vec<_> = fs::read_dir(work_dir.path())
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "gz")
                .unwrap_or(false)
        })
        .collect();

    assert_eq!(archives.len(), 1);
}

#[test]
fn export_with_custom_output_path() {
    let (_temp, config_path) = setup_gbrain_fixture();
    let work_dir = TempDir::new().unwrap();
    let output_path = work_dir.path().join("my-backup.tar.gz");

    sockt()
        .args([
            "export",
            "--output",
            output_path.to_str().unwrap(),
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("my-backup.tar.gz"));

    assert!(output_path.exists());
}

#[test]
fn export_includes_core_files() {
    let (_temp, config_path) = setup_gbrain_fixture();
    let work_dir = TempDir::new().unwrap();
    let output_path = work_dir.path().join("test.tar.gz");

    sockt()
        .args([
            "export",
            "--output",
            output_path.to_str().unwrap(),
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success();

    let extract_dir = work_dir.path().join("extracted");
    fs::create_dir(&extract_dir).unwrap();

    let tar_gz = fs::File::open(&output_path).unwrap();
    let tar = flate2::read::GzDecoder::new(tar_gz);
    let mut archive = tar::Archive::new(tar);
    archive.unpack(&extract_dir).unwrap();

    let gbrain_extracted = extract_dir.join("gbrain");
    assert!(gbrain_extracted.join("SOUL.md").exists());
    assert!(gbrain_extracted.join("AGENTS.md").exists());
    assert!(gbrain_extracted.join("MEMORY.md").exists());
    assert!(gbrain_extracted.join("skills").is_dir());
    assert!(gbrain_extracted.join("skills/lead-research.md").exists());
    assert!(gbrain_extracted.join(".git").is_dir());
}

#[test]
fn export_shows_human_readable_summary() {
    let (_temp, config_path) = setup_gbrain_fixture();
    let work_dir = TempDir::new().unwrap();
    let output_path = work_dir.path().join("test.tar.gz");

    sockt()
        .args([
            "export",
            "--output",
            output_path.to_str().unwrap(),
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Included:"))
        .stdout(predicate::str::contains("./gbrain/"))
        .stdout(predicate::str::contains("SOUL.md"))
        .stdout(predicate::str::contains("AGENTS.md"))
        .stdout(predicate::str::contains("MEMORY.md"))
        .stdout(predicate::str::contains("skills/"))
        .stdout(predicate::str::contains("git history"));
}

#[test]
fn export_json_manifest_dry_run() {
    let (_temp, config_path) = setup_gbrain_fixture();
    let work_dir = TempDir::new().unwrap();

    let output = sockt()
        .args([
            "export",
            "--json",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .current_dir(work_dir.path())
        .assert()
        .success()
        .stdout(predicate::str::contains(r#""files""#))
        .stdout(predicate::str::contains(r#""total_files""#))
        .stdout(predicate::str::contains(r#""total_size_bytes""#))
        .get_output()
        .clone();

    let json_str = String::from_utf8(output.stdout).unwrap();
    let _: serde_json::Value = serde_json::from_str(&json_str).unwrap();

    let archives: Vec<_> = fs::read_dir(work_dir.path())
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "gz")
                .unwrap_or(false)
        })
        .collect();

    assert_eq!(archives.len(), 0);
}

// ========================================
// Phase 3: Advanced Features Tests
// ========================================

#[test]
fn export_excludes_logs_by_default() {
    let (_temp, config_path) = setup_gbrain_fixture();
    let gbrain_dir = _temp.path().join("gbrain");

    let logs_dir = gbrain_dir.join("logs");
    fs::create_dir(&logs_dir).unwrap();
    fs::write(logs_dir.join("agent-1.log"), "log entry").unwrap();

    let work_dir = TempDir::new().unwrap();
    let output_path = work_dir.path().join("test.tar.gz");

    sockt()
        .args([
            "export",
            "--output",
            output_path.to_str().unwrap(),
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Excluded"))
        .stdout(predicate::str::contains("logs/"));

    let extract_dir = work_dir.path().join("extracted");
    fs::create_dir(&extract_dir).unwrap();

    let tar_gz = fs::File::open(&output_path).unwrap();
    let tar = flate2::read::GzDecoder::new(tar_gz);
    let mut archive = tar::Archive::new(tar);
    archive.unpack(&extract_dir).unwrap();

    assert!(!extract_dir.join("gbrain/logs").exists());
}

#[test]
fn export_includes_logs_with_flag() {
    let (_temp, config_path) = setup_gbrain_fixture();
    let gbrain_dir = _temp.path().join("gbrain");

    let logs_dir = gbrain_dir.join("logs");
    fs::create_dir(&logs_dir).unwrap();
    fs::write(logs_dir.join("agent-1.log"), "log entry").unwrap();

    let work_dir = TempDir::new().unwrap();
    let output_path = work_dir.path().join("test.tar.gz");

    sockt()
        .args([
            "export",
            "--include-logs",
            "--output",
            output_path.to_str().unwrap(),
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("logs/"));

    let extract_dir = work_dir.path().join("extracted");
    fs::create_dir(&extract_dir).unwrap();

    let tar_gz = fs::File::open(&output_path).unwrap();
    let tar = flate2::read::GzDecoder::new(tar_gz);
    let mut archive = tar::Archive::new(tar);
    archive.unpack(&extract_dir).unwrap();

    assert!(extract_dir.join("gbrain/logs/agent-1.log").exists());
}

#[test]
fn export_includes_config_with_flag() {
    let (_temp, config_path) = setup_gbrain_fixture();
    let work_dir = TempDir::new().unwrap();
    let output_path = work_dir.path().join("test.tar.gz");

    sockt()
        .args([
            "export",
            "--include-config",
            "--output",
            output_path.to_str().unwrap(),
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("config.yaml"));

    let extract_dir = work_dir.path().join("extracted");
    fs::create_dir(&extract_dir).unwrap();

    let tar_gz = fs::File::open(&output_path).unwrap();
    let tar = flate2::read::GzDecoder::new(tar_gz);
    let mut archive = tar::Archive::new(tar);
    archive.unpack(&extract_dir).unwrap();

    assert!(extract_dir.join("config.yaml").exists());
}

#[test]
fn export_include_all_flag() {
    let (_temp, config_path) = setup_gbrain_fixture();
    let gbrain_dir = _temp.path().join("gbrain");

    let logs_dir = gbrain_dir.join("logs");
    fs::create_dir(&logs_dir).unwrap();
    fs::write(logs_dir.join("agent-1.log"), "log entry").unwrap();

    let work_dir = TempDir::new().unwrap();
    let output_path = work_dir.path().join("test.tar.gz");

    sockt()
        .args([
            "export",
            "--include-all",
            "--output",
            output_path.to_str().unwrap(),
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("logs/"))
        .stdout(predicate::str::contains("config.yaml"));

    let extract_dir = work_dir.path().join("extracted");
    fs::create_dir(&extract_dir).unwrap();

    let tar_gz = fs::File::open(&output_path).unwrap();
    let tar = flate2::read::GzDecoder::new(tar_gz);
    let mut archive = tar::Archive::new(tar);
    archive.unpack(&extract_dir).unwrap();

    assert!(extract_dir.join("gbrain/logs/agent-1.log").exists());
    assert!(extract_dir.join("config.yaml").exists());
}

#[test]
fn export_exclude_pattern_works() {
    let (_temp, config_path) = setup_gbrain_fixture();
    let gbrain_dir = _temp.path().join("gbrain");

    fs::write(gbrain_dir.join("test.log"), "log content").unwrap();
    fs::write(gbrain_dir.join("debug.log"), "debug content").unwrap();
    fs::write(gbrain_dir.join("important.md"), "important").unwrap();

    let work_dir = TempDir::new().unwrap();
    let output_path = work_dir.path().join("test.tar.gz");

    sockt()
        .args([
            "export",
            "--exclude",
            "*.log",
            "--output",
            output_path.to_str().unwrap(),
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success();

    let extract_dir = work_dir.path().join("extracted");
    fs::create_dir(&extract_dir).unwrap();

    let tar_gz = fs::File::open(&output_path).unwrap();
    let tar = flate2::read::GzDecoder::new(tar_gz);
    let mut archive = tar::Archive::new(tar);
    archive.unpack(&extract_dir).unwrap();

    assert!(!extract_dir.join("gbrain/test.log").exists());
    assert!(!extract_dir.join("gbrain/debug.log").exists());
    assert!(extract_dir.join("gbrain/important.md").exists());
}

#[test]
fn export_warns_about_missing_core_files() {
    let temp_dir = TempDir::new().unwrap();
    let gbrain_dir = temp_dir.path().join("gbrain");
    fs::create_dir_all(gbrain_dir.join("skills")).unwrap();

    fs::write(gbrain_dir.join("SOUL.md"), "# Identity\n").unwrap();

    let git = |args: &[&str]| {
        StdCommand::new("git")
            .args(args)
            .current_dir(&gbrain_dir)
            .output()
            .expect("git command failed");
    };

    git(&["init"]);
    git(&["config", "user.email", "test@test.com"]);
    git(&["config", "user.name", "test-user"]);
    git(&["add", "."]);
    git(&["commit", "-m", "Initial"]);

    let sockt_dir = temp_dir.path().join(".sockt");
    fs::create_dir_all(&sockt_dir).unwrap();
    let config_yaml = format!(
        r#"version: "0.1.0"
tier: local
deployment_id: test-export
slack:
  app_token:
    ciphertext: ""
    recipient: ""
  bot_token:
    ciphertext: ""
    recipient: ""
  signing_secret:
    ciphertext: ""
    recipient: ""
models:
  provider: anthropic
  frontier: claude-sonnet-4-20250514
  fast: claude-haiku-4-20250514
  api_key:
    ciphertext: ""
    recipient: ""
gbrain:
  directory: "{}"
  soul_file: SOUL.md
  agents_file: AGENTS.md
"#,
        gbrain_dir.display()
    );
    let config_path = sockt_dir.join("config.yaml");
    fs::write(&config_path, config_yaml).unwrap();

    let work_dir = TempDir::new().unwrap();
    let output_path = work_dir.path().join("test.tar.gz");

    sockt()
        .args([
            "export",
            "--output",
            output_path.to_str().unwrap(),
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Warning"))
        .stdout(predicate::str::contains("Missing core files"))
        .stdout(predicate::str::contains("AGENTS.md"))
        .stdout(predicate::str::contains("MEMORY.md"));
}
