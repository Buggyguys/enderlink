use crate::{files, model::*, service::Service};
use anyhow::{Context, Result, ensure};
use std::fs;
impl Service {
    pub fn delete_backup(&self, id: &str, phrase: &str) -> Result<()> {
        let b = self
            .data()?
            .backups
            .into_iter()
            .find(|b| b.id == id)
            .context("Backup no longer exists")?;
        ensure!(
            phrase == format!("DELETE BACKUP {}", b.world.name),
            "Type the exact backup deletion phrase."
        );
        uuid::Uuid::parse_str(id)?;
        let path = self.root.join("backups").join(id);
        files::owned(&self.root, &path)?;
        if path.exists() {
            fs::remove_dir_all(path)?;
        }
        self.mutate(|d| {
            d.backups.retain(|b| b.id != id);
            Ok(())
        })?;
        Ok(())
    }
    pub async fn remove_managed_data(
        &self,
        phrase: &str,
        world_ids: Vec<String>,
        backup_ids: Vec<String>,
        keep_worlds: bool,
        keep_backups: bool,
    ) -> Result<()> {
        ensure!(
            phrase == "REMOVE ENDERLINK DATA",
            "Type REMOVE ENDERLINK DATA to confirm."
        );
        ensure!(
            self.process.lock().await.is_none() && self.orphan.lock().unwrap().is_none(),
            "Stop all server processes before cleanup."
        );
        let d = self.data()?;
        let mut actual_worlds: Vec<_> = d.worlds.iter().map(|w| w.id.clone()).collect();
        let mut actual_backups: Vec<_> = d.backups.iter().map(|b| b.id.clone()).collect();
        let mut worlds = world_ids;
        let mut backups = backup_ids;
        actual_worlds.sort();
        actual_backups.sort();
        worlds.sort();
        backups.sort();
        ensure!(
            worlds == actual_worlds && backups == actual_backups,
            "Stored worlds or backups changed. Review cleanup again."
        );
        self.disconnect_provider()?;
        if !keep_worlds {
            for w in &d.worlds {
                let p = self.prepare_delete(&w.id, keep_backups).await?;
                self.confirm_delete(&p.token, &p.phrase).await?;
            }
        }
        if !keep_backups {
            for b in self.data()?.backups {
                self.delete_backup(&b.id, &format!("DELETE BACKUP {}", b.world.name))?;
            }
        }
        for c in self.data()?.components {
            self.uninstall(&c.id).await?;
        }
        for name in ["components", "java", "staging"] {
            let path = self.root.join(name);
            files::owned(&self.root, &path)?;
            if path.exists() {
                fs::remove_dir_all(&path)?;
            }
            fs::create_dir_all(path)?;
        }
        self.mutate(|d| {
            d.settings = Settings::default();
            Ok(())
        })?;
        Ok(())
    }
}
