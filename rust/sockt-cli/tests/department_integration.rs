use assert_cmd::Command;
use predicates::prelude::*;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

fn sockt() -> Command {
    Command::cargo_bin("sockt").unwrap()
}

fn setup_test_config() -> (TempDir, PathBuf) {
    let temp_dir = TempDir::new().unwrap();
    let sockt_dir = temp_dir.path().join(".sockt");
    std::fs::create_dir_all(&sockt_dir).unwrap();

    let config_path = sockt_dir.join("config.yaml");
    let key_path = sockt_dir.join("key.txt");

    // Generate encryption key first
    let identity = age::x25519::Identity::generate();
    use age::secrecy::ExposeSecret;
    let key_str = identity.to_string();
    std::fs::write(&key_path, key_str.expose_secret()).unwrap();

    // Create recipient from identity
    let recipient = identity.to_public();

    // Encrypt a test value
    let test_value = "test-value";
    let encrypted = {
        let recipients: Vec<&dyn age::Recipient> = vec![&recipient];
        let encryptor = age::Encryptor::with_recipients(recipients.into_iter())
            .expect("Failed to create encryptor");

        let mut encrypted_bytes = vec![];
        let mut writer = encryptor.wrap_output(&mut encrypted_bytes).unwrap();

        std::io::Write::write_all(&mut writer, test_value.as_bytes()).unwrap();
        writer.finish().unwrap();

        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &encrypted_bytes)
    };

    let recipient_str = recipient.to_string();

    // Create minimal valid config with departments section
    let config_yaml = format!(
        r#"version: "0.1"
tier: local
deployment_id: test-deployment-id
slack:
  app_token:
    ciphertext: "{encrypted}"
    recipient: "{recipient_str}"
  bot_token:
    ciphertext: "{encrypted}"
    recipient: "{recipient_str}"
  signing_secret:
    ciphertext: "{encrypted}"
    recipient: "{recipient_str}"
  socket_mode: true
models:
  provider: anthropic
  frontier: claude-sonnet-4-20250514
  fast: claude-haiku-4-20250514
  api_key:
    ciphertext: "{encrypted}"
    recipient: "{recipient_str}"
  base_url: null
  aws_region: null
gbrain:
  directory: "./gbrain"
  soul_file: "SOUL.md"
  agents_file: "AGENTS.md"
integrations: {{}}
departments:
  active: []
"#
    );

    std::fs::write(&config_path, config_yaml).unwrap();

    (temp_dir, config_path)
}

fn setup_with_departments(active: Vec<String>) -> (TempDir, PathBuf) {
    let (temp_dir, config_path) = setup_test_config();

    // Read config and update with active departments
    let mut content = std::fs::read_to_string(&config_path).unwrap();
    content = content.replace("active: []", &format!("active: [{}]",
        active.iter().map(|s| format!("\"{}\"", s)).collect::<Vec<_>>().join(", ")
    ));
    std::fs::write(&config_path, content).unwrap();

    (temp_dir, config_path)
}

fn read_config(path: &Path) -> serde_yaml::Value {
    let content = std::fs::read_to_string(path).unwrap();
    serde_yaml::from_str(&content).unwrap()
}

// ============================================================================
// Phase 1: CLI Parsing Tests
// ============================================================================

