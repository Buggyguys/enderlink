//! Read existing server rules before Enderlink takes ownership of those fields.
//! These helpers never modify an instance or reconstruct settings by guessing.
use crate::{accounts, files, model::World};
use anyhow::{Context, Result, bail, ensure};
use flate2::read::GzDecoder;
use serde::Deserialize;
use std::{collections::HashMap, fs, io::Read, path::Path};

const MAX_SETTINGS: u64 = 1024 * 1024;
const MAX_COMPRESSED_LEVEL: u64 = 16 * 1024 * 1024;
const MAX_LEVEL_DATA: u64 = 32 * 1024 * 1024;
const MAX_NBT_NODES: usize = 1_000_000;
const MAX_NBT_DEPTH: usize = 64;

fn optional_bytes(root: &Path, path: &Path, limit: u64) -> Result<Option<Vec<u8>>> {
    files::owned(root, path)?;
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    ensure!(
        metadata.is_file(),
        "Expected a regular server settings file."
    );
    ensure!(
        metadata.len() <= limit,
        "Server settings file exceeds the supported size limit."
    );
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(limit + 1)
        .read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() as u64 <= limit,
        "Server settings file exceeds the supported size limit."
    );
    Ok(Some(bytes))
}

fn unescape_property(value: &str) -> Result<String> {
    let mut out = String::new();
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        let next = chars
            .next()
            .context("Incomplete server.properties escape.")?;
        match next {
            't' => out.push('\t'),
            'r' => out.push('\r'),
            'n' => out.push('\n'),
            'f' => out.push('\u{c}'),
            'u' => {
                let mut n = 0;
                for _ in 0..4 {
                    n = (n << 4)
                        + chars
                            .next()
                            .and_then(|c| c.to_digit(16))
                            .context("Invalid server.properties Unicode escape.")?;
                }
                // Rules of interest have ASCII names/values. Preserve unknown
                // UTF-16 surrogate escapes without treating them as rule keys.
                out.push(char::from_u32(n).unwrap_or('\u{fffd}'));
            }
            other => out.push(other),
        }
    }
    Ok(out)
}
fn property_space(ch: char) -> bool {
    matches!(ch, ' ' | '\t' | '\u{c}')
}
fn properties(bytes: &[u8]) -> Result<HashMap<String, String>> {
    // java.util.Properties InputStream format is Latin-1 with escaped Unicode.
    // Only ASCII rule names and boolean values are consumed below.
    let text: String = bytes.iter().map(|b| *b as char).collect();
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut lines = text.split('\n');
    let mut result = HashMap::new();
    while let Some(natural) = lines.next() {
        let trimmed = natural.trim_start_matches(property_space);
        if trimmed.is_empty() || trimmed.starts_with(['#', '!']) {
            continue;
        }
        let mut line = trimmed.to_owned();
        while line.chars().rev().take_while(|c| *c == '\\').count() % 2 == 1 {
            line.pop();
            let next = lines
                .next()
                .context("Incomplete server.properties continuation.")?;
            line.push_str(next.trim_start_matches(property_space));
        }
        let mut escaped = false;
        let mut split = line.len();
        for (at, ch) in line.char_indices() {
            if escaped {
                escaped = false;
                continue;
            }
            if ch == '\\' {
                escaped = true;
                continue;
            }
            if ch == '=' || ch == ':' || property_space(ch) {
                split = at;
                break;
            }
        }
        let key = unescape_property(&line[..split])?;
        let mut tail = line[split..].trim_start_matches(property_space);
        if tail.starts_with(['=', ':']) {
            tail = &tail[1..];
        }
        let value = unescape_property(tail.trim_start_matches(property_space))?;
        // Last declaration wins, matching Java's Properties implementation.
        result.insert(key, value);
    }
    Ok(result)
}
fn boolean_property(values: &HashMap<String, String>, key: &str) -> Result<Option<bool>> {
    values.get(key).map(|value| {
        if value.eq_ignore_ascii_case("true") { Ok(true) }
        else if value.eq_ignore_ascii_case("false") { Ok(false) }
        else { bail!("The existing {key} setting is not true or false; correct server.properties before upgrading.") }
    }).transpose()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExistingOperator {
    uuid: String,
    name: String,
    level: u8,
    #[serde(default)]
    bypasses_player_limit: bool,
}

/// Adopt legacy disk settings once. Existing explicit operators retain their
/// actual UUID, permission level and player-limit exemption. No lookup or grant
/// is inferred from a display name.
pub(crate) fn adopt_legacy_settings(root: &Path, world: &mut World) -> Result<()> {
    if world.gameplay_configured {
        return Ok(());
    }
    uuid::Uuid::parse_str(&world.id).context("Invalid world ID during settings upgrade.")?;
    let parent = root.join("worlds").join(&world.id);
    let mut instance = parent.join("instance");
    files::owned(root, &instance)?;
    if !instance.exists() {
        let previous = parent.join("import-previous");
        files::owned(root, &previous)?;
        if previous.exists() {
            instance = previous;
        }
    }
    let raw = optional_bytes(root, &instance.join("server.properties"), MAX_SETTINGS)?;
    let values = properties(raw.as_deref().unwrap_or_default())?;
    let configured_hardcore = boolean_property(&values, "hardcore")?;
    let saved_hardcore = stored_hardcore(&instance)?;
    let mut adopted = world.clone();
    adopted.hardcore = saved_hardcore
        .or(configured_hardcore)
        .unwrap_or(adopted.hardcore);
    adopted.pvp = boolean_property(&values, "pvp")?.unwrap_or(adopted.pvp);
    adopted.force_gamemode =
        boolean_property(&values, "force-gamemode")?.unwrap_or(adopted.force_gamemode);
    if adopted.hardcore {
        adopted.gamemode = "survival".into();
        adopted.difficulty = "hard".into();
    }
    let operators = optional_bytes(root, &instance.join("ops.json"), MAX_SETTINGS)?;
    let operators: Vec<ExistingOperator> = match operators {
        Some(bytes) => serde_json::from_slice(&bytes)
            .context("Could not preserve existing ops.json; repair the file before upgrading.")?,
        None => vec![],
    };
    ensure!(
        operators.len() <= 4096,
        "The existing operator list is too large."
    );
    for player in &mut adopted.players {
        player.operator = false;
    }
    let mut seen: HashMap<String, (String, u8, bool)> = HashMap::new();
    for entry in operators {
        accounts::validate_username(&entry.name)
            .context("Invalid player name in existing ops.json.")?;
        let uuid = uuid::Uuid::parse_str(&entry.uuid)
            .context("Invalid UUID in existing ops.json.")?
            .to_string();
        ensure!(
            entry.level <= 4,
            "An existing operator level is outside Minecraft's 0–4 range."
        );
        if !adopted.online_mode {
            ensure!(
                accounts::offline_player(&entry.name)?.uuid == uuid,
                "An operator UUID does not match its offline name. Resolve the existing ops.json identity before upgrading."
            );
        }
        if let Some((name, level, bypass)) = seen.get(&uuid) {
            ensure!(
                name == &entry.name
                    && *level == entry.level
                    && *bypass == entry.bypasses_player_limit,
                "Existing ops.json contains conflicting entries for one UUID."
            );
            continue;
        }
        ensure!(
            !adopted
                .players
                .iter()
                .any(|p| p.name.eq_ignore_ascii_case(&entry.name) && p.uuid != uuid),
            "An existing operator name belongs to a different allowed-player UUID. Resolve the conflict before upgrading."
        );
        let matching: Vec<_> = adopted
            .players
            .iter()
            .enumerate()
            .filter(|(_, p)| p.uuid == uuid)
            .map(|(i, _)| i)
            .collect();
        ensure!(
            matching.len() <= 1,
            "The allowed-player list contains a duplicate operator UUID."
        );
        if let Some(index) = matching.first() {
            let player = &mut adopted.players[*index];
            player.operator = true;
            player.operator_level = entry.level;
            player.bypasses_player_limit = entry.bypasses_player_limit;
        } else {
            adopted.players.push(crate::model::Player {
                uuid: uuid.clone(),
                name: entry.name.clone(),
                operator: true,
                operator_level: entry.level,
                bypasses_player_limit: entry.bypasses_player_limit,
            });
        }
        seen.insert(uuid, (entry.name, entry.level, entry.bypasses_player_limit));
    }
    adopted.allow_commands = adopted.players.iter().any(|p| p.operator);
    adopted.gameplay_configured = true;
    *world = adopted;
    Ok(())
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Scope {
    Root,
    Data,
    Other,
}
struct NbtReader<'a> {
    bytes: &'a [u8],
    at: usize,
    nodes: usize,
    saw_data: bool,
    hardcore: Option<bool>,
}
impl<'a> NbtReader<'a> {
    fn take(&mut self, count: usize) -> Result<&'a [u8]> {
        let end = self.at.checked_add(count).context("NBT length overflow.")?;
        let bytes = self
            .bytes
            .get(self.at..end)
            .context("Truncated level.dat NBT.")?;
        self.at = end;
        Ok(bytes)
    }
    fn byte(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }
    fn string(&mut self) -> Result<&'a [u8]> {
        let bytes = self.take(2)?;
        let len = u16::from_be_bytes([bytes[0], bytes[1]]) as usize;
        self.take(len)
    }
    fn length(&mut self) -> Result<usize> {
        let bytes = self.take(4)?;
        let len = i32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
        ensure!(len >= 0, "Negative level.dat NBT length.");
        Ok(len as usize)
    }
    fn count_node(&mut self) -> Result<()> {
        self.nodes += 1;
        ensure!(
            self.nodes <= MAX_NBT_NODES,
            "level.dat NBT has too many entries."
        );
        Ok(())
    }
    fn compound(&mut self, depth: usize, scope: Scope) -> Result<()> {
        ensure!(depth <= MAX_NBT_DEPTH, "level.dat NBT nesting is too deep.");
        loop {
            let tag = self.byte()?;
            if tag == 0 {
                break;
            }
            self.count_node()?;
            let name = self.string()?;
            if scope == Scope::Root && name == b"Data" {
                ensure!(
                    !self.saw_data && tag == 10,
                    "level.dat has an ambiguous Data compound."
                );
                self.saw_data = true;
                self.compound(depth + 1, Scope::Data)?;
            } else if scope == Scope::Data && name == b"hardcore" {
                ensure!(
                    self.hardcore.is_none() && tag == 1,
                    "level.dat has an ambiguous hardcore rule."
                );
                let value = self.byte()?;
                ensure!(value <= 1, "level.dat hardcore must be a boolean byte.");
                self.hardcore = Some(value != 0);
            } else {
                self.payload(tag, depth + 1)?;
            }
        }
        Ok(())
    }
    fn payload(&mut self, tag: u8, depth: usize) -> Result<()> {
        ensure!(depth <= MAX_NBT_DEPTH, "level.dat NBT nesting is too deep.");
        match tag {
            1 => {
                self.take(1)?;
            }
            2 => {
                self.take(2)?;
            }
            3 | 5 => {
                self.take(4)?;
            }
            4 | 6 => {
                self.take(8)?;
            }
            7 | 11 | 12 => {
                let len = self.length()?;
                let width = match tag {
                    11 => 4,
                    12 => 8,
                    _ => 1,
                };
                self.take(len.checked_mul(width).context("NBT array size overflow.")?)?;
            }
            8 => {
                self.string()?;
            }
            9 => {
                let element = self.byte()?;
                let len = self.length()?;
                ensure!(
                    element <= 12 && (element != 0 || len == 0),
                    "Invalid NBT list type."
                );
                ensure!(len <= MAX_NBT_NODES, "level.dat NBT list is too large.");
                for _ in 0..len {
                    self.count_node()?;
                    self.payload(element, depth + 1)?;
                }
            }
            10 => self.compound(depth, Scope::Other)?,
            _ => bail!("Unknown level.dat NBT tag."),
        }
        Ok(())
    }
}
fn hardcore_from_nbt(bytes: &[u8]) -> Result<bool> {
    let mut reader = NbtReader {
        bytes,
        at: 0,
        nodes: 0,
        saw_data: false,
        hardcore: None,
    };
    ensure!(
        reader.byte()? == 10,
        "level.dat root is not an NBT compound."
    );
    reader.string()?;
    reader.compound(0, Scope::Root)?;
    ensure!(
        reader.at == bytes.len(),
        "Unexpected data after level.dat NBT root."
    );
    reader
        .hardcore
        .context("The saved world has no readable hardcore rule; its settings were not changed.")
}

