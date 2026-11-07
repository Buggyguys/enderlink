use anyhow::{Context, Result, ensure};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path},
};
use walkdir::WalkDir;
pub fn hash(path: &Path) -> Result<String> {
    let mut f = File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = [0; 65536];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}
pub fn owned(root: &Path, path: &Path) -> Result<()> {
    ensure!(
        path.starts_with(root) && path != root,
        "Path is outside managed storage."
    );
    let mut at = root.to_path_buf();
    ensure!(
        !fs::symlink_metadata(root)?.file_type().is_symlink(),
        "Managed root cannot be a symlink."
    );
    for p in path.strip_prefix(root)?.components() {
        ensure!(matches!(p, Component::Normal(_)), "Invalid managed path.");
        at.push(p);
        if at.exists() || at.symlink_metadata().is_ok() {
            ensure!(
                !fs::symlink_metadata(&at)?.file_type().is_symlink(),
                "Symbolic links are not allowed in managed paths."
            );
        }
    }
    Ok(())
}
pub fn atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension(format!("{}.tmp", crate::model::id()));
    let mut f = File::create(&tmp)?;
    f.write_all(bytes)?;
    f.sync_all()?;
    drop(f);
    fs::rename(tmp, path)?;
    Ok(())
}
pub fn safe_entries(root: &Path) -> Result<Vec<std::path::PathBuf>> {
    let mut out = vec![];
    for e in WalkDir::new(root).follow_links(false) {
        let e = e?;
        ensure!(
            !e.file_type().is_symlink(),
            "Remove symbolic links before importing or backing up this instance."
        );
        ensure!(
            e.file_type().is_dir() || e.file_type().is_file(),
            "Unsupported special file."
        );
        out.push(e.into_path());
    }
    Ok(out)
}
pub fn copy_tree(from: &Path, to: &Path) -> Result<()> {
    for p in safe_entries(from)? {
        let dest = to.join(p.strip_prefix(from)?);
        if dest != to {
            owned(to, &dest)?;
        }
        if p.is_dir() {
            fs::create_dir_all(dest)?;
        } else {
            copy_with_retries(&p, &dest)?;
        }
    }
    Ok(())
}

fn copy_with_retries(from: &Path, to: &Path) -> Result<()> {
    let mut last = None;
    for attempt in 0..30 {
        match fs::copy(from, to) {
            Ok(_) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied && attempt < 29 => {
                last = Some(error);
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(error) => return Err(error.into()),
        }
    }
    Err(last
        .expect("copy retry loop always records a permission error")
        .into())
}
pub fn zip_dir(from: &Path, to: &Path) -> Result<()> {
    let file = File::create(to)?;
    let mut z = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for p in safe_entries(from)? {
        let rel = p.strip_prefix(from)?.to_string_lossy().replace('\\', "/");
        if rel.is_empty() {
            continue;
        }
        if p.is_dir() {
            z.add_directory(rel, opts)?;
        } else {
            z.start_file(rel, opts)?;
            std::io::copy(&mut File::open(p)?, &mut z)?;
        }
    }
    let f = z.finish()?;
    f.sync_all()?;
    Ok(())
}
pub fn unzip(from: &Path, to: &Path, max: u64) -> Result<()> {
    let mut z = zip::ZipArchive::new(File::open(from)?)?;
    ensure!(z.len() < 100_000, "Archive contains too many entries.");
    let mut total = 0u64;
    for i in 0..z.len() {
        let mut f = z.by_index(i)?;
        let rel = f.enclosed_name().context("Unsafe archive path")?;
        ensure!(
            rel.components().all(|c| matches!(c, Component::Normal(_))),
            "Unsafe archive path"
        );
        ensure!(
            f.unix_mode().is_none_or(|m| m & 0o170000 != 0o120000),
            "Archive symlinks are not supported."
        );
        total = total
            .checked_add(f.size())
            .context("Archive size overflow")?;
        ensure!(total <= max, "Archive exceeds available extraction limit.");
        let dest = to.join(rel);
        if f.is_dir() {
            fs::create_dir_all(&dest)?;
        } else {
            if let Some(p) = dest.parent() {
                fs::create_dir_all(p)?;
            }
            let mut o = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(dest)?;
            let expected = f.size();
            let copied = std::io::copy(&mut (&mut f).take(expected.saturating_add(1)), &mut o)?;
            ensure!(
                copied == expected,
                "Archive entry length does not match its declaration."
            );
        }
    }
    Ok(())
}
pub fn tar_gz(from: &Path, to: &Path) -> Result<()> {
    let mut a = tar::Archive::new(flate2::read::GzDecoder::new(File::open(from)?));
    let mut bytes = 0u64;
    for e in a.entries()? {
        let mut e = e?;
        let ty = e.header().entry_type();
        ensure!(
            ty.is_file() || ty.is_dir(),
            "Unexpected Java archive entry."
        );
        bytes += e.size();
        ensure!(bytes < 2_000_000_000, "Java archive too large.");
        ensure!(e.unpack_in(to)?, "Unsafe archive path.");
    }
    Ok(())
}
pub fn size(path: &Path) -> u64 {
    WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len())
        .sum()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backup_roundtrip() {
        let t = tempfile::tempdir().unwrap();
        let src = t.path().join("src");
        fs::create_dir_all(src.join("DIM-1/region")).unwrap();
        fs::write(src.join("DIM-1/region/a.mca"), b"world bytes").unwrap();
        let zip = t.path().join("backup.zip");
        zip_dir(&src, &zip).unwrap();
        let dst = t.path().join("restored");
        unzip(&zip, &dst, 1024).unwrap();
        assert_eq!(
            fs::read(dst.join("DIM-1/region/a.mca")).unwrap(),
            b"world bytes"
        );
    }
    #[test]
    fn traversal_rejected() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("bad.zip");
        let mut z = zip::ZipWriter::new(File::create(&p).unwrap());
        z.start_file("../escape", zip::write::SimpleFileOptions::default())
            .unwrap();
        z.write_all(b"bad").unwrap();
        z.finish().unwrap();
        assert!(unzip(&p, &t.path().join("out"), 100).is_err());
        assert!(!t.path().join("escape").exists());
    }
}
