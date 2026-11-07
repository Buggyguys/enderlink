use crate::{model::*, service::Service};
use anyhow::{Context, Result, ensure};
use serde_json::Value;

pub(crate) fn validate_gameplay(
    gamemode: &str,
    difficulty: &str,
    hardcore: bool,
    cover: Option<&str>,
) -> Result<()> {
    ensure!(
        ["survival", "creative", "adventure", "spectator"].contains(&gamemode)
            && ["peaceful", "easy", "normal", "hard"].contains(&difficulty),
        "Choose a supported game mode and difficulty."
    );
    ensure!(
        !hardcore || (gamemode == "survival" && difficulty == "hard"),
        "Hardcore worlds use Survival mode and Hard difficulty."
    );
    ensure!(
        cover.is_none_or(|value| [
            "amethyst",
            "obsidian",
            "rose-quartz",
            "moonstone",
            "endstone",
            "glowstone",
            "crystal-glass",
            "rose-glass",
            "void-core",
            "starfield",
            "pink-ore",
            "moss",
            "bricks",
            "circuit",
            "runes",
            "portal",
            "pumpkin",
            "cake",
            "mushroom",
            "lantern",
        ]
        .contains(&value)),
        "Choose one of the available cover blocks, or leave the cover empty."
    );
    Ok(())
}

impl Service {
    // Caller holds the mutation lock and has required a stopped world. Metadata
    // remains authoritative if any atomic file replacement fails.
    fn store_world_settings(&self, previous: &World, next: &World) -> Result<()> {
        let result = self.write_properties(next).and_then(|()| {
            self.mutate(|data| {
                ensure!(
                    !data
                        .worlds
                        .iter()
                        .any(|w| w.id != next.id && w.name == next.name),
                    "World name already used"
                );
                let world = data
                    .worlds
                    .iter_mut()
                    .find(|w| w.id == next.id)
                    .context("World no longer exists")?;
                ensure!(
                    world.revision == previous.revision,
                    "World changed; reopen settings."
                );
                *world = next.clone();
                Ok(())
            })
        });
        if result.is_err() {
            let _ = self.write_properties(previous);
        }
        result
    }

    pub(crate) async fn save_world_settings(&self, args: &Value) -> Result<World> {
        let id = args["id"].as_str().context("Missing world ID")?;
        self.require_stopped(id).await?;
        let previous = self.world(id)?;
        ensure!(
            Some(previous.revision) == args["revision"].as_u64(),
            "World changed; reopen settings."
        );
        let mut w = previous.clone();
        w.name = name(args["name"].as_str().context("Missing world name")?)?;
        w.memory_mb = args["memoryMb"]
            .as_u64()
            .unwrap_or(w.memory_mb as u64)
            .try_into()?;
        w.port = args["port"].as_u64().unwrap_or(w.port as u64).try_into()?;
        w.max_players = args["maxPlayers"]
            .as_u64()
            .unwrap_or(w.max_players as u64)
            .try_into()?;
        ensure!(
            (1024..=65536).contains(&w.memory_mb)
                && w.port >= 1024
                && (1..=100).contains(&w.max_players),
            "Invalid resource or port settings"
        );
        w.lan = args["lan"].as_bool().unwrap_or(w.lan);
        w.pack_notes = args["packNotes"]
            .as_str()
            .unwrap_or(&w.pack_notes)
            .chars()
            .take(2000)
            .collect();
        w.gamemode = args["gamemode"].as_str().unwrap_or(&w.gamemode).into();
        w.difficulty = args["difficulty"].as_str().unwrap_or(&w.difficulty).into();
        w.hardcore = args["hardcore"].as_bool().unwrap_or(w.hardcore);
        w.pvp = args["pvp"].as_bool().unwrap_or(w.pvp);
        w.allow_commands = args["allowCommands"].as_bool().unwrap_or(w.allow_commands);
        w.force_gamemode = args["forceGamemode"].as_bool().unwrap_or(w.force_gamemode);
        if let Some(cover) = args.get("coverBlock") {
            w.cover_block = if cover.is_null() {
                None
            } else {
                Some(cover.as_str().context("Invalid cover block")?.into())
            };
        }
        validate_gameplay(
            &w.gamemode,
            &w.difficulty,
            w.hardcore,
            w.cover_block.as_deref(),
        )?;
        ensure!(
            w.hardcore == previous.hardcore
                || (w.last_played.is_none()
                    && !self.instance(id)?.join("world/level.dat").exists()
                    && !self.instance(id)?.join("world/level.dat_old").exists()),
            "Hardcore is chosen before the first start. Create a new world to change this rule."
        );
        w.revision += 1;
        self.store_world_settings(&previous, &w)?;
        Ok(w)
    }

    pub(crate) async fn set_operator(
        &self,
        id: &str,
        uuid: &str,
        enabled: bool,
        revision: u64,
    ) -> Result<World> {
        self.require_stopped(id)
            .await
            .context("Stop this world before changing command permissions.")?;
        let previous = self.world(id)?;
        ensure!(
            previous.revision == revision,
            "World changed; reopen player access."
        );
        ensure!(
            !enabled || previous.allow_commands,
            "Enable player commands in world settings first."
        );
        let mut w = previous.clone();
        let player = w
            .players
            .iter_mut()
            .find(|p| p.uuid == uuid)
            .context("Add this player to the allowed list first")?;
        player.operator = enabled;
        if enabled {
            player.operator_level = 2;
            player.bypasses_player_limit = false;
        }
        w.revision += 1;
        self.store_world_settings(&previous, &w)?;
        Ok(w)
    }
}
