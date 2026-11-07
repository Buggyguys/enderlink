use crate::{files, model::*, status};
use anyhow::{Context, Result, ensure};
use rusqlite::Connection;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs::{self, File},
    future::Future,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use sysinfo::{Pid, ProcessesToUpdate, System};
use tokio::sync::Mutex as AsyncMutex;
use tokio_util::sync::CancellationToken;
#[derive(Clone)]
pub struct Service {
    pub(crate) maintenance_active: Arc<std::sync::atomic::AtomicBool>,
    pub(crate) maintenance_plan: Arc<Mutex<Option<crate::maintenance::MaintenancePlan>>>,
    pub memory: Arc<Mutex<crate::memory::MemorySampler>>,
    pub software_updates: Arc<Mutex<Vec<SoftwareUpdate>>>,
    pub update_check: Arc<AsyncMutex<()>>,
    pub provider_auth: Arc<Mutex<()>>,
    pub provider_check: Arc<AsyncMutex<()>>,
    pub provider_registration: Arc<Mutex<Option<CancellationToken>>>,
    pub provider_epoch: Arc<std::sync::atomic::AtomicU64>,
    pub awake: Arc<Mutex<Option<keepawake::KeepAwake>>>,
    pub root: Arc<PathBuf>,
    pub client: reqwest::Client,
    pub(crate) db: Arc<Mutex<Connection>>,
    pub activity: Arc<Mutex<crate::activity::ActivityTracker>>,
    pub mutation: Arc<AsyncMutex<()>>,
    pub process: Arc<AsyncMutex<Option<tokio::process::Child>>>,
    pub stdin: Arc<AsyncMutex<Option<tokio::process::ChildStdin>>>,
    pub session: Arc<Mutex<Option<SessionView>>>,
    pub logs: Arc<Mutex<VecDeque<String>>>,
    pub provider: Arc<Mutex<ProviderView>>,
    pub secret: Arc<Mutex<Option<String>>>,
    pub provider_cancel: Arc<Mutex<Option<CancellationToken>>>,
    pub claim_cancel: Arc<Mutex<Option<CancellationToken>>>,
    pub orphan: Arc<Mutex<Option<(u32, u64)>>>,
    pub(crate) operations: Arc<Mutex<Vec<Operation>>>,
    pub(crate) canceled: Arc<Mutex<HashSet<String>>>,
    pub(crate) plans: Arc<Mutex<HashMap<String, DeletePlan>>>,
    _lock: Arc<File>,
    pub(crate) warnings: Arc<Mutex<Vec<String>>>,
    #[cfg(target_os = "windows")]
    pub job_handles: Arc<Mutex<Vec<usize>>>,
}
impl Service {
    pub fn new(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(&root)?;
        ensure!(
            !fs::symlink_metadata(&root)?.file_type().is_symlink(),
            "App storage cannot be a symbolic link"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&root, fs::Permissions::from_mode(0o700))?;
        }
        let lock = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(root.join("instance.lock"))?;
        fs2::FileExt::try_lock_exclusive(&lock)
            .context("Enderlink is already running for this data directory")?;
        for dir in [
            "worlds",
            "components",
            "java",
            "backups",
            "staging",
            "quarantine",
        ] {
            let p = root.join(dir);
            fs::create_dir_all(&p)?;
            files::owned(&root, &p)?;
        }
        let db = Connection::open(root.join("state.sqlite"))?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS metadata(id INTEGER PRIMARY KEY CHECK(id=1),schema_version INTEGER NOT NULL,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS journal(id TEXT PRIMARY KEY,payload TEXT NOT NULL);")?;
        db.execute(
            "INSERT OR IGNORE INTO metadata VALUES(1,3,?1)",
            [serde_json::to_string(&Data::default())?],
        )?;
        let schema: u32 =
            db.query_row("SELECT schema_version FROM metadata WHERE id=1", [], |r| {
                r.get(0)
            })?;
        ensure!(
            matches!(schema, 1..=3),
            "This data was created by a newer Enderlink version."
        );
        if schema < 3 {
            // Older binaries drop gameplay/operator settings on their next write.
            // Keep a consistent SQLite snapshot before the version guard changes.
            let text: String =
                db.query_row("SELECT data FROM metadata WHERE id=1", [], |r| r.get(0))?;
            let mut migrated = serde_json::from_str::<Data>(&text)
                .context("Could not read the existing world library")?;
            for world in &mut migrated.worlds {
                crate::world_config::adopt_legacy_settings(&root, world)?;
            }
            let backup = root.join(format!("state-before-v3-{}.sqlite", id()));
            db.execute("VACUUM INTO ?1", [backup.to_string_lossy().as_ref()])
                .context("Could not back up app metadata before upgrading world settings")?;
            db.execute(
                "UPDATE metadata SET schema_version=3,data=?1 WHERE id=1",
                [serde_json::to_string(&migrated)?],
            )?;
        }
        crate::activity::initialize_activity(&db)?;
        let client = reqwest::Client::builder()
            .user_agent(concat!(
                "Enderlink/",
                env!("CARGO_PKG_VERSION"),
                " (https://github.com/Buggyguys/enderlink)"
            ))
            .connect_timeout(std::time::Duration::from_secs(15))
            .timeout(std::time::Duration::from_secs(600))
            .https_only(true)
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()?;
        let s = Self {
            maintenance_active: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            maintenance_plan: Arc::new(Mutex::new(None)),
            memory: Arc::new(Mutex::new(crate::memory::MemorySampler::default())),
            software_updates: Arc::new(Mutex::new(vec![])),
            update_check: Arc::new(AsyncMutex::new(())),
            provider_auth: Arc::new(Mutex::new(())),
            provider_check: Arc::new(AsyncMutex::new(())),
            provider_registration: Arc::new(Mutex::new(None)),
            provider_epoch: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            awake: Arc::new(Mutex::new(None)),
            root: Arc::new(root),
            client,
            db: Arc::new(Mutex::new(db)),
            activity: Arc::new(Mutex::new(crate::activity::ActivityTracker::default())),
            mutation: Arc::new(AsyncMutex::new(())),
            process: Arc::new(AsyncMutex::new(None)),
            stdin: Arc::new(AsyncMutex::new(None)),
            session: Arc::new(Mutex::new(None)),
            logs: Arc::new(Mutex::new(VecDeque::new())),
            provider: Arc::new(Mutex::new(ProviderView {
                state: "disconnected".into(),
                ..Default::default()
            })),
            secret: Arc::new(Mutex::new(None)),
            provider_cancel: Arc::new(Mutex::new(None)),
            claim_cancel: Arc::new(Mutex::new(None)),
            orphan: Arc::new(Mutex::new(None)),
            operations: Arc::new(Mutex::new(vec![])),
            canceled: Arc::new(Mutex::new(HashSet::new())),
            plans: Arc::new(Mutex::new(HashMap::new())),
            _lock: Arc::new(lock),
            warnings: Arc::new(Mutex::new(vec![])),
            #[cfg(target_os = "windows")]
            job_handles: Arc::new(Mutex::new(vec![])),
        };
        s.recover()?;
        Ok(s)
    }
    pub fn data(&self) -> Result<Data> {
        let db = self.db.lock().unwrap();
        let text: String =
            db.query_row("SELECT data FROM metadata WHERE id=1", [], |r| r.get(0))?;
        Ok(serde_json::from_str(&text)?)
    }
    pub fn mutate<T>(&self, f: impl FnOnce(&mut Data) -> Result<T>) -> Result<T> {
        let db = self.db.lock().unwrap();
        let text: String =
            db.query_row("SELECT data FROM metadata WHERE id=1", [], |r| r.get(0))?;
        let mut d: Data = serde_json::from_str(&text)?;
        let result = f(&mut d)?;
        db.execute(
            "UPDATE metadata SET data=?1 WHERE id=1",
            [serde_json::to_string(&d)?],
        )?;
        Ok(result)
    }
    pub fn world(&self, id: &str) -> Result<World> {
        uuid::Uuid::parse_str(id).context("Invalid world ID")?;
        self.data()?
            .worlds
            .into_iter()
            .find(|w| w.id == id)
            .context("World no longer exists")
    }
    pub fn instance(&self, id: &str) -> Result<PathBuf> {
        uuid::Uuid::parse_str(id)?;
        let p = self.root.join("worlds").join(id).join("instance");
        files::owned(&self.root, &p)?;
        Ok(p)
    }
    pub fn log(&self, message: &str) {
        let clean = message
            .chars()
            .filter(|c| !c.is_control() || *c == '\t')
            .take(4096)
            .collect::<String>();
        let mut logs = self.logs.lock().unwrap();
        logs.push_back(clean);
        while logs.len() > 500 {
            logs.pop_front();
        }
    }
    pub fn snapshot(&self) -> Result<Snapshot> {
        let session = self.session.lock().unwrap().clone();
        let memory = self
            .memory
            .lock()
            .unwrap()
            .sample(session.as_ref().and_then(|s| s.pid));
        Ok(Snapshot {
            data: self.data()?,
            session: self.session.lock().unwrap().clone(),
            provider: self.provider.lock().unwrap().clone(),
            operations: self.operations.lock().unwrap().clone(),
            logs: self.logs.lock().unwrap().iter().cloned().collect(),
            data_dir: self.root.display().to_string(),
            total_memory: memory.total,
            memory,
            software_updates: self.software_updates.lock().unwrap().clone(),
            warnings: self.warnings.lock().unwrap().clone(),
        })
    }
    pub fn progress(&self, id: &str, msg: &str, value: Option<f64>) {
        if let Some(o) = self
            .operations
            .lock()
            .unwrap()
            .iter_mut()
            .find(|o| o.id == id)
        {
            o.message = msg.into();
            o.progress = value;
        }
    }
    pub fn check_cancel(&self, id: &str) -> Result<()> {
        ensure!(
            !self.canceled.lock().unwrap().contains(id),
            "Operation canceled before commit."
        );
        Ok(())
    }
    pub fn job<F, Fut>(&self, label: &str, f: F) -> String
    where
        F: FnOnce(Self, String) -> Fut + Send + 'static,
        Fut: Future<Output = Result<()>> + Send + 'static,
    {
        let id = id();
        {
            let mut ops = self.operations.lock().unwrap();
            ops.retain(|o| o.finished_at.is_none_or(|t| now().saturating_sub(t) < 3600));
            while ops.len() > 30 && ops.first().is_some_and(|o| o.finished_at.is_some()) {
                ops.remove(0);
            }
            ops.push(Operation {
                id: id.clone(),
                label: label.into(),
                status: "queued".into(),
                message: "Waiting for other operations".into(),
                progress: None,
                started_at: now(),
                finished_at: None,
            });
        }
        let svc = self.clone();
        let key = id.clone();
        tokio::spawn(async move {
            let _guard = svc.mutation.lock().await;
            if let Some(o) = svc
                .operations
                .lock()
                .unwrap()
                .iter_mut()
                .find(|o| o.id == key)
            {
                o.status = "running".into();
                o.message = "Preparing".into();
            }
            let result = if svc.check_cancel(&key).is_err() {
                Err(anyhow::anyhow!("Operation canceled"))
            } else {
                f(svc.clone(), key.clone()).await
            };
            if let Some(o) = svc
                .operations
                .lock()
                .unwrap()
                .iter_mut()
                .find(|o| o.id == key)
            {
                o.finished_at = Some(now());
                match result {
                    Ok(()) => {
                        o.status = "completed".into();
                        o.message = "Completed".into();
                        o.progress = Some(1.0)
                    }
                    Err(e) => {
                        o.status = "failed".into();
                        o.message = format!("{e:#}");
                        o.progress = None;
                    }
                }
            }
            svc.canceled.lock().unwrap().remove(&key);
        });
        id
    }
    pub(crate) async fn require_stopped(&self, id: &str) -> Result<()> {
        let s = self.session.lock().unwrap().clone();
        ensure!(
            !s.is_some_and(|s| s.world_id == id && s.pid.is_some()),
            "Save and stop this world before changing its files."
        );
        ensure!(
            self.orphan.lock().unwrap().is_none(),
            "Resolve the recovered server process before changing worlds."
        );
        Ok(())
    }
    pub fn create_world(&self, input: CreateWorld) -> Result<World> {
        let n = name(&input.name)?;
        ensure!(
            input.accept_eula,
            "Minecraft's EULA must be explicitly accepted."
        );
        ensure!(
            (1024..=65536).contains(&input.memory_mb)
                && input.max_players > 0
                && input.max_players <= 100
                && input.port >= 1024,
            "Choose 1–64 GB memory, 1–100 players, and a port between 1024 and 65535."
        );
        ensure!(
            ["survival", "creative", "adventure", "spectator"].contains(&input.gamemode.as_str())
                && ["peaceful", "easy", "normal", "hard"].contains(&input.difficulty.as_str()),
            "Invalid game mode or difficulty"
        );
        crate::gameplay::validate_gameplay(
            &input.gamemode,
            &input.difficulty,
            input.hardcore,
            input.cover_block.as_deref(),
        )?;
        let d = self.data()?;
        ensure!(
            !d.worlds.iter().any(|w| w.name == n),
            "A world already uses that name."
        );
        let c = d
            .components
            .into_iter()
            .find(|c| c.id == input.component_id)
            .context("Install the selected engine first")?;
        let w = World {
            id: id(),
            name: n,
            revision: 1,
            component: c,
            memory_mb: input.memory_mb,
            max_players: input.max_players,
            port: input.port,
            lan: input.lan,
            online_mode: input.online_mode,
            seed: input.seed.chars().take(128).collect(),
            gamemode: input.gamemode,
            difficulty: input.difficulty,
            hardcore: input.hardcore,
            pvp: input.pvp,
            allow_commands: input.allow_commands,
            force_gamemode: input.force_gamemode,
            cover_block: input.cover_block,
            gameplay_configured: true,
            eula_accepted_at: now(),
            players: vec![],
            created_at: now(),
            last_played: None,
            pack_notes: input.pack_notes.chars().take(2000).collect(),
        };
        self.write_properties(&w)?;
        self.mutate(|d| {
            d.worlds.push(w.clone());
            Ok(())
        })?;
        Ok(w)
    }
    pub async fn backup(&self, id: &str, op: &str) -> Result<Backup> {
        self.require_stopped(id).await?;
        let w = self.world(id)?;
        let src = self.instance(id)?;
        let size = files::size(&src);
        ensure!(
            fs2::available_space(self.root.as_ref())? > size.saturating_mul(2) + 100_000_000,
            "Not enough disk space for a safe backup."
        );
        let bid = crate::model::id();
        let dir = self.root.join("backups").join(&bid);
        fs::create_dir_all(&dir)?;
        let zip = dir.join("instance.zip");
        self.progress(op, "Creating complete stopped-world backup", None);
        let zip2 = zip.clone();
        tokio::task::spawn_blocking(move || files::zip_dir(&src, &zip2)).await??;
        let b = Backup {
            id: bid,
            world: w,
            created_at: now(),
            bytes: fs::metadata(&zip)?.len(),
            sha256: files::hash(&zip)?,
        };
        files::atomic(&dir.join("manifest.json"), &serde_json::to_vec_pretty(&b)?)?;
        self.mutate(|d| {
            d.backups.push(b.clone());
            Ok(())
        })?;
        Ok(b)
    }
    pub async fn restore(&self, bid: &str, op: &str) -> Result<World> {
        let b = self
            .data()?
            .backups
            .into_iter()
            .find(|b| b.id == bid)
            .context("Backup no longer exists")?;
        uuid::Uuid::parse_str(&b.id)?;
        let zip = self.root.join("backups").join(&b.id).join("instance.zip");
        files::owned(&self.root, &zip)?;
        ensure!(
            files::hash(&zip)? == b.sha256,
            "Backup failed its integrity check."
        );
        let mut w = b.world.clone();
        w.id = id();
        w.revision = 1;
        w.created_at = now();
        w.last_played = None;
        let existing = self.data()?;
        let original = w.name.clone();
        w.name = format!(
            "{} (restored)",
            original.chars().take(45).collect::<String>()
        );
        let mut n = 2;
        while existing.worlds.iter().any(|x| x.name == w.name) {
            w.name = format!(
                "{} (restored {n})",
                original.chars().take(40).collect::<String>()
            );
            n += 1;
        }
        let dst = self.instance(&w.id)?;
        self.progress(op, "Restoring verified snapshot into a new world", None);
        let max = fs2::available_space(self.root.as_ref())?.saturating_sub(100_000_000);
        let dst2 = dst.clone();
        tokio::task::spawn_blocking(move || files::unzip(&zip, &dst2, max)).await??;
        crate::world_config::adopt_legacy_settings(self.root.as_ref(), &mut w)?;
        self.mutate(|d| {
            d.worlds.push(w.clone());
            Ok(())
        })?;
        Ok(w)
    }
    pub async fn prepare_delete(&self, id: &str, keep: bool) -> Result<DeletePlan> {
        self.require_stopped(id).await?;
        let w = self.world(id)?;
        let p = DeletePlan {
            token: crate::model::id(),
            world_id: id.into(),
            revision: w.revision,
            phrase: format!("DELETE {}", w.name),
            keep_backups: keep,
            backup_ids: self
                .data()?
                .backups
                .iter()
                .filter(|b| b.world.id == id)
                .map(|b| b.id.clone())
                .collect(),
            expires_at: now() + 300,
        };
        let mut plans = self.plans.lock().unwrap();
        plans.retain(|_, p| p.expires_at >= now());
        plans.insert(p.token.clone(), p.clone());
        Ok(p)
    }
    pub async fn confirm_delete(&self, token: &str, phrase: &str) -> Result<()> {
        use unicode_normalization::UnicodeNormalization;
        let p = self
            .plans
            .lock()
            .unwrap()
            .remove(token)
            .context("Deletion review expired. Review again.")?;
        ensure!(p.expires_at >= now(), "Deletion review expired.");
        let w = self.world(&p.world_id)?;
        ensure!(
            p.revision == w.revision && phrase.nfc().eq(p.phrase.nfc()),
            "Deletion phrase or reviewed world changed. Review again."
        );
        self.require_stopped(&p.world_id).await?;
        let ids: Vec<_> = self
            .data()?
            .backups
            .iter()
            .filter(|b| b.world.id == w.id)
            .map(|b| b.id.clone())
            .collect();
        ensure!(
            ids == p.backup_ids,
            "Backups changed after this review. Review again."
        );
        self.db.lock().unwrap().execute(
            "INSERT INTO journal VALUES(?1,?2)",
            rusqlite::params![p.token, serde_json::to_string(&p)?],
        )?;
        self.finish_delete(&p)
    }
    fn finish_delete(&self, p: &DeletePlan) -> Result<()> {
        uuid::Uuid::parse_str(&p.world_id)?;
        uuid::Uuid::parse_str(&p.token)?;
        let src = self.root.join("worlds").join(&p.world_id);
        let dst = self.root.join("quarantine").join(&p.token);
        files::owned(&self.root, &src)?;
        files::owned(&self.root, &dst)?;
        if src.exists() {
            ensure!(!dst.exists(), "Deletion quarantine already exists");
            fs::rename(&src, &dst)?;
        }
        self.mutate(|d| {
            d.worlds.retain(|w| w.id != p.world_id);
            if !p.keep_backups {
                d.backups.retain(|b| !p.backup_ids.contains(&b.id));
            }
            Ok(())
        })?;
        self.delete_world_activity(&p.world_id)?;
        if !p.keep_backups {
            for id in &p.backup_ids {
                uuid::Uuid::parse_str(id)?;
                let dir = self.root.join("backups").join(id);
                files::owned(&self.root, &dir)?;
                if dir.exists() {
                    fs::remove_dir_all(dir)?;
                }
            }
        }
        if dst.exists() {
            fs::remove_dir_all(dst).context(
                "World removed, but disk cleanup is pending. Restart Enderlink to retry.",
            )?;
        }
        self.db
            .lock()
            .unwrap()
            .execute("DELETE FROM journal WHERE id=?1", [&p.token])?;
        Ok(())
    }
    pub async fn uninstall(&self, id: &str) -> Result<()> {
        uuid::Uuid::parse_str(id)?;
        let d = self.data()?;
        let c = d
            .components
            .iter()
            .find(|c| c.id == id)
            .context("Component no longer installed")?;
        for w in d.worlds.iter().filter(|w| w.component.id == c.id) {
            self.require_stopped(&w.id).await?;
        }
        let dir = self.root.join("components").join(id);
        files::owned(&self.root, &dir)?;
        if dir.exists() {
            fs::remove_dir_all(&dir)?;
        }
        self.mutate(|d| {
            d.components.retain(|c| c.id != id);
            Ok(())
        })?;
        Ok(())
    }
    pub async fn update_world(
        &self,
        id: &str,
        version: &str,
        expected: u64,
        op: &str,
    ) -> Result<()> {
        self.require_stopped(id).await?;
        let mut w = self.world(id)?;
        ensure!(
            w.revision == expected,
            "World settings changed. Review the update again."
        );
        let c = self
            .install(
                w.component.engine.clone(),
                &w.component.minecraft,
                version,
                op,
            )
            .await?;
        self.check_cancel(op)?;
        self.backup(id, op).await?;
        self.progress(op, "Applying pinned engine version", None);
        w.component = c;
        w.revision += 1;
        self.mutate(|d| {
            *d.worlds
                .iter_mut()
                .find(|x| x.id == id)
                .context("World no longer exists")? = w;
            Ok(())
        })?;
        Ok(())
    }
    pub async fn set_player(&self, id: &str, username: &str, remove: bool) -> Result<()> {
        let mut w = self.world(id)?;
        crate::accounts::validate_username(username)?;
        if !w.online_mode {
            // Minecraft's name-based whitelist command can resolve a cached
            // authenticated profile. Write explicit offline UUIDs while stopped
            // so a matching real account cannot substitute the wrong identity.
            self.require_stopped(id)
                .await
                .context("Save and stop this world before editing its offline player list.")?;
        }
        if remove
            && w.players
                .iter()
                .any(|p| p.name.eq_ignore_ascii_case(username) && p.operator)
        {
            self.require_stopped(id)
                .await
                .context("Stop this world before removing a player with command access.")?;
        }
        let mut player = if remove {
            w.players
                .iter()
                .find(|p| p.name.eq_ignore_ascii_case(username))
                .cloned()
                .context("Player is not on this world's access list")?
        } else if w.online_mode {
            self.verified_player(username).await?
        } else {
            crate::accounts::offline_player(username)?
        };
        if w.players
            .iter()
            .any(|p| p.name.eq_ignore_ascii_case(&player.name) && p.uuid != player.uuid)
        {
            self.require_stopped(id)
                .await
                .context("Stop this world before replacing an existing player's identity.")?;
        }
        if let Some(existing) = w.players.iter().find(|p| p.uuid == player.uuid) {
            player.operator = existing.operator;
            player.operator_level = existing.operator_level;
            player.bypasses_player_limit = existing.bypasses_player_limit;
        }
        w.players
            .retain(|p| p.uuid != player.uuid && !p.name.eq_ignore_ascii_case(&player.name));
        if !remove {
            w.players.push(player.clone());
        }
        w.revision += 1;
        let running = self
            .session
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|s| s.world_id == id && s.pid.is_some());
        if running {
            let command = format!(
                "whitelist {} {}",
                if remove { "remove" } else { "add" },
                player.name
            );
            self.send_console(&command).await?;
            if remove {
                self.send_console(&format!("kick {} Access removed by the host", player.name))
                    .await?;
            }
            let whitelist = self.instance(id)?.join("whitelist.json");
            let mut acknowledged = false;
            for _ in 0..25 {
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                if let Ok(bytes) = fs::read(&whitelist)
                    && let Ok(actual) = serde_json::from_slice::<Vec<Player>>(&bytes)
                {
                    let contains = actual.iter().any(|p| p.uuid == player.uuid);
                    if contains != remove {
                        acknowledged = true;
                        break;
                    }
                }
            }
            ensure!(
                acknowledged,
                "Minecraft did not confirm this whitelist change. Check its console and retry."
            );
            self.log("[Enderlink] Minecraft confirmed the whitelist update.");
        } else {
            self.write_properties(&w)?;
        }
        self.mutate(|d| {
            *d.worlds
                .iter_mut()
                .find(|x| x.id == id)
                .context("World disappeared")? = w;
            Ok(())
        })?;
        Ok(())
    }
    pub async fn import_files(&self, id: &str, path: &Path, kind: &str, op: &str) -> Result<()> {
        self.require_stopped(id).await?;
        ensure!(
            ["server", "mods", "plugins"].contains(&kind),
            "Unsupported import type"
        );
        let mut w = self.world(id)?;
        ensure!(
            kind != "plugins" || w.component.engine == Engine::Paper,
            "Plugins require Paper"
        );
        ensure!(
            kind != "mods" || w.component.engine == Engine::Fabric,
            "Mods require Fabric"
        );
        ensure!(path.exists(), "Selected source does not exist");
        let source = path.canonicalize()?;
        ensure!(
            !source.starts_with(self.root.as_ref()) && !self.root.starts_with(&source),
            "Choose an external import source, not Enderlink storage"
        );
        self.backup(id, op).await?;
        let dir = self.instance(id)?;
        if kind == "server" {
            let stage = self.root.join("staging").join(crate::model::id());
            fs::create_dir_all(&stage)?;
            if source.is_dir() {
                let s = source.clone();
                let d = stage.clone();
                tokio::task::spawn_blocking(move || files::copy_tree(&s, &d)).await??;
            } else {
                let d = stage.clone();
                let max = fs2::available_space(self.root.as_ref())?.saturating_sub(100_000_000);
                tokio::task::spawn_blocking(move || files::unzip(&source, &d, max)).await??;
            }
            // A server pack is merged only after its level directory is made explicit.
            let properties =
                fs::read_to_string(stage.join("server.properties")).unwrap_or_default();
            let level = properties
                .lines()
                .filter_map(|l| l.trim().strip_prefix("level-name="))
                .next_back()
                .unwrap_or("world")
                .trim();
            ensure!(
                !level.is_empty()
                    && std::path::Path::new(level).components().count() == 1
                    && std::path::Path::new(level)
                        .components()
                        .all(|c| matches!(c, std::path::Component::Normal(_))),
                "Imported level-name must be a single folder name."
            );
            if level != "world" {
                for suffix in ["", "_nether", "_the_end"] {
                    let from = stage.join(format!("{level}{suffix}"));
                    let to = stage.join(format!("world{suffix}"));
                    if from.exists() {
                        ensure!(
                            !to.exists(),
                            "Import contains conflicting world directories"
                        );
                        fs::rename(from, to)?;
                    }
                }
            }
            let entries = files::safe_entries(&stage)?;
            ensure!(!entries.is_empty(), "Import was empty");
            for entry in &entries {
                if entry.is_file() {
                    let ext = entry
                        .extension()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_ascii_lowercase();
                    ensure!(
                        !["exe", "dll", "dylib", "so", "bat", "cmd", "ps1", "sh"]
                            .contains(&ext.as_str()),
                        "Remove executable scripts/binaries from this server pack before importing. Enderlink never runs imported installers."
                    );
                }
            }
            if let Some(hardcore) = crate::world_config::stored_hardcore(&stage)? {
                w.hardcore = hardcore;
                if hardcore {
                    w.gamemode = "survival".into();
                    w.difficulty = "hard".into();
                }
            }
            let previous = dir.with_file_name("import-previous");
            files::owned(&self.root, &previous)?;
            ensure!(
                !previous.exists(),
                "A previous import needs recovery; reopen Enderlink."
            );
            fs::rename(&dir, &previous)?;
            if let Err(e) = fs::rename(&stage, &dir) {
                let _ = fs::rename(&previous, &dir);
                return Err(e.into());
            }
            if let Err(e) = self.write_properties(&w) {
                let _ = fs::remove_dir_all(&dir);
                let _ = fs::rename(&previous, &dir);
                return Err(e);
            }
            fs::remove_dir_all(previous)?;
        } else {
            ensure!(
                source.extension().is_some_and(|e| e == "jar"),
                "Select a .jar mod/plugin from a trusted source."
            );
            let target = dir.join(kind);
            files::owned(&self.root, &target)?;
            fs::create_dir_all(&target)?;
            files::owned(
                &self.root,
                &target.join(source.file_name().context("Invalid import filename")?),
            )?;
            fs::copy(
                &source,
                target.join(source.file_name().context("Invalid import filename")?),
            )?;
        }
        self.mutate(|d| {
            if let Some(current) = d.worlds.iter_mut().find(|current| current.id == id) {
                w.revision += 1;
                *current = w;
            }
            Ok(())
        })?;
        Ok(())
    }
    fn recover(&self) -> Result<()> {
        let owner = self.root.join("server-owner.json");
        if owner.exists() {
            let v: Value = serde_json::from_slice(&fs::read(&owner)?)?;
            let pid = v["pid"].as_u64().unwrap_or(0) as u32;
            let start = v["start"].as_u64().unwrap_or(0);
            let mut sys = System::new();
            sys.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
            if start > 0
                && sys
                    .process(Pid::from_u32(pid))
                    .is_some_and(|p| p.start_time() == start)
            {
                *self.orphan.lock().unwrap() = Some((pid, start));
                self.warnings.lock().unwrap().push("A server survived a previous app exit. Use Recover server to request shutdown before editing worlds.".into());
            } else {
                let _ = fs::remove_file(owner);
            }
        }
        if self.orphan.lock().unwrap().is_none() {
            for w in self.data()?.worlds {
                let dir = self.instance(&w.id)?;
                let previous = dir.with_file_name("import-previous");
                files::owned(&self.root, &previous)?;
                if previous.exists() {
                    if dir.exists() {
                        let mut recovered = w.clone();
                        if let Some(hardcore) = crate::world_config::stored_hardcore(&dir)? {
                            recovered.hardcore = hardcore;
                            if hardcore {
                                recovered.gamemode = "survival".into();
                                recovered.difficulty = "hard".into();
                            }
                        }
                        self.write_properties(&recovered)?;
                        self.mutate(|data| {
                            if let Some(current) = data
                                .worlds
                                .iter_mut()
                                .find(|current| current.id == recovered.id)
                            {
                                *current = recovered;
                            }
                            Ok(())
                        })?;
                        fs::remove_dir_all(previous)?;
                    } else {
                        fs::rename(previous, dir)?;
                    }
                }
            }
        }
        let pending: Vec<String> = {
            let db = self.db.lock().unwrap();
            let mut stmt = db.prepare("SELECT payload FROM journal")?;
            stmt.query_map([], |r| r.get(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?
        };
        if self.orphan.lock().unwrap().is_none() {
            for payload in pending {
                let p: DeletePlan = serde_json::from_str(&payload)?;
                if let Err(e) = self.finish_delete(&p) {
                    self.warnings
                        .lock()
                        .unwrap()
                        .push(format!("Deletion cleanup pending: {e}"));
                }
            }
        }
        // Missing installed payloads become an explicit reinstall state; world pins survive.
        self.mutate(|d| {
            d.components.retain(|c| {
                let path = self.component_jar(c);
                files::owned(&self.root, &path).is_ok() && path.is_file()
            });
            Ok(())
        })?;
        for entry in fs::read_dir(self.root.join("backups"))? {
            let entry = entry?;
            let manifest = entry.path().join("manifest.json");
            if manifest.exists()
                && let Ok(b) = serde_json::from_slice::<Backup>(&fs::read(manifest)?)
                && !self.data()?.backups.iter().any(|x| x.id == b.id)
                && entry.path().join("instance.zip").exists()
            {
                self.mutate(|d| {
                    d.backups.push(b);
                    Ok(())
                })?;
            }
        }
        Ok(())
    }
    pub async fn dispatch(&self, action: &str, args: Value) -> Result<Value> {
        ensure!(
            action == "snapshot"
                || !self
                    .maintenance_active
                    .load(std::sync::atomic::Ordering::SeqCst),
            "Enderlink maintenance is in progress. Wait for it to finish."
        );
        fn s(v: &Value, k: &str) -> Result<String> {
            Ok(v[k]
                .as_str()
                .with_context(|| format!("Missing {k}"))?
                .into())
        }
        match action {
            "maintenancePlan" => Ok(serde_json::to_value(self.prepare_maintenance().await?)?),
            "resetAllData" => {
                self.reset_all_data(&s(&args, "token")?, &s(&args, "phrase")?)
                    .await?;
                Ok(Value::Null)
            }
            "restoreLibrary" => {
                self.restore_saved_library(&PathBuf::from(s(&args, "path")?))
                    .await?;
                Ok(Value::Null)
            }
            "checkUpdates" => Ok(json!(
                self.check_updates(args["force"].as_bool().unwrap_or(false))
                    .await?
            )),
            "verifyProvider" => {
                self.verify_provider().await?;
                Ok(Value::Null)
            }
            "snapshot" => Ok(serde_json::to_value(self.snapshot()?)?),
            "minecraftVersions" => Ok(json!(
                self.minecraft_versions(serde_json::from_value(args["engine"].clone())?)
                    .await?
            )),
            "versions" => Ok(json!(
                self.versions(
                    serde_json::from_value(args["engine"].clone())?,
                    &s(&args, "minecraft")?
                )
                .await?
            )),
            "checkServer" => Ok(json!(status::check(&s(&args, "address")?).await?)),
            "beginLink" => Ok(json!(
                self.begin_link(args["remember"].as_bool().unwrap_or(true))
                    .await?
            )),
            "disconnectProvider" => {
                self.disconnect_provider()?;
                Ok(Value::Null)
            }
            "retryProvider" => {
                let port = self
                    .session
                    .lock()
                    .unwrap()
                    .as_ref()
                    .filter(|s| s.pid.is_some())
                    .and_then(|s| self.world(&s.world_id).ok())
                    .map(|w| w.port)
                    .context("Start a world to activate its tunnel")?;
                self.start_provider(port);
                Ok(Value::Null)
            }
            "cancelOperation" => {
                self.canceled.lock().unwrap().insert(s(&args, "id")?);
                Ok(Value::Null)
            }
            "install" => {
                let engine = serde_json::from_value(args["engine"].clone())?;
                let mc = s(&args, "minecraft")?;
                let v = s(&args, "version")?;
                Ok(json!(self.job(
                    "Install server software",
                    move |svc, op| async move {
                        svc.install(engine, &mc, &v, &op).await?;
                        Ok(())
                    }
                )))
            }
            "createWorld" => {
                let input: CreateWorld = serde_json::from_value(args)?;
                let _g = self.mutation.lock().await;
                Ok(json!(self.create_world(input)?))
            }
            "start" => {
                let id = s(&args, "id")?;
                Ok(json!(self.job("Start world", move |svc, op| async move {
                    svc.start_world(&id, &op).await
                })))
            }
            "stop" => Ok(json!(
                self.job("Save and stop world", move |svc, _| async move {
                    svc.stop_world().await
                })
            )),
            "forceStop" => {
                ensure!(
                    args["confirmation"].as_str() == Some("FORCE STOP"),
                    "Confirm force stop explicitly"
                );
                self.force_stop().await?;
                Ok(Value::Null)
            }
            "recoverServer" => {
                self.stop_recovered()?;
                Ok(Value::Null)
            }
            "backup" => {
                let id = s(&args, "id")?;
                Ok(json!(self.job(
                    "Back up world",
                    move |svc, op| async move {
                        svc.require_stopped(&id).await?;
                        svc.backup(&id, &op).await?;
                        Ok(())
                    }
                )))
            }
            "restore" => {
                let id = s(&args, "id")?;
                Ok(json!(self.job(
                    "Restore backup",
                    move |svc, op| async move {
                        svc.restore(&id, &op).await?;
                        Ok(())
                    }
                )))
            }
            "prepareDelete" => {
                let _g = self.mutation.lock().await;
                Ok(json!(
                    self.prepare_delete(
                        &s(&args, "id")?,
                        args["keepBackups"].as_bool().unwrap_or(true)
                    )
                    .await?
                ))
            }
            "deleteWorld" => {
                let token = s(&args, "token")?;
                let phrase = s(&args, "phrase")?;
                Ok(json!(self.job("Delete world", move |svc, _| async move {
                    svc.confirm_delete(&token, &phrase).await
                })))
            }
            "uninstall" => {
                let id = s(&args, "id")?;
                Ok(json!(
                    self.job("Uninstall engine", move |svc, _| async move {
                        svc.uninstall(&id).await
                    })
                ))
            }
            "updateWorld" => {
                let id = s(&args, "id")?;
                let version = s(&args, "version")?;
                let revision = args["revision"]
                    .as_u64()
                    .context("Missing world revision")?;
                Ok(json!(
                    self.job("Back up and update world", move |svc, op| async move {
                        svc.update_world(&id, &version, revision, &op).await
                    })
                ))
            }
            "setPlayer" => {
                let id = s(&args, "id")?;
                let name = s(&args, "name")?;
                let remove = args["remove"].as_bool().unwrap_or(false);
                Ok(json!(
                    self.job("Update player access", move |svc, _| async move {
                        svc.set_player(&id, &name, remove).await
                    })
                ))
            }
            "changeAccountMode" => {
                let id = s(&args, "id")?;
                let online = args["onlineMode"]
                    .as_bool()
                    .context("Choose a player account mode")?;
                let revision = args["revision"]
                    .as_u64()
                    .context("Missing world revision")?;
                Ok(json!(self.job(
                    "Back up and change player accounts",
                    move |svc, op| async move {
                        svc.change_account_mode(&id, online, revision, &op).await
                    }
                )))
            }
            "saveWorld" => {
                let _g = self.mutation.lock().await;
                Ok(json!(self.save_world_settings(&args).await?))
            }
            "setOperator" => {
                let _g = self.mutation.lock().await;
                Ok(json!(
                    self.set_operator(
                        &s(&args, "id")?,
                        &s(&args, "uuid")?,
                        args["operator"]
                            .as_bool()
                            .context("Choose command access")?,
                        args["revision"]
                            .as_u64()
                            .context("Missing world revision")?,
                    )
                    .await?
                ))
            }
            "playtime" => Ok(json!(self.playtime(
                &s(&args, "id")?,
                serde_json::from_value(args["boundaries"].clone())?
            )?)),
            "settings" | "patchSettings" => {
                self.mutate(|d| {
                    let value = if action == "patchSettings" {
                        let mut current = serde_json::to_value(&d.settings)?;
                        for (key, value) in args.as_object().context("Expected settings object")? {
                            current[key] = value.clone();
                        }
                        current
                    } else {
                        args.clone()
                    };
                    let settings: Settings = serde_json::from_value(value)?;
                    ensure!(
                        (1024..=65536).contains(&settings.memory_mb),
                        "Invalid settings"
                    );
                    ensure!(
                        ["low", "medium", "high"].contains(&settings.star_density.as_str())
                            && ["gentle", "normal", "lively"]
                                .contains(&settings.motion_speed.as_str())
                            && ["wander", "float", "still"]
                                .contains(&settings.star_motion.as_str())
                            && ["slow", "balanced", "lively"]
                                .contains(&settings.star_speed.as_str())
                            && ["clear", "frosted", "dense"]
                                .contains(&settings.glass_opacity.as_str()),
                        "Invalid appearance preference"
                    );
                    d.settings = settings;
                    Ok(())
                })?;
                Ok(Value::Null)
            }
            "importFiles" => {
                let id = s(&args, "id")?;
                let path = PathBuf::from(s(&args, "path")?);
                let kind = s(&args, "kind")?;
                Ok(json!(
                    self.job("Import server files", move |svc, op| async move {
                        svc.import_files(&id, &path, &kind, &op).await
                    })
                ))
            }
            "deleteBackup" => {
                let id = s(&args, "id")?;
                let phrase = s(&args, "phrase")?;
                Ok(json!(self.job("Delete backup", move |svc, _| async move {
                    svc.delete_backup(&id, &phrase)
                })))
            }
            "removeManagedData" => {
                let phrase = s(&args, "phrase")?;
                let worlds: Vec<String> = serde_json::from_value(args["worldIds"].clone())?;
                let backups: Vec<String> = serde_json::from_value(args["backupIds"].clone())?;
                let keep_worlds = args["keepWorlds"].as_bool().unwrap_or(true);
                let keep_backups = args["keepBackups"].as_bool().unwrap_or(true);
                Ok(json!(self.job(
                    "Remove managed data",
                    move |svc, _| async move {
                        svc.remove_managed_data(&phrase, worlds, backups, keep_worlds, keep_backups)
                            .await
                    }
                )))
            }
            "restart" => {
                let id = s(&args, "id")?;
                Ok(json!(self.job(
                    "Restart world",
                    move |svc, op| async move {
                        svc.stop_world().await?;
                        svc.start_world(&id, &op).await
                    }
                )))
            }
            "exportDiagnostics" => {
                let path = PathBuf::from(s(&args, "path")?);
                ensure!(!path.exists(), "Choose a new diagnostic file name.");
                let data = self.data()?;
                let provider = self.provider.lock().unwrap().clone();
                let session = self.session.lock().unwrap().clone();
                // An allowlist deliberately excludes secrets, logs, usernames, paths, and addresses.
                let report = json!({"appVersion":env!("CARGO_PKG_VERSION"),"os":std::env::consts::OS,"arch":std::env::consts::ARCH,"createdAt":now(),"worldCount":data.worlds.len(),"backupCount":data.backups.len(),"engines":data.components.iter().map(|c|json!({"engine":c.engine,"minecraft":c.minecraft,"version":c.version,"javaMajor":c.java_major})).collect::<Vec<_>>(),"provider":{"linked":provider.linked,"persisted":provider.persisted,"state":provider.state,"endpointCount":provider.endpoints.len()},"sessionState":session.map(|s|s.state)});
                let mut f = fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(path)?;
                use std::io::Write;
                f.write_all(&serde_json::to_vec_pretty(&report)?)?;
                f.sync_all()?;
                Ok(Value::Null)
            }
            "exportBackup" => {
                let id = s(&args, "id")?;
                let dest = PathBuf::from(s(&args, "path")?);
                let b = self
                    .data()?
                    .backups
                    .into_iter()
                    .find(|b| b.id == id)
                    .context("Backup missing")?;
                ensure!(
                    !dest.exists(),
                    "Choose a new file name; an existing file will not be overwritten"
                );
                let src = self.root.join("backups").join(&b.id).join("instance.zip");
                ensure!(files::hash(&src)? == b.sha256, "Backup checksum mismatch");
                let mut output = fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(dest)?;
                std::io::copy(&mut fs::File::open(src)?, &mut output)?;
                output.sync_all()?;
                Ok(Value::Null)
            }
            "worldPath" => Ok(json!(
                self.instance(&s(&args, "id")?)?.display().to_string()
            )),
            "storage" => {
                let root = self.root.clone();
                Ok(tokio::task::spawn_blocking(move||json!({"worlds":files::size(&root.join("worlds")),"backups":files::size(&root.join("backups")),"components":files::size(&root.join("components")),"java":files::size(&root.join("java")),"cache":files::size(&root.join("staging"))})).await?)
            }
            "cleanCache" => {
                let _g = self.mutation.lock().await;
                let path = self.root.join("staging");
                files::owned(&self.root, &path)?;
                fs::remove_dir_all(&path)?;
                fs::create_dir_all(path)?;
                Ok(Value::Null)
            }
            _ => anyhow::bail!("Unknown application action"),
        }
    }
    pub async fn shutdown(&self) -> Result<()> {
        if self.process.lock().await.is_some() {
            self.stop_world().await?;
        }
        self.stop_provider();
        if let Some(t) = self.claim_cancel.lock().unwrap().take() {
            t.cancel()
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, Service, World) {
        let t = tempfile::tempdir().unwrap();
        let s = Service::new(t.path().join("data")).unwrap();
        let c = Component {
            id: id(),
            engine: Engine::Paper,
            minecraft: "1.21.1".into(),
            version: "132".into(),
            java_major: 21,
            sha256: String::new(),
            bytes: 0,
            installed_at: now(),
            source_url: None,
        };
        s.mutate(|d| {
            d.components.push(c.clone());
            Ok(())
        })
        .unwrap();
        let w = s
            .create_world(CreateWorld {
                name: "Mossy Hollow".into(),
                component_id: c.id,
                memory_mb: 2048,
                max_players: 8,
                port: 25565,
                lan: false,
                online_mode: true,
                seed: String::new(),
                gamemode: "survival".into(),
                difficulty: "normal".into(),
                hardcore: false,
                pvp: true,
                allow_commands: false,
                force_gamemode: false,
                cover_block: None,
                accept_eula: true,
                pack_notes: String::new(),
            })
            .unwrap();
        let dir = s.instance(&w.id).unwrap();
        fs::create_dir_all(dir.join("world/DIM-1/region")).unwrap();
        fs::write(dir.join("world/DIM-1/region/chunk.mca"), b"saved dimension").unwrap();
        (t, s, w)
    }
    #[tokio::test]
    async fn gameplay_settings_write_real_server_rules_and_require_a_stopped_fresh_world() {
        let (_t, s, w) = fixture();
        let change = json!({"id":w.id,"revision":w.revision,"name":w.name,
            "gamemode":"creative","difficulty":"peaceful","pvp":false,
            "forceGamemode":true,"allowCommands":true,"coverBlock":"rose-glass"});
        s.dispatch("saveWorld", change.clone()).await.unwrap();
        let updated = s.world(&w.id).unwrap();
        assert_eq!(updated.gamemode, "creative");
        assert_eq!(updated.cover_block.as_deref(), Some("rose-glass"));
        assert!(!updated.pvp && updated.allow_commands && updated.force_gamemode);
        let properties =
            fs::read_to_string(s.instance(&w.id).unwrap().join("server.properties")).unwrap();
        for rule in [
            "gamemode=creative",
            "difficulty=peaceful",
            "pvp=false",
            "force-gamemode=true",
            "hardcore=false",
        ] {
            assert!(properties.lines().any(|line| line == rule), "{rule}");
        }
        assert!(!properties.contains("allow-cheats"));
        assert!(
            s.dispatch("saveWorld", change.clone()).await.is_err(),
            "stale revision"
        );
        let mut current = change;
        current["revision"] = json!(updated.revision);
        current["coverBlock"] = json!("unknown-block");
        assert!(s.dispatch("saveWorld", current.clone()).await.is_err());
        current["coverBlock"] = Value::Null;
        *s.session.lock().unwrap() = Some(SessionView {
            world_id: w.id.clone(),
            pid: Some(42),
            ..Default::default()
        });
        assert!(s.dispatch("saveWorld", current.clone()).await.is_err());
        *s.session.lock().unwrap() = None;
        s.dispatch("saveWorld", current).await.unwrap();
        assert!(s.world(&w.id).unwrap().cover_block.is_none());
    }

    #[tokio::test]
    async fn commands_only_grant_level_two_to_explicit_allowed_players_and_can_be_revoked() {
        let (_t, s, w) = fixture();
        let mut player = crate::accounts::offline_player("Birch").unwrap();
        let other = crate::accounts::offline_player("Moss").unwrap();
        s.mutate(|d| {
            let world = &mut d.worlds[0];
            world.online_mode = false;
            world.players = vec![player.clone(), other];
            Ok(())
        })
        .unwrap();
        assert!(
            s.set_operator(&w.id, &player.uuid, true, w.revision)
                .await
                .is_err()
        );
        s.dispatch(
            "saveWorld",
            json!({"id":w.id,"revision":w.revision,"name":w.name,"allowCommands":true}),
        )
        .await
        .unwrap();
        let dir = s.instance(&w.id).unwrap();
        let ops = || {
            serde_json::from_slice::<Vec<Value>>(&fs::read(dir.join("ops.json")).unwrap()).unwrap()
        };
        assert!(
            ops().is_empty(),
            "enabling cheats never grants everyone access"
        );
        let revision = s.world(&w.id).unwrap().revision;
        assert!(
            s.set_operator(&w.id, "unknown", true, revision)
                .await
                .is_err()
        );
        s.set_operator(&w.id, &player.uuid, true, revision)
            .await
            .unwrap();
        assert_eq!(
            ops(),
            vec![
                json!({"uuid":player.uuid,"name":player.name,"level":2,"bypassesPlayerLimit":false})
            ]
        );
        let list: Vec<Value> =
            serde_json::from_slice(&fs::read(dir.join("whitelist.json")).unwrap()).unwrap();
        assert!(list.iter().all(|p| p.get("operator").is_none()));
        let revision = s.world(&w.id).unwrap().revision;
        *s.session.lock().unwrap() = Some(SessionView {
            world_id: w.id.clone(),
            pid: Some(42),
            ..Default::default()
        });
        assert!(
            s.set_operator(&w.id, &player.uuid, false, revision)
                .await
                .is_err()
        );
        *s.session.lock().unwrap() = None;
        s.dispatch(
            "saveWorld",
            json!({"id":w.id,"revision":revision,"name":w.name,"allowCommands":false}),
        )
        .await
        .unwrap();
        assert!(ops().is_empty(), "world toggle revokes effective commands");
        player.operator = true;
        assert!(
            s.world(&w.id).unwrap().players[0].operator,
            "selection retained while disabled"
        );
        let updated = s.world(&w.id).unwrap();
        s.set_operator(&w.id, &player.uuid, false, updated.revision)
            .await
            .unwrap();
        assert!(!s.world(&w.id).unwrap().players[0].operator);
    }

    #[tokio::test]
    async fn hardcore_is_validated_before_creation_and_locked_after_generation() {
        let (_t, s, w) = fixture();
        let input = json!({"name":"Hardcore", "componentId":w.component.id,"memoryMb":2048,
            "maxPlayers":8,"port":25565,"acceptEula":true,"hardcore":true});
        assert!(
            s.create_world(serde_json::from_value(input.clone()).unwrap())
                .is_err()
        );
        let mut input = input;
        input["gamemode"] = json!("survival");
        input["difficulty"] = json!("hard");
        let hardcore = s
            .create_world(serde_json::from_value(input).unwrap())
            .unwrap();
        assert!(hardcore.hardcore);
        let dir = s.instance(&hardcore.id).unwrap();
        fs::create_dir_all(dir.join("world")).unwrap();
        fs::write(dir.join("world/level.dat"), b"generated world").unwrap();
        assert!(s.dispatch("saveWorld",json!({"id":hardcore.id,"revision":hardcore.revision,"name":hardcore.name,"hardcore":false})).await.is_err());
        assert_eq!(
            fs::read(dir.join("world/level.dat")).unwrap(),
            b"generated world"
        );
        s.mutate(|d| {
            d.worlds[0].last_played = Some(now());
            Ok(())
        })
        .unwrap();
        assert!(s.dispatch("saveWorld",json!({"id":w.id,"revision":w.revision,"name":w.name,"hardcore":true,"gamemode":"survival","difficulty":"hard"})).await.is_err());
    }

    #[test]
    fn legacy_gameplay_and_operator_defaults_preserve_normal_worlds() {
        let (_t, _s, w) = fixture();
        let mut old = serde_json::to_value(&w).unwrap();
        for field in [
            "hardcore",
            "pvp",
            "allowCommands",
            "forceGamemode",
            "coverBlock",
        ] {
            old.as_object_mut().unwrap().remove(field);
        }
        let old: World = serde_json::from_value(old).unwrap();
        assert!(
            old.pvp
                && !old.hardcore
                && !old.allow_commands
                && !old.force_gamemode
                && old.cover_block.is_none()
        );
        let player: Player = serde_json::from_value(json!({"uuid":id(),"name":"Birch"})).unwrap();
        assert!(!player.operator);
    }

    #[tokio::test]
    async fn gameplay_and_operator_choices_survive_backup_and_restore() {
        let (_t, s, w) = fixture();
        s.dispatch("saveWorld",json!({"id":w.id,"revision":w.revision,"name":w.name,
            "gamemode":"adventure","difficulty":"easy","pvp":false,"coverBlock":"portal","allowCommands":true})).await.unwrap();
        s.mutate(|d| {
            let mut p = crate::accounts::offline_player("Birch")?;
            p.operator = true;
            d.worlds[0].players = vec![p];
            d.worlds[0].online_mode = false;
            Ok(())
        })
        .unwrap();
        s.write_properties(&s.world(&w.id).unwrap()).unwrap();
        let backup = s.backup(&w.id, "test").await.unwrap();
        let restored = s.restore(&backup.id, "test").await.unwrap();
        assert_ne!(restored.id, w.id);
        assert_eq!(restored.gamemode, "adventure");
        assert_eq!(restored.cover_block.as_deref(), Some("portal"));
        assert!(!restored.pvp && restored.allow_commands && restored.players[0].operator);
        assert!(
            s.playtime(&restored.id, vec![now() - 86400, now() + 86400])
                .unwrap()
                .recorded_from
                .is_none()
        );
    }

    #[tokio::test]
    async fn offline_mode_backs_up_before_switching_and_preserves_player_data() {
        let (_t, s, w) = fixture();
        let original = Player {
            name: "Notch".into(),
            uuid: "069a79f4-44e9-4726-a5be-fca90e38aaf5".into(),
            operator: false,
            operator_level: 2,
            bypasses_player_limit: false,
        };
        s.mutate(|d| {
            d.worlds[0].players.push(original.clone());
            Ok(())
        })
        .unwrap();
        let dir = s.instance(&w.id).unwrap();
        fs::create_dir_all(dir.join("world/playerdata")).unwrap();
        let player_file = dir
            .join("world/playerdata")
            .join(format!("{}.dat", original.uuid));
        fs::write(&player_file, b"original inventory").unwrap();
        s.write_properties(&s.world(&w.id).unwrap()).unwrap();
        s.change_account_mode(&w.id, false, w.revision, "test")
            .await
            .unwrap();
        let changed = s.world(&w.id).unwrap();
        assert!(!changed.online_mode);
        assert_eq!(
            changed.players[0].uuid,
            "b50ad385-829d-3141-a216-7e7d7539ba7f"
        );
        assert_eq!(fs::read(&player_file).unwrap(), b"original inventory");
        let properties = fs::read_to_string(dir.join("server.properties")).unwrap();
        for line in [
            "online-mode=false",
            "enforce-secure-profile=false",
            "white-list=true",
            "enforce-whitelist=true",
        ] {
            assert!(properties.lines().any(|p| p == line));
        }
        let whitelist: Vec<Player> =
            serde_json::from_slice(&fs::read(dir.join("whitelist.json")).unwrap()).unwrap();
        assert_eq!(whitelist[0].uuid, changed.players[0].uuid);
        let backups = s.data().unwrap().backups;
        assert_eq!(backups.len(), 1);
        assert!(backups[0].world.online_mode);
        assert_eq!(backups[0].world.players[0].uuid, original.uuid);
        let restored = s.restore(&backups[0].id, "test").await.unwrap();
        assert!(restored.online_mode);
        assert_eq!(restored.players[0].uuid, original.uuid);
        assert_eq!(
            fs::read(
                s.instance(&restored.id)
                    .unwrap()
                    .join("world/playerdata")
                    .join(format!("{}.dat", original.uuid))
            )
            .unwrap(),
            b"original inventory"
        );
    }

    #[tokio::test]
    async fn mode_change_refuses_active_stale_and_failed_backup_cases() {
        let (_t, s, w) = fixture();
        assert!(
            s.change_account_mode(&w.id, false, w.revision + 1, "test")
                .await
                .is_err()
        );
        *s.session.lock().unwrap() = Some(SessionView {
            world_id: w.id.clone(),
            pid: Some(42),
            ..Default::default()
        });
        assert!(
            s.change_account_mode(&w.id, false, w.revision, "test")
                .await
                .is_err()
        );
        *s.session.lock().unwrap() = None;
        fs::remove_dir(s.root.join("backups")).unwrap();
        fs::write(s.root.join("backups"), b"blocked backup storage").unwrap();
        assert!(
            s.change_account_mode(&w.id, false, w.revision, "test")
                .await
                .is_err()
        );
        assert!(s.world(&w.id).unwrap().online_mode);
        assert!(s.data().unwrap().backups.is_empty());
        assert!(
            fs::read_to_string(s.instance(&w.id).unwrap().join("server.properties"))
                .unwrap()
                .lines()
                .any(|l| l == "online-mode=true")
        );
    }

    #[tokio::test]
    async fn offline_access_uses_exact_names_without_network_and_requires_stopping() {
        let (_t, mut s, w) = fixture();
        // Any unexpected account lookup would fail through this local proxy.
        s.client = reqwest::Client::builder()
            .proxy(reqwest::Proxy::all("http://127.0.0.1:9").unwrap())
            .timeout(std::time::Duration::from_secs(1))
            .build()
            .unwrap();
        s.change_account_mode(&w.id, false, w.revision, "test")
            .await
            .unwrap();
        s.set_player(&w.id, "Notch", false).await.unwrap();
        assert_eq!(
            s.world(&w.id).unwrap().players[0].uuid,
            "b50ad385-829d-3141-a216-7e7d7539ba7f"
        );
        s.set_player(&w.id, "notch", false).await.unwrap();
        let changed = s.world(&w.id).unwrap();
        assert_eq!(changed.players.len(), 1);
        assert_eq!(changed.players[0].name, "notch");
        assert_ne!(
            changed.players[0].uuid,
            "b50ad385-829d-3141-a216-7e7d7539ba7f"
        );
        // Returning to verified mode must resolve official accounts first.
        assert!(
            s.change_account_mode(&w.id, true, changed.revision, "test")
                .await
                .is_err()
        );
        assert!(!s.world(&w.id).unwrap().online_mode);
        assert_eq!(s.data().unwrap().backups.len(), 1);
        *s.session.lock().unwrap() = Some(SessionView {
            world_id: w.id.clone(),
            pid: Some(42),
            ..Default::default()
        });
        assert!(s.set_player(&w.id, "Alex", false).await.is_err());
        assert!(s.set_player(&w.id, "notch", true).await.is_err());
        *s.session.lock().unwrap() = None;
        s.set_player(&w.id, "notch", true).await.unwrap();
        let changed = s.world(&w.id).unwrap();
        assert!(changed.players.is_empty());
        s.change_account_mode(&w.id, true, changed.revision, "test")
            .await
            .unwrap();
        assert!(s.world(&w.id).unwrap().online_mode);
        let properties =
            fs::read_to_string(s.instance(&w.id).unwrap().join("server.properties")).unwrap();
        assert!(
            properties
                .lines()
                .any(|l| l == "enforce-secure-profile=true")
        );
    }

    #[test]
    fn legacy_worlds_and_new_world_requests_default_to_verified_accounts() {
        let (_t, s, w) = fixture();
        let mut old = serde_json::to_value(&w).unwrap();
        old.as_object_mut().unwrap().remove("onlineMode");
        assert!(serde_json::from_value::<World>(old).unwrap().online_mode);
        let input = json!({"name":"Another world","componentId":w.component.id,"memoryMb":2048,"maxPlayers":8,"port":25565,"acceptEula":true});
        let input: CreateWorld = serde_json::from_value(input).unwrap();
        assert!(input.online_mode);
        let created = s.create_world(input).unwrap();
        assert!(created.online_mode);
    }

    #[test]
    fn account_schema_upgrade_keeps_a_consistent_backup_for_old_data() {
        let (t, s, w) = fixture();
        let mut data = serde_json::to_value(s.data().unwrap()).unwrap();
        data["worlds"][0]
            .as_object_mut()
            .unwrap()
            .remove("onlineMode");
        s.db.lock()
            .unwrap()
            .execute(
                "UPDATE metadata SET schema_version=1,data=?1",
                [data.to_string()],
            )
            .unwrap();
        drop(s);
        let s = Service::new(t.path().join("data")).unwrap();
        assert!(s.world(&w.id).unwrap().online_mode);
        let schema: u32 =
            s.db.lock()
                .unwrap()
                .query_row("SELECT schema_version FROM metadata", [], |r| r.get(0))
                .unwrap();
        assert_eq!(schema, 3);
        let backups: Vec<_> = fs::read_dir(s.root.as_ref())
            .unwrap()
            .map(|r| r.unwrap().path())
            .filter(|p| {
                p.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("state-before-v3-")
            })
            .collect();
        assert_eq!(backups.len(), 1);
        let backup = Connection::open(&backups[0]).unwrap();
        let old_schema: u32 = backup
            .query_row("SELECT schema_version FROM metadata", [], |r| r.get(0))
            .unwrap();
        let old_data: String = backup
            .query_row("SELECT data FROM metadata", [], |r| r.get(0))
            .unwrap();
        assert_eq!(old_schema, 1);
        assert_eq!(serde_json::from_str::<Value>(&old_data).unwrap(), data);
    }

    #[test]
    fn schema_two_upgrade_preserves_real_rules_and_existing_operator_permissions() {
        let (t, s, w) = fixture();
        let dir = s.instance(&w.id).unwrap();
        let original_ops =
            json!([{"uuid":id(),"name":"Birch","level":4,"bypassesPlayerLimit":true}]);
        fs::write(
            dir.join("ops.json"),
            serde_json::to_vec(&original_ops).unwrap(),
        )
        .unwrap();
        fs::write(
            dir.join("server.properties"),
            b"pvp=false\nforce-gamemode=true\nhardcore=false\n",
        )
        .unwrap();
        let mut old = serde_json::to_value(s.data().unwrap()).unwrap();
        for key in [
            "hardcore",
            "pvp",
            "forceGamemode",
            "allowCommands",
            "coverBlock",
            "gameplayConfigured",
        ] {
            old["worlds"][0].as_object_mut().unwrap().remove(key);
        }
        s.db.lock()
            .unwrap()
            .execute(
                "UPDATE metadata SET schema_version=2,data=?1",
                [old.to_string()],
            )
            .unwrap();
        drop(s);
        let migrated = Service::new(t.path().join("data")).unwrap();
        let w = migrated.world(&w.id).unwrap();
        assert!(w.gameplay_configured && !w.pvp && w.force_gamemode && w.allow_commands);
        assert_eq!(w.players.len(), 1);
        assert_eq!(w.players[0].operator_level, 4);
        assert!(w.players[0].bypasses_player_limit);
        migrated.write_properties(&w).unwrap();
        let actual: Value =
            serde_json::from_slice(&fs::read(dir.join("ops.json")).unwrap()).unwrap();
        assert_eq!(actual, original_ops);
    }

    #[tokio::test]
    async fn imported_saved_hardcore_is_preserved_and_cannot_be_toggled() {
        use std::io::Write;
        let (t, s, w) = fixture();
        let source = t.path().join("server-import");
        fs::create_dir_all(source.join("world")).unwrap();
        let nbt = hex::decode("0a00000a00044461746101000868617264636f7265010000").unwrap();
        let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        gzip.write_all(&nbt).unwrap();
        fs::write(source.join("world/level.dat"), gzip.finish().unwrap()).unwrap();
        s.import_files(&w.id, &source, "server", "test")
            .await
            .unwrap();
        let imported = s.world(&w.id).unwrap();
        assert!(imported.hardcore);
        assert_eq!(imported.gamemode, "survival");
        assert_eq!(imported.difficulty, "hard");
        assert!(
            s.dispatch(
                "saveWorld",
                json!({"id":w.id,"revision":imported.revision,"name":w.name,"hardcore":false})
            )
            .await
            .is_err()
        );
        assert!(!s.data().unwrap().backups[0].world.hardcore);
    }

    #[test]
    fn newer_metadata_schema_is_never_silently_downgraded() {
        let (t, s, _) = fixture();
        s.db.lock()
            .unwrap()
            .execute("UPDATE metadata SET schema_version=99", [])
            .unwrap();
        drop(s);
        assert!(Service::new(t.path().join("data")).is_err());
        let db = Connection::open(t.path().join("data/state.sqlite")).unwrap();
        let schema: u32 = db
            .query_row("SELECT schema_version FROM metadata", [], |r| r.get(0))
            .unwrap();
        assert_eq!(schema, 99);
    }

    #[test]
    fn new_offline_worlds_configure_paper_and_fabric() {
        for engine in [Engine::Paper, Engine::Fabric] {
            let (_t, s, w) = fixture();
            s.mutate(|d| {
                d.components[0].engine = engine;
                Ok(())
            })
            .unwrap();
            let input = json!({"name":"Offline world","componentId":w.component.id,"memoryMb":2048,"maxPlayers":8,"port":25565,"acceptEula":true,"onlineMode":false});
            let created = s
                .create_world(serde_json::from_value(input).unwrap())
                .unwrap();
            assert!(!created.online_mode);
            let properties =
                fs::read_to_string(s.instance(&created.id).unwrap().join("server.properties"))
                    .unwrap();
            assert!(properties.lines().any(|l| l == "online-mode=false"));
            assert!(
                properties
                    .lines()
                    .any(|l| l == "enforce-secure-profile=false")
            );
            assert!(properties.lines().any(|l| l == "white-list=true"));
        }
    }

    #[tokio::test]
    async fn deletion_requires_exact_fresh_phrase() {
        let (_t, s, w) = fixture();
        let p = s.prepare_delete(&w.id, true).await.unwrap();
        assert!(
            s.confirm_delete(&p.token, "delete Mossy Hollow")
                .await
                .is_err()
        );
        assert!(s.instance(&w.id).unwrap().exists());
        let p = s.prepare_delete(&w.id, true).await.unwrap();
        s.mutate(|d| {
            d.worlds[0].revision += 1;
            Ok(())
        })
        .unwrap();
        assert!(s.confirm_delete(&p.token, &p.phrase).await.is_err());
        assert_eq!(s.data().unwrap().worlds.len(), 1);
    }
    #[tokio::test]
    async fn active_world_blocks_delete_and_uninstall() {
        let (_t, s, w) = fixture();
        *s.session.lock().unwrap() = Some(SessionView {
            world_id: w.id.clone(),
            pid: Some(123),
            state: "running".into(),
            ..Default::default()
        });
        assert!(s.prepare_delete(&w.id, true).await.is_err());
        assert!(s.uninstall(&w.component.id).await.is_err());
    }
    #[tokio::test]
    async fn deleting_world_preserves_restorable_backup() {
        let (_t, s, w) = fixture();
        let b = s.backup(&w.id, "test").await.unwrap();
        let p = s.prepare_delete(&w.id, true).await.unwrap();
        s.confirm_delete(&p.token, &p.phrase).await.unwrap();
        assert!(s.data().unwrap().worlds.is_empty());
        assert_eq!(s.data().unwrap().backups.len(), 1);
        let restored = s.restore(&b.id, "test").await.unwrap();
        assert_ne!(restored.id, w.id);
        assert_eq!(
            fs::read(
                s.instance(&restored.id)
                    .unwrap()
                    .join("world/DIM-1/region/chunk.mca")
            )
            .unwrap(),
            b"saved dimension"
        );
    }
    #[tokio::test]
    async fn corruption_blocks_restore() {
        let (_t, s, w) = fixture();
        let b = s.backup(&w.id, "test").await.unwrap();
        fs::write(
            s.root.join("backups").join(&b.id).join("instance.zip"),
            b"corrupt",
        )
        .unwrap();
        assert!(s.restore(&b.id, "test").await.is_err());
        assert_eq!(s.data().unwrap().worlds.len(), 1);
    }
    #[tokio::test]
    async fn uninstall_keeps_world_and_backups() {
        let (_t, s, w) = fixture();
        s.backup(&w.id, "test").await.unwrap();
        s.uninstall(&w.component.id).await.unwrap();
        assert_eq!(s.data().unwrap().worlds.len(), 1);
        assert_eq!(s.data().unwrap().backups.len(), 1);
        assert!(
            s.instance(&w.id)
                .unwrap()
                .join("world/DIM-1/region/chunk.mca")
                .exists()
        );
        assert!(s.data().unwrap().components.is_empty());
    }
    #[tokio::test]
    async fn delete_journal_recovers_after_quarantine() {
        let (t, s, w) = fixture();
        let p = s.prepare_delete(&w.id, true).await.unwrap();
        s.db.lock()
            .unwrap()
            .execute(
                "INSERT INTO journal VALUES(?1,?2)",
                rusqlite::params![p.token, serde_json::to_string(&p).unwrap()],
            )
            .unwrap();
        fs::rename(
            s.root.join("worlds").join(&w.id),
            s.root.join("quarantine").join(&p.token),
        )
        .unwrap();
        drop(s);
        let s = Service::new(t.path().join("data")).unwrap();
        assert!(s.data().unwrap().worlds.is_empty());
        assert!(!s.root.join("quarantine").join(&p.token).exists());
    }
    #[tokio::test]
    async fn explicit_backup_removal_is_not_resurrected() {
        let (t, s, w) = fixture();
        s.backup(&w.id, "test").await.unwrap();
        let p = s.prepare_delete(&w.id, false).await.unwrap();
        s.confirm_delete(&p.token, &p.phrase).await.unwrap();
        drop(s);
        let s = Service::new(t.path().join("data")).unwrap();
        assert!(s.data().unwrap().backups.is_empty());
    }
    #[test]
    fn instance_path_rejects_traversal() {
        let (_t, s, _) = fixture();
        assert!(s.instance("../../outside").is_err());
    }
    #[test]
    fn single_instance_lock() {
        let (t, _s, _w) = fixture();
        assert!(Service::new(t.path().join("data")).is_err());
    }
    #[tokio::test]
    async fn changed_backup_policy_needs_new_review() {
        let (_t, s, w) = fixture();
        let p = s.prepare_delete(&w.id, true).await.unwrap();
        s.backup(&w.id, "test").await.unwrap();
        assert!(s.confirm_delete(&p.token, &p.phrase).await.is_err());
        assert_eq!(s.data().unwrap().worlds.len(), 1);
    }
    #[tokio::test]
    async fn cleanup_preserves_selected_data_and_rejects_stale_inventory() {
        let (_t, s, w) = fixture();
        let b = s.backup(&w.id, "test").await.unwrap();
        let interrupted = s.root.join("components").join(id());
        fs::create_dir_all(&interrupted).unwrap();
        fs::write(interrupted.join("server.part"), b"interrupted download").unwrap();
        assert!(
            s.remove_managed_data(
                "REMOVE ENDERLINK DATA",
                vec![w.id.clone()],
                vec![],
                true,
                true
            )
            .await
            .is_err()
        );
        assert!(
            s.remove_managed_data("remove", vec![w.id.clone()], vec![b.id.clone()], true, true)
                .await
                .is_err()
        );
        s.remove_managed_data(
            "REMOVE ENDERLINK DATA",
            vec![w.id.clone()],
            vec![b.id.clone()],
            true,
            true,
        )
        .await
        .unwrap();
        assert_eq!(s.data().unwrap().worlds.len(), 1);
        assert_eq!(s.data().unwrap().backups.len(), 1);
        assert!(s.data().unwrap().components.is_empty());
        assert!(!interrupted.exists());
        assert!(
            s.instance(&w.id)
                .unwrap()
                .join("world/DIM-1/region/chunk.mca")
                .exists()
        );
        s.remove_managed_data(
            "REMOVE ENDERLINK DATA",
            vec![w.id.clone()],
            vec![b.id.clone()],
            false,
            false,
        )
        .await
        .unwrap();
        assert!(s.data().unwrap().worlds.is_empty());
        assert!(s.data().unwrap().backups.is_empty());
    }
    #[tokio::test]
    async fn server_import_replaces_instance_backs_up_and_normalizes_level_name() {
        let (t, s, w) = fixture();
        let source = t.path().join("pack");
        fs::create_dir_all(source.join("adventure/region")).unwrap();
        fs::write(source.join("adventure/region/new.mca"), b"new world").unwrap();
        fs::write(
            source.join("server.properties"),
            "level-name=adventure\nonline-mode=false\nwhite-list=false",
        )
        .unwrap();
        s.import_files(&w.id, &source, "server", "test")
            .await
            .unwrap();
        let dir = s.instance(&w.id).unwrap();
        assert_eq!(
            fs::read(dir.join("world/region/new.mca")).unwrap(),
            b"new world"
        );
        assert!(!dir.join("world/DIM-1/region/chunk.mca").exists());
        let properties = fs::read_to_string(dir.join("server.properties")).unwrap();
        assert!(properties.contains("online-mode=true"));
        assert!(!properties.contains("online-mode=false"));
        let b = s.data().unwrap().backups[0].clone();
        let restored = s.restore(&b.id, "test").await.unwrap();
        assert!(
            s.instance(&restored.id)
                .unwrap()
                .join("world/DIM-1/region/chunk.mca")
                .exists()
        );
    }
    #[test]
    fn interrupted_import_recovers_previous_instance() {
        let (t, s, w) = fixture();
        let dir = s.instance(&w.id).unwrap();
        fs::rename(&dir, dir.with_file_name("import-previous")).unwrap();
        drop(s);
        let s = Service::new(t.path().join("data")).unwrap();
        assert!(
            s.instance(&w.id)
                .unwrap()
                .join("world/DIM-1/region/chunk.mca")
                .exists()
        );
    }
    #[tokio::test]
    async fn diagnostic_report_excludes_private_state() {
        let (t, s, _) = fixture();
        *s.secret.lock().unwrap() = Some("SECRET_DO_NOT_EXPORT".into());
        s.log("SECRET_LOG");
        s.provider
            .lock()
            .unwrap()
            .endpoints
            .push("PRIVATE_ADDRESS".into());
        let path = t.path().join("report.json");
        s.dispatch("exportDiagnostics", json!({"path":path}))
            .await
            .unwrap();
        let report = fs::read_to_string(path).unwrap();
        for private in ["SECRET", "PRIVATE", "Mossy Hollow"] {
            assert!(!report.contains(private));
        }
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn owned_process_becomes_ready_and_saves_before_shutdown() {
        use std::os::unix::fs::PermissionsExt;
        let (_t, s, mut w) = fixture();
        let java = s.root.join("java/21/bin/java");
        fs::create_dir_all(java.parent().unwrap()).unwrap();
        fs::write(&java, br#"#!/bin/sh
printf '\033[33m[20:11:12 INFO]: \033[0mDone (0.02s)! For help, type help\n'
while IFS= read -r command; do
  if [ "$command" = list ]; then
    printf '\033[33m[20:11:12 INFO]: \033[0mThere are 1 of a max of 8 players online: \033[35mSteve\033[0m\n'
  fi
  if [ "$command" = stop ]; then
    printf '[20:11:14 INFO]: Steve left the game\n'
    printf 'saved' > saved-on-stop
    exit 0
  fi
done
"#).unwrap();
        fs::set_permissions(&java, fs::Permissions::from_mode(0o700)).unwrap();
        let jar = s.component_jar(&w.component);
        fs::create_dir_all(jar.parent().unwrap()).unwrap();
        fs::write(&jar, b"synthetic JAR for process test").unwrap();
        w.component.sha256 = files::hash(&jar).unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        w.port = listener.local_addr().unwrap().port();
        drop(listener);
        w.online_mode = false;
        s.mutate(|d| {
            d.components[0] = w.component.clone();
            d.worlds[0] = w.clone();
            Ok(())
        })
        .unwrap();
        s.start_world(&w.id, "test").await.unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                if s.session.lock().unwrap().as_ref().is_some_and(|s| {
                    s.state == "running" && s.players_known && s.players == ["Steve"]
                }) {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        assert!(s.prepare_delete(&w.id, true).await.is_err());
        s.stop_world().await.unwrap();
        assert!(s.process.lock().await.is_none());
        assert!(!s.root.join("server-owner.json").exists());
        assert_eq!(
            fs::read(s.instance(&w.id).unwrap().join("saved-on-stop")).unwrap(),
            b"saved"
        );
    }
    #[tokio::test]
    async fn appearance_patches_preserve_worlds_and_other_preferences() {
        let (t, s, w) = fixture();
        s.dispatch(
            "patchSettings",
            json!({"stars":false,"glass":false,"reducedMotion":true,"starMotion":"float","starSpeed":"lively","starShimmer":false,"glassOpacity":"frosted"}),
        )
        .await
        .unwrap();
        s.dispatch("patchSettings", json!({"memoryMb":6144}))
            .await
            .unwrap();
        let d = s.data().unwrap();
        assert!(!d.settings.stars && !d.settings.glass && d.settings.reduced_motion);
        assert_eq!(d.settings.memory_mb, 6144);
        assert_eq!(d.settings.star_motion, "float");
        assert_eq!(d.settings.star_speed, "lively");
        assert!(!d.settings.star_shimmer);
        assert_eq!(d.settings.glass_opacity, "frosted");
        assert_eq!(d.worlds[0].id, w.id);
        assert!(
            s.dispatch("patchSettings", json!({"starDensity":"unbounded"}))
                .await
                .is_err()
        );
        drop(s);
        let s = Service::new(t.path().join("data")).unwrap();
        assert!(!s.data().unwrap().settings.stars);
        assert_eq!(s.data().unwrap().settings.star_speed, "lively");
        for patch in [
            json!({"starMotion":"teleport"}),
            json!({"starSpeed":"unbounded"}),
            json!({"glassOpacity":"invisible"}),
        ] {
            assert!(s.dispatch("patchSettings", patch).await.is_err());
        }
    }
    #[test]
    fn old_settings_gain_effect_defaults_without_losing_configuration() {
        let old = json!({"defaultEngine":"fabric","memoryMb":6144,"reducedMotion":true,"preventSleep":true,"savedServers":["example.net"]});
        let settings: Settings = serde_json::from_value(old).unwrap();
        assert!(settings.glass && settings.stars && settings.reduced_motion);
        assert_eq!(settings.star_motion, "wander");
        assert_eq!(settings.star_speed, "balanced");
        assert!(settings.star_shimmer);
        assert_eq!(settings.glass_opacity, "clear");
        assert_eq!(settings.memory_mb, 6144);
        assert_eq!(settings.default_engine, Engine::Fabric);
        assert!(settings.prevent_sleep);
    }
    #[tokio::test]
    async fn update_checks_reuse_cached_observations_without_changing_pins() {
        let (_t, s, w) = fixture();
        let observed = SoftwareUpdate {
            component_id: w.component.id.clone(),
            latest: Some("133".into()),
            status: "updateAvailable".into(),
            checked_at: now(),
        };
        *s.software_updates.lock().unwrap() = vec![observed];
        let checked = s.check_updates(false).await.unwrap();
        assert_eq!(checked[0].latest.as_deref(), Some("133"));
        assert_eq!(s.world(&w.id).unwrap().component.version, "132");
    }
}
