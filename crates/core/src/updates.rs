use crate::{Service, downloads::numbers, model::*};
use anyhow::Result;
impl Service {
    pub async fn check_updates(&self, force: bool) -> Result<Vec<SoftwareUpdate>> {
        let _check = self.update_check.lock().await;
        let components = self.data()?.components;
        let current = self.software_updates.lock().unwrap().clone();
        let mut result = vec![];
        let mut catalogs = std::collections::HashMap::new();
        for c in &components {
            if !force
                && let Some(old) = current
                    .iter()
                    .find(|u| u.component_id == c.id && now().saturating_sub(u.checked_at) < 900)
            {
                result.push(old.clone());
                continue;
            }
            let key = format!("{}:{}", c.engine.label(), c.minecraft);
            if !catalogs.contains_key(&key) {
                let versions = self.versions(c.engine.clone(), &c.minecraft).await.ok();
                catalogs.insert(key.clone(), versions);
            }
            let latest = catalogs[&key]
                .as_ref()
                .and_then(|v| v.iter().max_by_key(|v| numbers(&v.version)))
                .map(|v| v.version.clone());
            let status = match &latest {
                Some(v) if numbers(v) > numbers(&c.version) => "updateAvailable",
                Some(_) => "upToDate",
                None => "unavailable",
            };
            let u = SoftwareUpdate {
                component_id: c.id.clone(),
                latest,
                status: status.into(),
                checked_at: now(),
            };
            result.push(u);
        }
        *self.software_updates.lock().unwrap() = result.clone();
        Ok(result)
    }
}
