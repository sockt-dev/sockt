use std::path::PathBuf;
use anyhow::{Context, Result};
use chrono::{DateTime, Utc};

use crate::cli::{ListArgs, TasksArgs, TasksCommand};
use crate::config::loader::ConfigLoader;
use crate::orch_client::{OrchClient, OrchClientConfig, Task};

pub async fn run(args: TasksArgs, config_path: Option<PathBuf>) -> Result<()> {
    match args.command {
        None | Some(TasksCommand::List(_)) => {
            let list_args = match args.command {
                Some(TasksCommand::List(args)) => args,
                _ => ListArgs {
                    status: None,
                    agent: None,
                    since: None,
                    limit: 20,
                    all: false,
                    json: false,
                },
            };
            list_tasks(config_path, &list_args).await
        }
        Some(TasksCommand::Show { id, json }) => {
            show_task(config_path, &id, json).await
        }
        Some(TasksCommand::Approve { id, comment, edit }) => {
            approve_task(config_path, &id, comment.as_deref(), edit).await
        }
        Some(TasksCommand::Reject { id, reason }) => {
            reject_task(config_path, &id, reason.as_deref()).await
        }
        Some(TasksCommand::Cancel { id, confirm }) => {
            cancel_task(config_path, &id, confirm).await
        }
        Some(TasksCommand::Retry { id, priority }) => {
            retry_task(config_path, &id, priority.as_deref()).await
        }
    }
}

async fn list_tasks(config_path: Option<PathBuf>, args: &ListArgs) -> Result<()> {
    let config = ConfigLoader::from_default_or_override(config_path)
        .load()
        .context("No config found. Run `sockt init` first.")?;

    let client = create_orch_client()?;
    let tasks = client
        .get_running_tasks(&config.deployment_id)
        .await
        .context("Cannot reach orchestrator. Is the swarm running? (`sockt status`)")?;

    if args.json {
        println!("{}", serde_json::to_string_pretty(&tasks)?);
        return Ok(());
    }

    if tasks.is_empty() {
        println!("\n  No tasks found.");
        return Ok(());
    }

    // Group tasks by status
    let pending_approval: Vec<&Task> = tasks
        .iter()
        .filter(|t| t.status == "pending_approval" || t.status == "approval")
        .collect();

    let running: Vec<&Task> = tasks
        .iter()
        .filter(|t| t.status == "in_progress" || t.status == "running")
        .collect();

    let completed_today: Vec<&Task> = tasks
        .iter()
        .filter(|t| t.status == "completed" && is_today(&t.updated_at))
        .collect();

    print_task_groups(&pending_approval, &running, &completed_today);
    Ok(())
}

async fn show_task(config_path: Option<PathBuf>, id: &str, json: bool) -> Result<()> {
    let _config = ConfigLoader::from_default_or_override(config_path)
        .load()
        .context("No config found. Run `sockt init` first.")?;

    let client = create_orch_client()?;
    let task = client
        .get_task(id)
        .await
        .map_err(|e| map_orch_error(e, id))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&task)?);
        return Ok(());
    }

    print_task_detail(&task);
    Ok(())
}

async fn approve_task(config_path: Option<PathBuf>, id: &str, comment: Option<&str>, _edit: bool) -> Result<()> {
    let _config = ConfigLoader::from_default_or_override(config_path)
        .load()
        .context("No config found. Run `sockt init` first.")?;

    let client = create_orch_client()?;
    client
        .approve_task(id, comment)
        .await
        .map_err(|e| map_orch_error(e, id))?;

    let feedback_note = if comment.is_some() {
        " (with feedback)"
    } else {
        ""
    };

    println!("  ✓ Task #{} approved{}. Agent will proceed.", id, feedback_note);
    Ok(())
}

async fn reject_task(config_path: Option<PathBuf>, id: &str, reason: Option<&str>) -> Result<()> {
    let _config = ConfigLoader::from_default_or_override(config_path)
        .load()
        .context("No config found. Run `sockt init` first.")?;

    let client = create_orch_client()?;
    client
        .reject_task(id, reason)
        .await
        .map_err(|e| map_orch_error(e, id))?;

    println!("  ✓ Task #{} rejected. Feedback sent to agent.", id);
    println!("  The agent will revise and resubmit (or escalate if max retries reached).");
    Ok(())
}

