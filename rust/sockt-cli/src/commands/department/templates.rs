pub struct AgentSpec {
    pub name: &'static str,
    pub role: &'static str,
    pub description: &'static str,
    pub tools: &'static [&'static str],
    pub schedule: &'static str,
    pub hitl: &'static str,
}

pub struct DepartmentTemplate {
    pub id: &'static str,
    pub display_name: &'static str,
    pub description: &'static str,
    pub agents: &'static [AgentSpec],
    pub required_integrations: &'static [&'static str],
    pub optional_integrations: &'static [&'static str],
}

const GROWTH_TEMPLATE: DepartmentTemplate = DepartmentTemplate {
    id: "growth",
    display_name: "Growth & Lead Generation",
    description: "Find and qualify leads, draft outreach",
    agents: &[
        AgentSpec {
            name: "Lead Researcher",
            role: "Enrich leads with company data, contact scoring",
            description: "Enriches leads with company data and scores contacts",
            tools: &["apollo", "hunter.io", "hubspot"],
            schedule: "on-demand (triggered by Social Monitor)",
            hitl: "auto-execute (Tier 1)",
        },
        AgentSpec {
            name: "Outbound Writer",
            role: "Draft personalized outreach messages",
            description: "Drafts personalized outreach messages",
            tools: &["gmail", "hubspot"],
            schedule: "on-demand (triggered by Lead Researcher)",
            hitl: "all sends require approval (Tier 2)",
        },
        AgentSpec {
            name: "Social Monitor",
            role: "Monitor channels for buying-intent signals",
            description: "Monitors social channels for buying-intent signals",
            tools: &["reddit", "linkedin", "hn", "twitter"],
            schedule: "every 4 hours",
            hitl: "auto-execute (Tier 1)",
        },
    ],
    required_integrations: &["hubspot"],
    optional_integrations: &["apollo", "linkedin"],
};

const PRODUCT_TEMPLATE: DepartmentTemplate = DepartmentTemplate {
    id: "product",
    display_name: "Product Development",
    description: "Ship features, fix bugs, write tests",
    agents: &[
        AgentSpec {
            name: "Product Architect",
            role: "Designs features, writes specs",
            description: "Designs features and writes specifications",
            tools: &["linear", "github"],
            schedule: "on-demand",
            hitl: "auto-execute (Tier 1)",
        },
        AgentSpec {
            name: "Coder Agent",
            role: "Implements code in sandboxed environment",
            description: "Implements code in sandboxed environment",
            tools: &["github", "code-sandbox"],
            schedule: "on-demand",
            hitl: "all PRs require approval (Tier 2)",
        },
        AgentSpec {
            name: "QA Tester",
            role: "Validates code, finds bugs",
            description: "Validates code and finds bugs",
            tools: &["github", "code-sandbox"],
            schedule: "on-demand (after Coder Agent)",
            hitl: "auto-execute (Tier 1)",
        },
    ],
    required_integrations: &["github"],
    optional_integrations: &["linear"],
};

const ENGOPS_TEMPLATE: DepartmentTemplate = DepartmentTemplate {
    id: "engops",
    display_name: "Engineering Operations",
    description: "Detect incidents, triage, document resolutions",
    agents: &[
        AgentSpec {
            name: "Eng-Ops Architect",
            role: "Triages incidents, coordinates response",
            description: "Triages incidents and coordinates response",
            tools: &["sentry", "datadog", "pagerduty"],
            schedule: "on-demand",
            hitl: "auto-execute (Tier 1)",
        },
        AgentSpec {
            name: "Deploy Worker",
            role: "Manages deployments and rollbacks",
            description: "Manages deployments and rollbacks",
            tools: &["github", "datadog"],
            schedule: "on-demand",
            hitl: "all deploys require approval (Tier 2)",
        },
        AgentSpec {
            name: "Sentry Monitor",
            role: "Monitors error rates, alerts on anomalies",
            description: "Monitors error rates and alerts on anomalies",
            tools: &["sentry", "slack"],
            schedule: "every 10 minutes",
            hitl: "auto-execute (Tier 1)",
        },
    ],
    required_integrations: &["sentry"],
    optional_integrations: &["pagerduty", "datadog"],
};

pub fn get_template(name: &str) -> Option<&'static DepartmentTemplate> {
    match name {
        "growth" => Some(&GROWTH_TEMPLATE),
        "product" => Some(&PRODUCT_TEMPLATE),
        "engops" => Some(&ENGOPS_TEMPLATE),
        _ => None,
    }
}

pub fn all_templates() -> &'static [&'static DepartmentTemplate] {
    &[&GROWTH_TEMPLATE, &PRODUCT_TEMPLATE, &ENGOPS_TEMPLATE]
}

pub fn template_names() -> &'static [&'static str] {
    &["growth", "product", "engops"]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_growth_template_has_three_agents() {
        assert_eq!(GROWTH_TEMPLATE.agents.len(), 3);
    }

    #[test]
    fn test_all_templates_parseable() {
        let templates = all_templates();
        assert_eq!(templates.len(), 3);
    }

    #[test]
    fn test_template_names_match_ids() {
        let names = template_names();
        assert!(names.contains(&"growth"));
        assert!(names.contains(&"product"));
        assert!(names.contains(&"engops"));
    }

    #[test]
    fn test_get_template_returns_valid() {
        assert!(get_template("growth").is_some());
        assert!(get_template("product").is_some());
        assert!(get_template("engops").is_some());
        assert!(get_template("invalid").is_none());
    }
}
