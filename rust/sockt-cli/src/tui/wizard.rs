use crate::cli::Tier;
use crate::config::ModelProvider;
use crate::gbrain::OnboardingAnswers;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WizardStep {
    TierSelection,
    LlmSetup,
    SlackCredentials,
    CompanyInfo,
    Review,
}

#[derive(Debug, Clone)]
pub struct WizardState {
    pub step: WizardStep,
    pub tier: Option<Tier>,
    // LLM
    pub model_provider: Option<ModelProvider>,
    pub model_api_key: String,
    pub model_base_url: String,
    pub model_frontier: String,
    pub model_fast: String,
    pub model_verified: bool,
    pub aws_region: String,
    // Slack
    pub slack_app_token: String,
    pub slack_bot_token: String,
    pub slack_signing_secret: String,
    // Company
    pub company_name: String,
    pub industry: String,
    pub team_size: String,
    pub primary_use_case: String,
    pub tools_used: Vec<String>,
    pub tone: String,
    pub approval_threshold: String,
}

impl Default for WizardState {
    fn default() -> Self {
        Self {
            step: WizardStep::TierSelection,
            tier: None,
            model_provider: None,
            model_api_key: String::new(),
            model_base_url: String::new(),
            model_frontier: String::new(),
            model_fast: String::new(),
            model_verified: false,
            aws_region: String::new(),
            slack_app_token: String::new(),
            slack_bot_token: String::new(),
            slack_signing_secret: String::new(),
            company_name: String::new(),
            industry: String::new(),
            team_size: String::new(),
            primary_use_case: String::new(),
            tools_used: vec![],
            tone: "professional".to_string(),
            approval_threshold: "balanced".to_string(),
        }
    }
}

impl WizardState {
    pub fn advance(&mut self) -> Result<(), WizardValidationError> {
        match self.step {
            WizardStep::TierSelection => {
                if self.tier.is_none() {
                    return Err(WizardValidationError::Required("tier".to_string()));
                }
                self.step = WizardStep::LlmSetup;
            }
            WizardStep::LlmSetup => {
                let provider = self
                    .model_provider
                    .as_ref()
                    .ok_or_else(|| WizardValidationError::Required("provider".to_string()))?;

                match provider {
                    ModelProvider::Anthropic | ModelProvider::Openai => {
                        if self.model_api_key.is_empty() {
                            return Err(WizardValidationError::Required(
                                "api_key".to_string(),
                            ));
                        }
                    }
                    ModelProvider::Bedrock => {
                        if self.model_api_key.is_empty() {
                            return Err(WizardValidationError::Required(
                                "api_key".to_string(),
                            ));
                        }
                        if self.aws_region.is_empty() {
                            return Err(WizardValidationError::Required(
                                "aws_region".to_string(),
                            ));
                        }
                    }
                    ModelProvider::Custom => {
                        if self.model_base_url.is_empty() {
                            return Err(WizardValidationError::Required(
                                "base_url".to_string(),
                            ));
                        }
                        if self.model_api_key.is_empty() {
                            return Err(WizardValidationError::Required(
                                "api_key".to_string(),
                            ));
                        }
                    }
                }

                if self.model_frontier.is_empty() {
                    return Err(WizardValidationError::Required(
                        "frontier_model".to_string(),
                    ));
                }
                if self.model_fast.is_empty() {
                    return Err(WizardValidationError::Required("fast_model".to_string()));
                }

                self.step = WizardStep::SlackCredentials;
            }
            WizardStep::SlackCredentials => {
                if !self.slack_app_token.starts_with("xapp-") {
                    return Err(WizardValidationError::InvalidFormat(
                        "App token must start with 'xapp-'".to_string(),
                    ));
                }
                if !self.slack_bot_token.starts_with("xoxb-") {
                    return Err(WizardValidationError::InvalidFormat(
                        "Bot token must start with 'xoxb-'".to_string(),
                    ));
                }
                if self.slack_signing_secret.is_empty() {
                    return Err(WizardValidationError::Required(
                        "signing_secret".to_string(),
                    ));
                }
                self.step = WizardStep::CompanyInfo;
            }
            WizardStep::CompanyInfo => {
                if self.company_name.is_empty() {
                    return Err(WizardValidationError::Required(
                        "company_name".to_string(),
                    ));
                }
                self.step = WizardStep::Review;
            }
            WizardStep::Review => {}
        }
        Ok(())
    }

