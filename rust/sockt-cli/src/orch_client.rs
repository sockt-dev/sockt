//! HTTP client for the orchestrator service API.

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum OrchError {
    #[error("HTTP request failed: {0}")]
    RequestFailed(String),
    #[error("Orchestrator error: {status} - {body}")]
    OrchApiError { status: u16, body: String },
    #[error("Max retries exhausted after {0} attempts")]
    MaxRetriesExhausted(u32),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, OrchError>;

#[derive(Debug, Serialize, Deserialize)]
pub struct HealthStatus {
    pub status: String,
    pub uptime: u64,
    #[serde(rename = "activeAgents")]
    pub active_agents: u32,
    #[serde(rename = "pendingTasks")]
    pub pending_tasks: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    #[serde(rename = "tenantId")]
    pub tenant_id: String,
    pub status: String,
    pub owner: Option<String>,
    #[serde(rename = "parentId")]
    pub parent_id: Option<String>,
    pub description: String,
    pub output: Option<String>,
    #[serde(rename = "llmCallsUsed")]
    pub llm_calls_used: u32,
    #[serde(rename = "llmCallsBudget")]
    pub llm_calls_budget: u32,
    #[serde(rename = "attemptCount")]
    pub attempt_count: u32,
    #[serde(rename = "maxAttempts")]
    pub max_attempts: u32,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TaskCreate {
    #[serde(rename = "tenantId")]
    pub tenant_id: String,
    pub description: String,
    #[serde(rename = "parentId", skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(rename = "llmCallsBudget", skip_serializing_if = "Option::is_none")]
    pub llm_calls_budget: Option<u32>,
    #[serde(rename = "maxAttempts", skip_serializing_if = "Option::is_none")]
    pub max_attempts: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LlmCallResult {
    pub remaining: u32,
}

pub struct OrchClientConfig {
    pub base_url: String,
    pub timeout_ms: u64,
    pub retries: u32,
}

pub struct OrchClient {
    base_url: String,
    client: reqwest::Client,
    retries: u32,
}

impl OrchClient {
    pub fn new(config: OrchClientConfig) -> Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(config.timeout_ms))
            .build()
            .map_err(|e| OrchError::RequestFailed(e.to_string()))?;

        Ok(Self {
            base_url: config.base_url.trim_end_matches('/').to_string(),
            client,
            retries: config.retries,
        })
    }

    pub async fn health(&self) -> Result<HealthStatus> {
        self.get("/health").await
    }

    pub async fn get_running_tasks(&self, tenant_id: &str) -> Result<Vec<Task>> {
        use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
        let encoded_tenant_id = utf8_percent_encode(tenant_id, NON_ALPHANUMERIC).to_string();
        let path = format!("/tasks/pending?tenantId={}", encoded_tenant_id);
        self.get(&path).await
    }

    pub async fn create_task(&self, req: TaskCreate) -> Result<Task> {
        self.post("/tasks", Some(serde_json::to_value(&req)?))
            .await
    }

    pub async fn get_task(&self, id: &str) -> Result<Task> {
        let path = format!("/tasks/{}", id);
        self.get(&path).await
    }

    pub async fn claim_task(&self, task_id: &str, agent_id: &str) -> Result<Task> {
        let body = serde_json::json!({ "taskId": task_id, "agentId": agent_id });
        self.post("/tasks/claim", Some(body)).await
    }

    pub async fn complete_task(&self, task_id: &str, output: &str) -> Result<()> {
        let path = format!("/tasks/{}/complete", task_id);
        let body = serde_json::json!({ "output": output });
        let _: Task = self.post(&path, Some(body)).await?;
        Ok(())
    }

    pub async fn escalate_task(&self, task_id: &str, reason: &str) -> Result<()> {
        let path = format!("/tasks/{}/escalate", task_id);
        let body = serde_json::json!({ "reason": reason });
        let _: Task = self.post(&path, Some(body)).await?;
        Ok(())
    }

    pub async fn record_llm_call(&self, task_id: &str) -> Result<LlmCallResult> {
        let path = format!("/tasks/{}/llm-call", task_id);
        self.post(&path, Some(serde_json::json!({}))).await
    }

    async fn get<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T> {
        self.request("GET", path, None).await
    }

    async fn post<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<T> {
        self.request("POST", path, body).await
    }

    async fn request<T: serde::de::DeserializeOwned>(
        &self,
        method: &str,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<T> {
        let mut last_error: Option<OrchError> = None;

        for attempt in 0..=self.retries {
            let url = format!("{}{}", self.base_url, path);

            let mut request_builder = match method {
                "GET" => self.client.get(&url),
                "POST" => self.client.post(&url),
                _ => return Err(OrchError::RequestFailed(format!("Unsupported method: {}", method))),
            };

            if let Some(ref body_value) = body {
                request_builder = request_builder
                    .header("Content-Type", "application/json")
                    .body(body_value.to_string());
            }

            match request_builder.send().await {
                Ok(response) => {
                    let status = response.status();

                    if status.is_success() {
                        if status == StatusCode::NO_CONTENT {
                            return serde_json::from_str("null").map_err(OrchError::Json);
                        }
                        let text = response
                            .text()
                            .await
                            .map_err(|e| OrchError::RequestFailed(e.to_string()))?;
                        return serde_json::from_str(&text).map_err(OrchError::Json);
                    }

                    if self.is_retryable(status) && attempt < self.retries {
                        let body = response.text().await.unwrap_or_default();
                        last_error = Some(OrchError::OrchApiError {
                            status: status.as_u16(),
                            body,
                        });
                        self.backoff(attempt).await;
                        continue;
                    }

                    let body = response.text().await.unwrap_or_default();
                    return Err(OrchError::OrchApiError {
                        status: status.as_u16(),
                        body,
                    });
                }
                Err(e) => {
                    if attempt < self.retries {
                        last_error = Some(OrchError::RequestFailed(e.to_string()));
                        self.backoff(attempt).await;
                        continue;
                    }
                    return Err(OrchError::RequestFailed(e.to_string()));
                }
            }
        }

        Err(last_error.unwrap_or_else(|| OrchError::MaxRetriesExhausted(self.retries + 1)))
    }

    fn is_retryable(&self, status: StatusCode) -> bool {
        status.as_u16() >= 500 || status == StatusCode::TOO_MANY_REQUESTS
    }

    async fn backoff(&self, attempt: u32) {
        let delay_ms = std::cmp::min(100 * 2_u64.pow(attempt), 5000);
        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
    }
}
