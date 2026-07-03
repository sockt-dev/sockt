use std::path::PathBuf;
use std::time::Instant;

use anyhow::{Context, Result};
use tokio::time::Duration;

use crate::cli::AskArgs;
use crate::config::loader::ConfigLoader;
use crate::orch_client::{OrchClient, OrchClientConfig, Task, TaskCreate};

pub async fn run(args: AskArgs, config_path: Option<PathBuf>) -> Result<()> {
    let config = ConfigLoader::from_default_or_override(config_path)
        .load()
        .context("No config found. Run `sockt init` first.")?;

    let client = create_orch_client()?;
    let task_create = build_task_create(&args, &config.deployment_id);
    let task = client
        .create_task(task_create)
        .await
        .map_err(|e| anyhow::anyhow!("Cannot reach orchestrator. Is the swarm running? (`sockt status`)\n  {}", e))?;

    if args.json && !args.wait {
        println!("{}", serde_json::to_string_pretty(&task)?);
        return Ok(());
    }

    if !args.wait {
        println!(
            "  \u{2713} Task #{} created \u{2192} {} (priority: {})",
            task.id,
            task.owner.as_deref().unwrap_or("auto-routed"),
            args.priority
        );
        println!("  Track progress: sockt tasks show {}", task.id);
        return Ok(());
    }

    let result = poll_until_complete(&client, &task.id, args.timeout).await?;

    if args.json {
        println!("{}", serde_json::to_string_pretty(&result)?);
    } else {
        print_result(&result);
    }

    Ok(())
}

fn create_orch_client() -> Result<OrchClient> {
    let orch_url =
        std::env::var("ORCH_URL").unwrap_or_else(|_| "http://localhost:3100".to_string());

    OrchClient::new(OrchClientConfig {
        base_url: orch_url,
        timeout_ms: 5000,
        retries: 1,
    })
    .map_err(|e| anyhow::anyhow!("Failed to create orch client: {}", e))
}

fn build_task_create(args: &AskArgs, tenant_id: &str) -> TaskCreate {
    TaskCreate {
        tenant_id: tenant_id.to_string(),
        description: args.message.clone(),
        parent_id: None,
        llm_calls_budget: None,
        max_attempts: None,
        owner: args.agent.clone(),
        priority: Some(args.priority.to_string()),
        source: Some("cli".to_string()),
    }
}

async fn poll_until_complete(client: &OrchClient, task_id: &str, timeout_secs: u64) -> Result<Task> {
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);

    println!("  Waiting for response...");

    loop {
        if Instant::now() > deadline {
            println!(
                "\n  \u{26a0} Task still running after {}s",
                timeout_secs
            );
            println!("  Track: sockt tasks show {}", task_id);
            println!("  The agent will continue working \u{2014} check back with `sockt tasks show {}`", task_id);
            std::process::exit(0);
        }

        let task = client
            .get_task(task_id)
            .await
            .map_err(|e| anyhow::anyhow!("Lost connection to orchestrator: {}", e))?;

        if is_terminal_status(&task.status) {
            return Ok(task);
        }

        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

fn print_result(task: &Task) {
    match task.status.as_str() {
        "completed" => {
            println!("\n  \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}");
            if let Some(ref output) = task.output {
                println!("  {}", output.replace('\n', "\n  "));
            }
            println!("  \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}");
            println!("\n  Task #{} completed", task.id);
        }
        "failed" => {
            println!("\n  \u{2717} Task #{} failed", task.id);
            if let Some(ref output) = task.output {
                println!("  Reason: {}", output);
            }
        }
        "escalated" => {
            println!("\n  \u{26a0} Task #{} escalated", task.id);
            if let Some(ref output) = task.output {
                println!("  Reason: {}", output);
            }
        }
        _ => {
            println!("\n  Task #{} ended with status: {}", task.id, task.status);
        }
    }
}

fn is_terminal_status(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "escalated" | "cancelled")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::Priority;

    #[test]
    fn test_build_task_create_basic() {
        let args = AskArgs {
            message: "Find leads in healthcare".to_string(),
            agent: None,
            priority: Priority::Normal,
            wait: false,
            timeout: 300,
            json: false,
        };

        let task = build_task_create(&args, "dep-123");

        assert_eq!(task.tenant_id, "dep-123");
        assert_eq!(task.description, "Find leads in healthcare");
        assert_eq!(task.owner, None);
        assert_eq!(task.priority, Some("normal".to_string()));
        assert_eq!(task.source, Some("cli".to_string()));
        assert_eq!(task.parent_id, None);
    }

    #[test]
    fn test_build_task_create_with_agent() {
        let args = AskArgs {
            message: "Draft email".to_string(),
            agent: Some("outbound-writer".to_string()),
            priority: Priority::Normal,
            wait: false,
            timeout: 300,
            json: false,
        };

        let task = build_task_create(&args, "dep-123");

        assert_eq!(task.owner, Some("outbound-writer".to_string()));
    }

    #[test]
    fn test_build_task_create_with_priority() {
        let args = AskArgs {
            message: "Urgent task".to_string(),
            agent: None,
            priority: Priority::High,
            wait: false,
            timeout: 300,
            json: false,
        };

        let task = build_task_create(&args, "dep-123");

        assert_eq!(task.priority, Some("high".to_string()));
    }

    #[test]
    fn test_is_terminal_status() {
        assert!(is_terminal_status("completed"));
        assert!(is_terminal_status("failed"));
        assert!(is_terminal_status("escalated"));
        assert!(is_terminal_status("cancelled"));
        assert!(!is_terminal_status("pending"));
        assert!(!is_terminal_status("in_progress"));
    }
}
