use anyhow::{Context, Result};
use std::path::Path;
use super::templates::DepartmentTemplate;

pub fn generate_department_section(template: &DepartmentTemplate) -> String {
    let mut section = String::new();

    section.push_str(&format!("---\n\n## Department: {}\n\n", template.display_name));
    section.push_str(&format!("{}\n\n", template.description));

    for agent in template.agents {
        section.push_str(&format!("### {}\n\n", agent.name));
        section.push_str(&format!("**Role:** {}\n\n", agent.role));
        section.push_str(&format!("**Tools:** {}\n\n", agent.tools.join(", ")));
        section.push_str(&format!("**Schedule:** {}\n\n", agent.schedule));
        section.push_str(&format!("**HITL:** {}\n\n", agent.hitl));
    }

    section
}

pub fn update_agents_md(path: &Path, department_name: &str, section: &str) -> Result<()> {
    let content = if path.exists() {
        std::fs::read_to_string(path)
            .context("Failed to read AGENTS.md")?
    } else {
        // Create basic AGENTS.md if doesn't exist
        String::from("# Agents — Your Company\n\n")
    };

    // Check if department section already exists
    if content.contains(&format!("## Department:")) && content.contains(department_name) {
        // More careful check - look for the exact department name after "## Department:"
        for line in content.lines() {
            if line.starts_with("## Department:") && line.contains(department_name) {
                anyhow::bail!("Department section for {} already exists in AGENTS.md", department_name);
            }
        }
    }

    // Append section
    let updated = format!("{}\n{}", content.trim_end(), section);

    std::fs::write(path, updated)
        .context("Failed to write AGENTS.md")?;

    Ok(())
}

pub fn remove_department_section(path: &Path, department_name: &str) -> Result<()> {
    if !path.exists() {
        return Ok(()); // Nothing to remove
    }

    let content = std::fs::read_to_string(path)
        .context("Failed to read AGENTS.md")?;

    // Find department section boundaries
    let lines: Vec<&str> = content.lines().collect();
    let mut new_lines: Vec<&str> = Vec::new();
    let mut in_department = false;
    let mut skip_separator = false;

    for (i, line) in lines.iter().enumerate() {
        if line.starts_with("## Department:") {
            // Check if it's our department (case-insensitive match)
            in_department = line.to_lowercase().contains(&department_name.to_lowercase());
            if in_department {
                // Check if previous line was a separator
                if i > 0 && lines[i-1].trim() == "---" && !new_lines.is_empty() {
                    new_lines.pop(); // Remove the separator
                }
                skip_separator = false;
            } else {
                new_lines.push(*line);
            }
        } else if in_department && (line.starts_with("## ") || line.starts_with("# ")) {
            // Hit next section
            in_department = false;
            new_lines.push(*line);
        } else if in_department && line.trim() == "---" {
            // Skip the ending separator of our department section
            skip_separator = true;
        } else if !in_department {
            if skip_separator && line.trim() == "---" {
                skip_separator = false;
                // Don't add this separator
            } else {
                new_lines.push(*line);
            }
        }
        // Skip lines if in_department is true
    }

    let updated = new_lines.join("\n");

    std::fs::write(path, updated)
        .context("Failed to write AGENTS.md")?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::department::templates;
    use tempfile::TempDir;

    #[test]
    fn test_generate_section_includes_agents() {
        let template = templates::get_template("growth").unwrap();
        let section = generate_department_section(template);

        assert!(section.contains("## Department: Growth"));
        assert!(section.contains("### Lead Researcher"));
        assert!(section.contains("### Outbound Writer"));
        assert!(section.contains("### Social Monitor"));
    }

    #[test]
    fn test_generate_section_includes_details() {
        let template = templates::get_template("product").unwrap();
        let section = generate_department_section(template);

        assert!(section.contains("**Role:**"));
        assert!(section.contains("**Tools:**"));
        assert!(section.contains("**Schedule:**"));
        assert!(section.contains("**HITL:**"));
    }

    #[test]
    fn test_update_agents_md_creates_file() {
        let temp_dir = TempDir::new().unwrap();
        let agents_path = temp_dir.path().join("AGENTS.md");

        let template = templates::get_template("growth").unwrap();
        let section = generate_department_section(template);

        update_agents_md(&agents_path, "growth", &section).unwrap();

        assert!(agents_path.exists());
        let content = std::fs::read_to_string(&agents_path).unwrap();
        assert!(content.contains("## Department: Growth"));
    }

    #[test]
    fn test_remove_department_section_removes_correctly() {
        let temp_dir = TempDir::new().unwrap();
        let agents_path = temp_dir.path().join("AGENTS.md");

        let initial_content = "# Agents\n\n## Department: Growth & Lead Generation\n\nContent here\n\n## Other Section\n\nOther content";
        std::fs::write(&agents_path, initial_content).unwrap();

        remove_department_section(&agents_path, "Growth").unwrap();

        let content = std::fs::read_to_string(&agents_path).unwrap();
        assert!(!content.contains("## Department: Growth"));
        assert!(content.contains("## Other Section"));
    }
}
