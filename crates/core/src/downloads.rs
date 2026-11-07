use crate::{files, model::*, service::Service};
use anyhow::{Context, Result, ensure};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tokio::io::AsyncWriteExt;
impl Service {
    pub async fn minecraft_versions(&self, engine: Engine) -> Result<Vec<String>> {
        let v: Value = match engine {
            Engine::Paper => {
                self.json("https://fill.papermc.io/v3/projects/paper")
                    .await?
            }
            Engine::Fabric => {
                self.json("https://meta.fabricmc.net/v2/versions/game")
                    .await?
            }
        };
        let mut result: Vec<String> = vec![];
        if engine == Engine::Paper {
            if let Some(map) = v["versions"].as_object() {
                for values in map.values() {
                    if let Some(a) = values.as_array() {
                        for item in a {
                            if let Some(s) = item.as_str() {
                                result.push(s.into());
                            }
                        }
                    }
                }
            }
        } else if let Some(a) = v.as_array() {
            for x in a {
                if x["stable"].as_bool() == Some(true)
                    && let Some(s) = x["version"].as_str()
                {
                    result.push(s.into());
                }
            }
        }
        result.retain(|s| supported(s));
        result.sort_by_key(|s| std::cmp::Reverse(numbers(s)));
        result.dedup();
        result.truncate(80);
        Ok(result)
    }
    pub async fn versions(&self, engine: Engine, mc: &str) -> Result<Vec<Version>> {
        ensure!(
            supported(mc),
            "Select a supported stable Minecraft release (1.18 or newer)."
        );
        let java = java_major(&engine, mc);
        let mut versions = vec![];
        match engine {
            Engine::Paper => {
                let v: Value = self
                    .json(&format!(
                        "https://fill.papermc.io/v3/projects/paper/versions/{mc}/builds"
                    ))
                    .await?;
                for b in v.as_array().context("Unexpected Paper catalog")? {
                    if b["channel"].as_str() != Some("STABLE") {
                        continue;
                    }
                    let a = &b["downloads"]["server:default"];
                    if let (Some(url), Some(sha), Some(build)) = (
                        a["url"].as_str(),
                        a["checksums"]["sha256"].as_str(),
                        b["id"].as_u64(),
                    ) {
                        versions.push(Version {
                            engine: engine.clone(),
                            minecraft: mc.into(),
                            version: build.to_string(),
                            java_major: java,
                            url: url.into(),
                            sha256: Some(sha.into()),
                            size: a["size"].as_u64(),
                        })
                    }
                }
            }
            Engine::Fabric => {
                let loaders: Value = self
                    .json(&format!(
                        "https://meta.fabricmc.net/v2/versions/loader/{mc}"
                    ))
                    .await?;
                let installers: Value = self
                    .json("https://meta.fabricmc.net/v2/versions/installer")
                    .await?;
                let installer = installers
                    .as_array()
                    .and_then(|a| a.iter().find(|v| v["stable"].as_bool() == Some(true)))
                    .and_then(|v| v["version"].as_str())
                    .context("No stable Fabric installer available")?;
                for l in loaders
                    .as_array()
                    .context("Unexpected Fabric catalog")?
                    .iter()
                    .filter(|l| l["loader"]["stable"].as_bool() == Some(true))
                {
                    let version = l["loader"]["version"]
                        .as_str()
                        .context("Invalid Fabric version")?;
                    let required = java
                        .max(l["launcherMeta"]["min_java_version"].as_u64().unwrap_or(8) as u32);
                    versions.push(Version{engine:engine.clone(),minecraft:mc.into(),version:version.into(),java_major:required,url:format!("https://meta.fabricmc.net/v2/versions/loader/{mc}/{version}/{installer}/server/jar"),sha256:None,size:None})
                }
            }
        }
        versions.sort_by_key(|v| std::cmp::Reverse(numbers(&v.version)));
        versions.dedup_by(|a, b| a.version == b.version);
        Ok(versions)
    }
    pub async fn install(
        &self,
        engine: Engine,
        mc: &str,
        version: &str,
        op: &str,
    ) -> Result<Component> {
        if let Some(c) = self
            .data()?
            .components
            .iter()
            .find(|c| c.engine == engine && c.minecraft == mc && c.version == version)
            .cloned()
            && files::hash(&self.component_jar(&c)).is_ok_and(|h| h == c.sha256)
        {
            self.ensure_java(c.java_major, op).await?;
            return Ok(c);
        }
        let data = self.data()?;
        let pinned = data
            .components
            .iter()
            .chain(data.worlds.iter().map(|w| &w.component))
            .chain(data.backups.iter().map(|b| &b.world.component))
            .find(|c| c.engine == engine && c.minecraft == mc && c.version == version)
            .cloned();
        let v = if let Some(c) = pinned.as_ref().filter(|c| c.source_url.is_some()) {
            Version {
                engine: engine.clone(),
                minecraft: mc.into(),
                version: version.into(),
                java_major: c.java_major,
                url: c.source_url.clone().unwrap(),
                sha256: Some(c.sha256.clone()),
                size: Some(c.bytes),
            }
        } else {
            self.versions(engine, mc)
                .await?
                .into_iter()
                .find(|v| v.version == version)
                .context("This stable engine version is no longer listed by its official source.")?
        };
        self.ensure_java(v.java_major, op).await?;
        self.progress(op, "Downloading server software", None);
        let id = pinned.as_ref().map(|c| c.id.clone()).unwrap_or_else(id);
        uuid::Uuid::parse_str(&id)?;
        let dir = self.root.join("components").join(&id);
        files::owned(&self.root, &dir)?;
        fs::create_dir_all(&dir)?;
        let jar = dir.join("server.jar");
        if let Err(e) = self
            .download(&v.url, &jar, v.sha256.as_deref(), 500_000_000, op)
            .await
        {
            let _ = fs::remove_dir_all(dir);
            return Err(e);
        }
        let mut magic = [0u8; 2];
        use std::io::Read;
        fs::File::open(&jar)?.read_exact(&mut magic)?;
        ensure!(
            &magic == b"PK",
            "Official server artifact is not a JAR archive."
        );
        let c = Component {
            id,
            engine: v.engine,
            minecraft: v.minecraft,
            version: v.version,
            java_major: v.java_major,
            sha256: files::hash(&jar)?,
            bytes: fs::metadata(&jar)?.len(),
            installed_at: now(),
            source_url: Some(v.url),
        };
        self.mutate(|d| {
            d.components.retain(|old| old.id != c.id);
            d.components.push(c.clone());
            Ok(())
        })?;
        Ok(c)
    }
    pub fn component_jar(&self, c: &Component) -> PathBuf {
        self.root.join("components").join(&c.id).join("server.jar")
    }
    pub async fn json(&self, url: &str) -> Result<Value> {
        let mut r = self
            .client
            .get(url)
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await?
            .error_for_status()?;
        ensure!(
            r.content_length().unwrap_or(0) < 12_000_000,
            "Metadata response too large"
        );
        let mut bytes = Vec::new();
        while let Some(chunk) = r.chunk().await? {
            ensure!(
                bytes.len() + chunk.len() < 12_000_000,
                "Metadata response too large"
            );
            bytes.extend_from_slice(&chunk);
        }
        Ok(serde_json::from_slice(&bytes)?)
    }
    pub async fn download(
        &self,
        url: &str,
        dest: &Path,
        expected: Option<&str>,
        limit: u64,
        op: &str,
    ) -> Result<()> {
        ensure!(url.starts_with("https://"), "Downloads must use HTTPS");
        let mut response = self.client.get(url).send().await?.error_for_status()?;
        let total = response.content_length();
        ensure!(total.unwrap_or(0) <= limit, "Download is too large");
        if let Some(total) = total {
            ensure!(
                fs2::available_space(self.root.as_ref())? > total.saturating_mul(3),
                "Not enough free disk space for this download"
            );
        }
        let part = dest.with_extension("part");
        let mut f = tokio::fs::File::create(&part).await?;
        let mut received = 0u64;
        while let Some(chunk) = response.chunk().await? {
            self.check_cancel(op)?;
            received += chunk.len() as u64;
            ensure!(received <= limit, "Download exceeds its allowed size");
            f.write_all(&chunk).await?;
            self.progress(
                op,
                "Downloading verified source",
                total.map(|t| received as f64 / t as f64),
            );
        }
        f.sync_all().await?;
        drop(f);
        if let Some(expected) = expected {
            ensure!(
                files::hash(&part)?.eq_ignore_ascii_case(expected),
                "Download checksum mismatch; the artifact was not installed."
            );
        }
        tokio::fs::rename(part, dest).await?;
        Ok(())
    }
    pub async fn ensure_java(&self, major: u32, op: &str) -> Result<PathBuf> {
        let base = self.root.join("java").join(major.to_string());
        if let Some(p) = java_in(&base) {
            return Ok(p);
        }
        self.progress(op, &format!("Preparing Java {major}"), None);
        let os = match std::env::consts::OS {
            "macos" => "mac",
            "windows" => "windows",
            "linux" => "linux",
            _ => anyhow::bail!("Unsupported Java platform"),
        };
        let arch = match std::env::consts::ARCH {
            "aarch64" => "aarch64",
            "x86_64" => "x64",
            _ => anyhow::bail!("Unsupported CPU architecture"),
        };
        let url = format!(
            "https://api.adoptium.net/v3/assets/latest/{major}/hotspot?architecture={arch}&image_type=jre&os={os}"
        );
        let v = self.json(&url).await?;
        let pkg = v
            .as_array()
            .and_then(|a| a.first())
            .context("No compatible managed Java runtime available")?["binary"]["package"]
            .clone();
        let link = pkg["link"].as_str().context("No Java download")?;
        let checksum = pkg["checksum"].as_str().context("No Java checksum")?;
        let stage = self.root.join("staging").join(id());
        fs::create_dir_all(&stage)?;
        let archive = stage.join(if os == "windows" {
            "java.zip"
        } else {
            "java.tar.gz"
        });
        self.download(link, &archive, Some(checksum), 400_000_000, op)
            .await?;
        let extracted = stage.join("runtime");
        fs::create_dir_all(&extracted)?;
        let src = archive.clone();
        let dst = extracted.clone();
        tokio::task::spawn_blocking(move || {
            if os == "windows" {
                files::unzip(&src, &dst, 2_000_000_000)
            } else {
                files::tar_gz(&src, &dst)
            }
        })
        .await??;
        ensure!(
            java_in(&extracted).is_some(),
            "Java archive is missing the runtime executable"
        );
        if base.exists() {
            fs::remove_dir_all(&base)?;
        }
        fs::rename(&extracted, &base)?;
        let _ = fs::remove_dir_all(stage);
        java_in(&base).context("Java installation failed")
    }
}
fn java_in(root: &Path) -> Option<PathBuf> {
    walkdir::WalkDir::new(root)
        .max_depth(6)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .find(|e| {
            e.file_type().is_file()
                && e.file_name() == if cfg!(windows) { "java.exe" } else { "java" }
                && e.path()
                    .parent()
                    .and_then(Path::file_name)
                    .is_some_and(|s| s == "bin")
        })
        .map(|e| e.into_path())
}
pub fn numbers(s: &str) -> Vec<u32> {
    s.split('.').map(|x| x.parse().unwrap_or(0)).collect()
}
fn supported(s: &str) -> bool {
    let n = numbers(s);
    s.chars().all(|c| c.is_ascii_digit() || c == '.')
        && n.len() >= 2
        && ((n[0] == 1 && n[1] >= 18) || n[0] >= 26)
}
fn java_major(e: &Engine, s: &str) -> u32 {
    let n = numbers(s);
    if n[0] >= 26 {
        25
    } else if n[1] >= 21
        || (n[1] == 20 && (e == &Engine::Paper || n.get(2).copied().unwrap_or(0) >= 5))
    {
        21
    } else {
        17
    }
}