    pub fn back(&mut self) {
        self.step = match self.step {
            WizardStep::TierSelection => WizardStep::TierSelection,
            WizardStep::LlmSetup => WizardStep::TierSelection,
            WizardStep::SlackCredentials => WizardStep::LlmSetup,
            WizardStep::CompanyInfo => WizardStep::SlackCredentials,
            WizardStep::Review => WizardStep::CompanyInfo,
        };
    }

    pub fn into_answers(self) -> Result<OnboardingAnswers, WizardValidationError> {
        if self.step != WizardStep::Review {
            return Err(WizardValidationError::Incomplete);
        }
        Ok(OnboardingAnswers {
            company_name: self.company_name,
            industry: self.industry,
            team_size: self.team_size,
            primary_use_case: self.primary_use_case,
            tools_used: self.tools_used,
            tone: self.tone,
            approval_threshold: self.approval_threshold,
        })
    }
}

#[derive(Debug, thiserror::Error)]
pub enum WizardValidationError {
    #[error("required field missing: {0}")]
    Required(String),
    #[error("invalid format: {0}")]
    InvalidFormat(String),
    #[error("wizard not complete")]
    Incomplete,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn filled_state() -> WizardState {
        WizardState {
            step: WizardStep::TierSelection,
            tier: Some(Tier::Local),
            model_provider: Some(ModelProvider::Anthropic),
            model_api_key: "sk-ant-key123".to_string(),
            model_base_url: String::new(),
            model_frontier: "claude-sonnet-4-20250514".to_string(),
            model_fast: "claude-haiku-4-20250514".to_string(),
            model_verified: false,
            aws_region: String::new(),
            slack_app_token: "xapp-1-ABC123".to_string(),
            slack_bot_token: "xoxb-123-456-abc".to_string(),
            slack_signing_secret: "abc123secret".to_string(),
            company_name: "TestCo".to_string(),
            industry: "Tech".to_string(),
            team_size: "1-10".to_string(),
            primary_use_case: "Automation".to_string(),
            tools_used: vec!["Slack".to_string()],
            tone: "professional".to_string(),
            approval_threshold: "balanced".to_string(),
        }
    }

    // ─── Step Progression ────────────────────────────────────────────────

    #[test]
    fn advances_through_all_steps() {
        let mut state = filled_state();

        assert_eq!(state.step, WizardStep::TierSelection);
        state.advance().unwrap();
        assert_eq!(state.step, WizardStep::LlmSetup);
        state.advance().unwrap();
        assert_eq!(state.step, WizardStep::SlackCredentials);
        state.advance().unwrap();
        assert_eq!(state.step, WizardStep::CompanyInfo);
        state.advance().unwrap();
        assert_eq!(state.step, WizardStep::Review);
    }

    #[test]
    fn advance_at_review_is_noop() {
        let mut state = filled_state();
        state.step = WizardStep::Review;
        state.advance().unwrap();
        assert_eq!(state.step, WizardStep::Review);
    }

    #[test]
    fn back_from_every_step() {
        let steps = [
            (WizardStep::TierSelection, WizardStep::TierSelection),
            (WizardStep::LlmSetup, WizardStep::TierSelection),
            (WizardStep::SlackCredentials, WizardStep::LlmSetup),
            (WizardStep::CompanyInfo, WizardStep::SlackCredentials),
            (WizardStep::Review, WizardStep::CompanyInfo),
        ];

        for (from, expected) in steps {
            let mut state = filled_state();
            state.step = from;
            state.back();
            assert_eq!(state.step, expected);
        }
    }

    #[test]
    fn back_then_advance_roundtrip() {
        let mut state = filled_state();
        state.step = WizardStep::LlmSetup;

        state.advance().unwrap(); // → SlackCredentials
        state.back(); // → LlmSetup
        assert_eq!(state.step, WizardStep::LlmSetup);

        state.advance().unwrap(); // → SlackCredentials again
        assert_eq!(state.step, WizardStep::SlackCredentials);
    }

