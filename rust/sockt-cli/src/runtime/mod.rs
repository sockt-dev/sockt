//! Runtime process management for sockt services.
//!
//! This module provides functions to spawn, track, and manage Bun service processes.
//! It handles process lifecycle (spawn, kill), health checks, and persists runtime
//! state to `~/.sockt/runtime.json`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error("process not found: {0}")]
    ProcessNotFound(u32),
    #[error("failed to spawn process: {0}")]
    SpawnFailed(String),
    #[error("health check failed: {0}")]
    HealthCheckFailed(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("signal error: {0}")]
    Signal(String),
}

pub type Result<T> = std::result::Result<T, RuntimeError>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServicePid {
    pub name: String,
    pub pid: u32,
    pub port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct RuntimeState {
    pub pids: Vec<ServicePid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<u64>, // Unix timestamp in seconds
}

/// Get the path to the runtime state file (~/.sockt/runtime.json)
fn runtime_state_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".sockt")
        .join("runtime.json")
}

/// Save runtime state to ~/.sockt/runtime.json
pub fn save_runtime_state(state: &RuntimeState) -> Result<()> {
    let path = runtime_state_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(state)?;
    std::fs::write(&path, json)?;
    Ok(())
}

/// Load runtime state from ~/.sockt/runtime.json
pub fn load_runtime_state() -> Result<RuntimeState> {
    let path = runtime_state_path();
    if !path.exists() {
        return Ok(RuntimeState::default());
    }
    let contents = std::fs::read_to_string(&path)?;
    if contents.trim().is_empty() {
        return Ok(RuntimeState::default());
    }
    let state: RuntimeState = serde_json::from_str(&contents)?;
    Ok(state)
}

/// Remove the runtime state file
pub fn remove_runtime_state() -> Result<()> {
    let path = runtime_state_path();
    if path.exists() {
        std::fs::remove_file(&path)?;
    }
    Ok(())
}

/// Spawn a Bun process as a daemon
pub fn spawn_bun_service(
    package_path: &str,
    env_vars: HashMap<String, String>,
    name: &str,
) -> Result<ServicePid> {
    let mut cmd = Command::new("bun");
    cmd.arg(package_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .envs(&env_vars);

    // Create a new session (detach from parent) on Unix
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            cmd.pre_exec(|| {
                nix::unistd::setsid()
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
                Ok(())
            });
        }
    }

    let child = cmd.spawn()
        .map_err(|e| RuntimeError::SpawnFailed(e.to_string()))?;

    let pid = child.id();

    let port = env_vars.get("PORT")
        .and_then(|p| p.parse::<u16>().ok());

    Ok(ServicePid {
        name: name.to_string(),
        pid,
        port,
    })
}

/// Check if a process with the given PID is alive
pub fn is_process_alive(pid: u32) -> bool {
    use nix::sys::signal;
    use nix::unistd::Pid;

    let pid = Pid::from_raw(pid as i32);
    signal::kill(pid, None).is_ok()
}

/// Kill a process by PID
pub fn kill_process(pid: u32, force: bool) -> Result<()> {
    use nix::sys::signal::{self, Signal};
    use nix::unistd::Pid;

    let pid = Pid::from_raw(pid as i32);
    let signal = if force { Signal::SIGKILL } else { Signal::SIGTERM };

    signal::kill(pid, signal)
        .map_err(|e| RuntimeError::Signal(e.to_string()))?;

    Ok(())
}

/// Check HTTP health endpoint
pub async fn check_health(url: &str, timeout_ms: u64) -> Result<bool> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .build()
        .map_err(|e| RuntimeError::HealthCheckFailed(e.to_string()))?;

    match client.get(url).send().await {
        Ok(response) => Ok(response.status().is_success()),
        Err(e) => Err(RuntimeError::HealthCheckFailed(e.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_service_pid_serialization() {
        let service = ServicePid {
            name: "test".to_string(),
            pid: 12345,
            port: Some(3000),
        };
        let json = serde_json::to_string(&service).unwrap();
        let deserialized: ServicePid = serde_json::from_str(&json).unwrap();
        assert_eq!(service, deserialized);
    }

    #[test]
    fn test_runtime_state_serialization() {
        let state = RuntimeState {
            pids: vec![
                ServicePid {
                    name: "service1".to_string(),
                    pid: 111,
                    port: Some(3000),
                },
                ServicePid {
                    name: "service2".to_string(),
                    pid: 222,
                    port: None,
                },
            ],
        };
        let json = serde_json::to_string(&state).unwrap();
        let deserialized: RuntimeState = serde_json::from_str(&json).unwrap();
        assert_eq!(state, deserialized);
    }
}
