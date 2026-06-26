pub mod services;

use crate::config::SocktConfig;

pub struct ComposeGenerator<'a> {
    config: &'a SocktConfig,
}

impl<'a> ComposeGenerator<'a> {
    pub fn new(config: &'a SocktConfig) -> Self {
        Self { config }
    }

    pub fn generate(&self) -> anyhow::Result<String> {
        let mut compose = serde_yaml::Mapping::new();
        let mut service_map = serde_yaml::Mapping::new();

        service_map.insert(
            serde_yaml::Value::String("sockt-orch".into()),
            services::orch_service(self.config),
        );

        service_map.insert(
            serde_yaml::Value::String("gbrain".into()),
            services::gbrain_service(self.config),
        );

        service_map.insert(
            serde_yaml::Value::String("sockt-agent".into()),
            services::agent_service(self.config),
        );

        service_map.insert(
            serde_yaml::Value::String("sockt-cadvp".into()),
            services::cadvp_service(self.config),
        );

        compose.insert(
            serde_yaml::Value::String("services".into()),
            serde_yaml::Value::Mapping(service_map),
        );

        compose.insert(
            serde_yaml::Value::String("volumes".into()),
            services::volumes(),
        );

        compose.insert(
            serde_yaml::Value::String("networks".into()),
            services::networks(),
        );

        let yaml = serde_yaml::to_string(&compose)?;
        Ok(yaml)
    }

    pub fn validate(yaml: &str) -> anyhow::Result<()> {
        let _: serde_yaml::Value = serde_yaml::from_str(yaml)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::Tier;
    use crate::config::{EncryptedValue, GBrainConfig, ModelConfig, SlackConfig, SocktConfig};
    use std::path::PathBuf;

    fn local_config() -> SocktConfig {
        SocktConfig {
            tier: Tier::Local,
            deployment_id: "test-deploy".to_string(),
            ..Default::default()
        }
    }

    fn cloud_config() -> SocktConfig {
        SocktConfig {
            tier: Tier::Cloud,
            deployment_id: "test-deploy".to_string(),
            ..Default::default()
        }
    }

    fn enterprise_config() -> SocktConfig {
        SocktConfig {
            tier: Tier::Enterprise,
            deployment_id: "ent-deploy".to_string(),
            ..Default::default()
        }
    }

    // ─── Service Presence ────────────────────────────────────────────────

    #[test]
    fn local_tier_includes_required_services() {
        let config = local_config();
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();

        let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).unwrap();
        let services = parsed["services"].as_mapping().unwrap();

        assert!(services.contains_key(&serde_yaml::Value::String("gbrain".into())));
        assert!(services.contains_key(&serde_yaml::Value::String("sockt-orch".into())));
        assert!(services.contains_key(&serde_yaml::Value::String("sockt-agent".into())));
        assert!(services.contains_key(&serde_yaml::Value::String("sockt-cadvp".into())));
    }

    #[test]
    fn local_tier_excludes_proxy() {
        let config = local_config();
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();

        let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).unwrap();
        let services = parsed["services"].as_mapping().unwrap();