#[test]
fn test_department_help_shows_subcommands() {
    sockt()
        .args(["department", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("list"))
        .stdout(predicate::str::contains("add"))
        .stdout(predicate::str::contains("remove"))
        .stdout(predicate::str::contains("info"));
}

#[test]
fn test_department_list_help_shows_available_flag() {
    sockt()
        .args(["department", "list", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("--available"));
}

#[test]
fn test_department_add_requires_name() {
    sockt()
        .args(["department", "add"])
        .assert()
        .failure();
}

#[test]
fn test_department_add_help_shows_non_interactive_flag() {
    sockt()
        .args(["department", "add", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("--non-interactive"));
}

#[test]
fn test_department_remove_requires_name() {
    sockt()
        .args(["department", "remove"])
        .assert()
        .failure();
}

#[test]
fn test_department_remove_help_shows_flags() {
    sockt()
        .args(["department", "remove", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("--confirm"))
        .stdout(predicate::str::contains("--keep-data"));
}

#[test]
fn test_department_info_requires_name() {
    sockt()
        .args(["department", "info"])
        .assert()
        .failure();
}

#[test]
fn test_department_info_help_shows_json_flag() {
    sockt()
        .args(["department", "info", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("--json"));
}

// ============================================================================
// Phase 2: Validation Tests
// ============================================================================

#[test]
fn test_add_invalid_template_fails() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "department",
            "add",
            "invalid-dept",
            "--non-interactive",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .failure()
        .stderr(predicate::str::contains("Unknown department"))
        .stderr(predicate::str::contains("Available"));
}

#[test]
fn test_add_already_active_fails() {
    let (_temp_dir, config_path) = setup_with_departments(vec!["growth".to_string()]);

    sockt()
        .args([
            "department",
            "add",
            "growth",
            "--non-interactive",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .failure()
        .stderr(predicate::str::contains("already deployed"));
}

#[test]
fn test_remove_non_existent_fails() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "department",
            "remove",
            "growth",
            "--confirm",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .failure()
        .stderr(predicate::str::contains("not deployed"));
}

#[test]
fn test_info_non_existent_fails() {
    sockt()
        .args(["department", "info", "invalid-dept"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("Unknown department"));
}

#[test]
fn test_add_validates_config_exists() {
    let temp_dir = TempDir::new().unwrap();
    let non_existent_config = temp_dir.path().join(".sockt/config.yaml");

    sockt()
        .args([
            "department",
            "add",
            "growth",
            "--non-interactive",
            "--config",
            non_existent_config.to_str().unwrap(),
        ])
        .assert()
        .failure()
        .stderr(predicate::str::contains("Run `sockt init` first"));
}

#[test]
fn test_list_requires_config() {
    let temp_dir = TempDir::new().unwrap();
    let non_existent_config = temp_dir.path().join(".sockt/config.yaml");

    sockt()
        .args([
            "department",
            "--config",
            non_existent_config.to_str().unwrap(),
        ])
        .assert()
        .failure()
        .stderr(predicate::str::contains("Run `sockt init` first"));
}

// ============================================================================
// Phase 3: Integration Tests
// ============================================================================

#[test]
fn test_add_growth_updates_config() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "department",
            "add",
            "growth",
            "--non-interactive",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Growth & Lead Generation"))
        .stdout(predicate::str::contains("department added"));

    // Verify config was updated
    let config = read_config(&config_path);
    let active = config["departments"]["active"].as_sequence().unwrap();
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].as_str().unwrap(), "growth");
}

#[test]
fn test_add_product_updates_agents_md() {
    let (temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "department",
            "add",
            "product",
            "--non-interactive",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success();

    // Verify AGENTS.md was created/updated
    let gbrain_path = temp_dir.path().join("gbrain");
    let agents_md_path = gbrain_path.join("AGENTS.md");
    assert!(agents_md_path.exists());

    let content = std::fs::read_to_string(&agents_md_path).unwrap();
    assert!(content.contains("## Department: Product Development"));
}

#[test]
fn test_add_creates_department_section() {
    let (temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "department",
            "add",
            "growth",
            "--non-interactive",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success();

    // Verify AGENTS.md contains agent details
    let agents_md_path = temp_dir.path().join("gbrain/AGENTS.md");
    let content = std::fs::read_to_string(&agents_md_path).unwrap();

    assert!(content.contains("### Lead Researcher"));
    assert!(content.contains("### Outbound Writer"));
    assert!(content.contains("### Social Monitor"));
    assert!(content.contains("**Role:**"));
    assert!(content.contains("**Tools:**"));
}

#[test]
fn test_remove_updates_config() {
    let (_temp_dir, config_path) = setup_with_departments(vec!["growth".to_string()]);

    sockt()
        .args([
            "department",
            "remove",
            "growth",
            "--confirm",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("department removed"));

    // Verify config was updated
    let config = read_config(&config_path);
    let active = config["departments"]["active"].as_sequence().unwrap();
    assert_eq!(active.len(), 0);
}

#[test]
fn test_remove_preserves_data_by_default() {
    let (temp_dir, config_path) = setup_with_departments(vec!["growth".to_string()]);

    // Create AGENTS.md with department section
    let gbrain_path = temp_dir.path().join("gbrain");
    std::fs::create_dir_all(&gbrain_path).unwrap();
    let agents_md_path = gbrain_path.join("AGENTS.md");
    std::fs::write(&agents_md_path, "# Agents\n\n## Department: Growth & Lead Generation\n\nContent\n").unwrap();

    sockt()
        .args([
            "department",
            "remove",
            "growth",
            "--confirm",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("GBrain data preserved"));

    // Verify AGENTS.md still exists and contains section
    let content = std::fs::read_to_string(&agents_md_path).unwrap();
    assert!(content.contains("## Department: Growth"));
}

#[test]
fn test_remove_keep_data_false_removes_section() {
    let (temp_dir, config_path) = setup_with_departments(vec!["growth".to_string()]);

    // Create AGENTS.md with department section
    let gbrain_path = temp_dir.path().join("gbrain");
    std::fs::create_dir_all(&gbrain_path).unwrap();
    let agents_md_path = gbrain_path.join("AGENTS.md");
    std::fs::write(&agents_md_path, "# Agents\n\n## Department: Growth & Lead Generation\n\nContent\n\n## Other Section\n\nOther content").unwrap();

    sockt()
        .args([
            "department",
            "remove",
            "growth",
            "--confirm",
            "--keep-data=false",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success();

    // Verify AGENTS.md section was removed
    let content = std::fs::read_to_string(&agents_md_path).unwrap();
    assert!(!content.contains("## Department: Growth"));
    assert!(content.contains("## Other Section"));
}

#[test]
fn test_info_shows_department_details() {
    sockt()
        .args(["department", "info", "growth"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Growth & Lead Generation"))
        .stdout(predicate::str::contains("Lead Researcher"))
        .stdout(predicate::str::contains("Role:"))
        .stdout(predicate::str::contains("Tools:"));
}

#[test]
fn test_info_json_output() {
    sockt()
        .args(["department", "info", "growth", "--json"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"id\""))
        .stdout(predicate::str::contains("\"display_name\""))
        .stdout(predicate::str::contains("\"agents\""));
}

#[test]
fn test_list_shows_available_when_none_active() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args(["department", "--config", config_path.to_str().unwrap()])
        .assert()
        .success()
        .stdout(predicate::str::contains("ACTIVE DEPARTMENTS (0)"))
        .stdout(predicate::str::contains("AVAILABLE:"))
        .stdout(predicate::str::contains("growth"))
        .stdout(predicate::str::contains("product"))
        .stdout(predicate::str::contains("engops"));
}

#[test]
fn test_list_shows_active_departments() {
    let (_temp_dir, config_path) = setup_with_departments(vec!["growth".to_string()]);

    sockt()
        .args(["department", "--config", config_path.to_str().unwrap()])
        .assert()
        .success()
        .stdout(predicate::str::contains("ACTIVE DEPARTMENTS (1)"))
        .stdout(predicate::str::contains("growth — Growth & Lead Generation"))
        .stdout(predicate::str::contains("Agents: 3"));
}

#[test]
fn test_list_templates_shows_all() {
    let (_temp_dir, config_path) = setup_test_config();

    sockt()
        .args([
            "department",
            "list",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("BUILT-IN TEMPLATES"))
        .stdout(predicate::str::contains("growth"))
        .stdout(predicate::str::contains("product"))
        .stdout(predicate::str::contains("engops"))
        .stdout(predicate::str::contains("Use case:"));
}

#[test]
fn test_list_available_only_filters() {
    let (_temp_dir, config_path) = setup_with_departments(vec!["growth".to_string()]);

    sockt()
        .args([
            "department",
            "list",
            "--available",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("product"))
        .stdout(predicate::str::contains("engops"))
        .stdout(predicate::str::contains("growth").not());
}

#[test]
fn test_add_multiple_departments() {
    let (_temp_dir, config_path) = setup_test_config();

    // Add growth
    sockt()
        .args([
            "department",
            "add",
            "growth",
            "--non-interactive",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success();

    // Add product
    sockt()
        .args([
            "department",
            "add",
            "product",
            "--non-interactive",
            "--config",
            config_path.to_str().unwrap(),
        ])
        .assert()
        .success();

    // Verify both are in config
    let config = read_config(&config_path);
    let active = config["departments"]["active"].as_sequence().unwrap();
    assert_eq!(active.len(), 2);
}
