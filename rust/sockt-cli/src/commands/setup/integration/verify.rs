use anyhow::Context;
use std::time::Duration;

pub async fn verify_github(token: &str) -> anyhow::Result<()> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Sockt-CLI")
        .build()?;

    let resp = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .context("Failed to connect to GitHub API")?;

    if resp.status().is_success() {
        Ok(())
    } else {
        anyhow::bail!("GitHub token verification failed: HTTP {}", resp.status())
    }
}

pub async fn verify_hubspot(api_key: &str) -> anyhow::Result<()> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;

    let resp = client
        .get("https://api.hubapi.com/crm/v3/objects/contacts?limit=1")
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .context("Failed to connect to HubSpot API")?;

    if resp.status().is_success() {
        Ok(())
    } else {
        anyhow::bail!("HubSpot API verification failed: HTTP {}", resp.status())
    }
}

pub async fn verify_linear(api_key: &str) -> anyhow::Result<()> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;

    let query = serde_json::json!({
        "query": "{ viewer { id name } }"
    });

    let resp = client
        .post("https://api.linear.app/graphql")
        .header("Authorization", api_key)
        .json(&query)
        .send()
        .await
        .context("Failed to connect to Linear API")?;

    if resp.status().is_success() {
        Ok(())
    } else {
        anyhow::bail!("Linear API verification failed: HTTP {}", resp.status())
    }
}

pub async fn verify_sentry(auth_token: &str, dsn: &str) -> anyhow::Result<()> {
    // Parse DSN to extract organization
    let url = url::Url::parse(dsn)
        .context("Invalid Sentry DSN format. Expected format: https://key@sentry.io/project")?;

    let host = url.host_str()
        .ok_or_else(|| anyhow::anyhow!("Invalid DSN: no host found"))?;

    // Extract project ID from path
    let path_segments: Vec<&str> = url.path().trim_matches('/').split('/').collect();
    if path_segments.is_empty() {
        anyhow::bail!("Invalid DSN: no project ID found");
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;

    // Try to access the projects endpoint
    let api_url = if host.contains("sentry.io") {
        "https://sentry.io/api/0/projects/"
    } else {
        &format!("https://{}/api/0/projects/", host)
    };

    let resp = client
        .get(api_url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .send()
        .await
        .context("Failed to connect to Sentry API")?;

    if resp.status().is_success() {
        Ok(())
    } else {
        anyhow::bail!("Sentry API verification failed: HTTP {}", resp.status())
    }
}

pub async fn verify_pagerduty(api_token: &str) -> anyhow::Result<()> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;

    let resp = client
        .get("https://api.pagerduty.com/users?limit=1")
        .header("Authorization", format!("Token token={}", api_token))
        .header("Accept", "application/vnd.pagerduty+json;version=2")
        .send()
        .await
        .context("Failed to connect to PagerDuty API")?;

    if resp.status().is_success() {
        Ok(())
    } else {
        anyhow::bail!("PagerDuty API verification failed: HTTP {}", resp.status())
    }
}

pub async fn verify_apollo(api_key: &str) -> anyhow::Result<()> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;

    let resp = client
        .get("https://api.apollo.io/v1/auth/health")
        .header("X-Api-Key", api_key)
        .send()
        .await
        .context("Failed to connect to Apollo API")?;

    if resp.status().is_success() {
        Ok(())
    } else {
        anyhow::bail!("Apollo API verification failed: HTTP {}", resp.status())
    }
}
