use std::path::PathBuf;

use anyhow::Context;

use crate::cli::SetupCompanyArgs;
use crate::config::loader::ConfigLoader;
use crate::gbrain::{GBrainScaffolder, OnboardingAnswers};
use crate::tui::llm_verify;

pub async fn run(args: SetupCompanyArgs, config_path: Option<PathBuf>) -> anyhow::Result<()> {
    let config_loader = ConfigLoader::from_default_or_override(config_path);

    if !config_loader.path().exists() {
        anyhow::bail!(
            "Config not found at {}. Run `sockt init` first.",
            config_loader.path().display()
        );
    }

    let config = config_loader
        .load()
        .context("Failed to load existing config")?;

    let gbrain_dir = &config.gbrain.directory;

    if !gbrain_dir.exists() {
        anyhow::bail!(
            "GBrain directory not found at {}. Run `sockt init` first.",
            gbrain_dir.display()
        );
    }

    let answers = if args.non_interactive {
        collect_non_interactive(&args)?
    } else {
        collect_interactive(&args).await?
    };

    // Regenerate SOUL.md and AGENTS.md with company-specific content
    GBrainScaffolder::scaffold(gbrain_dir, &answers)
        .context("Failed to update GBrain with company context")?;

    println!();
    println!("  \u{2713} Company context saved to {}/", gbrain_dir.display());
    println!("  \u{2713} SOUL.md updated");
    println!("  \u{2713} AGENTS.md updated");
    println!();
    println!("  Your agents now have full context about your business.");
    println!();

    Ok(())
}

fn collect_non_interactive(args: &SetupCompanyArgs) -> anyhow::Result<OnboardingAnswers> {
    let company_name = args
        .name
        .clone()
        .ok_or_else(|| anyhow::anyhow!("--name required in non-interactive mode"))?;

    let industry = args.industry.clone().unwrap_or_else(|| "Technology".to_string());
    let team_size = args.team_size.clone().unwrap_or_else(|| "1-10".to_string());
    let primary_use_case = args
        .use_case
        .clone()
        .unwrap_or_else(|| "General automation".to_string());
    let tone = args.tone.clone().unwrap_or_else(|| "professional".to_string());
    let approval_threshold = args.approval.clone().unwrap_or_else(|| "balanced".to_string());

    Ok(OnboardingAnswers {
        company_name,
        industry,
        team_size,
        primary_use_case,
        tools_used: vec!["Slack".to_string()],
        tone,
        approval_threshold,
    })
}

async fn collect_interactive(args: &SetupCompanyArgs) -> anyhow::Result<OnboardingAnswers> {

    println!();
    llm_verify::print_header("Company & Preferences");
    println!();

    let company_name = args
        .name
        .clone()
        .or_else(|| {
            dialoguer::Input::new()
                .with_prompt("  Company name")
                .interact()
                .ok()
        })
        .ok_or_else(|| anyhow::anyhow!("Setup cancelled."))?;

    let industry = args
        .industry
        .clone()
        .or_else(|| {
            dialoguer::Input::new()
                .with_prompt("  Industry")
                .default("Technology".to_string())
                .interact()
                .ok()
        })
        .ok_or_else(|| anyhow::anyhow!("Setup cancelled."))?;

    let team_size = args
        .team_size
        .clone()
        .or_else(|| {
            dialoguer::Input::new()
                .with_prompt("  Team size")
                .default("1-10".to_string())
                .interact()
                .ok()
        })
        .ok_or_else(|| anyhow::anyhow!("Setup cancelled."))?;

    let primary_use_case = args
        .use_case
        .clone()
        .or_else(|| {
            dialoguer::Input::new()
                .with_prompt("  Primary use case")
                .default("General automation".to_string())
                .interact()
                .ok()
        })
        .ok_or_else(|| anyhow::anyhow!("Setup cancelled."))?;

    let tool_options = vec!["Slack", "GitHub", "Linear", "HubSpot", "Sentry", "PagerDuty"];
    let selected = dialoguer::MultiSelect::new()
        .with_prompt("  Tools & integrations (space to select)")
        .items(&tool_options)
        .defaults(&[true, false, false, false, false, false])
        .interact()
        .map_err(|_| anyhow::anyhow!("Setup cancelled."))?;
    let tools_used = selected
        .iter()
        .map(|&i| tool_options[i].to_string())
        .collect();

    let tone_options = vec!["professional", "casual", "friendly", "technical"];
    let tone = args
        .tone
        .clone()
        .or_else(|| {
            let tone_idx = dialoguer::Select::new()
                .with_prompt("  Communication tone")
                .items(&tone_options)
                .default(0)
                .interact()
                .ok()?;
            Some(tone_options[tone_idx].to_string())
        })
        .ok_or_else(|| anyhow::anyhow!("Setup cancelled."))?;

    let approval_options = vec!["conservative", "balanced", "permissive"];
    let approval_threshold = args
        .approval
        .clone()
        .or_else(|| {
            let approval_idx = dialoguer::Select::new()
                .with_prompt("  Approval threshold")
                .items(&approval_options)
                .default(1)
                .interact()
                .ok()?;
            Some(approval_options[approval_idx].to_string())
        })
        .ok_or_else(|| anyhow::anyhow!("Setup cancelled."))?;

    if company_name.is_empty() {
        anyhow::bail!("Company name is required");
    }

    Ok(OnboardingAnswers {
        company_name,
        industry,
        team_size,
        primary_use_case,
        tools_used,
        tone,
        approval_threshold,
    })
}
