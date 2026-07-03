use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use age::secrecy::ExposeSecret;
use thiserror::Error;

use crate::config::EncryptedValue;

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("key file not found: {0}")]
    KeyNotFound(PathBuf),
    #[error("failed to generate identity: {0}")]
    Generation(String),
    #[error("encryption failed: {0}")]
    Encryption(String),
    #[error("decryption failed")]
    DecryptionFailed,
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid key format: {0}")]
    InvalidKey(String),
}

pub struct KeyManager {
    key_path: PathBuf,
}

impl KeyManager {
    pub fn new(key_path: PathBuf) -> Self {
        Self { key_path }
    }

    pub fn default_path() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".sockt")
            .join("key.txt")
    }

    pub fn key_path(&self) -> &Path {
        &self.key_path
    }

    pub fn generate(&self) -> Result<age::x25519::Identity, CryptoError> {
        if self.key_path.exists() {
            return self.load();
        }

        let identity = age::x25519::Identity::generate();

        if let Some(parent) = self.key_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let key_str = identity.to_string();
        std::fs::write(&self.key_path, key_str.expose_secret())?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&self.key_path, std::fs::Permissions::from_mode(0o600))?;
        }

        Ok(identity)
    }

    pub fn load(&self) -> Result<age::x25519::Identity, CryptoError> {
        if !self.key_path.exists() {
            return Err(CryptoError::KeyNotFound(self.key_path.clone()));
        }

        let contents = std::fs::read_to_string(&self.key_path)?;
        let identity: age::x25519::Identity = contents
            .trim()
            .parse()
            .map_err(|e| CryptoError::InvalidKey(format!("{e}")))?;
        Ok(identity)
    }

    /// Generate a new identity without checking if one already exists
    pub fn generate_new(&self) -> Result<age::x25519::Identity, CryptoError> {
        Ok(age::x25519::Identity::generate())
    }

    /// Backup the current key file to key.txt.bak
    pub fn backup(&self) -> Result<(), CryptoError> {
        if !self.key_path.exists() {
            return Err(CryptoError::KeyNotFound(self.key_path.clone()));
        }
        let backup_path = PathBuf::from(format!("{}.bak", self.key_path.display()));
        std::fs::copy(&self.key_path, &backup_path)?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&backup_path, std::fs::Permissions::from_mode(0o600))?;
        }

        Ok(())
    }

    /// Save an identity to the key file
    pub fn save(&self, identity: &age::x25519::Identity) -> Result<(), CryptoError> {
        let key_str = identity.to_string();
        std::fs::write(&self.key_path, key_str.expose_secret())?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&self.key_path, std::fs::Permissions::from_mode(0o600))?;
        }

        Ok(())
    }

    /// Get a shortened fingerprint of an identity
    pub fn fingerprint(identity: &age::x25519::Identity) -> String {
        let recipient = identity.to_public().to_string();
        if recipient.len() > 15 {
            format!("{}...{}", &recipient[..8], &recipient[recipient.len()-4..])
        } else {
            recipient
        }
    }
}

pub fn encrypt(plaintext: &str, recipient: &age::x25519::Recipient) -> Result<EncryptedValue, CryptoError> {
    let recipients: Vec<&dyn age::Recipient> = vec![recipient];
    let encryptor = age::Encryptor::with_recipients(recipients.into_iter())
        .map_err(|e| CryptoError::Encryption(e.to_string()))?;

    let mut encrypted = vec![];
    let mut writer = encryptor
        .wrap_output(&mut encrypted)
        .map_err(|e| CryptoError::Encryption(e.to_string()))?;
    writer
        .write_all(plaintext.as_bytes())
        .map_err(|e| CryptoError::Encryption(e.to_string()))?;
    writer
        .finish()
        .map_err(|e| CryptoError::Encryption(e.to_string()))?;

    Ok(EncryptedValue {
        ciphertext: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &encrypted),
        recipient: recipient.to_string(),
        set_at: None,
    })
}

