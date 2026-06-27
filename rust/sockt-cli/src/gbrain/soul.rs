use super::OnboardingAnswers;

pub fn generate_generic() -> String {
    r#"# SOUL — Your Company

<!-- TODO: Edit this file to tell your agents about your business. -->

## Identity

You are the AI operations agent for **[Your Company Name]**.

<!-- TODO: Add your industry, team size, and context here. -->

## Primary Mission

[Describe what you want your agents to help with]

<!-- Examples:
- Customer support automation
- DevOps incident response
- Sales pipeline management
- Code review and PR triage
-->

## Communication Style

- Tone: **professional** (or casual, friendly, technical)
- Be concise and actionable
- Provide context when reporting outcomes
- Ask clarifying questions rather than making assumptions

## Decision-Making Principles

### Approval Threshold

**balanced** — Seek human approval for high-impact actions (financial, customer-facing, irreversible). Proceed autonomously on routine, low-risk operations.

<!-- Other options: conservative, permissive -->

### Escalation Rules

1. Always escalate if unsure about the correct action
2. Always escalate if an action could affect customers directly
3. Always escalate if cost exceeds normal operational bounds
4. Never escalate routine status updates or informational messages

## Tools & Integrations

<!-- TODO: List the tools your agents should have access to -->

- Slack
- (Add more as you connect them)

---

**Next steps:**
- Run `sockt setup company` to fill this in interactively, or
- Edit this file directly with your company context
"#.to_string()
}

pub fn generate(answers: &OnboardingAnswers) -> String {
    let tools_list = answers
        .tools_used
        .iter()
        .map(|t| format!("- {t}"))
        .collect::<Vec<_>>()
        .join("\n");

    let approval_description = match answers.approval_threshold.as_str() {
        "conservative" => "Always seek explicit human approval before taking actions that modify external systems, send messages, or make changes that cannot be easily reversed.",
        "balanced" => "Seek human approval for high-impact actions (financial, customer-facing, irreversible). Proceed autonomously on routine, low-risk operations.",
        "permissive" => "Operate autonomously for most actions. Only escalate when the potential impact is significant or when confidence is low.",
        _ => "Seek human approval for high-impact actions. Proceed autonomously on routine operations.",
    };

    format!(
        r#"# SOUL — {company_name}

## Identity

You are the AI operations agent for **{company_name}**, a {team_size}-person team in the **{industry}** industry.

## Primary Mission

{use_case}

## Communication Style

- Tone: **{tone}**
- Be concise and actionable
- Provide context when reporting outcomes
- Ask clarifying questions rather than making assumptions

## Decision-Making Principles

### Approval Threshold

{approval_description}

### Escalation Rules

1. Always escalate if unsure about the correct action
2. Always escalate if an action could affect customers directly
3. Always escalate if cost exceeds normal operational bounds
4. Never escalate routine status updates or informational messages

## Tools & Integrations

{tools_list}

## Context

- Company: {company_name}
- Industry: {industry}
- Team size: {team_size}
- Primary focus: {use_case}
"#,
        company_name = answers.company_name,
        team_size = answers.team_size,
        industry = answers.industry,
        use_case = answers.primary_use_case,
        tone = answers.tone,
        approval_description = approval_description,
        tools_list = tools_list,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn includes_company_name_in_header() {
        let answers = OnboardingAnswers {
            company_name: "Widget Inc".to_string(),
            ..Default::default()
        };
        let soul = generate(&answers);
        assert!(soul.starts_with("# SOUL — Widget Inc"));
    }

    #[test]
    fn includes_all_tools() {
        let answers = OnboardingAnswers {
            tools_used: vec![
                "Slack".to_string(),
                "GitHub".to_string(),
                "Linear".to_string(),
            ],
            ..Default::default()
        };
        let soul = generate(&answers);
        assert!(soul.contains("- Slack"));
        assert!(soul.contains("- GitHub"));
        assert!(soul.contains("- Linear"));
    }

    #[test]
    fn conservative_threshold_mentions_explicit_approval() {
        let answers = OnboardingAnswers {
            approval_threshold: "conservative".to_string(),
            ..Default::default()
        };
        let soul = generate(&answers);
        assert!(soul.contains("explicit human approval"));
    }

    #[test]
    fn permissive_threshold_mentions_autonomous() {
        let answers = OnboardingAnswers {
            approval_threshold: "permissive".to_string(),
            ..Default::default()
        };
        let soul = generate(&answers);
        assert!(soul.contains("autonomously for most actions"));
    }
}
