//! Turn a mixed list of file/directory paths into a flat list of `.sql` files.
//!
//! Reading happens entirely in Rust (`std::fs`), so we are not subject to the
//! `tauri-plugin-fs` scope system — the frontend hands us whatever path the
//! native dialog returned and we read it directly.

use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// Expand the given paths into concrete `.sql` files:
/// - a file ending in `.sql` is taken as-is,
/// - a directory is walked recursively and every `.sql` file under it is collected.
///
/// Results are de-duplicated and sorted for deterministic output.
pub fn collect_sql_files(paths: &[String]) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();

    for raw in paths {
        let p = Path::new(raw);
        if p.is_dir() {
            for entry in WalkDir::new(p).follow_links(true).into_iter().flatten() {
                let path = entry.path();
                if path.is_file() && has_sql_extension(path) {
                    out.push(path.to_path_buf());
                }
            }
        } else if p.is_file() && has_sql_extension(p) {
            out.push(p.to_path_buf());
        }
    }

    out.sort();
    out.dedup();
    out
}

fn has_sql_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("sql"))
        .unwrap_or(false)
}