pub fn decrypt(
    encrypted: &EncryptedValue,
    identity: &age::x25519::Identity,
) -> Result<String, CryptoError> {
    let ciphertext = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &encrypted.ciphertext,
    )
    .map_err(|_| CryptoError::DecryptionFailed)?;

    let decryptor = age::Decryptor::new(&ciphertext[..])
        .map_err(|_| CryptoError::DecryptionFailed)?;

    let mut decrypted = vec![];
    let mut reader = decryptor
        .decrypt(std::iter::once(identity as &dyn age::Identity))
        .map_err(|_| CryptoError::DecryptionFailed)?;
    reader
        .read_to_end(&mut decrypted)
        .map_err(|_| CryptoError::DecryptionFailed)?;

    String::from_utf8(decrypted).map_err(|_| CryptoError::DecryptionFailed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    use tempfile::TempDir;

    #[test]
    fn generate_creates_valid_identity() {
        let dir = TempDir::new().unwrap();
        let key_path = dir.path().join("key.txt");
        let km = KeyManager::new(key_path.clone());

        let identity = km.generate().unwrap();
        assert!(key_path.exists());

        let recipient = identity.to_public();
        let recipient_str = recipient.to_string();
        assert!(recipient_str.starts_with("age1"));
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let dir = TempDir::new().unwrap();
        let key_path = dir.path().join("key.txt");
        let km = KeyManager::new(key_path);
        let identity = km.generate().unwrap();
        let recipient = identity.to_public();

        let plaintext = "xoxb-my-super-secret-token";
        let encrypted = encrypt(plaintext, &recipient).unwrap();
        let decrypted = decrypt(&encrypted, &identity).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn encrypt_decrypt_empty_string() {
        let dir = TempDir::new().unwrap();
        let km = KeyManager::new(dir.path().join("key.txt"));
        let identity = km.generate().unwrap();
        let recipient = identity.to_public();

        let encrypted = encrypt("", &recipient).unwrap();
        let decrypted = decrypt(&encrypted, &identity).unwrap();
        assert_eq!(decrypted, "");
    }

    #[test]
    fn encrypt_decrypt_unicode() {
        let dir = TempDir::new().unwrap();
        let km = KeyManager::new(dir.path().join("key.txt"));
        let identity = km.generate().unwrap();
        let recipient = identity.to_public();

        let plaintext = "日本語テスト 🔐 مرحبا";
        let encrypted = encrypt(plaintext, &recipient).unwrap();
        let decrypted = decrypt(&encrypted, &identity).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn encrypt_decrypt_large_payload() {
        let dir = TempDir::new().unwrap();
        let km = KeyManager::new(dir.path().join("key.txt"));
        let identity = km.generate().unwrap();
        let recipient = identity.to_public();

        let plaintext = "A".repeat(100_000);
        let encrypted = encrypt(&plaintext, &recipient).unwrap();
        let decrypted = decrypt(&encrypted, &identity).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn encrypt_decrypt_special_characters() {
        let dir = TempDir::new().unwrap();
        let km = KeyManager::new(dir.path().join("key.txt"));
        let identity = km.generate().unwrap();
        let recipient = identity.to_public();

        let cases = [
            "\0\0\0",
            "\n\r\t",
            "\"'\\",
            "xoxb-123-456-abc\ndef",
            &"\x01\x02\x03\x7f".to_string(),
            "-----BEGIN AGE ENCRYPTED FILE-----",
        ];

        for plaintext in cases {
            let encrypted = encrypt(plaintext, &recipient).unwrap();
            let decrypted = decrypt(&encrypted, &identity).unwrap();
            assert_eq!(decrypted, plaintext, "failed for: {:?}", plaintext);
        }
    }

    #[test]
    fn encrypt_produces_different_ciphertext_each_time() {
        let dir = TempDir::new().unwrap();
        let km = KeyManager::new(dir.path().join("key.txt"));
        let identity = km.generate().unwrap();
        let recipient = identity.to_public();

        let e1 = encrypt("same plaintext", &recipient).unwrap();
        let e2 = encrypt("same plaintext", &recipient).unwrap();

        // age uses randomized encryption, so ciphertexts should differ
        assert_ne!(e1.ciphertext, e2.ciphertext);
    }

    #[test]
    fn decrypt_with_wrong_key_fails() {
        let dir = TempDir::new().unwrap();

        let km1 = KeyManager::new(dir.path().join("key1.txt"));
        let identity1 = km1.generate().unwrap();
        let recipient1 = identity1.to_public();

        let km2 = KeyManager::new(dir.path().join("key2.txt"));
        let identity2 = km2.generate().unwrap();

        let encrypted = encrypt("secret", &recipient1).unwrap();
        let result = decrypt(&encrypted, &identity2);

        assert!(matches!(result, Err(CryptoError::DecryptionFailed)));
    }

    #[test]
    fn decrypt_with_corrupted_ciphertext_fails() {
        let dir = TempDir::new().unwrap();
        let km = KeyManager::new(dir.path().join("key.txt"));
        let identity = km.generate().unwrap();
        let recipient = identity.to_public();

        let mut encrypted = encrypt("secret", &recipient).unwrap();
        // corrupt the ciphertext
        encrypted.ciphertext = "definitely-not-valid-base64!!!".to_string();
        let result = decrypt(&encrypted, &identity);
        assert!(matches!(result, Err(CryptoError::DecryptionFailed)));
    }

    #[test]
    fn decrypt_with_truncated_ciphertext_fails() {
        let dir = TempDir::new().unwrap();
        let km = KeyManager::new(dir.path().join("key.txt"));
        let identity = km.generate().unwrap();
        let recipient = identity.to_public();

        let mut encrypted = encrypt("secret", &recipient).unwrap();
        // truncate: take only first 10 chars of valid base64
        encrypted.ciphertext = encrypted.ciphertext[..10].to_string();
        let result = decrypt(&encrypted, &identity);
        assert!(result.is_err());
    }

    #[test]
    fn decrypt_with_empty_ciphertext_fails() {
        let dir = TempDir::new().unwrap();
        let km = KeyManager::new(dir.path().join("key.txt"));
        let identity = km.generate().unwrap();

        let encrypted = EncryptedValue {
            ciphertext: "".to_string(),
            recipient: "age1abc".to_string(),
            set_at: None,
        };
        let result = decrypt(&encrypted, &identity);
        assert!(result.is_err());
    }

    #[cfg(unix)]
    #[test]
    fn key_file_has_600_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let dir = TempDir::new().unwrap();
        let key_path = dir.path().join("key.txt");
        let km = KeyManager::new(key_path.clone());
        km.generate().unwrap();

        let perms = std::fs::metadata(&key_path).unwrap().permissions();
        assert_eq!(perms.mode() & 0o777, 0o600);
    }

    #[test]
    fn encrypt_produces_base64() {
        let dir = TempDir::new().unwrap();
        let km = KeyManager::new(dir.path().join("key.txt"));
        let identity = km.generate().unwrap();
        let recipient = identity.to_public();

        let encrypted = encrypt("test", &recipient).unwrap();
        base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &encrypted.ciphertext,
        )
        .unwrap();
    }

    #[test]
    fn encrypt_stores_correct_recipient() {
        let dir = TempDir::new().unwrap();
        let km = KeyManager::new(dir.path().join("key.txt"));
        let identity = km.generate().unwrap();
        let recipient = identity.to_public();

        let encrypted = encrypt("test", &recipient).unwrap();
        assert_eq!(encrypted.recipient, recipient.to_string());
    }

    #[test]
    fn generate_is_idempotent() {
        let dir = TempDir::new().unwrap();
        let key_path = dir.path().join("key.txt");
        let km = KeyManager::new(key_path.clone());

        let id1 = km.generate().unwrap();
        let id2 = km.generate().unwrap();

        assert_eq!(id1.to_public().to_string(), id2.to_public().to_string());
    }

    #[test]
    fn generate_creates_parent_directories() {
        let dir = TempDir::new().unwrap();
        let key_path = dir.path().join("nested").join("deep").join("key.txt");
        let km = KeyManager::new(key_path.clone());
        km.generate().unwrap();
        assert!(key_path.exists());
    }

    #[test]
    fn load_after_generate_returns_same_key() {
        let dir = TempDir::new().unwrap();
        let key_path = dir.path().join("key.txt");
        let km = KeyManager::new(key_path);

        let generated = km.generate().unwrap();
        let loaded = km.load().unwrap();

        assert_eq!(
            generated.to_public().to_string(),
            loaded.to_public().to_string()
        );
    }

    #[test]
    fn load_nonexistent_key_returns_error() {
        let km = KeyManager::new(PathBuf::from("/nonexistent/key.txt"));
        let result = km.load();
        assert!(matches!(result, Err(CryptoError::KeyNotFound(_))));
    }

    #[test]
    fn load_invalid_key_file_returns_error() {
        let dir = TempDir::new().unwrap();
        let key_path = dir.path().join("key.txt");
        std::fs::write(&key_path, "not a valid age key").unwrap();

        let km = KeyManager::new(key_path);
        let result = km.load();
        assert!(matches!(result, Err(CryptoError::InvalidKey(_))));
    }

    #[test]
    fn multiple_keys_produce_different_identities() {
        let dir = TempDir::new().unwrap();
        let mut recipients = std::collections::HashSet::new();

        for i in 0..10 {
            let km = KeyManager::new(dir.path().join(format!("key{i}.txt")));
            let id = km.generate().unwrap();
            recipients.insert(id.to_public().to_string());
        }

        assert_eq!(recipients.len(), 10, "all keys should be unique");
    }

    #[test]
    fn encrypt_decrypt_stress_many_operations() {
        let dir = TempDir::new().unwrap();
        let km = KeyManager::new(dir.path().join("key.txt"));
        let identity = km.generate().unwrap();
        let recipient = identity.to_public();

        for i in 0..50 {
            let plaintext = format!("secret-{}-{}", i, "x".repeat(i * 10));
            let encrypted = encrypt(&plaintext, &recipient).unwrap();
            let decrypted = decrypt(&encrypted, &identity).unwrap();
            assert_eq!(decrypted, plaintext);
        }
    }

    // Property-based tests
    proptest! {
        #[test]
        fn roundtrip_any_ascii(plaintext in "[\\x20-\\x7e]{0,500}") {
            let dir = TempDir::new().unwrap();
            let km = KeyManager::new(dir.path().join("key.txt"));
            let identity = km.generate().unwrap();
            let recipient = identity.to_public();

            let encrypted = encrypt(&plaintext, &recipient).unwrap();
            let decrypted = decrypt(&encrypted, &identity).unwrap();
            prop_assert_eq!(decrypted, plaintext);
        }

        #[test]
        fn roundtrip_any_utf8(plaintext in "\\PC{0,200}") {
            let dir = TempDir::new().unwrap();
            let km = KeyManager::new(dir.path().join("key.txt"));
            let identity = km.generate().unwrap();
            let recipient = identity.to_public();

            let encrypted = encrypt(&plaintext, &recipient).unwrap();
            let decrypted = decrypt(&encrypted, &identity).unwrap();
            prop_assert_eq!(decrypted, plaintext);
        }

        #[test]
        fn ciphertext_is_always_valid_base64(plaintext in ".{1,100}") {
            let dir = TempDir::new().unwrap();
            let km = KeyManager::new(dir.path().join("key.txt"));
            let identity = km.generate().unwrap();
            let recipient = identity.to_public();

            let encrypted = encrypt(&plaintext, &recipient).unwrap();
            let decode_result = base64::Engine::decode(
                &base64::engine::general_purpose::STANDARD,
                &encrypted.ciphertext,
            );
            prop_assert!(decode_result.is_ok());
        }
    }

    #[test]
    fn generate_new_creates_different_key() {
        let dir = TempDir::new().unwrap();
        let km = KeyManager::new(dir.path().join("key.txt"));
        let id1 = km.generate().unwrap();
        let id2 = km.generate_new().unwrap();
        assert_ne!(id1.to_string().expose_secret(), id2.to_string().expose_secret());
    }

    #[test]
    fn backup_creates_bak_file() {
        let dir = TempDir::new().unwrap();
        let km = KeyManager::new(dir.path().join("key.txt"));
        km.generate().unwrap();
        km.backup().unwrap();
        assert!(dir.path().join("key.txt.bak").exists());
    }

    #[test]
    #[cfg(unix)]
    fn backup_preserves_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TempDir::new().unwrap();
        let km = KeyManager::new(dir.path().join("key.txt"));
        km.generate().unwrap();
        km.backup().unwrap();
        let metadata = std::fs::metadata(dir.path().join("key.txt.bak")).unwrap();
        assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
    }

    #[test]
    fn save_overwrites_key_file() {
        let dir = TempDir::new().unwrap();
        let km = KeyManager::new(dir.path().join("key.txt"));
        let _id1 = km.generate().unwrap();
        let id2 = age::x25519::Identity::generate();
        km.save(&id2).unwrap();
        let loaded = km.load().unwrap();
        assert_eq!(loaded.to_string().expose_secret(), id2.to_string().expose_secret());
    }

    #[test]
    fn fingerprint_format() {
        let id = age::x25519::Identity::generate();
        let fp = KeyManager::fingerprint(&id);
        assert!(fp.starts_with("age1"));
        assert!(fp.contains("..."));
    }

    #[test]
    fn fingerprint_stable() {
        let id = age::x25519::Identity::generate();
        let fp1 = KeyManager::fingerprint(&id);
        let fp2 = KeyManager::fingerprint(&id);
        assert_eq!(fp1, fp2);
    }
}