async fn cancel_task(config_path: Option<PathBuf>, id: &str, confirm: bool) -> Result<()> {
    let _config = ConfigLoader::from_default_or_override(config_path)
        .load()
        .context("No config found. Run `sockt init` first.")?;

    let client = create_orch_client()?;

    if !confirm {
        // Get task info for confirmation prompt
        let task = client
            .get_task(id)
            .await
            .map_err(|e| map_orch_error(e, id))?;

        println!(
            "  Task #{} is currently {} ({}).",
            id, task.status, task.description
        );
        println!("  Note: Cancel confirmation prompts are not yet implemented.");
        println!("  Use --confirm flag to skip confirmation.");
        anyhow::bail!("Confirmation required. Use --confirm to proceed.");
    }

    client
        .cancel_task(id)
        .await
        .map_err(|e| map_orch_error(e, id))?;

    println!("  ✓ Task #{} cancelled. Agent will stop at next checkpoint.", id);
    Ok(())
}

async fn retry_task(config_path: Option<PathBuf>, id: &str, priority: Option<&str>) -> Result<()> {
    let _config = ConfigLoader::from_default_or_override(config_path)
        .load()
        .context("No config found. Run `sockt init` first.")?;

    let client = create_orch_client()?;

    // Get task info to validate state and show context
    let task = client
        .get_task(id)
        .await
        .map_err(|e| map_orch_error(e, id))?;

    if !matches!(task.status.as_str(), "failed" | "escalated" | "cancelled") {
        anyhow::bail!(
            "Task #{} is {} (not failed/escalated). Only failed tasks can be retried.",
            id,
            task.status
        );
    }

    println!("  Task #{} ({}) {} ago.", id, task.description, task.status);
    if let Some(ref output) = task.output {
        println!("  Reason: {}", output);
    }

    client
        .retry_task(id, priority)
        .await
        .map_err(|e| map_orch_error(e, id))?;

    let priority_str = priority.unwrap_or("normal");
    println!("  ✓ Task #{} requeued (priority: {}).", id, priority_str);
    println!("  Track: sockt tasks show {}", id);

    Ok(())
}

// Helper functions

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

fn print_task_groups(
    pending: &[&Task],
    running: &[&Task],
    completed: &[&Task],
) {
    if !pending.is_empty() {
        println!("\n  PENDING APPROVAL ({}):", pending.len());
        for task in pending {
            let ago = format_relative_time(&task.created_at);
            println!(
                "    #{}  {:<45} {:<18} {}",
                task.id,
                truncate(&task.description, 45),
                task.owner.as_deref().unwrap_or("auto"),
                ago
            );
            println!("          → sockt tasks approve {}", task.id);
        }
    }

    if !running.is_empty() {
        println!("\n  RUNNING ({}):", running.len());
        for task in running {
            let ago = format_relative_time(&task.created_at);
            println!(
                "    #{}  {:<45} {:<18} {}",
                task.id,
                truncate(&task.description, 45),
                task.owner.as_deref().unwrap_or("auto"),
                ago
            );
        }
    }

    if !completed.is_empty() {
        println!(
            "\n  COMPLETED TODAY ({}):  use `sockt tasks list --status completed --since 24h`",
            completed.len()
        );
    }
}

fn format_relative_time(timestamp: &str) -> String {
    let parsed = DateTime::parse_from_rfc3339(timestamp)
        .or_else(|_| {
            // Try ISO 8601 with 'Z' suffix
            timestamp
                .parse::<DateTime<Utc>>()
                .map(|dt| dt.into())
        });

    match parsed {
        Ok(dt) => {
            let now = Utc::now();
            let duration = now.signed_duration_since(dt);

            if duration.num_seconds() < 60 {
                format!("{}s ago", duration.num_seconds())
            } else if duration.num_minutes() < 60 {
                format!("{}m ago", duration.num_minutes())
            } else if duration.num_hours() < 24 {
                format!("{}h ago", duration.num_hours())
            } else {
                format!("{}d ago", duration.num_days())
            }
        }
        Err(_) => "unknown".to_string(),
    }
}

fn truncate(text: &str, max_len: usize) -> String {
    if text.len() <= max_len {
        text.to_string()
    } else {
        format!("{}...", &text[..max_len.saturating_sub(3)])
    }
}

fn is_today(timestamp: &str) -> bool {
    let parsed = DateTime::parse_from_rfc3339(timestamp)
        .or_else(|_| timestamp.parse::<DateTime<Utc>>().map(|dt| dt.into()));

    match parsed {
        Ok(dt) => {
            let now = Utc::now();
            dt.date_naive() == now.date_naive()
        }
        Err(_) => false,
    }
}

fn map_orch_error(e: crate::orch_client::OrchError, task_id: &str) -> anyhow::Error {
    use crate::orch_client::OrchError;
    match e {
        OrchError::OrchApiError { status: 404, .. } => {
            anyhow::anyhow!("No task with ID {}. List tasks: `sockt tasks`", task_id)
        }
        _ => anyhow::anyhow!(
            "Cannot reach orchestrator. Is the swarm running? (`sockt status`)\n  {}",
            e
        ),
    }
}

