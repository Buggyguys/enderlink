use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use unicode_normalization::UnicodeNormalization;
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
pub fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
pub fn name(s: &str) -> Result<String> {
    let n = s.trim().nfc().collect::<String>();
    ensure!(
        !n.is_empty() && n.chars().count() <= 64 && !n.chars().any(char::is_control),
        "Use a world name of 1–64 characters without control characters."
    );
    Ok(n)
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    Paper,
    Fabric,
}
impl Engine {
    pub fn label(&self) -> &str {
        match self {
            Self::Paper => "Paper",
            Self::Fabric => "Fabric",
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Component {
    pub id: String,
    pub engine: Engine,
    pub minecraft: String,
    pub version: String,
    pub java_major: u32,
    pub sha256: String,
    pub bytes: u64,
    pub installed_at: u64,
    #[serde(default)]
    pub source_url: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub uuid: String,
    pub name: String,
    #[serde(default)]
    pub operator: bool,
    #[serde(default = "default_operator_level")]
    pub operator_level: u8,
    #[serde(default)]
    pub bypasses_player_limit: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct World {
    pub id: String,
    pub name: String,
    pub revision: u64,
    pub component: Component,
    pub memory_mb: u32,
    pub max_players: u32,
    pub port: u16,
    pub lan: bool,
    #[serde(default = "verified_accounts")]
    pub online_mode: bool,
    pub seed: String,
    pub difficulty: String,
    pub gamemode: String,
    #[serde(default)]
    pub hardcore: bool,
    #[serde(default = "verified_accounts")]
    pub pvp: bool,
    #[serde(default)]
    pub allow_commands: bool,
    #[serde(default)]
    pub force_gamemode: bool,
    #[serde(default)]
    pub cover_block: Option<String>,
    #[serde(default)]
    pub gameplay_configured: bool,
    pub eula_accepted_at: u64,
    pub players: Vec<Player>,
    pub created_at: u64,
    pub last_played: Option<u64>,
    pub pack_notes: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub id: String,
    pub world: World,
    pub created_at: u64,
    pub bytes: u64,
    pub sha256: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub default_engine: Engine,
    pub memory_mb: u32,
    pub reduced_motion: bool,
    pub glass: bool,
    pub stars: bool,
    pub star_density: String,
    pub star_motion: String,
    pub star_speed: String,
    pub star_shimmer: bool,
    pub glass_opacity: String,
    pub motion_speed: String,
    pub prevent_sleep: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            default_engine: Engine::Paper,
            memory_mb: 4096,
            reduced_motion: false,
            glass: true,
            stars: true,
            star_density: "medium".into(),
            star_motion: "wander".into(),
            star_speed: "balanced".into(),
            star_shimmer: true,
            glass_opacity: "clear".into(),
            motion_speed: "gentle".into(),
            prevent_sleep: false,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Data {
    pub worlds: Vec<World>,
    pub components: Vec<Component>,
    pub backups: Vec<Backup>,
    pub settings: Settings,
    #[serde(default)]
    pub provider_setup: ProviderSetup,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSetup {
    pub tunnel_configured: bool,
    pub checked_at: Option<u64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareUpdate {
    pub component_id: String,
    pub latest: Option<String>,
    pub status: String,
    pub checked_at: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub id: String,
    pub label: String,
    pub status: String,
    pub message: String,
    pub progress: Option<f64>,
    pub started_at: u64,
    pub finished_at: Option<u64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub world_id: String,
    pub state: String,
    pub started_at: u64,
    pub pid: Option<u32>,
    pub memory_bytes: u64,
    pub cpu_percent: f32,
    pub players: Vec<String>,
    #[serde(default)]
    pub players_known: bool,
    pub error: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderView {
    pub linked: bool,
    pub persisted: bool,
    pub agent_registered: bool,
    pub state: String,
    pub endpoints: Vec<String>,
    pub error: Option<String>,
    pub claim_url: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    #[serde(flatten)]
    pub data: Data,
    pub session: Option<SessionView>,
    pub provider: ProviderView,
    pub operations: Vec<Operation>,
    pub logs: Vec<String>,
    pub data_dir: String,
    pub total_memory: u64,
    pub memory: crate::memory::MemorySnapshot,
    pub software_updates: Vec<SoftwareUpdate>,
    pub warnings: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    pub engine: Engine,
    pub minecraft: String,
    pub version: String,
    pub java_major: u32,
    pub url: String,
    pub sha256: Option<String>,
    pub size: Option<u64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorld {
    pub name: String,
    pub component_id: String,
    pub memory_mb: u32,
    pub max_players: u32,
    pub port: u16,
    #[serde(default)]
    pub lan: bool,
    #[serde(default = "verified_accounts")]
    pub online_mode: bool,
    #[serde(default)]
    pub seed: String,
    #[serde(default = "survival")]
    pub gamemode: String,
    #[serde(default = "normal")]
    pub difficulty: String,
    #[serde(default)]
    pub hardcore: bool,
    #[serde(default = "verified_accounts")]
    pub pvp: bool,
    #[serde(default)]
    pub allow_commands: bool,
    #[serde(default)]
    pub force_gamemode: bool,
    #[serde(default)]
    pub cover_block: Option<String>,
    pub accept_eula: bool,
    #[serde(default)]
    pub pack_notes: String,
}
pub(crate) fn default_operator_level() -> u8 {
    2
}
fn survival() -> String {
    "survival".into()
}
fn verified_accounts() -> bool {
    true
}
fn normal() -> String {
    "normal".into()
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletePlan {
    pub token: String,
    pub world_id: String,
    pub revision: u64,
    pub phrase: String,
    pub keep_backups: bool,
    pub backup_ids: Vec<String>,
    pub expires_at: u64,
}
