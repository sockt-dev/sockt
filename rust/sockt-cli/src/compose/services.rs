use serde_yaml::{Mapping, Value};

use crate::config::SocktConfig;

pub fn orch_service(config: &SocktConfig) -> Value {
    let mut service = Mapping::new();
    service.insert(
        Value::String("image".into()),
        Value::String("ghcr.io/sockt/orch:latest".into()),
    );
    service.insert(
        Value::String("container_name".into()),
        Value::String(format!("sockt-orch-{}", &config.deployment_id[..8.min(config.deployment_id.len())])),
    );

    let mut ports = vec![];
    ports.push(Value::String("3100:3100".into()));
    service.insert(Value::String("ports".into()), Value::Sequence(ports));

    let mut env = Mapping::new();
    env.insert(
        Value::String("TENANT_ID".into()),
        Value::String(config.deployment_id.clone()),
    );
    env.insert(
        Value::String("GBRAIN_MCP_URL".into()),
        Value::String("http://gbrain:3200".into()),
    );
    env.insert(
        Value::String("MODEL_PROVIDER".into()),
        Value::String(config.models.provider.to_string()),
    );
    env.insert(
        Value::String("FRONTIER_MODEL".into()),
        Value::String(config.models.frontier.clone()),
    );
    env.insert(
        Value::String("FAST_MODEL".into()),
        Value::String(config.models.fast.clone()),
    );
    if let Some(ref base_url) = config.models.base_url {
        env.insert(
            Value::String("MODEL_BASE_URL".into()),
            Value::String(base_url.clone()),
        );
    }
    if let Some(ref region) = config.models.aws_region {
        env.insert(
            Value::String("AWS_REGION".into()),
            Value::String(region.clone()),
        );
    }
    service.insert(
        Value::String("environment".into()),
        Value::Mapping(env),
    );

    let mut depends_on = Mapping::new();
    let mut gbrain_dep = Mapping::new();
    gbrain_dep.insert(
        Value::String("condition".into()),
        Value::String("service_healthy".into()),
    );
    depends_on.insert(Value::String("gbrain".into()), Value::Mapping(gbrain_dep));
    service.insert(
        Value::String("depends_on".into()),
        Value::Mapping(depends_on),
    );

    let mut healthcheck = Mapping::new();
    healthcheck.insert(
        Value::String("test".into()),
        Value::String("curl -f http://localhost:3100/health || exit 1".into()),
    );
    healthcheck.insert(Value::String("interval".into()), Value::String("10s".into()));
    healthcheck.insert(Value::String("timeout".into()), Value::String("5s".into()));
    healthcheck.insert(Value::String("retries".into()), Value::Number(3.into()));
    service.insert(
        Value::String("healthcheck".into()),
        Value::Mapping(healthcheck),
    );

    service.insert(
        Value::String("networks".into()),
        Value::Sequence(vec![Value::String("sockt-net".into())]),
    );

    let mut volumes = vec![];
    volumes.push(Value::String("scratch-data:/workspace/scratch".into()));
    service.insert(Value::String("volumes".into()), Value::Sequence(volumes));

    service.insert(
        Value::String("restart".into()),
        Value::String("unless-stopped".into()),
    );

    Value::Mapping(service)
}

pub fn gbrain_service(config: &SocktConfig) -> Value {
    let mut service = Mapping::new();
    service.insert(
        Value::String("image".into()),
        Value::String("ghcr.io/sockt/gbrain:latest".into()),
    );
    service.insert(
        Value::String("container_name".into()),
        Value::String(format!("sockt-gbrain-{}", &config.deployment_id[..8.min(config.deployment_id.len())])),
    );

    let mut ports = vec![];
    ports.push(Value::String("3200:3200".into()));
    service.insert(Value::String("ports".into()), Value::Sequence(ports));

    let mut env = Mapping::new();
    env.insert(
        Value::String("GBRAIN_DIR".into()),
        Value::String("/gbrain".into()),
    );
    service.insert(
        Value::String("environment".into()),
        Value::Mapping(env),
    );

    let mut volumes = vec![];
    volumes.push(Value::String(format!(
        "{}:/gbrain",
        config.gbrain.directory.display()
    )));
    service.insert(Value::String("volumes".into()), Value::Sequence(volumes));

    let mut healthcheck = Mapping::new();
    healthcheck.insert(
        Value::String("test".into()),
        Value::String("curl -f http://localhost:3200/health || exit 1".into()),
    );
    healthcheck.insert(Value::String("interval".into()), Value::String("10s".into()));
    healthcheck.insert(Value::String("timeout".into()), Value::String("5s".into()));
    healthcheck.insert(Value::String("retries".into()), Value::Number(3.into()));
    service.insert(
        Value::String("healthcheck".into()),
        Value::Mapping(healthcheck),
    );

    service.insert(
        Value::String("networks".into()),
        Value::Sequence(vec![Value::String("sockt-net".into())]),
    );

    service.insert(
        Value::String("restart".into()),
        Value::String("unless-stopped".into()),
    );

    Value::Mapping(service)
}

