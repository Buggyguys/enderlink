//! Scoped, opt-in native uninstallation. Preparing a helper never removes data.
//! The caller must finish its reviewed data policy, commit, then exit normally.
use serde_json::{Value, json};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Manager};

const IDENTIFIER: &str = "io.github.buggyguys.enderlink";
type Result<T> = std::result::Result<T, String>;

struct Installation {
    method: Option<&'static str>,
    application: PathBuf,
    target: PathBuf,
    description: String,
    manual_command: Option<String>,
    // The native Windows installer owns its directory; keep an exported
    // library out of it even though we never recursively delete it ourselves.
    preservation_exclusion: PathBuf,
}

impl Installation {
    fn manual(executable: PathBuf, description: &str, command: Option<String>) -> Self {
        Self {
            method: None,
            application: executable.clone(),
            target: executable.clone(),
            preservation_exclusion: executable,
            description: description.into(),
            manual_command: command,
        }
    }

    fn public(&self) -> Value {
        json!({
            "supported": self.method.is_some(),
            "method": self.method.unwrap_or("manual"),
            "applicationPath": self.application,
            "description": self.description,
            "manualCommand": self.manual_command,
        })
    }
}

pub fn inspect(app: &AppHandle) -> Result<Value> {
    Ok(installation(app)?.public())
}

/// A prepared helper is running, but remains inert until commit and app exit.
/// Dropping an uncommitted value cancels it. A failed prepare leaves the app
/// and all managed data intact.
pub struct PreparedRemoval {
    work: PathBuf,
    child: Child,
    roots: Vec<PathBuf>,
    committed: bool,
}

impl PreparedRemoval {
    /// Include these paths when rejecting an exported-library destination.
    pub fn deletion_roots(&self) -> &[PathBuf] {
        &self.roots
    }

    /// The caller must call app.exit(0) immediately after this succeeds.
    pub fn commit(mut self) -> Result<()> {
        if self.child.try_wait().map_err(|e| e.to_string())?.is_some() {
            return Err(format!(
                "The uninstall helper stopped. The application is still installed. Details: {}",
                self.work.join("uninstall.log").display()
            ));
        }
        let pending = self.work.join("commit.pending");
        let mut commit = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&pending)
            .map_err(|e| format!("Could not confirm application removal: {e}"))?;
        commit
            .write_all(b"remove after normal exit\n")
            .and_then(|_| commit.sync_all())
            .map_err(|e| format!("Could not confirm application removal: {e}"))?;
        drop(commit);
        fs::rename(pending, self.work.join("commit"))
            .map_err(|e| format!("Could not confirm application removal: {e}"))?;
        self.committed = true;
        Ok(())
    }
}

impl Drop for PreparedRemoval {
    fn drop(&mut self) {
        if !self.committed {
            // The helper cleans up its own temporary files after seeing this.
            let _ = fs::write(self.work.join("cancel"), b"canceled\n");
        }
    }
}

pub fn prepare(app: &AppHandle) -> Result<PreparedRemoval> {
    let install = installation(app)?;
    if install.method.is_none() {
        return Err(install.description);
    }
    let cleanup = cleanup_roots(app)?;
    let mut excluded = cleanup.clone();
    excluded.push(install.preservation_exclusion.clone());
    if matches!(install.method, Some("macos_bundle" | "linux_appimage")) {
        writable_parent(&install.target)?;
    }
    spawn_prepared(install, cleanup, excluded, std::process::id())
}

fn installation(app: &AppHandle) -> Result<Installation> {
    if app.config().identifier != IDENTIFIER {
        return Err("Automatic removal is only available for an Enderlink installation.".into());
    }
    let exe = std::env::current_exe()
        .and_then(fs::canonicalize)
        .map_err(|e| format!("Could not locate this Enderlink application: {e}"))?;
    if cfg!(debug_assertions) {
        return Ok(Installation::manual(
            exe,
            "Development builds are not installed applications. Use Clear all data to reset this build; remove build files through your development tools.",
            None,
        ));
    }
    platform_installation(app, exe)
}

