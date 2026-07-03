use super::LogEntry;

pub struct LogFormatter {
    color: bool,
    _agents: Vec<String>,
}

impl LogFormatter {
    pub fn new(color: bool, agents: Vec<String>) -> Self {
        Self { color, _agents: agents }
    }

    pub fn format(&self, entry: &LogEntry) -> String {
        let ts = if entry.timestamp > 0 {
            let secs = entry.timestamp / 1000;
            let ms = entry.timestamp % 1000;
            format!("{}.{:03}", secs, ms)
        } else {
            String::new()
        };

        if self.color {
            let (level_colored, msg_colored) = match entry.level.as_str() {
                "ERROR" => (
                    format!("\x1b[31mERROR\x1b[0m"),
                    format!("\x1b[31m{}\x1b[0m", entry.message),
                ),
                "WARN" => (
                    format!("\x1b[33mWARN \x1b[0m"),
                    format!("\x1b[33m{}\x1b[0m", entry.message),
                ),
                "DEBUG" => (
                    format!("\x1b[35mDEBUG\x1b[0m"),
                    entry.message.clone(),
                ),
                _ => (
                    format!("\x1b[36mINFO \x1b[0m"),
                    entry.message.clone(),
                ),
            };
            let agent = format!("\x1b[2m[{}]\x1b[0m", entry.agent);
            if ts.is_empty() {
                format!("{} {} {}", level_colored, agent, msg_colored)
            } else {
                format!("{} {} {} {}", ts, level_colored, agent, msg_colored)
            }
        } else {
            let level = format!("{:<5}", entry.level);
            if ts.is_empty() {
                format!("{} [{}] {}", level, entry.agent, entry.message)
            } else {
                format!("{} {} [{}] {}", ts, level, entry.agent, entry.message)
            }
        }
    }

    pub fn format_json(&self, entry: &LogEntry) -> String {
        serde_json::json!({
            "timestamp": entry.timestamp,
            "level":     entry.level,
            "agent":     entry.agent,
            "message":   entry.message,
        })
        .to_string()
    }
}
