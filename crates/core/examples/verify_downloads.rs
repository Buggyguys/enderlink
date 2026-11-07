//! Live, opt-in smoke check. Downloads official engines and Java; does not accept the EULA or start Minecraft.
use enderlink_core::{
    Service,
    model::{Engine, World, id, now},
};
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let root = std::env::args_os()
        .nth(1)
        .map(std::path::PathBuf::from)
        .expect("Pass an empty temporary data directory");
    anyhow::ensure!(
        !root.exists() || std::fs::read_dir(&root)?.next().is_none(),
        "Choose a new empty directory; this smoke check must not modify existing app data."
    );
    let s = Service::new(root)?;
    for engine in [Engine::Paper, Engine::Fabric] {
        let games = s.minecraft_versions(engine.clone()).await?;
        anyhow::ensure!(
            games.iter().any(|g| g == "1.21.1"),
            "Missing expected stable game version"
        );
        let versions = s.versions(engine.clone(), "1.21.1").await?;
        let latest = versions.first().expect("No versions");
        println!(
            "{}: {} supported game versions; selected {}",
            engine.label(),
            games.len(),
            latest.version
        );
        let c = s
            .install(engine.clone(), "1.21.1", &latest.version, "smoke")
            .await?;
        println!(
            "Verified {} artifact: {} bytes, Java {}",
            engine.label(),
            c.bytes,
            c.java_major
        );
        // A synthetic, unaccepted world pin exercises uninstall/reinstall without launching a game.
        let pin = World {
            id: id(),
            name: format!("{} pin verification", engine.label()),
            revision: 1,
            component: c.clone(),
            memory_mb: 2048,
            max_players: 8,
            port: 25565,
            lan: false,
            online_mode: true,
            seed: String::new(),
            difficulty: "normal".into(),
            gamemode: "survival".into(),
            hardcore: false,
            pvp: true,
            allow_commands: false,
            force_gamemode: false,
            cover_block: None,
            gameplay_configured: true,
            eula_accepted_at: 0,
            players: vec![],
            created_at: now(),
            last_played: None,
            pack_notes: String::new(),
        };
        s.mutate(|d| {
            d.worlds.push(pin);
            Ok(())
        })?;
        s.uninstall(&c.id).await?;
        let reinstalled = s
            .install(engine.clone(), "1.21.1", &c.version, "smoke")
            .await?;
        anyhow::ensure!(
            reinstalled.id == c.id && reinstalled.sha256 == c.sha256,
            "Reinstall lost the original world pin or artifact checksum"
        );
        println!("Exact artifact reinstall preserved the world's component identity and SHA-256.");
        let java = s.ensure_java(c.java_major, "smoke").await?;
        let output = tokio::process::Command::new(java)
            .arg("-version")
            .output()
            .await?;
        anyhow::ensure!(output.status.success(), "Managed Java failed to run");
        println!(
            "Managed runtime: {}",
            String::from_utf8_lossy(&output.stderr)
                .lines()
                .next()
                .unwrap_or("OK")
        );
    }
    println!(
        "PASS: engine catalogs, checksummed downloads, managed Java execution. No Minecraft EULA accepted; no server launched."
    );
    Ok(())
}
