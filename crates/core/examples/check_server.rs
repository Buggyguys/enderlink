//! Read-only Minecraft status probe; does not authenticate or join the game.
use anyhow::{Context, Result};
#[tokio::main]
async fn main() -> Result<()> {
    let address = std::env::args()
        .nth(1)
        .context("Pass a Minecraft server address")?;
    let status = enderlink_core::status::check(&address).await?;
    println!(
        "{}: {} player(s) online; status received in {} ms.",
        status.version, status.online, status.latency_ms
    );
    Ok(())
}
