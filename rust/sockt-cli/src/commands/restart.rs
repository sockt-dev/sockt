use std::path::PathBuf;

use anyhow::{bail, Context, Result};

use crate::cli::RestartArgs;
use crate::config::loader::ConfigLoader;
use crate::runtime::{
    is_process_alive, kill_process, load_runtime_state, save_runtime_state, RuntimeState,
};

use super::deploy::{build_service_configs, spawn_single_service, spawn_with_health};

fn resolve_agent_name(input: &str) -> Option<String> {
    let normalized = input.to_lowercase().replace('_', "-");
    match normalized.as_str() {
        "lead-researcher" | "researcher" => Some("agent-1".to_string()),
        "outbound-writer" | "writer" => Some("agent-2".to_string()),
        "social-monitor" | "monitor" => Some("agent-3".to_string()),
        "agent-1" | "agent-2" | "agent-3" | "gbrain-mcp" | "orch" | "cadvp" => {
            Some(normalized)
        }
        _ => None,
    }
}

pub async fn run(args: RestartArgs, config_path: Option<PathBuf>) -> Result<()> {
    let state = load_runtime_state()?;

    if state.pids.is_empty() {
        bail!("Swarm is not running. Use `sockt deploy` to start.");
    }

    let target_name = if let Some(ref input) = args.agent {
        let resolved = resolve_agent_name(input)
            .or_else(|| {
                state
                    .pids
                    .iter()
                    .find(|p| p.name == *input)
                    .map(|p| p.name.clone())
            });

        match resolved {
            Some(name) => {
                if !state.pids.iter().any(|p| p.name == name) {
                    let running: Vec<_> = state.pids.iter().map(|p| p.name.as_str()).collect();
                    bail!(
                        "Agent '{}' not found. Running services: {}",
                        input,
                        running.join(", ")
                    );
                }
                Some(name)
            }
            None => {
                let running: Vec<_> = state.pids.iter().map(|p| p.name.as_str()).collect();
                bail!(
                    "Unknown agent '{}'. Running services: {}",
                    input,
                    running.join(", ")
                );
            }
        }
    } else {
        None
    };

    let targets: Vec<_> = state
        .pids
        .iter()
        .filter(|p| match &target_name {
            Some(name) => p.name == *name,
            None => true,
        })
        .collect();

    println!(
        "  Restarting{}...\n",
        match &target_name {
            Some(name) => format!(" {}", name),
            None => " all services".to_string(),
        }
    );

    for service in &targets {
        if is_process_alive(service.pid) {
            kill_process(service.pid, args.hard)?;
            let deadline =
                tokio::time::Instant::now() + tokio::time::Duration::from_secs(5);
            while is_process_alive(service.pid) && tokio::time::Instant::now() < deadline {
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            }
        }
        println!("    {:<15} (PID {}) stopped", service.name, service.pid);
    }

    let loader = ConfigLoader::from_default_or_override(config_path);
    let config = loader.load().context("Failed to load config for restart")?;
    let all_configs = build_service_configs(&config, None)?;

    let target_names: Vec<&str> = targets.iter().map(|t| t.name.as_str()).collect();

    let mut new_pids: Vec<_> = state
        .pids
        .iter()
        .filter(|p| !target_names.contains(&p.name.as_str()))
        .cloned()
        .collect();

    for svc_config in &all_configs {
        if target_names.contains(&svc_config.name.as_str()) {
            let pid = if svc_config.health_endpoint.is_some() {
                spawn_with_health(svc_config, args.timeout).await?
            } else {
                spawn_single_service(svc_config)?
            };
            new_pids.push(pid);
        }
    }

    save_runtime_state(&RuntimeState { pids: new_pids })?;

    println!("\n  ✓ Restart complete.");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_agent_name_human_names() {
        assert_eq!(resolve_agent_name("lead-researcher"), Some("agent-1".to_string()));
        assert_eq!(resolve_agent_name("outbound-writer"), Some("agent-2".to_string()));
        assert_eq!(resolve_agent_name("social-monitor"), Some("agent-3".to_string()));
    }

    #[test]
    fn test_resolve_agent_name_shortcuts() {
        assert_eq!(resolve_agent_name("researcher"), Some("agent-1".to_string()));
        assert_eq!(resolve_agent_name("writer"), Some("agent-2".to_string()));
        assert_eq!(resolve_agent_name("monitor"), Some("agent-3".to_string()));
    }

    #[test]
    fn test_resolve_agent_name_raw_service_names() {
        assert_eq!(resolve_agent_name("agent-1"), Some("agent-1".to_string()));
        assert_eq!(resolve_agent_name("gbrain-mcp"), Some("gbrain-mcp".to_string()));
        assert_eq!(resolve_agent_name("orch"), Some("orch".to_string()));
        assert_eq!(resolve_agent_name("cadvp"), Some("cadvp".to_string()));
    }

    #[test]
    fn test_resolve_agent_name_case_insensitive() {
        assert_eq!(resolve_agent_name("Lead-Researcher"), Some("agent-1".to_string()));
        assert_eq!(resolve_agent_name("OUTBOUND-WRITER"), Some("agent-2".to_string()));
    }

    #[test]
    fn test_resolve_agent_name_underscore_variant() {
        assert_eq!(resolve_agent_name("lead_researcher"), Some("agent-1".to_string()));
        assert_eq!(resolve_agent_name("social_monitor"), Some("agent-3".to_string()));
    }

    #[test]
    fn test_resolve_agent_name_unknown() {
        assert_eq!(resolve_agent_name("nonexistent"), None);
        assert_eq!(resolve_agent_name("foo-bar"), None);
    }
}
