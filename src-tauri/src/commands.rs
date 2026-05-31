//! Tauri commands exposed to the frontend.

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
