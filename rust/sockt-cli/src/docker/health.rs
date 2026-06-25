use std::time::Duration;

use super::{ContainerStatus, DockerClient, HealthState};

pub async fn wait_for_healthy(
    client: &dyn DockerClient,
    project: &str,
    timeout: Duration,
) -> anyhow::Result<Vec<ContainerStatus>> {
    let start = std::time::Instant::now();

    loop {
        let containers = client.list_containers(project).await?;
        let all_healthy = containers
            .iter()
            .all(|c| c.health == HealthState::Healthy || c.health == HealthState::None);

        if all_healthy && !containers.is_empty() {
            return Ok(containers);
        }

        if start.elapsed() > timeout {
            anyhow::bail!("timeout waiting for containers to become healthy");
        }

        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::docker::{ContainerState, MockDockerClient};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    #[tokio::test]
    async fn returns_immediately_when_all_healthy() {
        let mut mock = MockDockerClient::new();
        mock.expect_list_containers().returning(|_| {
            Ok(vec![ContainerStatus {
                name: "orch".to_string(),
                state: ContainerState::Running,
                health: HealthState::Healthy,
            }])
        });

        let result = wait_for_healthy(&mock, "sockt", Duration::from_secs(5)).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn retries_until_healthy() {
        let mut mock = MockDockerClient::new();
        let call_count = Arc::new(AtomicU32::new(0));
        let count = call_count.clone();

        mock.expect_list_containers().returning(move |_| {
            let n = count.fetch_add(1, Ordering::SeqCst);
            if n < 2 {
                Ok(vec![ContainerStatus {
                    name: "orch".to_string(),
                    state: ContainerState::Running,
                    health: HealthState::Starting,
                }])
            } else {
                Ok(vec![ContainerStatus {
                    name: "orch".to_string(),
                    state: ContainerState::Running,
                    health: HealthState::Healthy,
                }])
            }
        });

        let result = wait_for_healthy(&mock, "sockt", Duration::from_secs(10)).await;
        assert!(result.is_ok());
        assert!(call_count.load(Ordering::SeqCst) >= 3);
    }

    #[tokio::test]
    async fn times_out_when_never_healthy() {
        let mut mock = MockDockerClient::new();
        mock.expect_list_containers().returning(|_| {
            Ok(vec![ContainerStatus {
                name: "orch".to_string(),
                state: ContainerState::Running,
                health: HealthState::Unhealthy,
            }])
        });

        let result = wait_for_healthy(&mock, "sockt", Duration::from_secs(2)).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("timeout"));
    }
}
