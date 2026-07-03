mod templates;
mod agents_gen;

use anyhow::{Context, Result};
use std::path::PathBuf;
use crate::cli::DepartmentCommand;
use crate::config::loader::ConfigLoader;

pub async fn run(
    args: crate::cli::DepartmentArgs,
    config_path: Option<PathBuf>,
) -> Result<()> {
    match args.command {
        None => list_active(config_path).await,
        Some(DepartmentCommand::List { available }) => {
            list_templates(config_path, available).await
        }
        Some(DepartmentCommand::Add { name, non_interactive }) => {
            add_department(&name, non_interactive, config_path).await
        }
        Some(DepartmentCommand::Remove { name, confirm, keep_data }) => {
            remove_department(&name, confirm, keep_data, config_path).await
        }
        Some(DepartmentCommand::Info { name, json }) => {
            show_info(&name, json, config_path).await
        }
    }
}

async fn list_active(config_path: Option<PathBuf>) -> Result<()> {
    let loader = ConfigLoader::from_default_or_override(config_path);
    let config = loader.load()
        .context("Config not found. Run `sockt init` first.")?;

    println!("\n  ACTIVE DEPARTMENTS ({}):\n", config.departments.active.len());

    if config.departments.active.is_empty() {
        println!("    (none)");
    } else {
        for dept_name in &config.departments.active {
            if let Some(template) = templates::get_template(dept_name) {
                println!("    {} — {}", dept_name, template.display_name);
                println!("      Agents: {} ({})",
                    template.agents.len(),
                    template.agents.iter()
                        .map(|a| a.name)
                        .collect::<Vec<_>>()
                        .join(", ")
                );
            }
        }
    }

    println!("\n  AVAILABLE:");
    for template in templates::all_templates() {
        if !config.departments.active.contains(&template.id.to_string()) {
            println!("    {:<10} {:<28} {} agents    `sockt department add {}`",
                template.id,
                template.display_name,
                template.agents.len(),
                template.id
            );
        }
    }

    Ok(())
}

async fn list_templates(config_path: Option<PathBuf>, available_only: bool) -> Result<()> {
    let active = if available_only {
        let loader = ConfigLoader::from_default_or_override(config_path);
        let config = loader.load()
            .context("Config not found. Run `sockt init` first.")?;
        config.departments.active
    } else {
        vec![]
    };

    println!("\n  BUILT-IN TEMPLATES:\n");

    for template in templates::all_templates() {
        if available_only && active.contains(&template.id.to_string()) {
            continue;
        }

        println!("    {} — {}", template.id, template.display_name);
        println!("               Agents: {}",
            template.agents.iter().map(|a| a.name).collect::<Vec<_>>().join(", ")
        );

        // Collect unique tools
        let mut tools: Vec<&str> = template.agents.iter()
            .flat_map(|a| a.tools.iter())
            .copied()
            .collect();
        tools.sort();
        tools.dedup();

        println!("               Tools: {}", tools.join(", "));
        println!("               Use case: {}\n", template.description);
    }

    println!("  Add with: sockt department add <name>");

    Ok(())
}

async fn add_department(
    name: &str,
    non_interactive: bool,
    config_path: Option<PathBuf>,
) -> Result<()> {
    // 1. Validate template exists
    let template = templates::get_template(name)
        .ok_or_else(|| anyhow::anyhow!(
            "Unknown department: '{}'. Available: {}",
            name,
            templates::template_names().join(", ")
        ))?;

    // 2. Load config
    let loader = ConfigLoader::from_default_or_override(config_path);
    if !loader.path().exists() {
        anyhow::bail!("Config not found. Run `sockt init` first.");
    }
    let mut config = loader.load()
        .context("Failed to load config")?;

    // 3. Check not already active
    if config.departments.active.contains(&name.to_string()) {
        anyhow::bail!("{} is already deployed. Use `sockt department info {}` to view.", name, name);
    }

    // 4. Interactive integration prompts (skip for now, can add in v2)
    if !non_interactive {
        println!("\n  Adding: {}", template.display_name);
        println!("  {}", "─".repeat(50));
        println!("\n  This department includes:");
        for agent in template.agents {
            println!("    • {} — {}", agent.name, agent.role);
        }
        println!();
    }

    // 5. Update config
    config.departments.active.push(name.to_string());
    loader.save(&config)
        .context("Failed to save config")?;

    // 6. Update AGENTS.md
    let gbrain_path = if config.gbrain.directory.is_relative() {
        // Resolve relative to config directory's parent (the project root)
        // Config is at ~/.sockt/config.yaml, so parent is ~/.sockt, grandparent is ~
        loader.path().parent().and_then(|p| p.parent()).unwrap().join(&config.gbrain.directory)
    } else {
        PathBuf::from(&config.gbrain.directory)
    };
    let agents_md_path = gbrain_path.join(&config.gbrain.agents_file);

    // Create gbrain dir if doesn't exist
    if !gbrain_path.exists() {
        std::fs::create_dir_all(&gbrain_path)
            .context("Failed to create gbrain directory")?;
    }

    // Generate department section
    let section = agents_gen::generate_department_section(template);
    agents_gen::update_agents_md(&agents_md_path, name, &section)?;

    println!("  ✓ {} department added ({} agents)", template.display_name, template.agents.len());
    println!("  ✓ AGENTS.md updated with {} department config", name);
    println!("\n  Deploy changes: sockt restart --pull");

    Ok(())
}

