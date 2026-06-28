use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckStatus {
    Pass,
    Warn,
    Fail,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckResult {
    pub name: String,
    pub status: CheckStatus,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DiagnosticReport {
    pub checks: Vec<CheckResult>,
    pub exit_code: i32,
}

pub fn exit_code(checks: &[CheckResult]) -> i32 {
    if checks.iter().any(|c| c.status == CheckStatus::Fail) {
        2
    } else if checks.iter().any(|c| c.status == CheckStatus::Warn) {
        1
    } else {
        0
    }
}