pub fn agent_service(config: &SocktConfig) -> Value {
    let mut service = Mapping::new();
    service.insert(
        Value::String("image".into()),
        Value::String("ghcr.io/sockt/runtime:latest".into()),
    );
    service.insert(
        Value::String("container_name".into()),
        Value::String(format!("sockt-agent-{}", &config.deployment_id[..8.min(config.deployment_id.len())])),
    );

    let mut env = Mapping::new();
    env.insert(
        Value::String("ORCH_URL".into()),
        Value::String("http://sockt-orch:3100".into()),
    );
    env.insert(
        Value::String("TENANT_ID".into()),
        Value::String(config.deployment_id.clone()),
    );
    env.insert(
        Value::String("SCRATCH_DIR".into()),
        Value::String("/workspace/scratch".into()),
    );
    service.insert(
        Value::String("environment".into()),
        Value::Mapping(env),
    );

    let mut depends_on = Mapping::new();
    let mut orch_dep = Mapping::new();
    orch_dep.insert(
        Value::String("condition".into()),
        Value::String("service_healthy".into()),
    );
    depends_on.insert(
        Value::String("sockt-orch".into()),
        Value::Mapping(orch_dep),
    );
    service.insert(
        Value::String("depends_on".into()),
        Value::Mapping(depends_on),
    );

    let mut volumes = vec![];
    volumes.push(Value::String("scratch-data:/workspace/scratch".into()));
    service.insert(Value::String("volumes".into()), Value::Sequence(volumes));

    service.insert(
        Value::String("networks".into()),
        Value::Sequence(vec![Value::String("sockt-net".into())]),
    );

    service.insert(
        Value::String("restart".into()),
        Value::String("unless-stopped".into()),
    );

    Value::Mapping(service)
}

pub fn cadvp_service(config: &SocktConfig) -> Value {
    let mut service = Mapping::new();
    service.insert(
        Value::String("image".into()),
        Value::String("ghcr.io/sockt/cadvp:latest".into()),
    );
    service.insert(
        Value::String("container_name".into()),
        Value::String(format!("sockt-cadvp-{}", &config.deployment_id[..8.min(config.deployment_id.len())])),
    );

    let mut env = Mapping::new();
    env.insert(
        Value::String("GBRAIN_MCP_URL".into()),
        Value::String("http://gbrain:3200".into()),
    );
    env.insert(
        Value::String("WATCH_DIR".into()),
        Value::String("/watch".into()),
    );
    service.insert(
        Value::String("environment".into()),
        Value::Mapping(env),
    );

    let mut depends_on = Mapping::new();
    let mut gbrain_dep = Mapping::new();
    gbrain_dep.insert(
        Value::String("condition".into()),
        Value::String("service_healthy".into()),
    );
    depends_on.insert(Value::String("gbrain".into()), Value::Mapping(gbrain_dep));
    service.insert(
        Value::String("depends_on".into()),
        Value::Mapping(depends_on),
    );

    let mut volumes = vec![];
    volumes.push(Value::String("scratch-data:/watch".into()));
    service.insert(Value::String("volumes".into()), Value::Sequence(volumes));

    service.insert(
        Value::String("networks".into()),
        Value::Sequence(vec![Value::String("sockt-net".into())]),
    );

    service.insert(
        Value::String("restart".into()),
        Value::String("unless-stopped".into()),
    );

    Value::Mapping(service)
}

pub fn volumes() -> Value {
    let mut vols = Mapping::new();
    vols.insert(
        Value::String("scratch-data".into()),
        Value::Mapping(Mapping::new()),
    );
    Value::Mapping(vols)
}

pub fn networks() -> Value {
    let mut nets = Mapping::new();
    let mut net_config = Mapping::new();
    net_config.insert(
        Value::String("driver".into()),
        Value::String("bridge".into()),
    );
    nets.insert(
        Value::String("sockt-net".into()),
        Value::Mapping(net_config),
    );
    Value::Mapping(nets)
}
