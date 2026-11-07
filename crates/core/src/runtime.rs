use crate::{files, model::*, service::Service};
use anyhow::{Context, Result, ensure};
use std::{fs, process::Stdio, time::Duration};
use sysinfo::{Pid, ProcessesToUpdate, System};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::Command,
};
impl Service {
    pub fn write_properties(&self, w: &World) -> Result<()> {
        let dir = self.instance(&w.id)?;
        fs::create_dir_all(&dir)?;
        let properties = dir.join("server.properties");
        let old = fs::read_to_string(&properties).unwrap_or_default();
        let keys = [
            "server-ip",
            "server-port",
            "online-mode",
            "enforce-secure-profile",
            "white-list",
            "enforce-whitelist",
            "enable-rcon",
            "level-name",
            "level-seed",
            "max-players",
            "gamemode",
            "difficulty",
            "hardcore",
            "pvp",
            "force-gamemode",
            "op-permission-level",
            "motd",
        ];
        let retained = old
            .lines()
            .filter(|l| !keys.iter().any(|k| l.starts_with(&format!("{k}="))))
            .collect::<Vec<_>>()
            .join("\n");
        let seed = w.seed.replace(['\r', '\n', '\\'], "");
        let content = format!(
            "{retained}\nserver-ip={}\nserver-port={}\nonline-mode={}\nenforce-secure-profile={}\nwhite-list=true\nenforce-whitelist=true\nenable-rcon=false\nlevel-name=world\nlevel-seed={}\nmax-players={}\ngamemode={}\ndifficulty={}\nhardcore={}\npvp={}\nforce-gamemode={}\nop-permission-level=2\nmotd=An Enderlink world\n",
            if w.lan { "" } else { "127.0.0.1" },
            w.port,
            w.online_mode,
            w.online_mode,
            seed,
            w.max_players,
            w.gamemode,
            w.difficulty,
            w.hardcore,
            w.pvp,
            w.force_gamemode
        );
        files::atomic(&properties, content.as_bytes())?;
        files::atomic(
            &dir.join("eula.txt"),
            b"# Explicitly accepted by the host in Enderlink.\neula=true\n",
        )?;
        files::atomic(
            &dir.join("whitelist.json"),
            &serde_json::to_vec_pretty(
                &w.players
                    .iter()
                    .map(|p| serde_json::json!({"uuid":p.uuid,"name":p.name}))
                    .collect::<Vec<_>>(),
            )?,
        )?;
        // Dedicated servers grant cheats through explicit operators, not a
        // fictitious allow-cheats property. Level 2 permits gameplay commands;
        // it does not grant server shutdown or access-management commands.
        let operators: Vec<_> = w.players.iter().filter(|p| w.allow_commands && p.operator)
            .map(|p| serde_json::json!({"uuid":p.uuid,"name":p.name,"level":p.operator_level,"bypassesPlayerLimit":p.bypasses_player_limit})).collect();
        files::atomic(
            &dir.join("ops.json"),
            &serde_json::to_vec_pretty(&operators)?,
        )?;
        Ok(())
    }
    pub async fn start_world(&self, id: &str, op: &str) -> Result<()> {
        ensure!(
            self.process.lock().await.is_none(),
            "Save and stop the running world first."
        );
        ensure!(
            self.orphan.lock().unwrap().is_none(),
            "A previously started server is still running. Stop it through the recovery action first."
        );
        let prevent_sleep = self.data()?.settings.prevent_sleep;
        let mut w = self.world(id)?;
        ensure!(
            w.eula_accepted_at > 0,
            "Accept Minecraft's EULA before starting."
        );
        let installed = self
            .data()?
            .components
            .into_iter()
            .find(|c| c.id == w.component.id)
            .context("Server software is missing. Reinstall this world's pinned version.")?;
        let jar = self.component_jar(&installed);
        files::owned(&self.root, &jar)?;
        ensure!(
            files::hash(&jar)? == installed.sha256,
            "Engine checksum mismatch. Remove and reinstall this version."
        );
        self.progress(op, "Preparing Java", None);
        let java = self.ensure_java(installed.java_major, op).await?;
        self.write_properties(&w)?;
        let dir = self.instance(id)?;
        files::owned(&self.root, &dir.join("server.jar"))?;
        fs::copy(&jar, dir.join("server.jar"))?;
        let probe =
            std::net::TcpListener::bind((if w.lan { "0.0.0.0" } else { "127.0.0.1" }, w.port))
                .context("This server port is in use. Choose another port in world settings.")?;
        drop(probe);
        let mut cmd = Command::new(java);
        cmd.current_dir(&dir)
            .arg(format!("-Xmx{}M", w.memory_mb))
            .arg("-Xms256M")
            .args(["-jar", "server.jar", "nogui"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(unix)]
        {
            cmd.process_group(0);
        }
        #[cfg(target_os = "windows")]
        {
            cmd.creation_flags(0x08000000);
        }
        let mut child = cmd.spawn().context("Could not start Java")?;
        let pid = child.id().context("No Java process ID")?;
        #[cfg(target_os = "windows")]
        self.assign_job(pid)?;
        let mut sys = System::new();
        sys.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
        let start = sys
            .process(Pid::from_u32(pid))
            .map(|p| p.start_time())
            .unwrap_or(0);
        files::atomic(
            &self.root.join("server-owner.json"),
            &serde_json::to_vec(&serde_json::json!({"pid":pid,"start":start,"world":id}))?,
        )?;
        w.last_played = Some(now());
        self.mutate(|d| {
            if let Some(x) = d.worlds.iter_mut().find(|x| x.id == id) {
                x.last_played = w.last_played;
            }
            Ok(())
        })?;
        *self.stdin.lock().await = child.stdin.take();
        self.logs.lock().unwrap().clear();
        *self.session.lock().unwrap() = Some(SessionView {
            world_id: id.into(),
            state: "starting".into(),
            started_at: now(),
            pid: Some(pid),
            ..Default::default()
        });
        if let Err(error) = self.begin_activity(&w, pid) {
            self.log(&format!(
                "[Enderlink] Connected-time recording could not start: {error}"
            ));
        }
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        *self.process.lock().await = Some(child);
        if let Some(out) = stdout {
            self.read_output(out, id.into(), pid)
        }
        if let Some(out) = stderr {
            self.read_output(out, id.into(), pid)
        }
        if prevent_sleep {
            match keepawake::Builder::default().idle(true).sleep(true).reason("Hosting a Minecraft world").app_name("Enderlink").app_reverse_domain("io.github.buggyguys.enderlink").create(){
                Ok(guard)=>*self.awake.lock().unwrap()=Some(guard),
                Err(_)=>self.log("[Enderlink] This desktop could not inhibit sleep. Keep the computer awake while hosting.")
            }
        }
        self.start_provider(w.port);
        let svc = self.clone();
        let wid = id.to_owned();
        tokio::spawn(async move {
            let mut sys = System::new();
            let mut samples = 0u32;
            loop {
                tokio::time::sleep(Duration::from_secs(2)).await;
                let mut process = svc.process.lock().await;
                let Some(child) = process.as_mut() else { break };
                match child.try_wait() {
                    Ok(Some(code)) => {
                        *process = None;
                        *svc.stdin.lock().await = None;
                        let _ = fs::remove_file(svc.root.join("server-owner.json"));
                        svc.stop_provider();
                        svc.awake.lock().unwrap().take();
                        #[cfg(target_os = "windows")]
                        for handle in svc.job_handles.lock().unwrap().drain(..) {
                            unsafe {
                                windows_sys::Win32::Foundation::CloseHandle(handle as _);
                            }
                        }
                        if let Err(error) = svc.finish_activity(&wid, pid) {
                            svc.log(&format!(
                                "[Enderlink] Could not save connected time: {error}"
                            ));
                        }
                        let mut view = svc.session.lock().unwrap();
                        if let Some(v) = view.as_mut()
                            && v.world_id == wid
                        {
                            v.state = if code.success() { "stopped" } else { "failed" }.into();
                            v.pid = None;
                            v.players.clear();
                            v.players_known = true;
                            v.error = if code.success() {
                                None
                            } else {
                                Some(format!(
                                    "Java exited with {code}. Open the console for details."
                                ))
                            };
                        }
                        svc.log(&format!("[Enderlink] Server exited: {code}"));
                        break;
                    }
                    Err(e) => {
                        svc.log(&format!("[Enderlink] Process observation failed: {e}"));
                    }
                    _ => {}
                }
                drop(process);
                let activity_gap = match svc.tick_activity(&wid, pid) {
                    Ok(gap) => gap,
                    Err(error) => {
                        svc.log(&format!(
                            "[Enderlink] Could not checkpoint connected time: {error}"
                        ));
                        false
                    }
                };
                if activity_gap {
                    let mut view = svc.session.lock().unwrap();
                    if let Some(view) = view.as_mut()
                        && view.world_id == wid
                        && view.pid == Some(pid)
                    {
                        view.players_known = false;
                        view.players.clear();
                    }
                }
                samples += 1;
                if (activity_gap || samples.is_multiple_of(8))
                    && svc
                        .session
                        .lock()
                        .unwrap()
                        .as_ref()
                        .is_some_and(|s| s.state == "running")
                {
                    let _ = tokio::time::timeout(Duration::from_secs(2), svc.send_console("list"))
                        .await;
                }
                sys.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
                if let Some(p) = sys.process(Pid::from_u32(pid)) {
                    let mut v = svc.session.lock().unwrap();
                    if let Some(v) = v.as_mut() {
                        v.memory_bytes = p.memory();
                        v.cpu_percent = p.cpu_usage()
                            / std::thread::available_parallelism()
                                .map(|n| n.get())
                                .unwrap_or(1) as f32;
                        if v.state == "starting" && now().saturating_sub(v.started_at) > 240 {
                            v.error=Some("Startup is taking longer than expected. Check the console; you can save and stop the process.".into());
                        }
                    }
                }
            }
        });
        Ok(())
    }
    fn read_output<R: tokio::io::AsyncRead + Unpin + Send + 'static>(
        &self,
        stream: R,
        wid: String,
        pid: u32,
    ) {
        let svc = self.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stream);
            let mut buf = Vec::new();
            let mut discarding_long_line = false;
            loop {
                buf.clear();
                let r = (&mut reader).take(16384).read_until(b'\n', &mut buf).await;
                match r {
                    Ok(0) | Err(_) => break,
                    _ => {}
                }
                let complete = buf.last() == Some(&b'\n');
                if discarding_long_line {
                    discarding_long_line = !complete;
                    continue;
                }
                if !complete && buf.len() == 16384 {
                    // A continuation of a long chat/plugin line must never be
                    // mistaken for a new authoritative server message.
                    discarding_long_line = true;
                    svc.log("[Enderlink] An oversized server log line was omitted.");
                    continue;
                }
                let line = normalize_console(&String::from_utf8_lossy(&buf));
                svc.log(&line);
                let event = console_event(&line);
                let mut request_list = false;
                let mut observation = None;
                let mut tracking_unknown = false;
                {
                    let mut view = svc.session.lock().unwrap();
                    let Some(s) = view.as_mut() else { continue };
                    if s.world_id != wid || s.pid != Some(pid) {
                        continue;
                    }
                    match event {
                        Some(ConsoleEvent::Ready) => {
                            s.state = "running".into();
                            s.error = None;
                            request_list = true;
                        }
                        Some(ConsoleEvent::Players(names)) => {
                            s.players = names;
                            s.players_known = true;
                            observation = Some(s.players.clone());
                        }
                        Some(ConsoleEvent::Joined(name)) => {
                            if !s.players.contains(&name) {
                                s.players.push(name);
                            }
                            if s.players_known {
                                observation = Some(s.players.clone());
                            } else {
                                request_list = true;
                            }
                        }
                        Some(ConsoleEvent::Left(name)) => {
                            s.players.retain(|player| player != &name);
                            if s.players_known {
                                observation = Some(s.players.clone());
                            } else {
                                request_list = true;
                            }
                        }
                        Some(ConsoleEvent::UnrecognizedList) => {
                            s.players_known = false;
                            tracking_unknown = true;
                        }
                        None => {}
                    }
                }
                if let Some(names) = observation
                    && let Err(error) = svc.observe_activity(&wid, pid, &names)
                {
                    svc.log(&format!(
                        "[Enderlink] Could not record connected time: {error}"
                    ));
                }
                if tracking_unknown {
                    svc.pause_activity(&wid, pid);
                }
                if request_list {
                    let _ = tokio::time::timeout(Duration::from_secs(2), svc.send_console("list"))
                        .await;
                }
            }
        });
    }
    pub async fn send_console(&self, text: &str) -> Result<()> {
        ensure!(
            !text.contains(['\n', '\r']),
            "Commands must be a single line"
        );
        let mut stdin = self.stdin.lock().await;
        let s = stdin.as_mut().context("No active server console")?;
        s.write_all(format!("{text}\n").as_bytes()).await?;
        s.flush().await?;
        Ok(())
    }
    pub async fn stop_world(&self) -> Result<()> {
        if self.process.lock().await.is_none() {
            return self.stop_recovered();
        }
        self.send_console("stop").await?;
        if let Some(s) = self.session.lock().unwrap().as_mut() {
            s.state = "stopping".into();
        }
        for _ in 0..90 {
            if self.process.lock().await.is_none() {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        anyhow::bail!(
            "The server has not finished saving. Check the console. Force stop is available separately and may lose progress."
        )
    }
    pub async fn force_stop(&self) -> Result<()> {
        if let Some(c) = self.process.lock().await.as_mut() {
            c.start_kill()?;
        } else {
            self.stop_recovered()?;
        }
        Ok(())
    }
    pub fn stop_recovered(&self) -> Result<()> {
        let Some((pid, start)) = *self.orphan.lock().unwrap() else {
            return Ok(());
        };
        let mut sys = System::new();
        sys.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
        if let Some(p) = sys.process(Pid::from_u32(pid)) {
            ensure!(
                p.start_time() == start && start != 0,
                "The previous process identity no longer matches; no signal was sent."
            );
            ensure!(
                p.kill_with(sysinfo::Signal::Term).unwrap_or(false),
                "Could not terminate the recovered Java process."
            );
            anyhow::bail!(
                "Shutdown requested. Wait for the previous Java process to exit, then reopen Enderlink."
            )
        }
        *self.orphan.lock().unwrap() = None;
        let _ = fs::remove_file(self.root.join("server-owner.json"));
        Ok(())
    }
    #[cfg(target_os = "windows")]
    fn assign_job(&self, pid: u32) -> Result<()> {
        use windows_sys::Win32::{
            Foundation::*,
            System::{JobObjects::*, Threading::*},
        };
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            ensure!(!job.is_null(), "Could not create process ownership group");
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            ensure!(
                SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    &limits as *const _ as *const _,
                    std::mem::size_of_val(&limits) as u32
                ) != 0,
                "Could not configure process ownership"
            );
            let p = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false as i32, pid);
            let result = AssignProcessToJobObject(job, p);
            CloseHandle(p);
            if result == 0 {
                CloseHandle(job);
                anyhow::bail!("Could not own Java process")
            }
            self.job_handles.lock().unwrap().push(job as usize);
        }
        Ok(())
    }
}