/// Return the saved world's authoritative hardcore flag. An ungenerated world
/// has no level metadata and returns None. Never infer false from corrupt NBT.
pub(crate) fn stored_hardcore(instance: &Path) -> Result<Option<bool>> {
    match fs::symlink_metadata(instance) {
        Ok(metadata) => ensure!(
            metadata.is_dir() && !metadata.file_type().is_symlink(),
            "The server instance must be an owned directory."
        ),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    }
    let mut compressed = None;
    for name in ["level.dat", "level.dat_old"] {
        let path = instance.join("world").join(name);
        if let Some(bytes) = optional_bytes(instance, &path, MAX_COMPRESSED_LEVEL)? {
            compressed = Some(bytes);
            break;
        }
    }
    let Some(compressed) = compressed else {
        return Ok(None);
    };
    let mut bytes = Vec::new();
    GzDecoder::new(&compressed[..])
        .take(MAX_LEVEL_DATA + 1)
        .read_to_end(&mut bytes)
        .context("Could not decompress saved world metadata; its rules were not changed.")?;
    ensure!(
        bytes.len() as u64 <= MAX_LEVEL_DATA,
        "Saved world metadata exceeds the supported size limit."
    );
    Ok(Some(hardcore_from_nbt(&bytes)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{Compression, write::GzEncoder};
    use std::io::Write;
    fn nbt(hardcore: bool) -> Vec<u8> {
        let mut bytes = vec![10, 0, 0, 10, 0, 4, b'D', b'a', b't', b'a', 1, 0, 8];
        bytes.extend_from_slice(b"hardcore");
        bytes.extend_from_slice(&[u8::from(hardcore), 0, 0]);
        bytes
    }
    fn save_level(instance: &Path, name: &str, hardcore: bool) {
        fs::create_dir_all(instance.join("world")).unwrap();
        let file = fs::File::create(instance.join("world").join(name)).unwrap();
        let mut encoder = GzEncoder::new(file, Compression::default());
        encoder.write_all(&nbt(hardcore)).unwrap();
        encoder.finish().unwrap();
    }
    fn fixture() -> (tempfile::TempDir, World) {
        let dir = tempfile::tempdir().unwrap();
        let world = serde_json::from_value(serde_json::json!({
            "id":uuid::Uuid::new_v4().to_string(),"name":"Legacy", "revision":1,
            "component":{"id":uuid::Uuid::new_v4().to_string(),"engine":"paper","minecraft":"1.21.1",
                "version":"132","javaMajor":21,"sha256":"","bytes":0,"installedAt":0},
            "memoryMb":2048,"maxPlayers":8,"port":25565,"lan":false,"onlineMode":true,
            "seed":"","difficulty":"normal","gamemode":"survival","eulaAcceptedAt":1,
            "players":[],"createdAt":1,"lastPlayed":null,"packNotes":""
        })).unwrap();
        (dir, world)
    }
    #[test]
    fn java_property_escapes_continuations_and_separators_are_respected() {
        let props = properties(
            br"# ignored
hard\u0063ore : tr\
   ue
pvp false
force-gamemode=true
motd=A\=B\:C
pvp:FALSE
",
        )
        .unwrap();
        assert_eq!(boolean_property(&props, "hardcore").unwrap(), Some(true));
        assert_eq!(boolean_property(&props, "pvp").unwrap(), Some(false));
        assert_eq!(
            boolean_property(&props, "force-gamemode").unwrap(),
            Some(true)
        );
        assert_eq!(props["motd"], "A=B:C");
        assert!(boolean_property(&properties(b"pvp=maybe").unwrap(), "pvp").is_err());
        assert!(properties(br"hard\uZZZZcore=true").is_err());
    }
    #[test]
    fn legacy_rules_and_existing_operator_privileges_are_adopted_once_without_file_writes() {
        let (root, mut world) = fixture();
        let instance = root.path().join("worlds").join(&world.id).join("instance");
        fs::create_dir_all(&instance).unwrap();
        let props = b"hardcore=true\npvp=false\nforce-gamemode=true\n";
        fs::write(instance.join("server.properties"), props).unwrap();
        let ops=br#"[{"uuid":"069a79f4-44e9-4726-a5be-fca90e38aaf5","name":"Notch","level":4,"bypassesPlayerLimit":true}]"#;
        fs::write(instance.join("ops.json"), ops).unwrap();
        adopt_legacy_settings(root.path(), &mut world).unwrap();
        assert!(
            world.hardcore
                && !world.pvp
                && world.force_gamemode
                && world.allow_commands
                && world.gameplay_configured
        );
        assert_eq!(
            (&world.gamemode, &world.difficulty),
            (&"survival".into(), &"hard".into())
        );
        assert_eq!(world.players.len(), 1);
        assert!(world.players[0].operator && world.players[0].bypasses_player_limit);
        assert_eq!(world.players[0].operator_level, 4);
        assert_eq!(fs::read(instance.join("server.properties")).unwrap(), props);
        assert_eq!(fs::read(instance.join("ops.json")).unwrap(), ops);
        fs::write(instance.join("server.properties"), b"pvp=true").unwrap();
        adopt_legacy_settings(root.path(), &mut world).unwrap();
        assert!(!world.pvp);
    }
    #[test]
    fn saved_hardcore_takes_precedence_and_interrupted_import_previous_is_found() {
        let (root, mut world) = fixture();
        let instance = root
            .path()
            .join("worlds")
            .join(&world.id)
            .join("import-previous");
        fs::create_dir_all(&instance).unwrap();
        fs::write(instance.join("server.properties"), b"hardcore=false").unwrap();
        save_level(&instance, "level.dat_old", true);
        assert_eq!(stored_hardcore(&instance).unwrap(), Some(true));
        adopt_legacy_settings(root.path(), &mut world).unwrap();
        assert!(world.hardcore && world.gameplay_configured);
        save_level(&instance, "level.dat", false);
        assert_eq!(stored_hardcore(&instance).unwrap(), Some(false));
    }
    #[test]
    fn malformed_operators_or_world_metadata_leave_legacy_metadata_unchanged() {
        let (root, mut world) = fixture();
        let instance = root.path().join("worlds").join(&world.id).join("instance");
        fs::create_dir_all(&instance).unwrap();
        fs::write(instance.join("server.properties"), b"pvp=false").unwrap();
        fs::write(instance.join("ops.json"), b"not JSON").unwrap();
        assert!(adopt_legacy_settings(root.path(), &mut world).is_err());
        assert!(!world.gameplay_configured && world.pvp);
        fs::write(instance.join("ops.json"), b"[]").unwrap();
        fs::create_dir_all(instance.join("world")).unwrap();
        fs::write(instance.join("world/level.dat"), b"not compressed NBT").unwrap();
        assert!(adopt_legacy_settings(root.path(), &mut world).is_err());
        assert!(!world.gameplay_configured && world.pvp);
    }
    #[test]
    fn nbt_parser_rejects_duplicates_truncation_and_oversized_arrays() {
        assert!(hardcore_from_nbt(&nbt(true)).unwrap());
        assert!(!hardcore_from_nbt(&nbt(false)).unwrap());
        for len in 0..nbt(true).len() {
            assert!(hardcore_from_nbt(&nbt(true)[..len]).is_err());
        }
        let mut duplicate = nbt(true);
        duplicate.truncate(duplicate.len() - 2);
        duplicate.extend_from_slice(&[1, 0, 8]);
        duplicate.extend_from_slice(b"hardcore");
        duplicate.extend_from_slice(&[0, 0, 0]);
        assert!(hardcore_from_nbt(&duplicate).is_err());
        let mut array = vec![10, 0, 0, 7, 0, 0];
        array.extend_from_slice(&i32::MAX.to_be_bytes());
        array.push(0);
        assert!(hardcore_from_nbt(&array).is_err());
    }
    #[test]
    fn offline_operator_identity_must_match_the_exact_name() {
        let (root, mut world) = fixture();
        world.online_mode = false;
        let instance = root.path().join("worlds").join(&world.id).join("instance");
        fs::create_dir_all(&instance).unwrap();
        let mut player = accounts::offline_player("Steve").unwrap();
        fs::write(
            instance.join("ops.json"),
            serde_json::to_vec(&serde_json::json!([
                {"uuid":player.uuid,"name":player.name,"level":2,"bypassesPlayerLimit":false}
            ]))
            .unwrap(),
        )
        .unwrap();
        world.players.push(player.clone());
        adopt_legacy_settings(root.path(), &mut world).unwrap();
        assert_eq!(world.players.len(), 1);
        assert!(world.players[0].operator);
        world.gameplay_configured = false;
        player.name = "steve".into();
        fs::write(
            instance.join("ops.json"),
            serde_json::to_vec(&serde_json::json!([
                {"uuid":player.uuid,"name":player.name,"level":2,"bypassesPlayerLimit":false}
            ]))
            .unwrap(),
        )
        .unwrap();
        assert!(adopt_legacy_settings(root.path(), &mut world).is_err());
    }
    #[test]
    fn nbt_skips_all_other_payload_types_without_confusing_nested_hardcore() {
        fn named(bytes: &mut Vec<u8>, tag: u8, name: &[u8], payload: &[u8]) {
            bytes.push(tag);
            bytes.extend_from_slice(&(name.len() as u16).to_be_bytes());
            bytes.extend_from_slice(name);
            bytes.extend_from_slice(payload);
        }
        let mut data = vec![10, 0, 0, 10, 0, 4, b'D', b'a', b't', b'a'];
        for (tag, payload) in [
            (1, vec![9]),
            (2, vec![0, 1]),
            (3, vec![0; 4]),
            (4, vec![0; 8]),
            (5, vec![0; 4]),
            (6, vec![0; 8]),
            (7, vec![0, 0, 0, 2, 1, 2]),
            (8, vec![0, 2, 0xc0, 0x80]), // Java modified UTF-8; ignored string payload.
            (9, vec![8, 0, 0, 0, 2, 0, 1, b'a', 0, 1, b'b']),
            (11, vec![0, 0, 0, 1, 0, 0, 0, 1]),
            (12, vec![0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]),
        ] {
            named(&mut data, tag, b"other", &payload);
        }
        let mut nested = vec![];
        named(&mut nested, 1, b"hardcore", &[1]);
        nested.push(0);
        named(&mut data, 10, b"ModSettings", &nested);
        named(&mut data, 1, b"hardcore", &[0]);
        data.extend_from_slice(&[0, 0]);
        assert!(!hardcore_from_nbt(&data).unwrap());
        let mut deep = vec![10, 0, 0];
        for _ in 0..100 {
            deep.extend_from_slice(&[10, 0, 0]);
        }
        deep.extend_from_slice(&[0; 101]);
        assert!(hardcore_from_nbt(&deep).is_err());
    }
    #[test]
    fn conflicting_operator_entries_cannot_partially_grant_access() {
        let (root, mut world) = fixture();
        let instance = root.path().join("worlds").join(&world.id).join("instance");
        fs::create_dir_all(&instance).unwrap();
        fs::write(
            instance.join("ops.json"),
            br#"[
          {"uuid":"069a79f4-44e9-4726-a5be-fca90e38aaf5","name":"Notch","level":2},
          {"uuid":"069a79f4-44e9-4726-a5be-fca90e38aaf5","name":"Notch","level":4}
        ]"#,
        )
        .unwrap();
        assert!(adopt_legacy_settings(root.path(), &mut world).is_err());
        assert!(world.players.is_empty() && !world.allow_commands && !world.gameplay_configured);
    }
}
