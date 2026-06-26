use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};

pub const SLACK_MANIFEST: &str = include_str!("../../assets/slack-manifest.yaml");

pub fn manifest_creation_url() -> String {
    let encoded = utf8_percent_encode(SLACK_MANIFEST, NON_ALPHANUMERIC).to_string();
    format!(
        "https://api.slack.com/apps?new_app=1&manifest_yaml={}",
        encoded
    )
}

pub fn open_creation_page() -> bool {
    let url = manifest_creation_url();
    match open::that(&url) {
        Ok(_) => true,
        Err(_) => {
            println!("  Could not open browser automatically.");
            println!("  Please visit this URL to create your app:");
            println!();
            println!("  {}", url);
            println!();
            false
        }
    }
}

pub fn print_token_instructions() {
    println!();
    println!("  After creating the app:");
    println!();
    println!("  1. Generate an App-Level Token (xapp-...)");
    println!("     Settings > Basic Information > App-Level Tokens");
    println!("     Click 'Generate Token and Scopes'");
    println!("     Add scope: connections:write");
    println!("     Name it 'sockt-socket' and click 'Generate'");
    println!();
    println!("  2. Get the Bot Token (xoxb-...)");
    println!("     Settings > OAuth & Permissions");
    println!("     Click 'Install to Workspace' (if not already installed)");
    println!("     Copy the 'Bot User OAuth Token'");
    println!();
    println!("  3. Get the Signing Secret");
    println!("     Settings > Basic Information > App Credentials");
    println!("     Copy the 'Signing Secret'");
    println!();
}