async fn remove_department(
    name: &str,
    skip_confirm: bool,
    keep_data: bool,
    config_path: Option<PathBuf>,
) -> Result<()> {
    // 1. Load config
    let loader = ConfigLoader::from_default_or_override(config_path);
    let mut config = loader.load()
        .context("Config not found. Run `sockt init` first.")?;

    // 2. Validate exists
    if !config.departments.active.contains(&name.to_string()) {
        anyhow::bail!("{} is not deployed. Nothing to remove.", name);
    }

    let template = templates::get_template(name)
        .ok_or_else(|| anyhow::anyhow!("Unknown department: {}", name))?;

    // 3. Confirm
    if !skip_confirm {
        println!("\n  Remove {} department?", template.display_name);
        println!("\n  This will:");
        println!("    • Stop {} agents ({})",
            template.agents.len(),
            template.agents.iter().map(|a| a.name).collect::<Vec<_>>().join(", ")
        );
        println!("    • Remove agent containers from docker-compose.yaml");
        if keep_data {
            println!("    • Keep all GBrain data (memories, skills, logs)");
        } else {
            println!("    • Remove department section from AGENTS.md");
        }

        let proceed = dialoguer::Confirm::new()
            .with_prompt("  Proceed?")
            .default(false)
            .interact()?;

        if !proceed {
            println!("  Cancelled.");
            return Ok(());
        }
    }

    // 4. Remove from config
    config.departments.active.retain(|d| d != name);
    loader.save(&config)?;

    // 5. Optionally remove from AGENTS.md
    if !keep_data {
        let gbrain_path = if config.gbrain.directory.is_relative() {
            // Resolve relative to config directory's parent (the project root)
            loader.path().parent().and_then(|p| p.parent()).unwrap().join(&config.gbrain.directory)
        } else {
            PathBuf::from(&config.gbrain.directory)
        };
        let agents_md_path = gbrain_path.join(&config.gbrain.agents_file);
        agents_gen::remove_department_section(&agents_md_path, name)?;
    }

    println!("\n  ✓ {} department removed", template.display_name);

    if keep_data {
        println!("\n  GBrain data preserved. To also remove:");
        println!("    sockt department remove {} --keep-data=false", name);
    }

    Ok(())
}

async fn show_info(
    name: &str,
    json: bool,
    _config_path: Option<PathBuf>,
) -> Result<()> {
    let template = templates::get_template(name)
        .ok_or_else(|| anyhow::anyhow!(
            "Unknown department: '{}'. Available: {}",
            name,
            templates::template_names().join(", ")
        ))?;

    if json {
        let output = serde_json::json!({
            "id": template.id,
            "display_name": template.display_name,
            "description": template.description,
            "agents": template.agents.iter().map(|a| {
                serde_json::json!({
                    "name": a.name,
                    "role": a.role,
                    "tools": a.tools,
                    "schedule": a.schedule,
                    "hitl": a.hitl,
                })
            }).collect::<Vec<_>>(),
            "required_integrations": template.required_integrations,
            "optional_integrations": template.optional_integrations,
        });
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        println!("\n  {}", template.display_name);
        println!("  {}", "─".repeat(65));
        println!("  Agents:     {}", template.agents.len());
        println!();
        println!("  ┌─ Agents {}", "─".repeat(56));

        for agent in template.agents {
            println!("  │");
            println!("  │ {}", agent.name);
            println!("  │   Role: {}", agent.role);
            println!("  │   Tools: {}", agent.tools.join(", "));
            println!("  │   Schedule: {}", agent.schedule);
            println!("  │   HITL: {}", agent.hitl);
        }

        println!("  │");
        println!("  └{}", "─".repeat(65));
    }

    Ok(())
}
