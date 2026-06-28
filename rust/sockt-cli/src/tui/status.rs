use crate::docker::{ContainerState, ContainerStatus, HealthState};

pub fn format_status_table(containers: &[ContainerStatus]) -> String {
    if containers.is_empty() {
        return "No containers running.".to_string();
    }

    let mut output = String::new();
    output.push_str(&format!(
        "{:<25} {:<12} {:<10}\n",
        "CONTAINER", "STATE", "HEALTH"
    ));
    output.push_str(&"-".repeat(47));
    output.push('\n');

    for c in containers {
        let state_str = match c.state {
            ContainerState::Running => "running",
            ContainerState::Stopped => "stopped",
            ContainerState::Restarting => "restarting",
            ContainerState::Exited => "exited",
            ContainerState::Unknown => "unknown",
        };
        let health_str = match c.health {
            HealthState::Healthy => "healthy",
            HealthState::Unhealthy => "unhealthy",
            HealthState::Starting => "starting",
            HealthState::None => "-",
        };
        output.push_str(&format!("{:<25} {:<12} {:<10}\n", c.name, state_str, health_str));
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_containers_shows_message() {
        let output = format_status_table(&[]);
        assert_eq!(output, "No containers running.");
    }

    #[test]
    fn formats_running_containers() {
        let containers = vec![
            ContainerStatus {
                name: "sockt-orch".to_string(),
                state: ContainerState::Running,
                health: HealthState::Healthy,
            },
            ContainerStatus {
                name: "gbrain".to_string(),
                state: ContainerState::Running,
                health: HealthState::Starting,
            },
        ];

        let output = format_status_table(&containers);
        assert!(output.contains("sockt-orch"));
        assert!(output.contains("running"));
        assert!(output.contains("healthy"));
        assert!(output.contains("gbrain"));
        assert!(output.contains("starting"));
    }
}