#[cfg(target_os = "macos")]
fn platform_installation(_app: &AppHandle, exe: PathBuf) -> Result<Installation> {
    let candidate = exe
        .parent()
        .filter(|p| p.file_name().is_some_and(|v| v == "MacOS"))
        .and_then(Path::parent)
        .filter(|p| p.file_name().is_some_and(|v| v == "Contents"))
        .and_then(Path::parent)
        .filter(|p| p.extension().is_some_and(|v| v == "app"));
    let Some(bundle) = candidate else {
        return Ok(Installation::manual(
            exe,
            "This executable is not inside a macOS app bundle. Clear its data here, then remove the standalone build yourself.",
            None,
        ));
    };
    let bundle = bundle.to_path_buf();
    let identifier = Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Print CFBundleIdentifier"])
        .arg(bundle.join("Contents/Info.plist"))
        .output()
        .map_err(|e| format!("Could not verify this application bundle: {e}"))?;
    if !identifier.status.success()
        || String::from_utf8_lossy(&identifier.stdout).trim() != IDENTIFIER
    {
        return Err(
            "The app bundle could not be verified as Enderlink. Nothing was removed.".into(),
        );
    }
    ensure_regular_target(&bundle, true)?;
    Ok(Installation {
        method: Some("macos_bundle"),
        application: bundle.clone(),
        target: bundle.clone(),
        preservation_exclusion: bundle,
        description: "Enderlink will quit, then remove this app bundle and its remaining local data. Saved worlds placed in your chosen folder are kept.".into(),
        manual_command: None,
    })
}

#[cfg(target_os = "windows")]
fn platform_installation(_app: &AppHandle, exe: PathBuf) -> Result<Installation> {
    let parent = exe
        .parent()
        .ok_or("Could not identify the installation folder")?;
    let uninstaller = parent.join("uninstall.exe");
    if !uninstaller.is_file() {
        return Ok(Installation::manual(
            exe,
            "No Enderlink installer uninstaller was found beside this executable. For an MSI installation, use Windows Settings → Apps → Installed apps. For a portable build, clear its data here and delete its files yourself.",
            None,
        ));
    }
    ensure_regular_target(&uninstaller, false)?;
    let identity = Command::new(windows_powershell()?)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            r#"$p=$env:ENDERLINK_UNINSTALL_TARGET; if ($p.StartsWith('\\?\UNC\')) { $p='\\'+$p.Substring(8) } elseif ($p.StartsWith('\\?\')) { $p=$p.Substring(4) }; (Get-Item -LiteralPath $p).VersionInfo.ProductName"#,
        ])
        .env("ENDERLINK_UNINSTALL_TARGET", &uninstaller)
        .output()
        .map_err(|e| format!("Could not verify the Windows uninstaller: {e}"))?;
    if !identity.status.success() || String::from_utf8_lossy(&identity.stdout).trim() != "Enderlink"
    {
        return Err("The adjacent uninstaller could not be verified as Enderlink. Use Windows Settings to remove the app.".into());
    }
    Ok(Installation {
        method: Some("windows_nsis"),
        application: exe.clone(),
        target: uninstaller,
        preservation_exclusion: parent.to_path_buf(),
        description: "Enderlink will quit and open its Windows uninstaller. Windows may ask for permission. Saved worlds placed in your chosen folder are kept.".into(),
        manual_command: None,
    })
}

