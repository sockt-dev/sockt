pub mod events;

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum SocketModeError {
    #[error("connection failed: {0}")]
    ConnectionFailed(String),
    #[error("authentication failed")]
    AuthFailed,
    #[error("disconnected unexpectedly")]
    Disconnected,
    #[error("websocket error: {0}")]
    WebSocket(String),
}

pub struct SocketModeClient {
    app_token: String,
    bot_token: String,
    max_retries: u32,
    base_delay: Duration,
}

impl SocketModeClient {
    pub fn new(app_token: String, bot_token: String) -> Self {
        Self {
            app_token,
            bot_token,
            max_retries: 5,
            base_delay: Duration::from_secs(1),
        }
    }

    pub fn with_retry_config(mut self, max_retries: u32, base_delay: Duration) -> Self {
        self.max_retries = max_retries;
        self.base_delay = base_delay;
        self
    }

    pub async fn connect(&self) -> Result<(), SocketModeError> {
        todo!("implement WebSocket connection to Slack")
    }

    pub async fn listen(
        &self,
        _handler: impl EventHandler,
    ) -> Result<(), SocketModeError> {
        todo!("implement event loop")
    }

    pub async fn disconnect(&self) -> Result<(), SocketModeError> {
        todo!("implement graceful disconnect")
    }

    pub fn app_token(&self) -> &str {
        &self.app_token
    }

    pub fn bot_token(&self) -> &str {
        &self.bot_token
    }
}

pub trait EventHandler: Send + Sync {
    fn handle_message(
        &self,
        event: events::SlackMessage,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<()>> + Send>>;

    fn handle_interaction(
        &self,
        event: events::SlackInteraction,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<()>> + Send>>;
}

pub fn calculate_backoff(attempt: u32, base_delay: Duration) -> Duration {
    let multiplier = 2u64.pow(attempt.min(6));
    base_delay * multiplier as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_stores_tokens() {
        let client = SocketModeClient::new(
            "xapp-test-token".to_string(),
            "xoxb-test-token".to_string(),
        );
        assert_eq!(client.app_token(), "xapp-test-token");
        assert_eq!(client.bot_token(), "xoxb-test-token");
    }

    #[test]
    fn backoff_increases_exponentially() {
        let base = Duration::from_secs(1);
        assert_eq!(calculate_backoff(0, base), Duration::from_secs(1));
        assert_eq!(calculate_backoff(1, base), Duration::from_secs(2));
        assert_eq!(calculate_backoff(2, base), Duration::from_secs(4));
        assert_eq!(calculate_backoff(3, base), Duration::from_secs(8));
    }

    #[test]
    fn backoff_caps_at_64x() {
        let base = Duration::from_secs(1);
        assert_eq!(calculate_backoff(6, base), Duration::from_secs(64));
        assert_eq!(calculate_backoff(7, base), Duration::from_secs(64));
        assert_eq!(calculate_backoff(100, base), Duration::from_secs(64));
    }

    #[test]
    fn custom_retry_config() {
        let client = SocketModeClient::new("xapp-t".to_string(), "xoxb-t".to_string())
            .with_retry_config(10, Duration::from_millis(500));
        assert_eq!(client.max_retries, 10);
        assert_eq!(client.base_delay, Duration::from_millis(500));
    }
}
