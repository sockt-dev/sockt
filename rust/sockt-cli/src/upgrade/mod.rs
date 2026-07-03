use std::path::Path;

use sha2::{Digest, Sha256};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum UpgradeError {
    #[error("failed to check for updates: {0}")]
    CheckFailed(String),
    #[error("download failed: {0}")]
    DownloadFailed(String),
    #[error("checksum mismatch: expected {expected}, got {actual}")]
    ChecksumMismatch { expected: String, actual: String },
    #[error("failed to replace binary: {0}")]
    ReplaceFailed(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone)]
pub struct ReleaseInfo {
    pub version: String,
    pub download_url: String,
    pub checksum: String,
}

pub struct UpgradeManager {
    current_version: String,
    check_url: String,
}

impl UpgradeManager {
    pub fn new(current_version: String, check_url: String) -> Self {
        Self {
            current_version,
            check_url,
        }
    }

    pub fn check_url(&self) -> &str {
        &self.check_url
    }

    pub fn current_version(&self) -> &str {
        &self.current_version
    }

    pub fn verify_checksum(file_path: &Path, expected: &str) -> Result<(), UpgradeError> {
        let contents = std::fs::read(file_path)?;
        let mut hasher = Sha256::new();
        hasher.update(&contents);
        let actual = format!("{:x}", hasher.finalize());

        if actual != expected {
            return Err(UpgradeError::ChecksumMismatch {
                expected: expected.to_string(),
                actual,
            });
        }
        Ok(())
    }

    pub fn replace_binary(current: &Path, new: &Path) -> Result<(), UpgradeError> {
        let backup = current.with_extension("bak");

        std::fs::rename(current, &backup).map_err(|e| {
            UpgradeError::ReplaceFailed(format!("failed to backup current binary: {e}"))
        })?;

        if let Err(e) = std::fs::rename(new, current) {
            std::fs::rename(&backup, current).ok();
            return Err(UpgradeError::ReplaceFailed(format!(
                "failed to install new binary: {e}"
            )));
        }

        std::fs::remove_file(&backup).ok();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::TempDir;

    #[test]
    fn verify_checksum_passes_for_correct_hash() {
        let dir = TempDir::new().unwrap();
        let file_path = dir.path().join("binary");
        let content = b"hello world";
        std::fs::write(&file_path, content).unwrap();

        let expected = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
        UpgradeManager::verify_checksum(&file_path, expected).unwrap();
    }

    #[test]
    fn verify_checksum_fails_for_wrong_hash() {
        let dir = TempDir::new().unwrap();
        let file_path = dir.path().join("binary");
        std::fs::write(&file_path, b"hello world").unwrap();

        let result = UpgradeManager::verify_checksum(&file_path, "wrong_hash");
        assert!(matches!(result, Err(UpgradeError::ChecksumMismatch { .. })));
    }

    #[test]
    fn replace_binary_atomic() {
        let dir = TempDir::new().unwrap();
        let current = dir.path().join("sockt");
        let new = dir.path().join("sockt-new");

        std::fs::write(&current, b"old version").unwrap();
        std::fs::write(&new, b"new version").unwrap();

        UpgradeManager::replace_binary(&current, &new).unwrap();

        let content = std::fs::read_to_string(&current).unwrap();
        assert_eq!(content, "new version");
        assert!(!new.exists());
    }

    #[test]
    fn replace_binary_restores_on_failure() {
        let dir = TempDir::new().unwrap();
        let current = dir.path().join("sockt");
        let new = PathBuf::from("/nonexistent/path/sockt-new");

        std::fs::write(&current, b"old version").unwrap();

        let result = UpgradeManager::replace_binary(&current, &new);
        assert!(result.is_err());

        let content = std::fs::read_to_string(&current).unwrap();
        assert_eq!(content, "old version");
    }

    #[test]
    fn manager_stores_version_and_url() {
        let mgr = UpgradeManager::new(
            "0.1.0".to_string(),
            "https://api.github.com/repos/sockt/sockt/releases/latest".to_string(),
        );
        assert_eq!(mgr.current_version(), "0.1.0");
        assert!(mgr.check_url().contains("github.com"));
    }
}
