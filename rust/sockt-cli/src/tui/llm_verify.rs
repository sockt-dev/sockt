use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crossterm::style::Stylize;

use crate::config::ModelProvider;

pub fn print_header(text: &str) {
    println!("  {} {}", "\u{25c6}".cyan(), text.cyan().bold());
}

pub fn print_success(text: &str) {
    println!("  {} {}", "\u{2713}".green(), text.green());
}

pub fn print_error(text: &str) {
    println!("  {} {}", "\u{2717}".red(), text.red());
}

pub fn print_hint(text: &str) {
    println!("  {}", text.dark_grey());
}

const SPINNER_FRAMES: &[&str] = &[
    "\u{280b}", "\u{2819}", "\u{2839}", "\u{2838}", "\u{283c}", "\u{2834}", "\u{2826}",
    "\u{2827}", "\u{2807}", "\u{280f}",
];

pub async fn verify_model_inline(
    provider: &ModelProvider,
    api_key: &str,
    base_url: Option<&str>,
    model: &str,
    aws_region: Option<&str>,
) -> Result<(), String> {
    let prefix = format!("  {} ", model);

    let done = Arc::new(AtomicBool::new(false));
    let done_clone = done.clone();
    let prefix_clone = prefix.clone();

    let spinner_handle = tokio::spawn(async move {
        let mut i = 0;
        loop {
            if done_clone.load(Ordering::Relaxed) {
                break;
            }
            let frame = SPINNER_FRAMES[i % SPINNER_FRAMES.len()];
            print!("\r{}{}", prefix_clone, frame.cyan());
            let _ = std::io::stdout().flush();
            i += 1;
            tokio::time::sleep(Duration::from_millis(80)).await;
        }
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap();

    let result = match provider {
        ModelProvider::Anthropic => verify_anthropic(&client, api_key, model).await,
        ModelProvider::Openai => verify_openai(&client, api_key, model).await,
        ModelProvider::Bedrock => {
            let region = aws_region.unwrap_or("us-east-1");
            verify_bedrock(&client, api_key, region, model).await
        }
        ModelProvider::Custom => {
            let url = base_url.unwrap_or("http://localhost:11434/v1");
            verify_custom(&client, api_key, url, model).await
        }
    };

    done.store(true, Ordering::Relaxed);
    spinner_handle.await.ok();

    match result {
        Ok(_) => {
            print!("\r{}{}\n", prefix, "\u{2713}".green());
            let _ = std::io::stdout().flush();
            Ok(())
        }
        Err(reason) => {
            print!("\r{}{} {}\n", prefix, "\u{2717}".red(), reason.as_str().red());
            let _ = std::io::stdout().flush();
            Err(reason)
        }
    }
}

async fn verify_anthropic(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
) -> Result<String, String> {
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&serde_json::json!({
            "model": model,
            "max_tokens": 10,
            "messages": [{"role": "user", "content": "Respond with only the word OK."}]
        }))
        .send()
        .await
        .map_err(|e| format!("connection failed: {}", e))?;

    parse_status(resp.status(), model)?;

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let text = body["content"][0]["text"]
        .as_str()
        .unwrap_or("OK")
        .to_string();
    Ok(text)
}

async fn verify_openai(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
) -> Result<String, String> {
    let resp = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": model,
            "max_tokens": 10,
            "messages": [{"role": "user", "content": "Respond with only the word OK."}]
        }))
        .send()
        .await
        .map_err(|e| format!("connection failed: {}", e))?;

    parse_status(resp.status(), model)?;

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let text = body["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("OK")
        .to_string();
    Ok(text)
}

async fn verify_bedrock(
    client: &reqwest::Client,
    api_key: &str,
    region: &str,
    model: &str,
) -> Result<String, String> {
    let endpoint = format!(
        "https://bedrock-runtime.{}.amazonaws.com/model/{}/invoke",
        region, model
    );

    let resp = client
        .post(&endpoint)
        .header("content-type", "application/json")
        .header("x-api-key", api_key)
        .json(&serde_json::json!({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 10,
            "messages": [{"role": "user", "content": "Respond with only the word OK."}]
        }))
        .send()
        .await
        .map_err(|e| format!("connection failed: {}", e))?;

    parse_status(resp.status(), model)?;

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let text = body["content"][0]["text"]
        .as_str()
        .unwrap_or("OK")
        .to_string();
    Ok(text)
}

async fn verify_custom(
    client: &reqwest::Client,
    api_key: &str,
    base_url: &str,
    model: &str,
) -> Result<String, String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    // Auto-detect OpenRouter and add required headers
    // OpenRouter requires HTTP-Referer and X-Title headers for all requests
    // This prevents "error decoding response body" during verification
    let is_openrouter = base_url.contains("openrouter.ai");

    let mut request = client
        .post(&url)
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": model,
            "max_tokens": 10,
            "messages": [{"role": "user", "content": "Respond with only the word OK."}]
        }));

    // Add OpenRouter-specific headers
    if is_openrouter {
        request = request
            .header("HTTP-Referer", "https://github.com/sockt")
            .header("X-Title", "Sockt");
    }

    let resp = request
        .send()
        .await
        .map_err(|e| format!("connection failed: {}", e))?;

    parse_status(resp.status(), model)?;

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let text = body["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("OK")
        .to_string();
    Ok(text)
}

fn parse_status(status: reqwest::StatusCode, model: &str) -> Result<(), String> {
    if status == 401 || status == 403 {
        return Err("invalid api key".to_string());
    }
    if status == 404 {
        return Err(format!("model '{}' not found", model));
    }
    if status == 429 {
        return Err("rate limited".to_string());
    }
    if !status.is_success() {
        return Err(format!("error {}", status.as_u16()));
    }
    Ok(())
}
