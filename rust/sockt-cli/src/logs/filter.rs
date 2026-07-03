use anyhow::{Result, bail};
use super::LogEntry;

pub struct LogFilter {
    level: Option<String>,
    since_ms: Option<i64>,
    tail: Option<usize>,
}

impl LogFilter {
    pub fn new(level: Option<&str>, since: Option<&str>, tail: Option<usize>) -> Result<Self> {
        let since_ms = if let Some(s) = since {
            Some(parse_since(s)?)
        } else {
            None
        };
        Ok(Self {
            level: level.map(|l| l.to_uppercase()),
            since_ms,
            tail,
        })
    }

    pub fn apply(&self, mut entries: Vec<LogEntry>) -> Vec<LogEntry> {
        entries.retain(|e| self.matches_entry(e));
        if let Some(n) = self.tail {
            if entries.len() > n {
                let skip = entries.len() - n;
                entries = entries.into_iter().skip(skip).collect();
            }
        }
        entries
    }

    pub fn matches_entry(&self, entry: &LogEntry) -> bool {
        if let Some(ref level) = self.level {
            let order = level_order(&entry.level);
            let filter_order = level_order(level);
            if order < filter_order {
                return false;
            }
        }
        if let Some(since) = self.since_ms {
            if entry.timestamp > 0 && entry.timestamp < since {
                return false;
            }
        }
        true
    }
}

fn level_order(level: &str) -> u8 {
    match level.to_uppercase().as_str() {
        "TRACE" => 0,
        "DEBUG" => 1,
        "INFO"  => 2,
        "WARN"  => 3,
        "ERROR" => 4,
        _       => 2,
    }
}

fn parse_since(s: &str) -> Result<i64> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let (num, unit) = s.split_at(s.len().saturating_sub(1));
    let num: i64 = num.trim().parse().unwrap_or(1);

    let ms = match unit {
        "s" => num * 1_000,
        "m" => num * 60_000,
        "h" => num * 3_600_000,
        "d" => num * 86_400_000,
        _ => bail!("invalid duration '{}' — use e.g. 1h, 30m, 2d", s),
    };

    Ok(now_ms - ms)
}
