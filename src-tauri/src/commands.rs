//! Tauri commands exposed to the frontend.

use std::path::PathBuf;

use crate::fs_scan::collect_sql_files;
use crate::model::SchemaModel;
use crate::parser;

/// Parse a mix of file and directory paths (as returned by the native dialog)
/// into one merged schema. Directories are scanned recursively for `.sql`.
#[tauri::command]
pub fn parse_schema(paths: Vec<String>) -> Result<SchemaModel, String> {
    let files = collect_sql_files(&paths);
    if files.is_empty() {
        return Err("No .sql files were found in the selected paths.".to_string());
    }
    Ok(parser::parse_files(&files))
}

/// Parse raw SQL text directly (paste box / programmatic use).
#[tauri::command]
pub fn parse_sql_text(sql: String, dialect: Option<String>) -> Result<SchemaModel, String> {
    Ok(parser::parse_text(&sql, dialect.as_deref()))
}

/// Write an exported diagram (PNG bytes or SVG text) to `path`.
#[tauri::command]
pub fn save_export_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(format!(
                "Parent directory does not exist: {}",
                parent.display()
            ));
        }
    }
    std::fs::write(&target, &contents).map_err(|e| format!("Failed to write {}: {e}", path))
}
