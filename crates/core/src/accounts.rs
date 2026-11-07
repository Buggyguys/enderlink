use crate::{model::Player, service::Service};
use anyhow::{Context, Result, ensure};
use md5::{Digest, Md5};
use std::time::Duration;

pub(crate) fn validate_username(username: &str) -> Result<()> {
    ensure!(
        (3..=16).contains(&username.len())
            && username
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_'),
        "Enter a Minecraft username of 3–16 letters, numbers, or underscores."
    );
    Ok(())
}

pub(crate) fn offline_player(username: &str) -> Result<Player> {
    validate_username(username)?;
    // Minecraft's UUID.nameUUIDFromBytes("OfflinePlayer:" + exact username):
    // MD5 without a namespace, with RFC 4122 variant and version 3 bits.
    // This is protocol compatibility, not a password hash or authentication.
    let digest = Md5::digest(format!("OfflinePlayer:{username}").as_bytes());
    Ok(Player {
        uuid: uuid::Builder::from_md5_bytes(digest.into())
            .into_uuid()
            .to_string(),
        name: username.into(),
        operator: false,
        operator_level: 2,
        bypasses_player_limit: false,
    })
}

impl Service {
    pub(crate) async fn verified_player(&self, username: &str) -> Result<Player> {
        validate_username(username)?;
        let url = format!("https://api.mojang.com/users/profiles/minecraft/{username}");
        let response = tokio::time::timeout(Duration::from_secs(15), self.json(&url))
            .await
            .context("Minecraft account lookup timed out. Try again.")?
            .context(
                "Could not resolve this Minecraft account. Check the name and internet connection.",
            )?;
        let id = response["id"]
            .as_str()
            .context("Minecraft account was not found")?;
        let name = response["name"]
            .as_str()
            .context("Invalid account response")?;
        validate_username(name)?;
        Ok(Player {
            uuid: uuid::Uuid::parse_str(id)?.to_string(),
            name: name.into(),
            operator: false,
            operator_level: 2,
            bypasses_player_limit: false,
        })
    }

    pub async fn change_account_mode(
        &self,
        id: &str,
        online: bool,
        revision: u64,
        op: &str,
    ) -> Result<()> {
        self.require_stopped(id).await?;
        let mut world = self.world(id)?;
        ensure!(
            world.revision == revision,
            "World changed; review player account settings again."
        );
        if world.online_mode == online {
            return Ok(());
        }
        let mut players = Vec::with_capacity(world.players.len());
        for player in &world.players {
            self.check_cancel(op)?;
            let mut resolved = if online {
                self.verified_player(&player.name).await.with_context(|| format!(
                    "Could not verify {}. Every allowed name must belong to a Minecraft account before enabling verification; remove unverifiable names and retry.", player.name
                ))?
            } else {
                offline_player(&player.name)?
            };
            resolved.operator = player.operator;
            resolved.operator_level = player.operator_level;
            resolved.bypasses_player_limit = player.bypasses_player_limit;
            players.push(resolved);
        }
        self.check_cancel(op)?;
        // The snapshot retains the old mode, access list, inventories and all
        // other instance files. A failed backup must leave the mode unchanged.
        self.backup(id, op).await?;
        self.check_cancel(op)?;
        self.progress(
            op,
            "Updating player identities and account verification",
            None,
        );
        world.online_mode = online;
        world.players = players;
        world.revision += 1;
        self.write_properties(&world)?;
        self.mutate(|data| {
            let current = data
                .worlds
                .iter_mut()
                .find(|w| w.id == id)
                .context("World no longer exists")?;
            ensure!(
                current.revision == revision,
                "World changed; review player account settings again."
            );
            *current = world;
            Ok(())
        })?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn offline_identity_matches_minecraft_and_preserves_case() {
        assert_eq!(
            offline_player("Notch").unwrap().uuid,
            "b50ad385-829d-3141-a216-7e7d7539ba7f"
        );
        assert_eq!(
            offline_player("Steve").unwrap().uuid,
            "5627dd98-e6be-3c21-b8a8-e92344183641"
        );
        assert_ne!(
            offline_player("Steve").unwrap().uuid,
            offline_player("steve").unwrap().uuid
        );
        for name in [
            "",
            "ab",
            "longer_than_16_characters",
            "User Name",
            "User\nstop",
            "üser",
        ] {
            assert!(offline_player(name).is_err());
        }
    }
}
