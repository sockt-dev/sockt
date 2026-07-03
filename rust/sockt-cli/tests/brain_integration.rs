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
    fs::create_dir_all(gbrain_dir.join("memory")).unwrap();
    fs::create_dir_all(gbrain_dir.join("logs")).unwrap();

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
        "# Memory\n\n- 2026-06-25: Identified 3 healthcare leads via LinkedIn\n  Companies: MedTech Inc, HealthFlow, CareStack\n  Status: enrichment complete, pending outreach\n- 2026-06-26: New Reddit signal detected\n",
    )
    .unwrap();
    fs::write(
        gbrain_dir.join("skills").join("lead-research.md"),
        "---\nstatus: production\n---\n# Lead Research Skill\n\n## Pattern\nWhen tasked with enriching a lead from a social signal\n\n## Steps\n1. Extract company name\n2. Query Apollo.io\n3. Calculate relevance score\n",
    )
    .unwrap();
    fs::write(
        gbrain_dir.join("skills").join("reddit-monitoring.md"),
        "---\nstatus: production\n---\n# Reddit Monitoring\n\n## Pattern\nMonitor subreddits for buying signals\n",
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
    git(&["config", "user.name", "lead-researcher"]);
    git(&["add", "."]);
    git(&["commit", "-m", "Initial scaffold"]);

    fs::write(
        gbrain_dir.join("MEMORY.md"),
        "# Memory\n\n- 2026-06-25: Identified 3 healthcare leads via LinkedIn\n  Companies: MedTech Inc, HealthFlow, CareStack\n  Status: enrichment complete, pending outreach\n- 2026-06-26: New Reddit signal detected\n- 2026-06-27: Updated monitoring patterns\n",
    )
    .unwrap();

    git(&[
        "-c",
        "user.name=social-monitor",
        "-c",
        "user.email=social@test.com",
        "commit",
        "-am",
        "Updated monitoring patterns",
    ]);

    let sockt_dir = temp_dir.path().join(".sockt");
    fs::create_dir_all(&sockt_dir).unwrap();
    let config_yaml = format!(
        r#"version: "0.1.0"
tier: local
deployment_id: test-brain
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
fn brain_help_shows_subcommands() {
    sockt()
        .args(["brain", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("search"))
        .stdout(predicate::str::contains("log"))
        .stdout(predicate::str::contains("show"))
        .stdout(predicate::str::contains("edit"))
        .stdout(predicate::str::contains("diff"))
        .stdout(predicate::str::contains("skills"));
}

#[test]
fn brain_search_requires_query() {
    sockt().args(["brain", "search"]).assert().failure();
}

#[test]
fn brain_search_help_shows_flags() {
    sockt()
        .args(["brain", "search", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("--file"))
        .stdout(predicate::str::contains("--context"))
        .stdout(predicate::str::contains("--limit"));
}

#[test]
fn brain_log_help_shows_flags() {
    sockt()
        .args(["brain", "log", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("--agent"))
        .stdout(predicate::str::contains("--since"))
        .stdout(predicate::str::contains("--limit"))
        .stdout(predicate::str::contains("--oneline"));
}

#[test]
fn brain_show_requires_file() {
    sockt().args(["brain", "show"]).assert().failure();
}

#[test]
fn brain_edit_requires_file() {
    sockt().args(["brain", "edit"]).assert().failure();
}

#[test]
fn brain_diff_help_shows_flags() {
    sockt()
        .args(["brain", "diff", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("--since"))
        .stdout(predicate::str::contains("--stat"));
}

#[test]
fn brain_skills_help_shows_subcommands() {
    sockt()
        .args(["brain", "skills", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("list"))
        .stdout(predicate::str::contains("show"))
        .stdout(predicate::str::contains("approve"))
        .stdout(predicate::str::contains("reject"));
}

#[test]
fn brain_skills_show_requires_name() {
    sockt()
        .args(["brain", "skills", "show"])
        .assert()
        .failure();
}

#[test]
fn brain_skills_approve_requires_name() {
    sockt()
        .args(["brain", "skills", "approve"])
        .assert()
        .failure();
}

// ========================================
// Phase 1: Summary Tests
// ========================================

#[test]
fn brain_summary_shows_file_count() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args(["brain", "--config", config_path.to_str().unwrap()])
        .assert()
        .success()
        .stdout(predicate::str::contains("GBrain"))
        .stdout(predicate::str::contains("Files:"))
        .stdout(predicate::str::contains("SOUL.md"));
}

#[test]
fn brain_summary_shows_last_commit() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args(["brain", "--config", config_path.to_str().unwrap()])
        .assert()
        .success()
        .stdout(predicate::str::contains("Last commit:"));
}

#[test]
fn brain_summary_shows_skills_count() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args(["brain", "--config", config_path.to_str().unwrap()])
        .assert()
        .success()
        .stdout(predicate::str::contains("Skills:"));
}

#[test]
fn brain_summary_gbrain_not_found() {
    let temp_dir = TempDir::new().unwrap();
    let sockt_dir = temp_dir.path().join(".sockt");
    fs::create_dir_all(&sockt_dir).unwrap();
    let config_yaml = r#"version: "0.1.0"
tier: local
deployment_id: test-brain
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
        .args(["brain", "--config", config_path.to_str().unwrap()])
        .assert()
        .failure()
        .stderr(predicate::str::contains("not found"));
}

// ========================================
// Phase 2: Show Tests
// ========================================

#[test]
fn brain_show_displays_file_content() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args([
            "brain",
            "show",
            "SOUL.md",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Company Identity"))
        .stdout(predicate::str::contains("Acme Corp"));
}

#[test]
fn brain_show_raw_flag() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args([
            "brain",
            "show",
            "SOUL.md",
            "--raw",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("# Company Identity"));
}

#[test]
fn brain_show_file_not_found() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args([
            "brain",
            "show",
            "NONEXISTENT.md",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .failure()
        .stderr(predicate::str::contains("not found"))
        .stderr(predicate::str::contains("SOUL.md"));
}

#[test]
fn brain_show_line_range() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args([
            "brain",
            "show",
            "SOUL.md",
            "--line",
            "1-2",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Company Identity"));
}

#[test]
fn brain_show_nested_path() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args([
            "brain",
            "show",
            "skills/lead-research.md",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Lead Research"));
}

// ========================================
// Phase 3: Search Tests
// ========================================

#[test]
fn brain_search_finds_match() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args([
            "brain",
            "search",
            "healthcare",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("MEMORY.md"))
        .stdout(predicate::str::contains("healthcare"));
}

#[test]
fn brain_search_no_results() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args([
            "brain",
            "search",
            "zzz_no_match_zzz",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("No results"));
}

#[test]
fn brain_search_file_filter() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args([
            "brain",
            "search",
            "enriching",
            "--file",
            "skills/*",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("lead-research.md"));
}

#[test]
fn brain_search_limit() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args([
            "brain",
            "search",
            "e",
            "--limit",
            "1",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("1 result"));
}

// ========================================
// Phase 4: Log Tests
// ========================================

#[test]
fn brain_log_shows_commits() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args([
            "brain",
            "log",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Initial scaffold"))
        .stdout(predicate::str::contains("Updated monitoring"));
}

#[test]
fn brain_log_oneline_format() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args([
            "brain",
            "log",
            "--oneline",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Updated monitoring"));
}

#[test]
fn brain_log_limit() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args([
            "brain",
            "log",
            "--limit",
            "1",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Updated monitoring"))
        .stdout(predicate::str::contains("Initial scaffold").not());
}

#[test]
fn brain_log_filter_by_agent() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args([
            "brain",
            "log",
            "--agent",
            "social-monitor",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("social-monitor"));
}

#[test]
fn brain_log_since_filter() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args([
            "brain",
            "log",
            "--since",
            "1d",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success();
}

// ========================================
// Phase 5: Diff Tests
// ========================================

#[test]
fn brain_diff_shows_changes() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args([
            "brain",
            "diff",
            "--since",
            "HEAD~1",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("MEMORY.md"));
}

#[test]
fn brain_diff_stat_mode() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args([
            "brain",
            "diff",
            "--stat",
            "--since",
            "HEAD~1",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("MEMORY.md"));
}

#[test]
fn brain_diff_duration_based() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args([
            "brain",
            "diff",
            "--since",
            "1d",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success();
}

// ========================================
// Phase 6: Edit Tests
// ========================================

#[test]
fn brain_edit_no_editor_set() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args([
            "brain",
            "edit",
            "SOUL.md",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .env_remove("EDITOR")
        .env_remove("VISUAL")
        .assert()
        .failure()
        .stderr(predicate::str::contains("editor"));
}

#[test]
fn brain_edit_file_not_found() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args([
            "brain",
            "edit",
            "NONEXISTENT.md",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .env("EDITOR", "true")
        .assert()
        .failure()
        .stderr(predicate::str::contains("not found"));
}

#[test]
fn brain_edit_spawns_editor() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args([
            "brain",
            "edit",
            "SOUL.md",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .env("EDITOR", "true")
        .assert()
        .success();
}

// ========================================
// Phase 7: Skills Tests
// ========================================

#[test]
fn brain_skills_list_shows_skills() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args([
            "brain",
            "skills",
            "list",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("lead-research"));
}

#[test]
fn brain_skills_bare_defaults_to_list() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args([
            "brain",
            "skills",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("lead-research"));
}

#[test]
fn brain_skills_show_displays_content() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args([
            "brain",
            "skills",
            "show",
            "lead-research",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Lead Research"))
        .stdout(predicate::str::contains("Steps"));
}

#[test]
fn brain_skills_show_not_found() {
    let (_temp, config_path) = setup_gbrain_fixture();
    sockt()
        .args([
            "brain",
            "skills",
            "show",
            "nonexistent",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .failure()
        .stderr(predicate::str::contains("No skill named"))
        .stderr(predicate::str::contains("lead-research"));
}

#[test]
fn brain_skills_approve() {
    let (_temp, config_path) = setup_gbrain_fixture();
    let gbrain_dir = _temp.path().join("gbrain");
    fs::write(
        gbrain_dir.join("skills").join("pending-new.md"),
        "---\nstatus: pending-review\n---\n# New Skill\nDoes things\n",
    )
    .unwrap();

    sockt()
        .args([
            "brain",
            "skills",
            "approve",
            "pending-new",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("production"));
}

#[test]
fn brain_skills_reject() {
    let (_temp, config_path) = setup_gbrain_fixture();
    let gbrain_dir = _temp.path().join("gbrain");
    fs::write(
        gbrain_dir.join("skills").join("bad-skill.md"),
        "---\nstatus: pending-review\n---\n# Bad Skill\n",
    )
    .unwrap();

    sockt()
        .args([
            "brain",
            "skills",
            "reject",
            "bad-skill",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("rejected"));

    assert!(!gbrain_dir.join("skills").join("bad-skill.md").exists());
}
