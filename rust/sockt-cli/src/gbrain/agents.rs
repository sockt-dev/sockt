use super::OnboardingAnswers;

pub fn generate(answers: &OnboardingAnswers) -> String {
    format!(
        r#"# Agents — {company_name}

## Architect Agent

**Role:** Strategic planning and task decomposition

The architect agent receives inbound requests and breaks them into actionable tasks.
It decides which worker agents to involve and sets priorities.

### Capabilities
- Task decomposition and planning
- Priority assignment
- Agent coordination
- Escalation decisions

### Constraints
- Cannot execute external actions directly
- Must delegate execution to worker agents
- Must respect approval thresholds defined in SOUL.md

---

## Monitor Agent

**Role:** Scheduled observation and reporting

The monitor agent runs on cron schedules to observe system state and report changes.

### Capabilities
- Periodic system checks
- Anomaly detection
- Status reporting
- Alert triggering

### Schedule
- Every 15 minutes: health checks
- Hourly: integration status
- Daily: summary report

---

## Worker Agent

**Role:** Task execution

Worker agents execute specific tasks assigned by the architect. They operate within
sandboxed environments and report results back.

### Capabilities
- External API calls (within approved tool set)
- Data gathering and analysis
- Message composition and delivery
- File creation and modification

### Tools Available
{tools_list}

---

## Configuration

- **Industry context:** {industry}
- **Team size:** {team_size}
- **Primary use case:** {use_case}
- **Communication tone:** {tone}
"#,
        company_name = answers.company_name,
        industry = answers.industry,
        team_size = answers.team_size,
        use_case = answers.primary_use_case,
        tone = answers.tone,
        tools_list = answers
            .tools_used
            .iter()
            .map(|t| format!("- {t}"))
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_with_heading() {
        let answers = OnboardingAnswers::default();
        let agents = generate(&answers);
        assert!(agents.starts_with("# Agents"));
    }

    #[test]
    fn includes_architect_and_worker_roles() {
        let answers = OnboardingAnswers::default();
        let agents = generate(&answers);
        assert!(agents.contains("## Architect Agent"));
        assert!(agents.contains("## Worker Agent"));
        assert!(agents.contains("## Monitor Agent"));
    }

    #[test]
    fn includes_tools_in_worker_section() {
        let answers = OnboardingAnswers {
            tools_used: vec!["Jira".to_string(), "PagerDuty".to_string()],
            ..Default::default()
        };
        let agents = generate(&answers);
        assert!(agents.contains("- Jira"));
        assert!(agents.contains("- PagerDuty"));
    }
}