#[cfg(target_os = "linux")]
fn platform_installation(app: &AppHandle, exe: PathBuf) -> Result<Installation> {
    let env = app.env();
    if let (Some(image), Some(appdir)) = (env.appimage, env.appdir) {
        let mount = fs::canonicalize(appdir)
            .map_err(|e| format!("Could not verify the AppImage mount: {e}"))?;
        if !exe.starts_with(&mount) {
            return Err("The current executable does not belong to the reported AppImage.".into());
        }
        let image = fs::canonicalize(image)
            .map_err(|e| format!("Could not find the original AppImage file: {e}"))?;
        ensure_regular_target(&image, false)?;
        if image.starts_with(&mount) {
            return Err("The original AppImage path points inside its read-only mount.".into());
        }
        return Ok(Installation {
            method: Some("linux_appimage"),
            application: image.clone(),
            target: image.clone(),
            preservation_exclusion: image,
            description: "Enderlink will quit, then remove this AppImage and its local data. Saved worlds placed in your chosen folder are kept. Any manually created desktop shortcut can be removed separately.".into(),
            manual_command: None,
        });
    }
    for (query, args, method, manual) in [
        (
            "/usr/bin/dpkg-query",
            vec!["-S"],
            "linux_dpkg",
            "sudo dpkg --remove",
        ),
        (
            "/usr/bin/pacman",
            vec!["-Qoq"],
            "linux_pacman",
            "sudo pacman --remove",
        ),
        (
            "/usr/bin/rpm",
            vec!["-qf", "--queryformat", "%{NAME}"],
            "linux_rpm",
            "sudo rpm --erase",
        ),
    ] {
        if !Path::new(query).is_file() {
            continue;
        }
        let result = Command::new(query).args(args).arg(&exe).output();
        let Ok(result) = result else {
            continue;
        };
        if !result.status.success() {
            continue;
        }
        let text = String::from_utf8_lossy(&result.stdout);
        let name = if method == "linux_dpkg" {
            text.split(": ")
                .next()
                .unwrap_or("")
                .split(':')
                .next()
                .unwrap_or("")
                .trim()
        } else {
            text.trim()
        };
        if !["enderlink", "enderlink-bin", "enderlink-git"].contains(&name) {
            continue;
        }
        let command = format!("{manual} {name}");
        if !Path::new("/usr/bin/pkexec").is_file() {
            return Ok(Installation::manual(
                exe,
                "This package is managed by your Linux distribution, and automatic authorization is unavailable. Clear data here if wanted, then run the removal command in your terminal.",
                Some(command),
            ));
        }
        return Ok(Installation {
            method: Some(method),
            application: exe.clone(),
            preservation_exclusion: exe,
            target: PathBuf::from(name),
            description: "Enderlink will quit, then your package manager will ask for authorization to remove the app. Canceling that system prompt leaves the app installed; the data cleanup already confirmed here is permanent. Saved worlds in your chosen folder are kept.".into(),
            manual_command: Some(command),
        });
    }
    Ok(Installation::manual(
        exe,
        "This is an unpackaged Linux executable. Clear its data here, then remove the binary and any shortcut you created. Source files and build folders are never deleted automatically.",
        None,
    ))
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn platform_installation(_app: &AppHandle, exe: PathBuf) -> Result<Installation> {
    Ok(Installation::manual(
        exe,
        "Use your operating system to remove Enderlink after clearing its data.",
        None,
    ))
}

fn cleanup_roots(app: &AppHandle) -> Result<Vec<PathBuf>> {
    let paths = app.path();
    let mut candidates = vec![
        paths.app_data_dir(),
        paths.app_local_data_dir(),
        paths.app_config_dir(),
        paths.app_cache_dir(),
        paths.app_log_dir(),
    ]
    .into_iter()
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    {
        let home = paths.home_dir().map_err(|e| e.to_string())?;
        candidates.extend([
            home.join("Library/WebKit").join(IDENTIFIER),
            home.join("Library/HTTPStorages").join(IDENTIFIER),
            home.join("Library/Saved Application State")
                .join(format!("{IDENTIFIER}.savedState")),
            home.join("Library/Preferences")
                .join(format!("{IDENTIFIER}.plist")),
        ]);
    }
    let mut roots = vec![];
    for path in candidates {
        if !owned_app_path(&path) {
            return Err(format!(
                "An app directory is outside Enderlink's dedicated storage: {}",
                path.display()
            ));
        }
        let path = normalize_candidate(&path)?;
        if !owned_app_path(&path) {
            return Err("An app directory resolves outside Enderlink's dedicated storage.".into());
        }
        roots.push(path);
    }
    roots.sort_by_key(|path| path.components().count());
    let mut unique: Vec<PathBuf> = vec![];
    for path in roots {
        if !unique.iter().any(|root| path.starts_with(root)) {
            unique.push(path);
        }
    }
    Ok(unique)
}

fn owned_app_path(path: &Path) -> bool {
    let leaf = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
    path.is_absolute()
        && (leaf == IDENTIFIER
            || leaf == format!("{IDENTIFIER}.savedState")
            || leaf == format!("{IDENTIFIER}.plist")
            || (leaf == "logs"
                && path
                    .parent()
                    .is_some_and(|p| p.file_name().is_some_and(|v| v == IDENTIFIER))))
}

fn normalize_candidate(path: &Path) -> Result<PathBuf> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
    {
        return Err("Uninstall paths must be absolute and normalized.".into());
    }
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            if meta.file_type().is_symlink() {
                return Err(format!(
                    "Remove the symbolic link before uninstalling: {}",
                    path.display()
                ));
            }
            fs::canonicalize(path).map_err(|e| e.to_string())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = path.parent().ok_or("An uninstall path has no parent")?;
            Ok(
                normalize_candidate(parent)?
                    .join(path.file_name().ok_or("Invalid uninstall path")?),
            )
        }
        Err(error) => Err(error.to_string()),
    }
}

