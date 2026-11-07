//! Local, bounded-frequency memory accounting. Command lines never leave this module.
use crate::model::now;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySnapshot {
    pub total: u64,
    pub available: u64,
    pub used: u64,
    pub app: u64,
    pub server: u64,
    pub minecraft_clients: u64,
    pub client_count: usize,
    pub other: u64,
    pub observed_at: u64,
    pub partial_process_visibility: bool,
}
pub struct MemorySampler {
    system: System,
    last: Option<Instant>,
    current: MemorySnapshot,
    last_server: Option<u32>,
}
impl Default for MemorySampler {
    fn default() -> Self {
        Self {
            system: System::new(),
            last: None,
            current: MemorySnapshot::default(),
            last_server: None,
        }
    }
}
fn is_client(name: &str, args: &[String]) -> bool {
    let name = name.to_ascii_lowercase();
    if !matches!(name.as_str(), "java" | "java.exe" | "javaw" | "javaw.exe") {
        return false;
    }
    args.iter().any(|a| {
        a == "net.minecraft.client.main.Main"
            || a.ends_with(".KnotClient")
            || a == "net.minecraft.launchwrapper.Launch" && args.iter().any(|a| a == "--gameDir")
    }) || args.windows(2).any(|a| {
        a[0] == "--launchTarget"
            && ["forgeclient", "neoforgeclient", "fmlclient"].contains(&a[1].as_str())
    })
}
fn descendant(system: &System, mut pid: Pid, root: Pid) -> bool {
    for _ in 0..64 {
        if pid == root {
            return true;
        }
        let Some(parent) = system.process(pid).and_then(|p| p.parent()) else {
            return false;
        };
        if parent == pid {
            return false;
        }
        pid = parent;
    }
    false
}
impl MemorySampler {
    pub fn sample(&mut self, server_pid: Option<u32>) -> MemorySnapshot {
        if self
            .last
            .is_some_and(|t| t.elapsed() < Duration::from_secs(5))
            && self.last_server == server_pid
        {
            return self.current.clone();
        }
        self.system.refresh_memory();
        self.system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing()
                .without_tasks()
                .with_memory()
                .with_cmd(UpdateKind::OnlyIfNotSet),
        );
        let total = self.system.total_memory();
        let available = self.system.available_memory().min(total);
        let used = total - available;
        let mut result = MemorySnapshot {
            total,
            available,
            used,
            observed_at: now(),
            ..Default::default()
        };
        let own = Pid::from_u32(std::process::id());
        for (pid, p) in self.system.processes() {
            if server_pid.is_some_and(|s| descendant(&self.system, *pid, Pid::from_u32(s))) {
                result.server = result.server.saturating_add(p.memory());
            } else if descendant(&self.system, *pid, own) {
                result.app = result.app.saturating_add(p.memory());
            } else {
                let name = p.name().to_string_lossy();
                let args: Vec<_> = p
                    .cmd()
                    .iter()
                    .map(|s| s.to_string_lossy().into_owned())
                    .collect();
                if is_client(&name, &args) {
                    result.minecraft_clients = result.minecraft_clients.saturating_add(p.memory());
                    result.client_count += 1;
                }
                if name.to_ascii_lowercase().starts_with("java") && args.is_empty() {
                    result.partial_process_visibility = true;
                }
            }
        }
        result.other = used.saturating_sub(
            result
                .app
                .saturating_add(result.server)
                .saturating_add(result.minecraft_clients),
        );
        self.current = result.clone();
        self.last = Some(Instant::now());
        self.last_server = server_pid;
        result
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_recognizes_java_game_clients() {
        assert!(is_client(
            "javaw.exe",
            &["net.minecraft.client.main.Main".into()]
        ));
        assert!(is_client(
            "java",
            &["net.fabricmc.loader.impl.launch.knot.KnotClient".into()]
        ));
        assert!(is_client(
            "java",
            &["--launchTarget".into(), "neoforgeclient".into()]
        ));
        assert!(!is_client(
            "java",
            &["-jar".into(), "minecraft-server.jar".into()]
        ));
        assert!(!is_client(
            "java",
            &["/home/minecraft/another-app.jar".into()]
        ));
        assert!(!is_client(
            "node",
            &["net.minecraft.client.main.Main".into()]
        ));
    }
    #[test]
    fn sampling_reports_real_memory_and_reuses_sample() {
        let mut s = MemorySampler::default();
        let a = s.sample(None);
        assert!(a.total > 0);
        assert!(a.available <= a.total);
        assert_eq!(a.used + a.available, a.total);
        assert_eq!(s.sample(None).observed_at, a.observed_at);
    }
}