#[derive(Debug, PartialEq, Eq)]
enum ConsoleEvent {
    Ready,
    Players(Vec<String>),
    Joined(String),
    Left(String),
    UnrecognizedList,
}

/// Paper's terminal output can contain CSI colour/reset sequences and OSC
/// titles/hyperlinks even when latest.log is plain text. Strip complete escape
/// sequences, not just ESC (which would leave "[0m" inside player names).
fn normalize_console(line: &str) -> String {
    let mut chars = line.chars().peekable();
    let mut out = String::with_capacity(line.len());
    while let Some(ch) = chars.next() {
        match ch {
            '\u{1b}' => match chars.next() {
                Some('[') => {
                    for code in chars.by_ref() {
                        if ('@'..='~').contains(&code) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    while let Some(code) = chars.next() {
                        if code == '\u{7}' {
                            break;
                        }
                        if code == '\u{1b}' && chars.peek() == Some(&'\\') {
                            chars.next();
                            break;
                        }
                    }
                }
                _ => {}
            },
            '§' if chars.peek().is_some_and(|next| {
                next.is_ascii_hexdigit() || "klmnorxKLMNORX".contains(*next)
            }) =>
            {
                chars.next();
            }
            c if c.is_control() => {
                // Do not collapse embedded line boundaries into a valid name.
                if c == '\n' || c == '\r' || c == '\t' {
                    out.push(' ');
                }
            }
            c => out.push(c),
        }
    }
    out.trim().to_owned()
}
fn clock_stamp(value: &str) -> bool {
    let value = value
        .split_once('.')
        .map(|(time, fraction)| {
            if !fraction.is_empty() && fraction.bytes().all(|c| c.is_ascii_digit()) {
                time
            } else {
                ""
            }
        })
        .unwrap_or(value);
    value.len() == 8
        && value.as_bytes()[2] == b':'
        && value.as_bytes()[5] == b':'
        && value
            .bytes()
            .enumerate()
            .all(|(i, b)| i == 2 || i == 5 || b.is_ascii_digit())
}
fn console_message(line: &str) -> Option<&str> {
    // Paper's interactive console may prefix a cleared prompt with '>'.
    let line = line.trim_start_matches('>').trim_start();
    let (frame, rest) = line.strip_prefix('[')?.split_once(']')?;
    if let Some(time) = frame.strip_suffix(" INFO") {
        return clock_stamp(time).then(|| rest.strip_prefix(": ")).flatten();
    }
    if !clock_stamp(frame) {
        return None;
    }
    let rest = rest.strip_prefix(" [Server thread/INFO]")?;
    rest.strip_prefix(": (Minecraft) ")
        .or_else(|| rest.strip_prefix(" (Minecraft) "))
        .or_else(|| rest.strip_prefix(": "))
}
fn observed_name(name: &str) -> bool {
    (3..=16).contains(&name.len()) && name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
}
fn player_list(message: &str) -> Option<Vec<String>> {
    let (count, remainder) = message
        .strip_prefix("There are ")?
        .split_once(" of a max of ")?;
    let count: usize = count.parse().ok()?;
    let (maximum, names) = remainder.split_once(" players online:")?;
    let maximum: usize = maximum.parse().ok()?;
    if count > maximum || count > 1000 {
        return None;
    }
    let names = names.trim();
    let names: Vec<String> = if names.is_empty() {
        vec![]
    } else {
        names.split(',').map(str::trim).map(str::to_owned).collect()
    };
    if names.len() != count || !names.iter().all(|name| observed_name(name)) {
        return None;
    }
    let unique: std::collections::HashSet<_> = names.iter().collect();
    (unique.len() == names.len()).then_some(names)
}
fn console_event(line: &str) -> Option<ConsoleEvent> {
    let message = console_message(line)?;
    if message.starts_with("Done (") && message.contains("For help, type") {
        return Some(ConsoleEvent::Ready);
    }
    if message.starts_with("There are ") && message.contains("players online:") {
        return Some(match player_list(message) {
            Some(names) => ConsoleEvent::Players(names),
            None => ConsoleEvent::UnrecognizedList,
        });
    }
    if let Some(name) = message.strip_suffix(" joined the game")
        && observed_name(name)
    {
        return Some(ConsoleEvent::Joined(name.into()));
    }
    if let Some(name) = message.strip_suffix(" left the game")
        && observed_name(name)
    {
        return Some(ConsoleEvent::Left(name.into()));
    }
    None
}

#[cfg(test)]
mod presence_tests {
    use super::*;
    #[test]
    fn reads_paper_and_fabric_terminal_formats_with_real_colour_sequences() {
        for line in [
            "[20:11:12 INFO]: There are 2 of a max of 8 players online: Alex, Steve",
            "\u{1b}[33m[20:11:12 INFO]: \u{1b}[0mThere are 2 of a max of 8 players online: \u{1b}[32mAlex\u{1b}[0m, \u{1b}[35mSteve\u{1b}[0m\n",
            "[20:11:12] [Server thread/INFO]: There are 2 of a max of 8 players online: §dAlex§r, §5Steve§r",
            "[20:11:12] [Server thread/INFO] (Minecraft) There are 2 of a max of 8 players online: Alex, Steve",
            "[20:11:12] [Server thread/INFO]: (Minecraft) There are 2 of a max of 8 players online: Alex, Steve",
        ] {
            assert_eq!(
                console_event(&normalize_console(line)),
                Some(ConsoleEvent::Players(vec!["Alex".into(), "Steve".into()]))
            );
        }
        assert_eq!(
            console_event("[20:11:12 INFO]: There are 0 of a max of 8 players online:"),
            Some(ConsoleEvent::Players(vec![]))
        );
    }
    #[test]
    fn joins_and_leaves_are_exact_server_messages_not_chat_or_plugin_text() {
        assert_eq!(
            console_event("[20:11:12 INFO]: Alex joined the game"),
            Some(ConsoleEvent::Joined("Alex".into()))
        );
        assert_eq!(
            console_event("[20:11:12] [Server thread/INFO]: Alex left the game"),
            Some(ConsoleEvent::Left("Alex".into()))
        );
        for message in [
            "<Steve> Alex joined the game",
            "[Essentials] Alex joined the game",
            "<Alex> There are 0 of a max of 8 players online:",
            "Alex joined the game [extra text]",
            "[Server] Alex left the game",
            "* Steve Alex joined the game",
            "Alex joined the game joined the game",
        ] {
            assert_eq!(console_event(&format!("[20:11:12 INFO]: {message}")), None);
        }
        assert_eq!(
            console_event("[20:11:12] [Async Chat Thread/INFO]: Alex joined the game"),
            None
        );
        assert_eq!(
            console_event("[Not a time INFO]: Alex joined the game"),
            None
        );
    }
    #[test]
    fn incomplete_or_modified_lists_are_unknown_instead_of_false_zero() {
        for names in [
            "Alex",
            "Alex, Alex",
            "Alex, [Admin] Steve",
            "Alex, Steve, Extra",
            "",
        ] {
            assert_eq!(
                console_event(&format!(
                    "[20:11:12 INFO]: There are 2 of a max of 8 players online: {names}"
                )),
                Some(ConsoleEvent::UnrecognizedList)
            );
        }
    }
    #[test]
    fn terminal_hyperlinks_and_resets_do_not_pollute_names() {
        let line = "\u{1b}]0;server title\u{7}\u{1b}[2K> [20:11:12 INFO]: \u{1b}]8;;https://example.com\u{1b}\\Alex\u{1b}]8;;\u{1b}\\ joined the game\r\n";
        assert_eq!(
            console_event(&normalize_console(line)),
            Some(ConsoleEvent::Joined("Alex".into()))
        );
    }
}