fn ensure_regular_target(path: &Path, directory: bool) -> Result<()> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink()
        || (directory && !metadata.is_dir())
        || (!directory && !metadata.is_file())
    {
        return Err("The installation target is not a regular application file or bundle.".into());
    }
    Ok(())
}

fn unique_name() -> String {
    format!("{}-{}", std::process::id(), enderlink_core::model::id())
}

fn writable_parent(path: &Path) -> Result<()> {
    let parent = path
        .parent()
        .ok_or("The application has no parent folder")?;
    let probe = parent.join(format!(".enderlink-uninstall-check-{}", unique_name()));
    let file = OpenOptions::new().create_new(true).write(true).open(&probe)
        .map_err(|e| format!("The app is in a read-only or protected location. Move it to a writable folder first, or remove it using your operating system. No data was removed. ({e})"))?;
    drop(file);
    fs::remove_file(probe).map_err(|e| e.to_string())
}

fn private_work_dir() -> Result<PathBuf> {
    let path = std::env::temp_dir().join(format!("enderlink-uninstall-{}", unique_name()));
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&path)
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    fs::create_dir(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn spawn_prepared(
    install: Installation,
    cleanup: Vec<PathBuf>,
    roots: Vec<PathBuf>,
    parent: u32,
) -> Result<PreparedRemoval> {
    let work = private_work_dir()?;
    let spawned = spawn_helper(&install, &cleanup, parent, &work);
    let child = match spawned {
        Ok(child) => child,
        Err(error) => {
            let _ = fs::remove_dir_all(&work);
            return Err(error);
        }
    };
    let mut prepared = PreparedRemoval {
        work,
        child,
        roots,
        committed: false,
    };
    for _ in 0..100 {
        if prepared.work.join("ready").is_file() {
            return Ok(prepared);
        }
        if prepared
            .child
            .try_wait()
            .map_err(|e| e.to_string())?
            .is_some()
        {
            return Err(format!(
                "The uninstall helper could not start. No data was removed. Details: {}",
                prepared.work.join("uninstall.log").display()
            ));
        }
        thread::sleep(Duration::from_millis(30));
    }
    Err("The uninstall helper did not become ready. No data was removed.".into())
}

#[cfg(unix)]
fn spawn_helper(
    install: &Installation,
    cleanup: &[PathBuf],
    parent: u32,
    work: &Path,
) -> Result<Child> {
    let script = work.join("finish.sh");
    fs::write(&script, include_str!("../uninstall/finish.sh")).map_err(|e| e.to_string())?;
    let log = File::create(work.join("uninstall.log")).map_err(|e| e.to_string())?;
    Command::new("/bin/sh")
        .arg(script)
        .arg(parent.to_string())
        .arg(work)
        .arg(install.method.ok_or("No automatic uninstall method")?)
        .arg(&install.target)
        .args(cleanup)
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(log))
        .spawn()
        .map_err(|e| format!("Could not start the uninstall helper: {e}"))
}

#[cfg(target_os = "windows")]
fn windows_powershell() -> Result<PathBuf> {
    let system =
        std::env::var_os("SystemRoot").ok_or("Windows system directory could not be located")?;
    let path = PathBuf::from(system).join("System32/WindowsPowerShell/v1.0/powershell.exe");
    if !path.is_absolute() || !path.is_file() {
        return Err("The Windows PowerShell executable could not be located.".into());
    }
    Ok(path)
}

#[cfg(target_os = "windows")]
fn spawn_helper(
    install: &Installation,
    cleanup: &[PathBuf],
    parent: u32,
    work: &Path,
) -> Result<Child> {
    use std::os::windows::process::CommandExt;
    let script = work.join("finish.ps1");
    fs::write(&script, include_str!("../uninstall/finish.ps1")).map_err(|e| e.to_string())?;
    let plan_path = work.join("plan.json");
    let plan = json!({ "parentPid": parent, "method": install.method, "target": install.target, "application": install.application, "roots": cleanup });
    fs::write(
        &plan_path,
        serde_json::to_vec(&plan).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let log = File::create(work.join("uninstall.log")).map_err(|e| e.to_string())?;
    Command::new(windows_powershell()?)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(script)
        .arg("-PlanPath")
        .arg(plan_path)
        .creation_flags(0x08000000) // CREATE_NO_WINDOW; NSIS owns the visible UI.
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(log))
        .spawn()
        .map_err(|e| format!("Could not start the uninstall helper: {e}"))
}

