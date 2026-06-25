pub mod agents;
pub mod soul;

use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnboardingAnswers {
    pub company_name: String,
    pub industry: String,
    pub team_size: String,
    pub primary_use_case: String,
    pub tools_used: Vec<String>,
    pub tone: String,
    pub approval_threshold: String,
}

impl Default for OnboardingAnswers {
    fn default() -> Self {
        Self {
            company_name: "My Company".to_string(),
            industry: "Technology".to_string(),
            team_size: "1-10".to_string(),
            primary_use_case: "General automation".to_string(),
            tools_used: vec!["Slack".to_string()],
            tone: "professional".to_string(),
            approval_threshold: "balanced".to_string(),
        }
    }
}

pub struct GBrainScaffolder;

impl GBrainScaffolder {
    pub fn scaffold(dir: &Path, answers: &OnboardingAnswers) -> anyhow::Result<()> {
        std::fs::create_dir_all(dir)?;
        std::fs::create_dir_all(dir.join("skills"))?;
        std::fs::create_dir_all(dir.join("memory"))?;

        let soul_content = soul::generate(answers);
        std::fs::write(dir.join("SOUL.md"), soul_content)?;

        let agents_content = agents::generate(answers);
        std::fs::write(dir.join("AGENTS.md"), agents_content)?;

        let example_skill = include_str!("example_skill.md");
        std::fs::write(dir.join("skills").join("example.md"), example_skill)?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    use tempfile::TempDir;

    // ─── Directory Structure ─────────────────────────────────────────────

    #[test]
    fn scaffold_creates_directory_structure() {
        let dir = TempDir::new().unwrap();
        let gbrain_dir = dir.path().join("gbrain");
        let answers = OnboardingAnswers::default();

        GBrainScaffolder::scaffold(&gbrain_dir, &answers).unwrap();

        assert!(gbrain_dir.exists());
        assert!(gbrain_dir.join("skills").exists());
        assert!(gbrain_dir.join("memory").exists());
        assert!(gbrain_dir.join("SOUL.md").exists());
        assert!(gbrain_dir.join("AGENTS.md").exists());
        assert!(gbrain_dir.join("skills").join("example.md").exists());
    }

    #[test]
    fn scaffold_creates_nested_directory() {
        let dir = TempDir::new().unwrap();
        let gbrain_dir = dir.path().join("deep").join("nested").join("gbrain");
        let answers = OnboardingAnswers::default();

        GBrainScaffolder::scaffold(&gbrain_dir, &answers).unwrap();
        assert!(gbrain_dir.join("SOUL.md").exists());
    }

    #[test]
    fn scaffold_is_idempotent() {
        let dir = TempDir::new().unwrap();
        let gbrain_dir = dir.path().join("gbrain");
        let answers = OnboardingAnswers::default();

        GBrainScaffolder::scaffold(&gbrain_dir, &answers).unwrap();
        GBrainScaffolder::scaffold(&gbrain_dir, &answers).unwrap();

        assert!(gbrain_dir.join("SOUL.md").exists());
    }

    #[test]
    fn scaffold_overwrites_existing_files() {
        let dir = TempDir::new().unwrap();
        let gbrain_dir = dir.path().join("gbrain");

        let answers1 = OnboardingAnswers {
            company_name: "First Corp".to_string(),
            ..Default::default()
        };
        GBrainScaffolder::scaffold(&gbrain_dir, &answers1).unwrap();

        let answers2 = OnboardingAnswers {
            company_name: "Second Corp".to_string(),
            ..Default::default()
        };
        GBrainScaffolder::scaffold(&gbrain_dir, &answers2).unwrap();

        let soul = std::fs::read_to_string(gbrain_dir.join("SOUL.md")).unwrap();
        assert!(soul.contains("Second Corp"));
        assert!(!soul.contains("First Corp"));
    }

    // ─── SOUL.md Content ─────────────────────────────────────────────────

    #[test]
    fn scaffold_soul_contains_company_name() {
        let dir = TempDir::new().unwrap();
        let gbrain_dir = dir.path().join("gbrain");
        let answers = OnboardingAnswers {
            company_name: "Acme Corp".to_string(),
            ..Default::default()
        };

        GBrainScaffolder::scaffold(&gbrain_dir, &answers).unwrap();

        let soul = std::fs::read_to_string(gbrain_dir.join("SOUL.md")).unwrap();
        assert!(soul.contains("Acme Corp"));
    }

    #[test]
    fn soul_contains_industry() {
        let answers = OnboardingAnswers {
            industry: "Healthcare".to_string(),
            ..Default::default()
        };
        let soul = soul::generate(&answers);
        assert!(soul.contains("Healthcare"));
    }

    #[test]
    fn soul_contains_team_size() {
        let answers = OnboardingAnswers {
            team_size: "51-200".to_string(),
            ..Default::default()
        };
        let soul = soul::generate(&answers);
        assert!(soul.contains("51-200"));
    }

    #[test]
    fn soul_contains_use_case() {
        let answers = OnboardingAnswers {
            primary_use_case: "Incident response automation".to_string(),
            ..Default::default()
        };
        let soul = soul::generate(&answers);
        assert!(soul.contains("Incident response automation"));
    }

    #[test]
    fn soul_contains_all_tools() {
        let answers = OnboardingAnswers {
            tools_used: vec![
                "Slack".to_string(),
                "GitHub".to_string(),
                "Linear".to_string(),
                "Notion".to_string(),
                "PagerDuty".to_string(),
            ],
            ..Default::default()
        };
        let soul = soul::generate(&answers);
        for tool in &answers.tools_used {
            assert!(soul.contains(tool), "missing tool: {}", tool);
        }
    }

    #[test]
    fn soul_with_empty_tools_list() {
        let answers = OnboardingAnswers {
            tools_used: vec![],
            ..Default::default()
        };
        let soul = soul::generate(&answers);
        // Should still produce valid markdown
        assert!(soul.contains("## Tools & Integrations"));
    }

    #[test]
    fn soul_approval_thresholds_distinct() {
        let thresholds = ["conservative", "balanced", "permissive"];
        let mut outputs = std::collections::HashSet::new();

        for threshold in thresholds {
            let answers = OnboardingAnswers {
                approval_threshold: threshold.to_string(),
                ..Default::default()
            };
            outputs.insert(soul::generate(&answers));
        }

        assert_eq!(outputs.len(), 3, "each threshold should produce unique output");
    }

    // ─── AGENTS.md Content ───────────────────────────────────────────────

    #[test]
    fn scaffold_agents_is_valid_markdown() {
        let dir = TempDir::new().unwrap();
        let gbrain_dir = dir.path().join("gbrain");
        let answers = OnboardingAnswers::default();

        GBrainScaffolder::scaffold(&gbrain_dir, &answers).unwrap();

        let agents = std::fs::read_to_string(gbrain_dir.join("AGENTS.md")).unwrap();
        assert!(agents.starts_with('#'));
        assert!(agents.contains("## "));
    }

    #[test]
    fn agents_contains_all_three_roles() {
        let answers = OnboardingAnswers::default();
        let agents = agents::generate(&answers);
        assert!(agents.contains("Architect"));
        assert!(agents.contains("Monitor"));
        assert!(agents.contains("Worker"));
    }

    #[test]
    fn agents_contains_company_context() {
        let answers = OnboardingAnswers {
            company_name: "SpecialCo".to_string(),
            industry: "EdTech".to_string(),
            ..Default::default()
        };
        let agents = agents::generate(&answers);
        assert!(agents.contains("SpecialCo"));
        assert!(agents.contains("EdTech"));
    }

    // ─── Example Skill ───────────────────────────────────────────────────

    #[test]
    fn example_skill_is_valid_markdown() {
        let dir = TempDir::new().unwrap();
        let gbrain_dir = dir.path().join("gbrain");
        let answers = OnboardingAnswers::default();

        GBrainScaffolder::scaffold(&gbrain_dir, &answers).unwrap();

        let skill = std::fs::read_to_string(gbrain_dir.join("skills").join("example.md")).unwrap();
        assert!(skill.starts_with('#'));
        assert!(skill.contains("Trigger"));
        assert!(skill.contains("Steps"));
    }

    // ─── Snapshots ───────────────────────────────────────────────────────

    #[test]
    fn snapshot_soul() {
        let answers = OnboardingAnswers {
            company_name: "TestCorp".to_string(),
            industry: "FinTech".to_string(),
            team_size: "11-50".to_string(),
            primary_use_case: "Customer support automation".to_string(),
            tools_used: vec!["Slack".to_string(), "Jira".to_string(), "GitHub".to_string()],
            tone: "professional".to_string(),
            approval_threshold: "conservative".to_string(),
        };

        let soul = soul::generate(&answers);
        insta::assert_snapshot!("soul_md", soul);
    }

    #[test]
    fn snapshot_agents() {
        let answers = OnboardingAnswers {
            company_name: "TestCorp".to_string(),
            industry: "FinTech".to_string(),
            team_size: "11-50".to_string(),
            primary_use_case: "Customer support automation".to_string(),
            tools_used: vec!["Slack".to_string(), "Jira".to_string(), "GitHub".to_string()],
            tone: "professional".to_string(),
            approval_threshold: "conservative".to_string(),
        };

        let agents = agents::generate(&answers);
        insta::assert_snapshot!("agents_md", agents);
    }

    // ─── Property-Based Tests ────────────────────────────────────────────

    proptest! {
        #[test]
        fn soul_always_contains_company_name(name in "[A-Za-z ]{1,50}") {
            let answers = OnboardingAnswers {
                company_name: name.clone(),
                ..Default::default()
            };
            let soul = soul::generate(&answers);
            prop_assert!(soul.contains(&name));
        }

        #[test]
        fn agents_always_contains_company_name(name in "[A-Za-z ]{1,50}") {
            let answers = OnboardingAnswers {
                company_name: name.clone(),
                ..Default::default()
            };
            let agents_output = agents::generate(&answers);
            prop_assert!(agents_output.contains(&name));
        }

        #[test]
        fn soul_never_empty(
            name in ".+",
            industry in ".+",
        ) {
            let answers = OnboardingAnswers {
                company_name: name,
                industry,
                ..Default::default()
            };
            let soul = soul::generate(&answers);
            prop_assert!(!soul.is_empty());
            prop_assert!(soul.len() > 100);
        }

        #[test]
        fn scaffold_succeeds_for_any_answers(
            name in "[A-Za-z0-9 ]{1,30}",
            industry in "[A-Za-z ]{1,20}",
            tone in "(professional|casual|friendly)",
        ) {
            let dir = TempDir::new().unwrap();
            let gbrain_dir = dir.path().join("gb");
            let answers = OnboardingAnswers {
                company_name: name,
                industry,
                tone,
                ..Default::default()
            };
            GBrainScaffolder::scaffold(&gbrain_dir, &answers).unwrap();
            prop_assert!(gbrain_dir.join("SOUL.md").exists());
            prop_assert!(gbrain_dir.join("AGENTS.md").exists());
        }
    }

    // ─── Unicode Handling ────────────────────────────────────────────────

    #[test]
    fn scaffold_handles_unicode_company() {
        let dir = TempDir::new().unwrap();
        let gbrain_dir = dir.path().join("gbrain");
        let answers = OnboardingAnswers {
            company_name: "企業テスト 🏢".to_string(),
            industry: "技術".to_string(),
            tools_used: vec!["スラック".to_string()],
            ..Default::default()
        };

        GBrainScaffolder::scaffold(&gbrain_dir, &answers).unwrap();

        let soul = std::fs::read_to_string(gbrain_dir.join("SOUL.md")).unwrap();
        assert!(soul.contains("企業テスト 🏢"));
        assert!(soul.contains("技術"));
        assert!(soul.contains("スラック"));
    }

    #[test]
    fn scaffold_handles_special_markdown_characters() {
        let dir = TempDir::new().unwrap();
        let gbrain_dir = dir.path().join("gbrain");
        let answers = OnboardingAnswers {
            company_name: "Foo & Bar <Inc>".to_string(),
            primary_use_case: "Handle [brackets] and *asterisks*".to_string(),
            ..Default::default()
        };

        GBrainScaffolder::scaffold(&gbrain_dir, &answers).unwrap();

        let soul = std::fs::read_to_string(gbrain_dir.join("SOUL.md")).unwrap();
        assert!(soul.contains("Foo & Bar <Inc>"));
    }
}
