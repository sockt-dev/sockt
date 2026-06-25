pub mod health;

use std::path::Path;

use async_trait::async_trait;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DockerError {
    #[error("compose file not found: {0}")]
    ComposeNotFound(String),
    #[error("docker engine not available: {0}")]
    EngineUnavailable(String),
    #[error("container operation failed: {0}")]
    OperationFailed(String),
}

#[derive(Debug, Clone)]
pub struct ContainerStatus {
    pub name: String,
    pub state: ContainerState,
    pub health: HealthState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContainerState {
    Running,
    Stopped,
    Restarting,
    Exited,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HealthState {
    Healthy,
    Unhealthy,
    Starting,
    None,
}

#[cfg_attr(test, mockall::automock)]
#[async_trait]
pub trait DockerClient: Send + Sync {
    async fn compose_up(&self, compose_path: &Path, detach: bool) -> Result<(), DockerError>;
    async fn compose_down(&self, compose_path: &Path, remove_volumes: bool) -> Result<(), DockerError>;
    async fn list_containers(&self, project: &str) -> Result<Vec<ContainerStatus>, DockerError>;
}

pub struct BollardDockerClient;

impl BollardDockerClient {
    pub fn new() -> Result<Self, DockerError> {
        Ok(Self)
    }
}

#[async_trait]
impl DockerClient for BollardDockerClient {
    async fn compose_up(&self, _compose_path: &Path, _detach: bool) -> Result<(), DockerError> {
        todo!("bollard compose up implementation")
    }

    async fn compose_down(&self, _compose_path: &Path, _remove_volumes: bool) -> Result<(), DockerError> {
        todo!("bollard compose down implementation")
    }

    async fn list_containers(&self, _project: &str) -> Result<Vec<ContainerStatus>, DockerError> {
        todo!("bollard list containers implementation")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[tokio::test]
    async fn mock_compose_up_called_with_correct_path() {
        let mut mock = MockDockerClient::new();
        let expected_path = PathBuf::from("/tmp/docker-compose.yaml");

        mock.expect_compose_up()
            .withf(|path, detach| {
                path == Path::new("/tmp/docker-compose.yaml") && *detach
            })
            .times(1)
            .returning(|_, _| Ok(()));

        mock.compose_up(&expected_path, true).await.unwrap();
    }

    #[tokio::test]
    async fn mock_compose_down_called() {
        let mut mock = MockDockerClient::new();

        mock.expect_compose_down()
            .times(1)
            .returning(|_, _| Ok(()));

        mock.compose_down(Path::new("/tmp/docker-compose.yaml"), false)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn mock_list_containers_returns_status() {
        let mut mock = MockDockerClient::new();

        mock.expect_list_containers()
            .returning(|_| {
                Ok(vec![
                    ContainerStatus {
                        name: "sockt-orch".to_string(),
                        state: ContainerState::Running,
                        health: HealthState::Healthy,
                    },
                    ContainerStatus {
                        name: "gbrain".to_string(),
                        state: ContainerState::Running,
                        health: HealthState::Healthy,
                    },
                ])
            });

        let containers = mock.list_containers("sockt").await.unwrap();
        assert_eq!(containers.len(), 2);
        assert_eq!(containers[0].state, ContainerState::Running);
    }
}