fn print_task_detail(task: &Task) {
    println!("\n  Task #{} — {}", task.id, task.description);
    println!("  {}", "─".repeat(65));

    let status_display = match task.status.as_str() {
        "pending_approval" | "approval" => format!("{} (HITL Tier 2)", task.status),
        _ => task.status.clone(),
    };
    println!("  Status:    {}", status_display);
    println!("  Agent:     {}", task.owner.as_deref().unwrap_or("auto"));
    println!("  Created:   {} ({})", task.created_at, format_relative_time(&task.created_at));

    if let Some(ref expires) = task.expires_at {
        let remaining = calculate_time_remaining(expires);
        println!("  Expires:   {} ({})", expires, remaining);
    }

    // Print action payload box
    if let Some(ref payload) = task.action_payload {
        println!("\n  ┌─ Action ──────────────────────────────────────────────────────┐");
        let payload_str = serde_json::to_string_pretty(payload).unwrap_or_else(|_| payload.to_string());
        for line in payload_str.lines() {
            println!("  │ {:<62} │", truncate(line, 62));
        }
        println!("  └───────────────────────────────────────────────────────────────┘");
    }

    // Print context box
    if let Some(ref ctx) = task.context {
        println!("\n  ┌─ Context ─────────────────────────────────────────────────────┐");
        let ctx_str = serde_json::to_string_pretty(ctx).unwrap_or_else(|_| ctx.to_string());
        for line in ctx_str.lines() {
            println!("  │ {:<62} │", truncate(line, 62));
        }
        println!("  └───────────────────────────────────────────────────────────────┘");
    }

    // Print suggested actions
    if task.status == "pending_approval" || task.status == "approval" {
        println!("\n  Actions:");
        println!("    sockt tasks approve {}", task.id);
        println!("    sockt tasks approve {} --comment \"good tone, send it\"", task.id);
        println!("    sockt tasks reject {} --reason \"too aggressive\"", task.id);
    }

    println!();  // Empty line at end
}

fn calculate_time_remaining(expiry: &str) -> String {
    let parsed = DateTime::parse_from_rfc3339(expiry)
        .or_else(|_| expiry.parse::<DateTime<Utc>>().map(|dt| dt.into()));

    match parsed {
        Ok(dt) => {
            let now = Utc::now();
            let duration = dt.signed_duration_since(now);

            if duration.num_seconds() < 0 {
                "expired".to_string()
            } else if duration.num_minutes() < 60 {
                format!("{}m remaining", duration.num_minutes())
            } else if duration.num_hours() < 24 {
                let hours = duration.num_hours();
                let mins = duration.num_minutes() % 60;
                format!("{}h {}m remaining", hours, mins)
            } else {
                format!("{}d remaining", duration.num_days())
            }
        }
        Err(_) => "unknown".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_truncate() {
        assert_eq!(truncate("Short", 10), "Short");
        assert_eq!(truncate("Very long description here", 10), "Very lo...");
        assert_eq!(truncate("Exactly10!", 10), "Exactly10!");
    }

    #[test]
    fn test_format_relative_time() {
        let now = Utc::now();

        // Test minutes ago
        let five_min_ago = (now - chrono::Duration::minutes(5))
            .to_rfc3339();
        assert_eq!(format_relative_time(&five_min_ago), "5m ago");

        // Test hours ago
        let two_hours_ago = (now - chrono::Duration::hours(2))
            .to_rfc3339();
        assert_eq!(format_relative_time(&two_hours_ago), "2h ago");

        // Test seconds ago
        let thirty_sec_ago = (now - chrono::Duration::seconds(30))
            .to_rfc3339();
        assert_eq!(format_relative_time(&thirty_sec_ago), "30s ago");
    }

    #[test]
    fn test_is_today() {
        let now = Utc::now();
        let today = now.to_rfc3339();
        assert!(is_today(&today));

        let yesterday = (now - chrono::Duration::days(1)).to_rfc3339();
        assert!(!is_today(&yesterday));
    }

    #[test]
    fn test_calculate_time_remaining() {
        let now = Utc::now();

        // Test minutes remaining
        let in_30_min = (now + chrono::Duration::minutes(30)).to_rfc3339();
        let result = calculate_time_remaining(&in_30_min);
        assert!(result.contains("m remaining"));

        // Test hours remaining
        let in_3_hours = (now + chrono::Duration::hours(3) + chrono::Duration::minutes(30)).to_rfc3339();
        let result = calculate_time_remaining(&in_3_hours);
        assert!(result.contains("3h") && result.contains("m remaining"));

        // Test expired
        let past = (now - chrono::Duration::hours(1)).to_rfc3339();
        assert_eq!(calculate_time_remaining(&past), "expired");
    }
}
