pub mod filter;
pub mod formatter;
pub mod reader;

#[derive(Debug, Clone)]
pub struct LogEntry {
    pub timestamp: i64,
    pub level: String,
    pub agent: String,
    pub message: String,
}