    #[test]
    fn multiple_backs_from_review() {
        let mut state = filled_state();
        state.step = WizardStep::Review;

        state.back();
        assert_eq!(state.step, WizardStep::CompanyInfo);
        state.back();
        assert_eq!(state.step, WizardStep::SlackCredentials);
        state.back();
        assert_eq!(state.step, WizardStep::LlmSetup);
        state.back();
        assert_eq!(state.step, WizardStep::TierSelection);
        state.back();
        assert_eq!(state.step, WizardStep::TierSelection);
    }

    // ─── Tier Validation ─────────────────────────────────────────────────

    #[test]
    fn rejects_missing_tier() {
        let mut state = WizardState::default();
        let result = state.advance();
        assert!(matches!(result, Err(WizardValidationError::Required(_))));
    }

    #[test]
    fn accepts_all_tier_values() {
        for tier in [Tier::Local, Tier::Cloud, Tier::Enterprise] {
            let mut state = filled_state();
            state.tier = Some(tier);
            state.advance().unwrap();
            assert_eq!(state.step, WizardStep::LlmSetup);
        }
    }

    // ─── LLM Setup Validation ────────────────────────────────────────────

    #[test]
    fn rejects_missing_provider() {
        let mut state = filled_state();
        state.model_provider = None;
        state.step = WizardStep::LlmSetup;

        let result = state.advance();
        assert!(matches!(result, Err(WizardValidationError::Required(_))));
    }

    #[test]
    fn rejects_empty_api_key_for_anthropic() {
        let mut state = filled_state();
        state.model_api_key = String::new();
        state.step = WizardStep::LlmSetup;

        let result = state.advance();
        assert!(matches!(result, Err(WizardValidationError::Required(_))));
    }

    #[test]
    fn rejects_empty_api_key_for_openai() {
        let mut state = filled_state();
        state.model_provider = Some(ModelProvider::Openai);
        state.model_api_key = String::new();
        state.step = WizardStep::LlmSetup;

        let result = state.advance();
        assert!(matches!(result, Err(WizardValidationError::Required(_))));
    }

    #[test]
    fn rejects_empty_bedrock_credentials() {
        let mut state = filled_state();
        state.model_provider = Some(ModelProvider::Bedrock);
        state.model_api_key = String::new();
        state.step = WizardStep::LlmSetup;

        let result = state.advance();
        assert!(matches!(result, Err(WizardValidationError::Required(_))));
    }

    #[test]
    fn rejects_bedrock_without_region() {
        let mut state = filled_state();
        state.model_provider = Some(ModelProvider::Bedrock);
        state.model_api_key = "some-key".to_string();
        state.aws_region = String::new();
        state.model_frontier = "us.anthropic.claude-sonnet-4-20250514-v1:0".to_string();
        state.model_fast = "us.anthropic.claude-haiku-4-20250514-v1:0".to_string();
        state.step = WizardStep::LlmSetup;

        let result = state.advance();
        assert!(matches!(result, Err(WizardValidationError::Required(_))));
    }

    #[test]
    fn accepts_bedrock_with_key_and_region() {
        let mut state = filled_state();
        state.model_provider = Some(ModelProvider::Bedrock);
        state.model_api_key = "some-api-key".to_string();
        state.aws_region = "us-east-1".to_string();
        state.model_frontier = "us.anthropic.claude-sonnet-4-20250514-v1:0".to_string();
        state.model_fast = "us.anthropic.claude-haiku-4-20250514-v1:0".to_string();
        state.step = WizardStep::LlmSetup;

        state.advance().unwrap();
        assert_eq!(state.step, WizardStep::SlackCredentials);
    }

    #[test]
    fn rejects_custom_without_base_url() {
        let mut state = filled_state();
        state.model_provider = Some(ModelProvider::Custom);
        state.model_base_url = String::new();
        state.step = WizardStep::LlmSetup;

        let result = state.advance();
        assert!(matches!(result, Err(WizardValidationError::Required(_))));
    }

