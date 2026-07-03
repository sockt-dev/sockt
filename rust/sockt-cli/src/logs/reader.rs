use std::path::PathBuf;
use anyhow::Result;
use super::LogEntry;

pub struct LogReader {
    log_dir: PathBuf,
}

impl LogReader {
    pub fn new(log_dir: PathBuf) -> Self {
        Self { log_dir }
    }

    /// Read log entries from ~/.sockt/logs/, optionally filtered to one agent.
    pub fn read_entries(&self, agent: Option<&str>) -> Result<Vec<LogEntry>> {
        let mut entries = Vec::new();

        if !self.log_dir.exists() {
            return Ok(entries);
        }

        let pattern = match agent {
            Some(name) => format!("{}.log", name),
            None => "*.log".to_string(),
        };

        let files: Vec<PathBuf> = if agent.is_some() {
            let path = self.log_dir.join(&pattern);
            if path.exists() { vec![path] } else { vec![] }
        } else {
            std::fs::read_dir(&self.log_dir)?
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.extension().map(|e| e == "log").unwrap_or(false))
                .collect()
        };

        for file in files {
            let agent_name = file
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string();

            let content = std::fs::read_to_string(&file).unwrap_or_default();
            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() { continue; }

                // Try to parse as JSON (JSONL format)
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
                    let timestamp = val["timestamp"].as_i64()
                        .or_else(|| val["ts"].as_i64())
                        .unwrap_or(0);
                    let level = val["level"].as_str()
                        .or_else(|| val["lvl"].as_str())
                        .unwrap_or("INFO")
                        .to_uppercase();
                    let message = val["message"].as_str()
                        .or_else(|| val["msg"].as_str())
                        .unwrap_or(line)
                        .to_string();
                    let log_agent = val["agent"].as_str()
                        .unwrap_or(&agent_name)
                        .to_string();

                    entries.push(LogEntry { timestamp, level, agent: log_agent, message });
                } else {
                    // Plain text fallback — try to infer level
                    let level = if line.contains("ERROR") { "ERROR" }
                        else if line.contains("WARN") { "WARN" }
                        else if line.contains("DEBUG") { "DEBUG" }
                        else { "INFO" };

                    entries.push(LogEntry {
                        timestamp: 0,
                        level: level.to_string(),
                        agent: agent_name.clone(),
                        message: line.to_string(),
                    });
                }
            }
        }

        entries.sort_by_key(|e| e.timestamp);
        Ok(entries)
    }
}
