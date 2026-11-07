//! Explicit, reviewed factory reset and portable game-library preservation.
//! The native shell removes the application only after this layer succeeds.
use crate::{activity::ActivityTracker, files, model::*, service::Service};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    path::{Component as PathComponent, Path},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaintenancePlan {
    pub token: String,
    pub worlds: usize,
    pub backups: usize,
    pub components: usize,
    pub bytes: u64,
    pub has_library: bool,
    #[serde(skip)]
    fingerprint: String,
    #[serde(skip)]
    expires_at: u64,
}

pub struct MaintenanceGuard {
    active: Arc<AtomicBool>,
    release: bool,
}
impl MaintenanceGuard {
    /// Keep IPC mutations disabled while the native shell exits.
    pub fn hold_until_exit(mut self) {
        self.release = false;
    }
}
impl Drop for MaintenanceGuard {
    fn drop(&mut self) {
        if self.release {
            self.active.store(false, Ordering::SeqCst);
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LibraryFile {
    path: String,
    bytes: u64,
    sha256: String,
}
#[derive(Serialize, Deserialize, Default)]
struct History {
    worlds: Vec<(String, u64)>,
    players: Vec<(String, String, String, bool)>,
    spans: Vec<(String, String, Option<String>, u64, u64)>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedLibrary {
    format: u32,
    created_at: u64,
    data: Data,
    history: History,
    files: Vec<LibraryFile>,
}

impl Service {
    pub fn is_maintenance_active(&self) -> bool {
        self.maintenance_active.load(Ordering::SeqCst)
    }
    fn maintenance_guard(&self) -> Result<MaintenanceGuard> {
        ensure!(
            self.maintenance_active
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok(),
            "Another maintenance action is running."
        );
        Ok(MaintenanceGuard {
            active: self.maintenance_active.clone(),
            release: true,
        })
    }
    async fn maintenance_idle(&self) -> Result<()> {
        ensure!(
            self.process.lock().await.is_none()
                && self.orphan.lock().unwrap().is_none()
                && !self
                    .session
                    .lock()
                    .unwrap()
                    .as_ref()
                    .is_some_and(|s| s.pid.is_some()),
            "Save and stop every world before clearing data or uninstalling."
        );
        ensure!(
            !self
                .operations
                .lock()
                .unwrap()
                .iter()
                .any(|op| op.finished_at.is_none()),
            "Wait for queued and running operations to finish first."
        );
        Ok(())
    }
    fn maintenance_fingerprint(&self) -> Result<String> {
        let mut names = fs::read_dir(self.root.as_ref())?
            .map(|entry| entry.map(|e| e.file_name()))
            .collect::<std::io::Result<Vec<_>>>()?;
        names.sort();
        let mut hash = Sha256::new();
        hash.update(serde_json::to_vec(&self.data()?)?);
        for name in names {
            hash.update(name.to_string_lossy().as_bytes());
            hash.update([0]);
        }
        Ok(hex::encode(hash.finalize()))
    }
    pub async fn prepare_maintenance(&self) -> Result<MaintenancePlan> {
        let _active = self.maintenance_guard()?;
        let _lock = self
            .mutation
            .try_lock()
            .context("Wait for the current operation to finish.")?;
        self.maintenance_idle().await?;
        let data = self.data()?;
        let plan = MaintenancePlan {
            token: id(),
            worlds: data.worlds.len(),
            backups: data.backups.len(),
            components: data.components.len(),
            bytes: files::size(&self.root),
            has_library: !data.worlds.is_empty() || !data.backups.is_empty(),
            fingerprint: self.maintenance_fingerprint()?,
            expires_at: now() + 600,
        };
        *self.maintenance_plan.lock().unwrap() = Some(plan.clone());
        Ok(plan)
    }
    fn check_maintenance_plan(&self, token: &str) -> Result<()> {
        let plan = self
            .maintenance_plan
            .lock()
            .unwrap()
            .clone()
            .context("Review the cleanup summary first.")?;
        ensure!(
            plan.token == token && plan.expires_at >= now(),
            "This review expired. Review it again."
        );
        ensure!(
            plan.fingerprint == self.maintenance_fingerprint()?,
            "Your library or settings changed. Review the summary again."
        );
        Ok(())
    }
    pub async fn reset_all_data(&self, token: &str, phrase: &str) -> Result<()> {
        ensure!(
            phrase == "CLEAR ENDERLINK DATA",
            "Type CLEAR ENDERLINK DATA exactly."
        );
        let _active = self.maintenance_guard()?;
        let _lock = self
            .mutation
            .try_lock()
            .context("Wait for the current operation to finish.")?;
        self.maintenance_idle().await?;
        self.check_maintenance_plan(token)?;
        self.clear_all_data_locked()
    }
    pub async fn prepare_uninstall(
        &self,
        token: &str,
        phrase: &str,
        save_to: Option<&Path>,
    ) -> Result<MaintenanceGuard> {
        ensure!(
            phrase == "UNINSTALL ENDERLINK",
            "Type UNINSTALL ENDERLINK exactly."
        );
        let active = self.maintenance_guard()?;
        let _lock = self
            .mutation
            .try_lock()
            .context("Wait for the current operation to finish.")?;
        self.maintenance_idle().await?;
        self.check_maintenance_plan(token)?;
        if let Some(path) = save_to {
            self.save_library_locked(path)?;
        }
        self.clear_all_data_locked().with_context(|| match save_to {
            Some(path) => format!("Your saved library is in {}. Cleanup did not finish; Enderlink is still installed", path.display()),
            None => "Cleanup did not finish; Enderlink is still installed".into(),
        })?;
        Ok(active)
    }
    fn clear_all_data_locked(&self) -> Result<()> {
        // Validate every target before deleting anything; never follow a storage symlink.
        let mut paths = Vec::new();
        for entry in fs::read_dir(self.root.as_ref())? {
            let path = entry?.path();
            if matches!(
                path.file_name().and_then(|s| s.to_str()),
                Some("instance.lock" | "state.sqlite" | "state.sqlite-wal" | "state.sqlite-shm")
            ) {
                continue;
            }
            files::owned(&self.root, &path)?;
            paths.push(path);
        }
        self.forget_provider_authorization()?;
        // Remove files before forgetting their records. A failed deletion remains visible/retryable.
        for path in paths {
            if path.is_dir() {
                fs::remove_dir_all(&path)?;
            } else {
                fs::remove_file(&path)?;
            }
        }
        {
            let mut db = self.db.lock().unwrap();
            db.execute_batch("PRAGMA secure_delete=ON;")?;
            let tx = db.transaction()?;
            tx.execute_batch("DELETE FROM activity_spans; DELETE FROM activity_players; DELETE FROM activity_worlds; DELETE FROM journal;")?;
            tx.execute(
                "UPDATE metadata SET schema_version=3,data=?1 WHERE id=1",
                [serde_json::to_string(&Data::default())?],
            )?;
            tx.commit()?;
            db.execute_batch("VACUUM; PRAGMA wal_checkpoint(TRUNCATE);")?;
        }
        for name in [
            "worlds",
            "backups",
            "components",
            "java",
            "staging",
            "quarantine",
        ] {
            fs::create_dir_all(self.root.join(name))?;
        }
        *self.activity.lock().unwrap() = ActivityTracker::default();
        *self.session.lock().unwrap() = None;
        self.logs.lock().unwrap().clear();
        self.operations.lock().unwrap().clear();
        self.plans.lock().unwrap().clear();
        self.canceled.lock().unwrap().clear();
        self.software_updates.lock().unwrap().clear();
        self.warnings.lock().unwrap().clear();
        self.maintenance_plan.lock().unwrap().take();
        Ok(())
    }
    fn saved_history(&self) -> Result<History> {
        let db = self.db.lock().unwrap();
        let worlds = db
            .prepare("SELECT world_id,recorded_from FROM activity_worlds")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        let players = db
            .prepare("SELECT world_id,id,name,verified FROM activity_players")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<rusqlite::Result<_>>()?;
        let spans = db
            .prepare("SELECT id,world_id,player_id,start,end FROM activity_spans")?
            .query_map([], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })?
            .collect::<rusqlite::Result<_>>()?;
        Ok(History {
            worlds,
            players,
            spans,
        })
    }
    fn save_library_locked(&self, destination: &Path) -> Result<()> {
        ensure!(
            destination.is_absolute()
                && !destination.exists()
                && destination.symlink_metadata().is_err(),
            "Choose a new folder for the saved library."
        );
        let parent = destination
            .parent()
            .context("Choose a folder")?
            .canonicalize()?;
        let root = self.root.canonicalize()?;
        ensure!(
            !parent.starts_with(&root),
            "Save your library outside Enderlink's data folder."
        );
        let name = destination
            .file_name()
            .context("Choose a new folder name")?;
        let destination = parent.join(name);
        let staging = parent.join(format!(".enderlink-save-{}", id()));
        fs::create_dir(&staging)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&staging, fs::Permissions::from_mode(0o700))?;
        }
        let result = (|| -> Result<()> {
            let mut data = self.data()?;
            data.components.clear();
            data.settings = Settings::default();
            data.provider_setup = ProviderSetup::default();
            for w in &data.worlds {
                uuid::Uuid::parse_str(&w.id)?;
                let source = self.root.join("worlds").join(&w.id);
                files::owned(&self.root, &source)?;
                files::copy_tree(&source, &staging.join("worlds").join(&w.id))?;
            }
            for b in &data.backups {
                uuid::Uuid::parse_str(&b.id)?;
                let source = self.root.join("backups").join(&b.id);
                files::owned(&self.root, &source)?;
                files::copy_tree(&source, &staging.join("backups").join(&b.id))?;
            }
            let mut manifest = Vec::new();
            for path in files::safe_entries(&staging)? {
                if path.is_file() {
                    manifest.push(LibraryFile {
                        path: path
                            .strip_prefix(&staging)?
                            .components()
                            .map(|part| {
                                part.as_os_str()
                                    .to_str()
                                    .context("A game file name is not valid Unicode")
                            })
                            .collect::<Result<Vec<_>>>()?
                            .join("/"),
                        bytes: path.metadata()?.len(),
                        sha256: files::hash(&path)?,
                    });
                }
            }
            let library = SavedLibrary {
                format: 1,
                created_at: now(),
                data,
                history: self.saved_history()?,
                files: manifest,
            };
            validate_library(&library)?;
            let bytes = serde_json::to_vec_pretty(&library)?;
            ensure!(
                bytes.len() <= 64 * 1024 * 1024,
                "This library's index exceeds the supported 64 MB limit."
            );
            fs::write(staging.join("enderlink-library.json"), bytes)?;
            fs::write(
                staging.join("README.txt"),
                "Enderlink saved worlds\n\nContains your worlds, mods/plugins, allowed-player settings, backups and play history.\nNo Playit credentials, managed Java or installed engine cache are included.\n\nTo restore: install Enderlink, open Settings > Backups & storage > Restore saved library, and choose this folder. Restore into an empty world library, then reinstall the worlds' pinned server software.\n",
            )?;
            // Reach storage before uninstall deletes the original files.
            for path in files::safe_entries(&staging)?.into_iter().rev() {
                if path.is_file() {
                    fs::File::open(&path)?.sync_all()?;
                }
                #[cfg(unix)]
                if path.is_dir() {
                    fs::File::open(&path)?.sync_all()?;
                }
            }
            ensure!(
                !destination.exists(),
                "The chosen destination already exists."
            );
            commit_saved_directory(&staging, &destination)?;
            #[cfg(unix)]
            fs::File::open(&parent)?.sync_all()?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&staging);
        }
        result
    }
    pub async fn restore_saved_library(&self, source: &Path) -> Result<()> {
        let _active = self.maintenance_guard()?;
        let _lock = self
            .mutation
            .try_lock()
            .context("Wait for the current operation to finish.")?;
        self.maintenance_idle().await?;
        ensure!(
            self.data()?.worlds.is_empty() && self.data()?.backups.is_empty(),
            "Restore into an empty world library. Existing worlds and backups are never replaced."
        );
        let source = source.canonicalize()?;
        ensure!(
            !source.starts_with(self.root.canonicalize()?),
            "Choose a saved library outside Enderlink's data folder."
        );
        let index = source.join("enderlink-library.json");
        files::owned(&source, &index)?;
        ensure!(
            index.metadata()?.len() <= 64 * 1024 * 1024,
            "The saved library index is too large."
        );
        let library: SavedLibrary = serde_json::from_slice(&fs::read(index)?)?;
        validate_library(&library)?;
        let staging = self.root.join("staging").join(id());
        files::owned(&self.root, &staging)?;
        fs::create_dir(&staging)?;
        let mut moved = Vec::new();
        let result = (|| -> Result<()> {
            for entry in &library.files {
                let from = source.join(&entry.path);
                files::owned(&source, &from)?;
                ensure!(
                    from.is_file() && from.metadata()?.len() == entry.bytes,
                    "A saved game file is missing or has changed."
                );
                let to = staging.join(&entry.path);
                files::owned(&staging, &to)?;
                fs::create_dir_all(to.parent().unwrap())?;
                let mut output = fs::OpenOptions::new().write(true).create_new(true).open(&to)
                    .context("Saved filenames conflict on this operating system; nothing was overwritten")?;
                std::io::copy(&mut fs::File::open(from)?, &mut output)?;
                output.sync_all()?;
                ensure!(
                    files::hash(&to)? == entry.sha256,
                    "Saved game file checksum mismatch; nothing has been restored."
                );
            }
            for world in &library.data.worlds {
                ensure!(
                    staging
                        .join("worlds")
                        .join(&world.id)
                        .join("instance")
                        .is_dir(),
                    "Saved world files are missing."
                );
            }
            // Backup manifests are regenerated from validated data, never trusted on recovery.
            for backup in &library.data.backups {
                let dir = staging.join("backups").join(&backup.id);
                ensure!(
                    files::hash(&dir.join("instance.zip"))? == backup.sha256,
                    "Backup checksum mismatch."
                );
                fs::write(
                    dir.join("manifest.json"),
                    serde_json::to_vec_pretty(backup)?,
                )?;
            }
            for (kind, ids) in [
                (
                    "worlds",
                    library
                        .data
                        .worlds
                        .iter()
                        .map(|w| &w.id)
                        .collect::<Vec<_>>(),
                ),
                (
                    "backups",
                    library.data.backups.iter().map(|b| &b.id).collect(),
                ),
            ] {
                for id in ids {
                    let target = self.root.join(kind).join(id);
                    files::owned(&self.root, &target)?;
                    ensure!(
                        !target.exists(),
                        "Untracked files already use a saved world's ID. Nothing was overwritten."
                    );
                    fs::rename(staging.join(kind).join(id), &target)?;
                    moved.push(target);
                }
            }
            let mut data = self.data()?;
            data.worlds = library.data.worlds.clone();
            data.backups = library.data.backups.clone();
            let mut db = self.db.lock().unwrap();
            let tx = db.transaction()?;
            tx.execute_batch("DELETE FROM activity_spans; DELETE FROM activity_players; DELETE FROM activity_worlds;")?;
            for (world, start) in &library.history.worlds {
                tx.execute(
                    "INSERT INTO activity_worlds VALUES(?1,?2)",
                    rusqlite::params![world, start],
                )?;
            }
            for (world, id, name, verified) in &library.history.players {
                tx.execute(
                    "INSERT INTO activity_players VALUES(?1,?2,?3,?4)",
                    rusqlite::params![world, id, name, verified],
                )?;
            }
            for (id, world, player, start, end) in &library.history.spans {
                tx.execute(
                    "INSERT INTO activity_spans VALUES(?1,?2,?3,?4,?5)",
                    rusqlite::params![id, world, player, start, end],
                )?;
            }
            tx.execute(
                "UPDATE metadata SET data=?1 WHERE id=1",
                [serde_json::to_string(&data)?],
            )?;
            tx.commit()?;
            Ok(())
        })();
        if result.is_err() {
            for path in moved {
                let _ = fs::remove_dir_all(path);
            }
        }
        let _ = fs::remove_dir_all(staging);
        result
    }
}

fn commit_saved_directory(staging: &Path, destination: &Path) -> Result<()> {
    match fs::rename(staging, destination) {
        Ok(()) => Ok(()),
        Err(rename_error) => {
            ensure!(
                !destination.exists(),
                "The chosen destination appeared while the library was being saved."
            );
            let copy_result = (|| -> Result<()> {
                // Windows can reject a directory rename when a security scanner or
                // another filesystem observer briefly holds a staged file. The
                // destination is still new, so copy the already validated tree,
                // flush its files, then remove the staging directory.
                files::copy_tree(staging, destination)
                    .context("Could not copy the saved library to the chosen folder")?;
                for path in files::safe_entries(destination)? {
                    if path.is_file() {
                        fs::File::open(&path)?.sync_all()?;
                    }
                }
                fs::remove_dir_all(staging)
                    .context("Could not remove the temporary saved-library staging folder")?;
                Ok(())
            })();
            if copy_result.is_ok() {
                Ok(())
            } else {
                let _ = fs::remove_dir_all(destination);
                let copy_error = copy_result.expect_err("copy result was checked above");
                Err(copy_error.context(format!(
                    "Could not commit the saved library directory after rename failed: {rename_error}"
                )))
            }
        }
    }
}

fn valid_world(world: &World) -> Result<()> {
    uuid::Uuid::parse_str(&world.id)?;
    uuid::Uuid::parse_str(&world.component.id)?;
    let component = &world.component;
    ensure!(
        component.sha256.len() == 64
            && component.sha256.chars().all(|c| c.is_ascii_hexdigit())
            && (17..=99).contains(&component.java_major)
            && [&component.minecraft, &component.version]
                .iter()
                .all(|value| !value.is_empty()
                    && value.len() <= 64
                    && value
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))),
        "Invalid pinned server software in the saved library."
    );
    if let Some(source) = &component.source_url {
        let url = reqwest::Url::parse(source)?;
        ensure!(
            url.scheme() == "https"
                && url.username().is_empty()
                && url.password().is_none()
                && url.port_or_known_default() == Some(443)
                && url.host_str().is_some_and(|host| [
                    "fill-data.papermc.io",
                    "fill.papermc.io",
                    "api.papermc.io",
                    "meta.fabricmc.net",
                    "maven.fabricmc.net"
                ]
                .contains(&host)),
            "The saved engine must come from an official Paper or Fabric download source."
        );
    }
    name(&world.name)?;
    ensure!(
        (1024..=65536).contains(&world.memory_mb)
            && (1..=100).contains(&world.max_players)
            && world.port >= 1024
            && world.eula_accepted_at > 0,
        "Invalid saved world settings."
    );
    crate::gameplay::validate_gameplay(
        &world.gamemode,
        &world.difficulty,
        world.hardcore,
        world.cover_block.as_deref(),
    )?;
    ensure!(
        world.seed.len() <= 512
            && !world.seed.contains(['\n', '\r'])
            && world.pack_notes.len() <= 8000,
        "Invalid saved world text."
    );
    for player in &world.players {
        crate::accounts::validate_username(&player.name)?;
        uuid::Uuid::parse_str(&player.uuid)?;
        ensure!(
            (1..=4).contains(&player.operator_level),
            "Invalid command permissions."
        );
    }
    Ok(())
}
fn validate_library(library: &SavedLibrary) -> Result<()> {
    ensure!(library.format == 1, "Unsupported saved library format.");
    ensure!(
        library.data.components.is_empty(),
        "A saved library cannot install software."
    );
    let mut worlds = HashSet::new();
    let mut names = HashSet::new();
    for world in &library.data.worlds {
        valid_world(world)?;
        ensure!(
            worlds.insert(world.id.as_str()) && names.insert(world.name.as_str()),
            "Duplicate saved world."
        );
    }
    let mut backups = HashSet::new();
    for backup in &library.data.backups {
        uuid::Uuid::parse_str(&backup.id)?;
        valid_world(&backup.world)?;
        ensure!(
            backups.insert(backup.id.as_str()),
            "Duplicate saved backup."
        );
    }
    let mut paths = HashSet::new();
    for entry in &library.files {
        let path = Path::new(&entry.path);
        let parts = path.components().collect::<Vec<_>>();
        ensure!(
            parts.len() >= 3
                && !entry.path.contains('\\')
                && !entry.path.contains(':')
                && parts.iter().all(|p| matches!(p, PathComponent::Normal(_)))
                && paths.insert(&entry.path),
            "Invalid or duplicate saved file path."
        );
        let kind = parts[0].as_os_str().to_str().unwrap_or("");
        let id = parts[1].as_os_str().to_str().unwrap_or("");
        ensure!(
            (kind == "worlds" && worlds.contains(id))
                || (kind == "backups" && backups.contains(id)),
            "File is outside the saved game library."
        );
        ensure!(
            entry.sha256.len() == 64 && entry.sha256.chars().all(|c| c.is_ascii_hexdigit()),
            "Invalid saved checksum."
        );
    }
    let mut recorded = HashSet::new();
    for (world, start) in &library.history.worlds {
        ensure!(
            worlds.contains(world.as_str())
                && recorded.insert(world.as_str())
                && *start <= i64::MAX as u64,
            "Invalid recorded world history."
        );
    }
    let mut players = HashSet::new();
    for (world, id, name, _) in &library.history.players {
        ensure!(
            worlds.contains(world.as_str())
                && id.len() <= 128
                && players.insert((world.as_str(), id.as_str())),
            "Invalid recorded player."
        );
        crate::accounts::validate_username(name)?;
    }
    let mut spans = HashSet::new();
    for (id, world, player, start, end) in &library.history.spans {
        ensure!(
            worlds.contains(world.as_str())
                && id.len() <= 128
                && spans.insert(id)
                && start <= end
                && *end <= i64::MAX as u64
                && player
                    .as_ref()
                    .is_none_or(|p| players.contains(&(world.as_str(), p.as_str()))),
            "Invalid recorded playtime."
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> (tempfile::TempDir, Service, World) {
        let temp = tempfile::tempdir().unwrap();
        let service = Service::new(temp.path().join("data")).unwrap();
        let component = Component {
            id: id(),
            engine: Engine::Paper,
            minecraft: "1.21.1".into(),
            version: "132".into(),
            java_major: 21,
            sha256: "0".repeat(64),
            bytes: 0,
            installed_at: now(),
            source_url: None,
        };
        service
            .mutate(|d| {
                d.components.push(component.clone());
                Ok(())
            })
            .unwrap();
        let world = service.create_world(serde_json::from_value(json!({"name":"Saved world","componentId":component.id,"memoryMb":2048,"maxPlayers":8,"port":25565,"acceptEula":true,"gamemode":"survival","difficulty":"normal","onlineMode":false})).unwrap()).unwrap();
        let instance = service.instance(&world.id).unwrap();
        fs::create_dir_all(instance.join("world/region")).unwrap();
        fs::write(
            instance.join("world/region/chunk.mca"),
            b"real fixture game data",
        )
        .unwrap();
        let player = crate::accounts::offline_player("Birch").unwrap();
        let player_id = format!("offline:{}", player.uuid);
        service
            .mutate(|d| {
                d.worlds[0].players.push(player);
                d.settings.memory_mb = 8192;
                Ok(())
            })
            .unwrap();
        let world = service.world(&world.id).unwrap();
        let db = service.db.lock().unwrap();
        db.execute("INSERT INTO activity_worlds VALUES(?1,10)", [&world.id])
            .unwrap();
        db.execute(
            "INSERT INTO activity_players VALUES(?1,?2,'Birch',0)",
            rusqlite::params![world.id, player_id],
        )
        .unwrap();
        db.execute(
            "INSERT INTO activity_spans VALUES(?1,?2,?3,10,40)",
            rusqlite::params![id(), world.id, player_id],
        )
        .unwrap();
        drop(db);
        (temp, service, world)
    }
    #[tokio::test]
    async fn full_reset_forgets_all_managed_files_history_and_metadata_without_touching_neighbors()
    {
        let (temp, service, world) = fixture();
        service.backup(&world.id, "test").await.unwrap();
        fs::write(
            service.root.join("state-before-v3-old.sqlite"),
            b"old private metadata",
        )
        .unwrap();
        fs::write(service.root.join("quarantine/orphan"), b"leftover").unwrap();
        fs::write(temp.path().join("outside"), b"keep me").unwrap();
        *service.secret.lock().unwrap() = Some("test-only-secret".into());
        service.log("test-only private log");
        let plan = service.prepare_maintenance().await.unwrap();
        assert!(service.reset_all_data(&plan.token, "clear").await.is_err());
        assert_eq!(service.data().unwrap().worlds.len(), 1);
        service
            .reset_all_data(&plan.token, "CLEAR ENDERLINK DATA")
            .await
            .unwrap();
        let data = service.data().unwrap();
        assert!(data.worlds.is_empty() && data.backups.is_empty() && data.components.is_empty());
        assert_eq!(data.settings.memory_mb, Settings::default().memory_mb);
        assert!(service.secret.lock().unwrap().is_none());
        assert!(service.logs.lock().unwrap().is_empty());
        assert!(!service.root.join("state-before-v3-old.sqlite").exists());
        assert!(!service.root.join("quarantine/orphan").exists());
        assert_eq!(fs::read(temp.path().join("outside")).unwrap(), b"keep me");
        assert_eq!(
            service
                .db
                .lock()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM activity_spans", [], |r| r
                    .get::<_, u64>(0))
                .unwrap(),
            0
        );
        drop(service);
        let reopened = Service::new(temp.path().join("data")).unwrap();
        assert!(
            reopened.data().unwrap().worlds.is_empty()
                && reopened.data().unwrap().backups.is_empty()
        );
    }
    #[tokio::test]
    async fn reset_rejects_changed_inventory_and_busy_or_recovered_servers() {
        let (_temp, service, world) = fixture();
        let plan = service.prepare_maintenance().await.unwrap();
        service.backup(&world.id, "test").await.unwrap();
        assert!(
            service
                .reset_all_data(&plan.token, "CLEAR ENDERLINK DATA")
                .await
                .unwrap_err()
                .to_string()
                .contains("changed")
        );
        *service.orphan.lock().unwrap() = Some((123, 456));
        assert!(service.prepare_maintenance().await.is_err());
        *service.orphan.lock().unwrap() = None;
        service.operations.lock().unwrap().push(Operation {
            id: id(),
            label: "Test".into(),
            status: "queued".into(),
            message: "Queued".into(),
            progress: None,
            started_at: now(),
            finished_at: None,
        });
        assert!(service.prepare_maintenance().await.is_err());
        service.operations.lock().unwrap().clear();
        let lock = service.mutation.lock().await;
        assert!(service.prepare_maintenance().await.is_err());
        drop(lock);
        assert_eq!(service.data().unwrap().worlds.len(), 1);
    }
    #[tokio::test]
    async fn uninstall_can_preserve_and_restore_a_portable_library_with_history() {
        let (temp, service, world) = fixture();
        let backup = service.backup(&world.id, "test").await.unwrap();
        let saved = temp.path().join("saved games");
        let plan = service.prepare_maintenance().await.unwrap();
        let guard = service
            .prepare_uninstall(&plan.token, "UNINSTALL ENDERLINK", Some(&saved))
            .await
            .unwrap();
        assert!(
            service
                .dispatch("patchSettings", json!({"memoryMb":4096}))
                .await
                .is_err()
        );
        assert!(service.data().unwrap().worlds.is_empty());
        drop(guard);
        let index = fs::read_to_string(saved.join("enderlink-library.json")).unwrap();
        let library: SavedLibrary = serde_json::from_str(&index).unwrap();
        assert_eq!(library.history.spans.len(), 1);
        assert!(library.data.components.is_empty());
        assert!(!library.data.provider_setup.tunnel_configured);
        service.restore_saved_library(&saved).await.unwrap();
        let data = service.data().unwrap();
        assert_eq!(
            serde_json::to_value(&data.worlds[0]).unwrap(),
            serde_json::to_value(world).unwrap()
        );
        assert_eq!(data.backups[0].id, backup.id);
        assert!(data.components.is_empty());
        assert_eq!(
            service
                .db
                .lock()
                .unwrap()
                .query_row("SELECT SUM(end-start) FROM activity_spans", [], |r| r
                    .get::<_, u64>(0))
                .unwrap(),
            30
        );
        assert_eq!(
            fs::read(
                service
                    .instance(&data.worlds[0].id)
                    .unwrap()
                    .join("world/region/chunk.mca")
            )
            .unwrap(),
            b"real fixture game data"
        );
        assert!(service.restore_saved_library(&saved).await.is_err());
        assert!(saved.join("enderlink-library.json").is_file());
    }
    #[tokio::test]
    async fn preservation_must_succeed_outside_managed_storage_before_any_deletion() {
        let (temp, service, world) = fixture();
        let plan = service.prepare_maintenance().await.unwrap();
        assert!(
            service
                .prepare_uninstall(
                    &plan.token,
                    "UNINSTALL ENDERLINK",
                    Some(&service.root.join("saved"))
                )
                .await
                .is_err()
        );
        assert!(
            service
                .prepare_uninstall(&plan.token, "UNINSTALL ENDERLINK", Some(temp.path()))
                .await
                .is_err()
        );
        assert!(
            service
                .prepare_uninstall(
                    &plan.token,
                    "UNINSTALL ENDERLINK",
                    Some(&temp.path().join("missing/child"))
                )
                .await
                .is_err()
        );
        assert!(
            service
                .instance(&world.id)
                .unwrap()
                .join("world/region/chunk.mca")
                .exists()
        );
    }
    #[tokio::test]
    async fn restored_files_are_verified_before_the_library_is_committed() {
        let (temp, service, world) = fixture();
        let saved = temp.path().join("saved");
        service.save_library_locked(&saved).unwrap();
        let fresh = Service::new(temp.path().join("fresh")).unwrap();
        fs::write(
            saved
                .join("worlds")
                .join(world.id)
                .join("instance/world/region/chunk.mca"),
            b"changed game data",
        )
        .unwrap();
        assert!(fresh.restore_saved_library(&saved).await.is_err());
        assert!(fresh.data().unwrap().worlds.is_empty());
        assert_eq!(fs::read_dir(fresh.root.join("worlds")).unwrap().count(), 0);
        assert_eq!(fs::read_dir(fresh.root.join("staging")).unwrap().count(), 0);
    }
    #[tokio::test]
    async fn saved_file_paths_cannot_escape_the_library() {
        let (temp, service, _world) = fixture();
        let saved = temp.path().join("saved");
        service.save_library_locked(&saved).unwrap();
        let path = saved.join("enderlink-library.json");
        let mut library: SavedLibrary = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        library.files[0].path = "../../outside".into();
        fs::write(path, serde_json::to_vec(&library).unwrap()).unwrap();
        fs::write(temp.path().join("outside"), b"keep").unwrap();
        let fresh = Service::new(temp.path().join("fresh")).unwrap();
        assert!(fresh.restore_saved_library(&saved).await.is_err());
        assert_eq!(fs::read(temp.path().join("outside")).unwrap(), b"keep");
        assert!(fresh.data().unwrap().worlds.is_empty());
    }
    #[tokio::test]
    async fn a_failed_restore_transaction_leaves_no_recoverable_partial_library() {
        let (temp, service, world) = fixture();
        service.backup(&world.id, "test").await.unwrap();
        let saved = temp.path().join("saved");
        service.save_library_locked(&saved).unwrap();
        let fresh = Service::new(temp.path().join("fresh")).unwrap();
        fresh
            .db
            .lock()
            .unwrap()
            .execute_batch("PRAGMA query_only=ON")
            .unwrap();
        assert!(fresh.restore_saved_library(&saved).await.is_err());
        assert!(fresh.data().unwrap().worlds.is_empty());
        assert_eq!(fs::read_dir(fresh.root.join("worlds")).unwrap().count(), 0);
        assert_eq!(fs::read_dir(fresh.root.join("backups")).unwrap().count(), 0);
        fresh
            .db
            .lock()
            .unwrap()
            .execute_batch("PRAGMA query_only=OFF")
            .unwrap();
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn an_unportable_filename_cannot_produce_a_broken_save_before_uninstall() {
        let (temp, service, world) = fixture();
        fs::write(
            service
                .instance(&world.id)
                .unwrap()
                .join(r"unportable\name"),
            b"game file",
        )
        .unwrap();
        let plan = service.prepare_maintenance().await.unwrap();
        let save = temp.path().join("saved");
        assert!(
            service
                .prepare_uninstall(&plan.token, "UNINSTALL ENDERLINK", Some(&save))
                .await
                .is_err()
        );
        assert!(!save.exists());
        assert_eq!(service.data().unwrap().worlds.len(), 1);
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn reset_and_export_refuse_symlinked_managed_paths() {
        let (temp, service, world) = fixture();
        let outside = temp.path().join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("keep"), b"keep").unwrap();
        std::os::unix::fs::symlink(&outside, service.root.join("linked")).unwrap();
        let plan = service.prepare_maintenance().await.unwrap();
        assert!(
            service
                .reset_all_data(&plan.token, "CLEAR ENDERLINK DATA")
                .await
                .is_err()
        );
        fs::remove_file(service.root.join("linked")).unwrap();
        std::os::unix::fs::symlink(
            &outside,
            service.instance(&world.id).unwrap().join("linked"),
        )
        .unwrap();
        assert!(
            service
                .save_library_locked(&temp.path().join("saved"))
                .is_err()
        );
        assert!(outside.join("keep").exists());
        assert!(!temp.path().join("saved").exists());
    }
}