    #[test]
    fn accepts_custom_with_base_url_and_key() {
        let mut state = filled_state();
        state.model_provider = Some(ModelProvider::Custom);
        state.model_base_url = "http://localhost:11434/v1".to_string();
        state.model_api_key = "custom-key".to_string();
        state.model_frontier = "llama3".to_string();
        state.model_fast = "llama3".to_string();
        state.step = WizardStep::LlmSetup;

        state.advance().unwrap();
        assert_eq!(state.step, WizardStep::SlackCredentials);
    }

    #[test]
    fn rejects_empty_frontier_model() {
        let mut state = filled_state();
        state.model_frontier = String::new();
        state.step = WizardStep::LlmSetup;

        let result = state.advance();
        assert!(matches!(result, Err(WizardValidationError::Required(_))));
    }

    #[test]
    fn rejects_empty_fast_model() {
        let mut state = filled_state();
        state.model_fast = String::new();
        state.step = WizardStep::LlmSetup;

        let result = state.advance();
        assert!(matches!(result, Err(WizardValidationError::Required(_))));
    }

    #[test]
    fn accepts_any_nonempty_api_key() {
        let keys = ["sk-ant-123", "sk-proj-abc", "key_12345", "x"];
        for key in keys {
            let mut state = filled_state();
            state.model_api_key = key.to_string();
            state.step = WizardStep::LlmSetup;
            state.advance().unwrap();
        }
    }

    // ─── Slack Credential Validation ─────────────────────────────────────

    #[test]
    fn rejects_invalid_app_token_format() {
        let mut state = filled_state();
        state.slack_app_token = "invalid-token".to_string();
        state.step = WizardStep::SlackCredentials;

        let result = state.advance();
        assert!(matches!(
            result,
            Err(WizardValidationError::InvalidFormat(_))
        ));
    }

    #[test]
    fn rejects_empty_app_token() {
        let mut state = filled_state();
        state.slack_app_token = String::new();
        state.step = WizardStep::SlackCredentials;

        let result = state.advance();
        assert!(result.is_err());
    }

    #[test]
    fn rejects_invalid_bot_token_format() {
        let mut state = filled_state();
        state.slack_bot_token = "invalid".to_string();
        state.step = WizardStep::SlackCredentials;

        let result = state.advance();
        assert!(matches!(
            result,
            Err(WizardValidationError::InvalidFormat(_))
        ));
    }

    #[test]
    fn rejects_empty_bot_token() {
        let mut state = filled_state();
        state.slack_bot_token = String::new();
        state.step = WizardStep::SlackCredentials;

        let result = state.advance();
        assert!(result.is_err());
    }

    #[test]
    fn rejects_empty_signing_secret() {
        let mut state = filled_state();
        state.slack_signing_secret = String::new();
        state.step = WizardStep::SlackCredentials;

        let result = state.advance();
        assert!(matches!(result, Err(WizardValidationError::Required(_))));
    }

    #[test]
    fn accepts_valid_slack_tokens() {
        let valid_app_tokens = [
            "xapp-1-A123",
            "xapp-1-ABCDEF1234567890",
            "xapp-2-short",
        ];
        let valid_bot_tokens = [
            "xoxb-1-2-abc",
            "xoxb-123456789-987654321-abcdefghij",
        ];

        for app in valid_app_tokens {
            for bot in valid_bot_tokens {
                let mut state = filled_state();
                state.slack_app_token = app.to_string();
                state.slack_bot_token = bot.to_string();
                state.step = WizardStep::SlackCredentials;
                state.advance().unwrap();
            }
        }
    }

    #[test]
    fn rejects_xoxb_as_app_token() {
        let mut state = filled_state();
        state.slack_app_token = "xoxb-swapped-token".to_string();
        state.step = WizardStep::SlackCredentials;

        let result = state.advance();
        assert!(result.is_err());
    }

    #[test]
    fn rejects_xapp_as_bot_token() {
        let mut state = filled_state();
        state.slack_bot_token = "xapp-swapped-token".to_string();
        state.step = WizardStep::SlackCredentials;

        let result = state.advance();
        assert!(result.is_err());
    }

    // ─── Company Info Validation ─────────────────────────────────────────