#[cfg(not(any(unix, target_os = "windows")))]
fn spawn_helper(
    _install: &Installation,
    _cleanup: &[PathBuf],
    _parent: u32,
    _work: &Path,
) -> Result<Child> {
    Err("Automatic uninstallation is unavailable on this operating system.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("enderlink-removal-test-{}", unique_name()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn only_dedicated_app_paths_qualify() {
        let parent = std::env::temp_dir();
        assert!(owned_app_path(&parent.join(IDENTIFIER)));
        assert!(owned_app_path(&parent.join(IDENTIFIER).join("logs")));
        assert!(!owned_app_path(&parent));
        assert!(!owned_app_path(&parent.join("Minecraft")));
        assert!(!owned_app_path(Path::new(IDENTIFIER)));
    }

    #[test]
    fn rejects_parent_traversal_and_preserves_missing_owned_path() {
        let temp = Temp::new();
        assert!(normalize_candidate(&temp.0.join("../outside")).is_err());
        let path = normalize_candidate(&temp.0.join("not-created").join(IDENTIFIER)).unwrap();
        assert!(path.ends_with(Path::new("not-created").join(IDENTIFIER)));
    }

    #[cfg(unix)]
    #[test]
    fn symbolic_link_is_not_an_uninstall_root() {
        let temp = Temp::new();
        let outside = temp.0.join("unrelated");
        fs::create_dir(&outside).unwrap();
        let link = temp.0.join(IDENTIFIER);
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        assert!(normalize_candidate(&link).is_err());
        assert!(ensure_regular_target(&link, true).is_err());
        assert!(outside.exists());
    }

    #[cfg(unix)]
    fn fixture_installation(target: PathBuf) -> Installation {
        Installation {
            method: Some("linux_appimage"),
            application: target.clone(),
            target: target.clone(),
            preservation_exclusion: target,
            description: String::new(),
            manual_command: None,
        }
    }

    #[cfg(unix)]
    #[test]
    fn canceling_a_prepared_helper_keeps_everything() {
        let temp = Temp::new();
        let target = temp.0.join("Enderlink.AppImage");
        fs::write(&target, b"disposable app").unwrap();
        let data = temp.0.join(IDENTIFIER);
        fs::create_dir(&data).unwrap();
        fs::write(data.join("world"), b"keep me").unwrap();
        let prepared = spawn_prepared(
            fixture_installation(target.clone()),
            vec![data.clone()],
            vec![data.clone()],
            std::process::id(),
        )
        .unwrap();
        let work = prepared.work.clone();
        drop(prepared);
        for _ in 0..100 {
            if !work.exists() {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        assert!(!work.exists());
        assert!(target.exists());
        assert!(data.join("world").exists());
    }

    #[cfg(unix)]
    #[test]
    fn helper_waits_for_exit_and_removes_only_passed_fixture_paths() {
        let temp = Temp::new();
        // Shell metacharacters and spaces are literal arguments, never code.
        let target = temp.0.join("Enderlink $(touch injected); '.AppImage");
        fs::write(&target, b"disposable app").unwrap();
        let data = temp.0.join(IDENTIFIER);
        fs::create_dir(&data).unwrap();
        fs::write(data.join("world"), b"disposable world").unwrap();
        let preserved = temp.0.join("saved worlds");
        fs::create_dir(&preserved).unwrap();
        fs::write(preserved.join("world"), b"keep this").unwrap();
        let mut parent = Command::new("/bin/sh")
            .args(["-c", "sleep 2"])
            .spawn()
            .unwrap();
        let prepared = spawn_prepared(
            fixture_installation(target.clone()),
            vec![data.clone()],
            vec![data.clone()],
            parent.id(),
        )
        .unwrap();
        let work = prepared.work.clone();
        prepared.commit().unwrap();
        assert!(target.exists());
        assert!(data.exists());
        parent.wait().unwrap();
        for _ in 0..150 {
            if !work.exists() {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        assert!(!work.exists(), "helper should finish normally");
        assert!(!target.exists());
        assert!(!data.exists());
        assert!(preserved.join("world").exists());
        assert!(!temp.0.join("injected").exists());
    }
}
