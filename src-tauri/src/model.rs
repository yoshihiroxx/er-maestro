//! Normalized schema graph model returned to the frontend.
//!
//! These types are the single source of truth for the Rust <-> TypeScript
//! boundary. `ts-rs` generates the matching `.ts` declarations into
//! `../src/types/` when `cargo test export_bindings` runs. Field names use
//! snake_case in both Rust and TS so the serde JSON payload matches the
//! generated types exactly (no rename layer to drift out of sync).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The full parsed schema: every table plus the foreign-key relationships
/// resolved between them, along with any non-fatal warnings collected while
/// parsing (unparseable statements, foreign keys pointing at unknown tables).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/")]
pub struct SchemaModel {
    pub tables: Vec<Table>,
    pub relationships: Vec<Relationship>,
    pub warnings: Vec<String>,
    /// Detected dialect label ("generic" / "postgres" / "mysql" / ...).
    pub dialect: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/")]
pub struct Table {
    /// Normalized key used to resolve FKs and as the React Flow node id.
    /// Format: lowercased `schema.table` (or just `table` when unqualified).
    pub id: String,
    pub name: String,
    pub schema: Option<String>,
    pub columns: Vec<Column>,
    /// Absolute path of the `.sql` file this table was defined in.
    pub source_file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/")]
pub struct Column {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
    pub is_foreign_key: bool,
    pub default: Option<String>,
    pub unique: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/")]
pub struct Relationship {
    /// Stable id for the React Flow edge.
    pub id: String,
    /// Child side (the table that holds the foreign key), normalized key.
    pub from_table: String,
    pub from_columns: Vec<String>,
    /// Parent side (the referenced table), normalized key.
    pub to_table: String,
    pub to_columns: Vec<String>,
    pub on_delete: Option<String>,
    pub on_update: Option<String>,
}

/// Build the normalized lookup key for a table from an optional schema and a
/// table name. Lowercasing makes FK resolution tolerant of case differences
/// between the `REFERENCES` clause and the `CREATE TABLE` it points at.
pub fn table_key(schema: Option<&str>, name: &str) -> String {
    match schema {
        Some(s) if !s.is_empty() => format!("{}.{}", s.to_lowercase(), name.to_lowercase()),
        _ => name.to_lowercase(),
    }
}