    #[test]
    fn rejects_empty_company_name() {
        let mut state = filled_state();
        state.company_name = String::new();
        state.step = WizardStep::CompanyInfo;

        let result = state.advance();
        assert!(matches!(result, Err(WizardValidationError::Required(_))));
    }

    #[test]
    fn accepts_whitespace_only_company_name_as_valid() {
        let mut state = filled_state();
        state.company_name = " ".to_string();
        state.step = WizardStep::CompanyInfo;

        state.advance().unwrap();
    }

    #[test]
    fn accepts_unicode_company_name() {
        let mut state = filled_state();
        state.company_name = "日本語会社 🏢".to_string();
        state.step = WizardStep::CompanyInfo;
        state.advance().unwrap();
    }

    // ─── into_answers ────────────────────────────────────────────────────

    #[test]
    fn into_answers_succeeds_at_review() {
        let mut state = filled_state();
        state.step = WizardStep::Review;

        let answers = state.into_answers().unwrap();
        assert_eq!(answers.company_name, "TestCo");
        assert_eq!(answers.tone, "professional");
    }

    #[test]
    fn into_answers_fails_before_review() {
        let steps = [
            WizardStep::TierSelection,
            WizardStep::LlmSetup,
            WizardStep::SlackCredentials,
            WizardStep::CompanyInfo,
        ];

        for step in steps {
            let mut state = filled_state();
            state.step = step;
            let result = state.into_answers();
            assert!(matches!(result, Err(WizardValidationError::Incomplete)));
        }
    }

    #[test]
    fn into_answers_preserves_all_fields() {
        let mut state = WizardState {
            step: WizardStep::Review,
            tier: Some(Tier::Enterprise),
            company_name: "Acme Corp".to_string(),
            industry: "Automotive".to_string(),
            team_size: "100+".to_string(),
            primary_use_case: "Fleet management".to_string(),
            tools_used: vec![
                "Slack".to_string(),
                "Jira".to_string(),
                "PagerDuty".to_string(),
            ],
            tone: "casual".to_string(),
            approval_threshold: "permissive".to_string(),
            ..Default::default()
        };
        state.step = WizardStep::Review;

        let answers = state.into_answers().unwrap();
        assert_eq!(answers.company_name, "Acme Corp");
        assert_eq!(answers.industry, "Automotive");
        assert_eq!(answers.team_size, "100+");
        assert_eq!(answers.primary_use_case, "Fleet management");
        assert_eq!(answers.tools_used.len(), 3);
        assert_eq!(answers.tone, "casual");
        assert_eq!(answers.approval_threshold, "permissive");
    }

    #[test]
    fn into_answers_with_empty_tools_list() {
        let mut state = filled_state();
        state.tools_used = vec![];
        state.step = WizardStep::Review;

        let answers = state.into_answers().unwrap();
        assert!(answers.tools_used.is_empty());
    }

    // ─── State Independence ──────────────────────────────────────────────

    #[test]
    fn failed_advance_does_not_change_step() {
        let mut state = WizardState::default();
        let original_step = state.step.clone();
        let _ = state.advance(); // should fail (no tier)
        assert_eq!(state.step, original_step);
    }

    #[test]
    fn default_state_starts_at_tier_selection() {
        let state = WizardState::default();
        assert_eq!(state.step, WizardStep::TierSelection);
        assert!(state.tier.is_none());
    }

    #[test]
    fn default_models_are_empty() {
        let state = WizardState::default();
        assert!(state.model_frontier.is_empty());
        assert!(state.model_fast.is_empty());
    }

    // ─── Stress: Rapid Back/Forward ──────────────────────────────────────

    #[test]
    fn rapid_back_forward_does_not_corrupt_state() {
        let mut state = filled_state();

        for _ in 0..100 {
            state.back();
        }
        assert_eq!(state.step, WizardStep::TierSelection);

        // Advance all the way through
        state.advance().unwrap();
        state.advance().unwrap();
        state.advance().unwrap();
        state.advance().unwrap();
        assert_eq!(state.step, WizardStep::Review);

        let answers = state.into_answers().unwrap();
        assert_eq!(answers.company_name, "TestCo");
    }
}
