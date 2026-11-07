//! Opt-in check of a previously saved Playit link. Close Enderlink first.
//! Uses the existing app-data directory and system credential store, never a
//! credential argument or plaintext file. Does not start a world or forward traffic.
use anyhow::{Context, Result, ensure};
use enderlink_core::Service;
use std::path::PathBuf;

#[tokio::main]
async fn main() -> Result<()> {
    let root = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .context("Pass Enderlink's existing app-data directory; close the app first.")?;
    ensure!(
        root.join("state.sqlite").is_file(),
        "Use an existing app-data directory."
    );
    // Service's normal exclusive lock prevents running alongside the app.
    let service = Service::new(root)?;
    ensure!(
        service.orphan.lock().unwrap().is_none(),
        "Stop the existing server before checking setup."
    );
    ensure!(
        service.snapshot()?.provider.linked,
        "No saved Playit authorization is available. Link through Enderlink first."
    );
    service.verify_provider().await?;
    let snapshot = service.snapshot()?;
    ensure!(
        snapshot.provider.agent_registered,
        "The device has not registered."
    );
    ensure!(
        snapshot.session.is_none() && snapshot.provider.endpoints.is_empty(),
        "Setup unexpectedly started hosting."
    );
    println!("Playit device registration: verified through the upstream control handshake.");
    println!(
        "Minecraft Java tunnel configured: {}.",
        snapshot.data.provider_setup.tunnel_configured
    );
    println!(
        "No Minecraft process or tunnel forwarder was started. Authorization stays in the system credential store."
    );
    Ok(())
}
