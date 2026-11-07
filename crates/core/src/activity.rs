//! Connected-time observations, deliberately independent of Minecraft account lookup.
//! A checkpoint updates the end of an existing connection span; it never counts
//! time after the last observation or tries to reconstruct old server sessions.
use crate::{accounts::offline_player, model::World, service::Service};
use anyhow::{Result, ensure};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    time::{Duration, Instant},
};

const CHECKPOINT: Duration = Duration::from_secs(30);
const MAX_OBSERVATION_GAP: Duration = Duration::from_secs(10);

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPlayer {
    pub id: String,
    pub name: String,
    /// Whether the server verified this connection's Minecraft account.
    pub verified: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerDay {
    pub id: String,
    pub name: String,
    pub seconds: u64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityDay {
    pub start: u64,
    pub end: u64,
    pub world_seconds: u64,
    pub players: Vec<PlayerDay>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaytimeView {
    pub world_id: String,
    pub recorded_from: Option<u64>,
    pub days: Vec<ActivityDay>,
    pub players: Vec<ActivityPlayer>,
    pub observed_at: u64,
}

#[derive(Clone, Debug)]
struct Span {
    id: String,
    world_id: String,
    player: Option<ActivityPlayer>,
    start: u64,
    end: u64,
}

/// At most one Minecraft process belongs to this service. Closed spans are
/// removed from memory after a successful checkpoint; active spans keep their ID.
#[derive(Default)]
pub struct ActivityTracker {
    session: Option<TrackedSession>,
}
struct TrackedSession {
    world_id: String,
    pid: u32,
    last_wall: u64,
    last_tick: Instant,
    last_checkpoint: Instant,
    last_players: Option<Instant>,
    finished: bool,
    active: HashMap<Option<String>, String>,
    spans: HashMap<String, Span>,
    dirty: HashSet<String>,
}
impl TrackedSession {
    fn new(world_id: &str, pid: u32, wall: u64, tick: Instant) -> Self {
        Self {
            world_id: world_id.into(),
            pid,
            last_wall: wall,
            last_tick: tick,
            last_checkpoint: tick,
            last_players: None,
            finished: false,
            active: HashMap::new(),
            spans: HashMap::new(),
            dirty: HashSet::new(),
        }
    }
    /// A paused app/computer, clock jump or stalled observation must not become
    /// hours of invented playtime. Resume only after a new player observation.
    fn advance(&mut self, wall: u64, tick: Instant) -> bool {
        let elapsed = tick.saturating_duration_since(self.last_tick);
        let wall_elapsed = wall.saturating_sub(self.last_wall);
        let gap = wall < self.last_wall
            || elapsed > MAX_OBSERVATION_GAP
            || wall_elapsed > MAX_OBSERVATION_GAP.as_secs()
            || wall_elapsed.abs_diff(elapsed.as_secs()) > 3;
        if gap {
            self.active.clear();
            self.last_players = None;
        } else {
            for span_id in self.active.values() {
                if let Some(span) = self.spans.get_mut(span_id)
                    && span.end != wall
                {
                    span.end = wall;
                    self.dirty.insert(span_id.clone());
                }
            }
        }
        self.last_wall = wall;
        self.last_tick = tick;
        gap
    }
    fn observe(&mut self, players: Vec<ActivityPlayer>, wall: u64, tick: Instant) {
        self.advance(wall, tick);
        self.last_players = Some(tick);
        let mut desired = HashMap::new();
        if !players.is_empty() {
            desired.insert(None, None);
        }
        for player in players {
            desired.insert(Some(player.id.clone()), Some(player));
        }
        self.active.retain(|key, _| desired.contains_key(key));
        for (key, player) in desired {
            if let Some(span_id) = self.active.get(&key) {
                if let Some(span) = self.spans.get_mut(span_id)
                    && span.player != player
                {
                    span.player = player;
                    self.dirty.insert(span_id.clone());
                }
                continue;
            }
            let id = uuid::Uuid::new_v4().to_string();
            self.spans.insert(
                id.clone(),
                Span {
                    id: id.clone(),
                    world_id: self.world_id.clone(),
                    player,
                    start: wall,
                    end: wall,
                },
            );
            self.dirty.insert(id.clone());
            self.active.insert(key, id);
        }
    }
    fn flush(&mut self, db: &mut Connection, tick: Instant) -> Result<()> {
        // A failing disk must not trigger another write attempt every tick.
        self.last_checkpoint = tick;
        if !self.dirty.is_empty() {
            let tx = db.transaction()?;
            for id in &self.dirty {
                let Some(span) = self.spans.get(id) else {
                    continue;
                };
                if let Some(player) = &span.player {
                    tx.execute(
                        "INSERT INTO activity_players(world_id,id,name,verified) VALUES(?1,?2,?3,?4)
                         ON CONFLICT(world_id,id) DO UPDATE SET name=excluded.name,verified=excluded.verified",
                        params![span.world_id, player.id, player.name, player.verified],
                    )?;
                }
                tx.execute(
                    "INSERT INTO activity_spans(id,world_id,player_id,start,end) VALUES(?1,?2,?3,?4,?5)
                     ON CONFLICT(id) DO UPDATE SET end=MAX(activity_spans.end,excluded.end)",
                    params![span.id, span.world_id, span.player.as_ref().map(|p| &p.id), span.start, span.end],
                )?;
            }
            tx.commit()?;
            self.dirty.clear();
        }
        let active: HashSet<_> = self.active.values().collect();
        self.spans.retain(|id, _| active.contains(id));
        self.last_checkpoint = tick;
        Ok(())
    }
}

pub(crate) fn initialize_activity(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS activity_worlds(
            world_id TEXT PRIMARY KEY,recorded_from INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS activity_players(
            world_id TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,verified INTEGER NOT NULL,
            PRIMARY KEY(world_id,id));
         CREATE TABLE IF NOT EXISTS activity_spans(
            id TEXT PRIMARY KEY,world_id TEXT NOT NULL,player_id TEXT,
            start INTEGER NOT NULL,end INTEGER NOT NULL CHECK(end>=start));
         CREATE INDEX IF NOT EXISTS activity_spans_world_time ON activity_spans(world_id,end,start);",
    )?;
    Ok(())
}

fn player_identity(world: &World, name: &str) -> ActivityPlayer {
    if !world.online_mode {
        // UUIDs use exact case in offline mode, just like the saved inventory.
        let player = offline_player(name).expect("runtime validates observed player names");
        return ActivityPlayer {
            id: format!("offline:{}", player.uuid),
            name: name.into(),
            verified: false,
        };
    }
    let uuid = world
        .players
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(name))
        .and_then(|p| uuid::Uuid::parse_str(&p.uuid).ok());
    ActivityPlayer {
        // Managed allowed players always have their resolved UUID. A name from
        // a manually modified server remains explicitly separate until known,
        // rather than being assigned another person's UUID or an offline UUID.
        id: uuid
            .map(|id| format!("verified:{id}"))
            .unwrap_or_else(|| format!("online-name:{}", name.to_ascii_lowercase())),
        name: name.into(),
        verified: true,
    }
}

impl Service {
    pub(crate) fn begin_activity(&self, world: &World, pid: u32) -> Result<()> {
        let wall = crate::model::now();
        let tick = Instant::now();
        let mut tracker = self.activity.lock().unwrap();
        let mut db = self.db.lock().unwrap();
        if let Some(previous) = tracker.session.as_mut() {
            // Never extend a previous session across a process replacement.
            previous.active.clear();
            previous.flush(&mut db, tick)?;
        }
        db.execute(
            "INSERT INTO activity_worlds(world_id,recorded_from) VALUES(?1,?2)
             ON CONFLICT(world_id) DO UPDATE SET recorded_from=MIN(activity_worlds.recorded_from,excluded.recorded_from)",
            params![world.id, wall],
        )?;
        tracker.session = Some(TrackedSession::new(&world.id, pid, wall, tick));
        Ok(())
    }
    pub(crate) fn observe_activity(
        &self,
        world_id: &str,
        pid: u32,
        names: &[String],
    ) -> Result<()> {
        let world = self.world(world_id)?;
        let players = names
            .iter()
            .map(|name| player_identity(&world, name))
            .collect();
        let tick = Instant::now();
        let mut tracker = self.activity.lock().unwrap();
        if let Some(session) = tracker.session.as_mut()
            && session.world_id == world_id
            && session.pid == pid
            && !session.finished
        {
            session.observe(players, crate::model::now(), tick);
            if tick.duration_since(session.last_checkpoint) >= CHECKPOINT {
                session.flush(&mut self.db.lock().unwrap(), tick)?;
            }
        }
        Ok(())
    }
    /// Returns true after an observation gap so the console list is refreshed.
    pub(crate) fn tick_activity(&self, world_id: &str, pid: u32) -> Result<bool> {
        let tick = Instant::now();
        let mut tracker = self.activity.lock().unwrap();
        let mut gap = false;
        if let Some(session) = tracker.session.as_mut()
            && session.world_id == world_id
            && session.pid == pid
            && !session.finished
        {
            gap = session.advance(crate::model::now(), tick);
            if session
                .last_players
                .is_some_and(|last| tick.duration_since(last) > Duration::from_secs(45))
            {
                session.active.clear();
                session.last_players = None;
                gap = true;
            }
            if tick.duration_since(session.last_checkpoint) >= CHECKPOINT {
                session.flush(&mut self.db.lock().unwrap(), tick)?;
            }
        }
        Ok(gap)
    }
    pub(crate) fn pause_activity(&self, world_id: &str, pid: u32) {
        let mut tracker = self.activity.lock().unwrap();
        if let Some(session) = tracker.session.as_mut()
            && session.world_id == world_id
            && session.pid == pid
        {
            session.active.clear();
            session.last_players = None;
        }
    }
    pub(crate) fn finish_activity(&self, world_id: &str, pid: u32) -> Result<()> {
        let tick = Instant::now();
        let mut tracker = self.activity.lock().unwrap();
        if let Some(session) = tracker.session.as_mut()
            && session.world_id == world_id
            && session.pid == pid
        {
            // The exit was observed now, but its exact time is unknown. Keep
            // the last healthy sample rather than crediting unobserved time.
            session.active.clear();
            session.finished = true;
            session.flush(&mut self.db.lock().unwrap(), tick)?;
            tracker.session = None;
        }
        Ok(())
    }
    pub fn delete_world_activity(&self, id: &str) -> Result<()> {
        let mut tracker = self.activity.lock().unwrap();
        ensure!(
            tracker
                .session
                .as_ref()
                .is_none_or(|s| s.world_id != id || s.finished),
            "Stop the world before deleting its connected-time history."
        );
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction()?;
        tx.execute("DELETE FROM activity_spans WHERE world_id=?1", [id])?;
        tx.execute("DELETE FROM activity_players WHERE world_id=?1", [id])?;
        tx.execute("DELETE FROM activity_worlds WHERE world_id=?1", [id])?;
        tx.commit()?;
        if tracker.session.as_ref().is_some_and(|s| s.world_id == id) {
            tracker.session = None;
        }
        Ok(())
    }
    pub fn playtime(&self, id: &str, boundaries: Vec<u64>) -> Result<PlaytimeView> {
        self.world(id)?;
        validate_boundaries(&boundaries)?;
        let observed_at = crate::model::now();
        let from = boundaries[0];
        let to = *boundaries.last().unwrap();
        // All activity paths acquire these two short synchronous locks in this
        // order. Queries do not write checkpoints or hold a lock over await.
        let tracker = self.activity.lock().unwrap();
        let db = self.db.lock().unwrap();
        let recorded_from = db
            .query_row(
                "SELECT recorded_from FROM activity_worlds WHERE world_id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()?;
        let mut spans = HashMap::new();
        let mut stmt = db.prepare(
            "SELECT s.id,s.start,s.end,p.id,p.name,p.verified FROM activity_spans s
             LEFT JOIN activity_players p ON s.world_id=p.world_id AND s.player_id=p.id
             WHERE s.world_id=?1 AND s.end>?2 AND s.start<?3",
        )?;
        let rows = stmt.query_map(params![id, from, to], |row| {
            let player_id: Option<String> = row.get(3)?;
            Ok(Span {
                id: row.get(0)?,
                world_id: id.into(),
                start: row.get(1)?,
                end: row.get(2)?,
                player: match player_id {
                    Some(id) => Some(ActivityPlayer {
                        id,
                        name: row.get(4)?,
                        verified: row.get(5)?,
                    }),
                    None => None,
                },
            })
        })?;
        for span in rows {
            let span = span?;
            spans.insert(span.id.clone(), span);
        }
        if let Some(session) = tracker.session.as_ref()
            && session.world_id == id
        {
            for span in session.spans.values() {
                spans.insert(span.id.clone(), span.clone());
            }
        }
        drop(stmt);
        drop(db);
        drop(tracker);
        Ok(summarize(
            id,
            recorded_from,
            &boundaries,
            observed_at,
            spans.into_values(),
        ))
    }
}

fn validate_boundaries(boundaries: &[u64]) -> Result<()> {
    ensure!(
        (2..=91).contains(&boundaries.len()),
        "Choose between 1 and 90 days."
    );
    ensure!(
        boundaries.iter().all(|n| *n <= i64::MAX as u64),
        "Invalid day boundary."
    );
    ensure!(
        boundaries
            .windows(2)
            .all(|w| w[0] < w[1] && w[1] - w[0] <= 48 * 3600),
        "Day boundaries must be increasing and no more than 48 hours apart."
    );
    Ok(())
}

fn union_seconds(mut ranges: Vec<(u64, u64)>) -> u64 {
    ranges.sort_unstable();
    let mut total = 0;
    let mut current: Option<(u64, u64)> = None;
    for (start, end) in ranges {
        match current.as_mut() {
            Some((_, old_end)) if start <= *old_end => *old_end = (*old_end).max(end),
            Some((old_start, old_end)) => {
                total += *old_end - *old_start;
                current = Some((start, end));
            }
            None => current = Some((start, end)),
        }
    }
    total + current.map(|(start, end)| end - start).unwrap_or(0)
}
fn summarize(
    world_id: &str,
    recorded_from: Option<u64>,
    boundaries: &[u64],
    observed_at: u64,
    spans: impl IntoIterator<Item = Span>,
) -> PlaytimeView {
    let mut ranges: HashMap<Option<String>, Vec<(u64, u64)>> = HashMap::new();
    let mut players: HashMap<String, (u64, ActivityPlayer)> = HashMap::new();
    for span in spans {
        let end = span.end.min(observed_at).min(*boundaries.last().unwrap());
        let start = span.start.max(boundaries[0]);
        if end <= start {
            continue;
        }
        let key = span.player.as_ref().map(|p| p.id.clone());
        if let Some(player) = span.player
            && players
                .get(&player.id)
                .is_none_or(|(last, _)| *last <= span.end)
        {
            players.insert(player.id.clone(), (span.end, player));
        }
        ranges.entry(key).or_default().push((start, end));
    }
    let mut players: Vec<ActivityPlayer> =
        players.into_values().map(|(_, player)| player).collect();
    players.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.id.cmp(&b.id))
    });
    let days = boundaries
        .windows(2)
        .map(|day| {
            let seconds = |key: &Option<String>| {
                union_seconds(
                    ranges
                        .get(key)
                        .into_iter()
                        .flatten()
                        .filter_map(|(start, end)| {
                            let a = (*start).max(day[0]);
                            let b = (*end).min(day[1]);
                            (b > a).then_some((a, b))
                        })
                        .collect(),
                )
            };
            ActivityDay {
                start: day[0],
                end: day[1],
                world_seconds: seconds(&None),
                players: players
                    .iter()
                    .map(|player| PlayerDay {
                        id: player.id.clone(),
                        name: player.name.clone(),
                        seconds: seconds(&Some(player.id.clone())),
                    })
                    .collect(),
            }
        })
        .collect();
    PlaytimeView {
        world_id: world_id.into(),
        recorded_from,
        days,
        players,
        observed_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn player(name: &str) -> ActivityPlayer {
        ActivityPlayer {
            id: format!("offline:{name}"),
            name: name.into(),
            verified: false,
        }
    }
    fn memory_db() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        initialize_activity(&db).unwrap();
        db
    }
    #[test]
    fn overlapping_players_count_world_once_and_split_at_day_boundaries() {
        let tick = Instant::now();
        let mut s = TrackedSession::new("world", 42, 90, tick);
        s.observe(vec![player("Alex")], 90, tick);
        s.observe(
            vec![player("Alex"), player("Steve")],
            95,
            tick + Duration::from_secs(5),
        );
        s.observe(vec![player("Steve")], 105, tick + Duration::from_secs(15));
        s.observe(vec![], 115, tick + Duration::from_secs(25));
        let view = summarize(
            "world",
            Some(90),
            &[80, 100, 120],
            115,
            s.spans.into_values(),
        );
        assert_eq!(
            view.days
                .iter()
                .map(|d| d.world_seconds)
                .collect::<Vec<_>>(),
            [10, 15]
        );
        assert_eq!(
            view.days[0]
                .players
                .iter()
                .map(|p| p.seconds)
                .collect::<Vec<_>>(),
            [10, 5]
        );
        assert_eq!(
            view.days[1]
                .players
                .iter()
                .map(|p| p.seconds)
                .collect::<Vec<_>>(),
            [5, 15]
        );
    }
    #[test]
    fn checkpoints_update_rows_and_restart_cannot_extend_crashed_sessions() {
        let mut db = memory_db();
        let tick = Instant::now();
        let mut s = TrackedSession::new("world", 42, 100, tick);
        s.observe(vec![player("Alex")], 100, tick);
        for n in 1..=15 {
            s.advance(100 + n * 2, tick + Duration::from_secs(n * 2));
        }
        s.flush(&mut db, tick + Duration::from_secs(30)).unwrap();
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM activity_spans", [], |r| r
                .get::<_, u64>(0))
                .unwrap(),
            2
        );
        for n in 16..=30 {
            s.advance(100 + n * 2, tick + Duration::from_secs(n * 2));
        }
        s.flush(&mut db, tick + Duration::from_secs(60)).unwrap();
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM activity_spans", [], |r| r
                .get::<_, u64>(0))
                .unwrap(),
            2
        );
        drop(s);
        let restarted = TrackedSession::new("world", 43, 500, tick + Duration::from_secs(400));
        assert!(restarted.active.is_empty());
        assert_eq!(
            db.query_row("SELECT MAX(end) FROM activity_spans", [], |r| r
                .get::<_, u64>(0))
                .unwrap(),
            160
        );
    }
    #[test]
    fn suspension_and_clock_jumps_never_fill_the_gap() {
        let tick = Instant::now();
        let mut s = TrackedSession::new("world", 42, 100, tick);
        s.observe(vec![player("Alex")], 100, tick);
        assert!(!s.advance(104, tick + Duration::from_secs(4)));
        assert!(s.advance(3700, tick + Duration::from_secs(3600)));
        assert!(s.active.is_empty());
        s.observe(vec![player("Alex")], 3700, tick + Duration::from_secs(3600));
        s.advance(3702, tick + Duration::from_secs(3602));
        assert!(s.advance(9000, tick + Duration::from_secs(3604)));
        let view = summarize(
            "world",
            Some(100),
            &[0, 86400],
            10000,
            s.spans.into_values(),
        );
        assert_eq!(view.days[0].world_seconds, 6);
        assert_eq!(view.days[0].players[0].seconds, 6);
    }
    #[test]
    fn queries_clip_at_observation_and_union_repeated_clock_intervals() {
        let spans = vec![
            Span {
                id: "a".into(),
                world_id: "w".into(),
                player: None,
                start: 10,
                end: 90,
            },
            Span {
                id: "b".into(),
                world_id: "w".into(),
                player: None,
                start: 20,
                end: 100,
            },
        ];
        let view = summarize("w", Some(10), &[0, 50, 100], 60, spans);
        assert_eq!(
            view.days
                .iter()
                .map(|d| d.world_seconds)
                .collect::<Vec<_>>(),
            [40, 10]
        );
        assert!(validate_boundaries(&[0, 23 * 3600, 48 * 3600]).is_ok());
        assert!(validate_boundaries(&[0, 0]).is_err());
        assert!(validate_boundaries(&[0, u64::MAX]).is_err());
    }
    #[test]
    fn completed_spans_are_evicted_only_after_a_successful_checkpoint() {
        let mut db = memory_db();
        let tick = Instant::now();
        let mut s = TrackedSession::new("w", 42, 10, tick);
        s.observe(vec![player("Alex")], 10, tick);
        s.observe(vec![], 15, tick + Duration::from_secs(5));
        assert_eq!(s.spans.len(), 2);
        db.execute("DROP TABLE activity_spans", []).unwrap();
        assert!(s.flush(&mut db, tick + Duration::from_secs(5)).is_err());
        assert_eq!(s.spans.len(), 2);
        assert_eq!(s.dirty.len(), 2);
        initialize_activity(&db).unwrap();
        s.flush(&mut db, tick + Duration::from_secs(5)).unwrap();
        assert!(s.spans.is_empty());
        assert_eq!(
            db.query_row(
                "SELECT SUM(end-start) FROM activity_spans WHERE player_id IS NULL",
                [],
                |r| r.get::<_, u64>(0)
            )
            .unwrap(),
            5
        );
    }
    fn world_fixture() -> World {
        serde_json::from_value(serde_json::json!({
            "id":uuid::Uuid::new_v4().to_string(), "name":"History test", "revision":1,
            "component": {"id":uuid::Uuid::new_v4().to_string(),"engine":"paper","minecraft":"1.21.1",
                "version":"132","javaMajor":21,"sha256":"","bytes":0,"installedAt":0},
            "memoryMb":2048,"maxPlayers":8,"port":25565,"lan":false,"onlineMode":false,
            "seed":"","difficulty":"normal","gamemode":"survival","eulaAcceptedAt":1,
            "players":[],"createdAt":1,"lastPlayed":null,"packNotes":""
        })).unwrap()
    }
    #[test]
    fn identity_separates_offline_case_and_account_modes_and_keeps_verified_uuid() {
        let mut world = world_fixture();
        let offline = player_identity(&world, "Alex");
        assert!(!offline.verified);
        assert_ne!(offline.id, player_identity(&world, "alex").id);
        let verified_uuid = "069a79f4-44e9-4726-a5be-fca90e38aaf5";
        world.online_mode = true;
        world.players.push(crate::model::Player {
            name: "Alex".into(),
            uuid: verified_uuid.into(),
            operator: false,
            operator_level: 2,
            bypasses_player_limit: false,
        });
        let verified = player_identity(&world, "Alex");
        assert!(verified.verified);
        assert_eq!(verified.id, format!("verified:{verified_uuid}"));
        assert_ne!(offline.id, verified.id);
        assert_eq!(verified.id, player_identity(&world, "alex").id);
        world.players[0].name = "RenamedAlex".into();
        assert_eq!(verified.id, player_identity(&world, "RenamedAlex").id);
    }
    #[test]
    fn service_query_includes_live_spans_once_persists_and_deletes_only_this_world() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("data");
        let service = Service::new(root.clone()).unwrap();
        let world = world_fixture();
        let other = world_fixture();
        service
            .mutate(|data| {
                data.worlds.extend([world.clone(), other.clone()]);
                Ok(())
            })
            .unwrap();
        let now = crate::model::now();
        let boundaries = vec![now - 100, now + 100];
        assert!(
            service
                .playtime(&world.id, boundaries.clone())
                .unwrap()
                .recorded_from
                .is_none()
        );
        service.begin_activity(&world, 42).unwrap();
        let tick = Instant::now();
        {
            let mut tracker = service.activity.lock().unwrap();
            let session = tracker.session.as_mut().unwrap();
            *session = TrackedSession::new(&world.id, 42, now - 10, tick);
            session.observe(vec![player_identity(&world, "Alex")], now - 10, tick);
            session.advance(now - 5, tick + Duration::from_secs(5));
        }
        let live = service.playtime(&world.id, boundaries.clone()).unwrap();
        assert_eq!(live.days[0].world_seconds, 5);
        assert_eq!(live.days[0].players[0].seconds, 5);
        assert_eq!(
            service
                .playtime(&other.id, boundaries.clone())
                .unwrap()
                .days[0]
                .world_seconds,
            0
        );
        {
            let mut tracker = service.activity.lock().unwrap();
            let session = tracker.session.as_mut().unwrap();
            session
                .flush(
                    &mut service.db.lock().unwrap(),
                    tick + Duration::from_secs(5),
                )
                .unwrap();
            session.advance(now - 3, tick + Duration::from_secs(7));
        }
        assert_eq!(
            service
                .playtime(&world.id, boundaries.clone())
                .unwrap()
                .days[0]
                .world_seconds,
            7
        );
        service.finish_activity(&world.id, 42).unwrap();
        drop(service);
        let restarted = Service::new(root).unwrap();
        let persisted = restarted.playtime(&world.id, boundaries.clone()).unwrap();
        assert_eq!(persisted.days[0].world_seconds, 7);
        assert_eq!(persisted.days[0].players[0].seconds, 7);
        restarted.delete_world_activity(&world.id).unwrap();
        let deleted = restarted.playtime(&world.id, boundaries).unwrap();
        assert!(deleted.recorded_from.is_none());
        assert_eq!(deleted.days[0].world_seconds, 0);
    }
}