        assert!(!services.contains_key(&serde_yaml::Value::String("sockt-proxy".into())));
    }

    #[test]
    fn cloud_tier_also_includes_core_services() {
        let config = cloud_config();
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();

        let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).unwrap();
        let services = parsed["services"].as_mapping().unwrap();
        assert!(services.contains_key(&serde_yaml::Value::String("gbrain".into())));
        assert!(services.contains_key(&serde_yaml::Value::String("sockt-orch".into())));
    }

    #[test]
    fn enterprise_tier_generates_valid_compose() {
        let config = enterprise_config();
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();
        ComposeGenerator::validate(&yaml).unwrap();
    }

    // ─── YAML Validity ───────────────────────────────────────────────────

    #[test]
    fn generated_yaml_is_valid() {
        let config = local_config();
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();

        ComposeGenerator::validate(&yaml).unwrap();
    }

    #[test]
    fn all_tiers_produce_valid_yaml() {
        for tier in [Tier::Local, Tier::Cloud, Tier::Enterprise] {
            let config = SocktConfig {
                tier,
                deployment_id: "test".to_string(),
                ..Default::default()
            };
            let generator = ComposeGenerator::new(&config);
            let yaml = generator.generate().unwrap();
            ComposeGenerator::validate(&yaml).expect("invalid YAML for tier");
        }
    }

    #[test]
    fn validate_rejects_invalid_yaml() {
        let result = ComposeGenerator::validate("services: [broken{{{");
        assert!(result.is_err());
    }

    // ─── Service Configuration ───────────────────────────────────────────

    #[test]
    fn services_have_depends_on() {
        let config = local_config();
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();

        let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).unwrap();
        let orch = &parsed["services"]["sockt-orch"];
        assert!(orch["depends_on"].is_mapping());
    }

    #[test]
    fn orch_depends_on_gbrain_healthy() {
        let config = local_config();
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();

        let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).unwrap();
        let dep = &parsed["services"]["sockt-orch"]["depends_on"]["gbrain"]["condition"];
        assert_eq!(dep.as_str().unwrap(), "service_healthy");
    }

    #[test]
    fn agent_depends_on_orch_healthy() {
        let config = local_config();
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();

        let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).unwrap();
        let dep = &parsed["services"]["sockt-agent"]["depends_on"]["sockt-orch"]["condition"];
        assert_eq!(dep.as_str().unwrap(), "service_healthy");
    }

    #[test]
    fn cadvp_depends_on_gbrain_healthy() {
        let config = local_config();
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();

        let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).unwrap();
        let dep = &parsed["services"]["sockt-cadvp"]["depends_on"]["gbrain"]["condition"];
        assert_eq!(dep.as_str().unwrap(), "service_healthy");
    }

    // ─── Container Naming ────────────────────────────────────────────────

    #[test]
    fn container_names_include_deployment_id_prefix() {
        let config = SocktConfig {
            deployment_id: "abcd1234-long-id".to_string(),
            ..Default::default()
        };
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();

        let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).unwrap();
        let orch_name = parsed["services"]["sockt-orch"]["container_name"].as_str().unwrap();
        assert!(orch_name.contains("abcd1234"), "name should contain prefix: {}", orch_name);
    }

    #[test]
    fn short_deployment_id_does_not_panic() {
        let config = SocktConfig {
            deployment_id: "ab".to_string(),
            ..Default::default()
        };
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();
        ComposeGenerator::validate(&yaml).unwrap();
    }

    // ─── Environment Variables ───────────────────────────────────────────

    #[test]
    fn orch_has_required_env_vars() {
        let config = local_config();
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();

        let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).unwrap();
        let env = parsed["services"]["sockt-orch"]["environment"].as_mapping().unwrap();

        let keys: Vec<&str> = env.keys().filter_map(|k| k.as_str()).collect();
        assert!(keys.contains(&"TENANT_ID"));
        assert!(keys.contains(&"GBRAIN_MCP_URL"));
        assert!(keys.contains(&"FRONTIER_MODEL"));
        assert!(keys.contains(&"FAST_MODEL"));
    }

    #[test]
    fn agent_has_required_env_vars() {
        let config = local_config();
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();

        let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).unwrap();
        let env = parsed["services"]["sockt-agent"]["environment"].as_mapping().unwrap();

        let keys: Vec<&str> = env.keys().filter_map(|k| k.as_str()).collect();
        assert!(keys.contains(&"ORCH_URL"));
        assert!(keys.contains(&"TENANT_ID"));
        assert!(keys.contains(&"SCRATCH_DIR"));
    }

    #[test]
    fn cadvp_has_required_env_vars() {
        let config = local_config();
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();

        let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).unwrap();
        let env = parsed["services"]["sockt-cadvp"]["environment"].as_mapping().unwrap();

        let keys: Vec<&str> = env.keys().filter_map(|k| k.as_str()).collect();
        assert!(keys.contains(&"GBRAIN_MCP_URL"));
        assert!(keys.contains(&"WATCH_DIR"));
    }

    #[test]
    fn model_config_propagates_to_env() {
        let config = SocktConfig {
            models: ModelConfig {
                frontier: "custom-model-v2".to_string(),
                fast: "fast-model-v1".to_string(),
                ..Default::default()
            },
            deployment_id: "test".to_string(),
            ..Default::default()
        };
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();

        assert!(yaml.contains("custom-model-v2"));
        assert!(yaml.contains("fast-model-v1"));
    }

    #[test]
    fn deployment_id_propagates_to_tenant_id() {
        let config = SocktConfig {
            deployment_id: "unique-tenant-xyz".to_string(),
            ..Default::default()
        };
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();

        assert!(yaml.contains("unique-tenant-xyz"));
    }

    // ─── Volumes & Networks ──────────────────────────────────────────────

    #[test]
    fn volumes_section_exists() {
        let config = local_config();
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();

        let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).unwrap();
        assert!(parsed["volumes"].is_mapping());
    }

    #[test]
    fn scratch_volume_defined() {
        let config = local_config();
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();

        let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).unwrap();
        let volumes = parsed["volumes"].as_mapping().unwrap();
        assert!(volumes.contains_key(&serde_yaml::Value::String("scratch-data".into())));
    }

    #[test]
    fn network_defined_with_bridge_driver() {
        let config = local_config();
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();

        let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).unwrap();
        let net = &parsed["networks"]["sockt-net"]["driver"];
        assert_eq!(net.as_str().unwrap(), "bridge");
    }

    #[test]
    fn all_services_on_sockt_net() {
        let config = local_config();
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();

        let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).unwrap();
        let services = parsed["services"].as_mapping().unwrap();

        for (name, service) in services {
            let networks = service["networks"].as_sequence().unwrap();
            let has_sockt_net = networks
                .iter()
                .any(|n| n.as_str() == Some("sockt-net"));
            assert!(has_sockt_net, "service {:?} missing sockt-net", name);
        }
    }

    // ─── Healthchecks ────────────────────────────────────────────────────

    #[test]
    fn orch_has_healthcheck() {
        let config = local_config();
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();

        let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).unwrap();
        let hc = &parsed["services"]["sockt-orch"]["healthcheck"];
        assert!(hc["test"].as_str().unwrap().contains("curl"));
        assert!(hc["interval"].as_str().is_some());
        assert!(hc["timeout"].as_str().is_some());
    }

    #[test]
    fn gbrain_has_healthcheck() {
        let config = local_config();
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();

        let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).unwrap();
        let hc = &parsed["services"]["gbrain"]["healthcheck"];
        assert!(hc["test"].as_str().unwrap().contains("curl"));
    }

    // ─── Restart Policy ──────────────────────────────────────────────────

    #[test]
    fn all_services_have_restart_policy() {
        let config = local_config();
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();

        let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).unwrap();
        let services = parsed["services"].as_mapping().unwrap();

        for (name, service) in services {
            let restart = service["restart"].as_str();
            assert!(
                restart.is_some(),
                "service {:?} missing restart policy",
                name
            );
            assert_eq!(restart.unwrap(), "unless-stopped");
        }
    }

    // ─── Image Tags ─────────────────────────────────────────────────────

    #[test]
    fn services_use_ghcr_images() {
        let config = local_config();
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();

        let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).unwrap();
        let services = parsed["services"].as_mapping().unwrap();

        for (name, service) in services {
            let image = service["image"].as_str().unwrap();
            assert!(
                image.starts_with("ghcr.io/sockt/"),
                "service {:?} has unexpected image: {}",
                name,
                image
            );
        }
    }

    // ─── GBrain Volume Mount ─────────────────────────────────────────────

    #[test]
    fn gbrain_mounts_configured_directory() {
        let config = SocktConfig {
            gbrain: GBrainConfig {
                directory: PathBuf::from("/custom/path/gbrain"),
                ..Default::default()
            },
            deployment_id: "test".to_string(),
            ..Default::default()
        };
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();

        assert!(yaml.contains("/custom/path/gbrain:/gbrain"));
    }

    // ─── Snapshot ────────────────────────────────────────────────────────

    #[test]
    fn snapshot_local_compose() {
        let config = local_config();
        let generator = ComposeGenerator::new(&config);
        let yaml = generator.generate().unwrap();

        insta::assert_snapshot!("local_compose", yaml);
    }
}
