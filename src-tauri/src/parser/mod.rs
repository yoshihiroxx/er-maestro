//! SQL schema parsing: file/text in, normalized [`SchemaModel`] out.

mod dialect;
mod extract;

use std::path::PathBuf;

use crate::model::SchemaModel;
use extract::Accumulator;

/// Parse and merge a set of already-resolved `.sql` files into one schema.
pub fn parse_files(files: &[PathBuf]) -> SchemaModel {
    let mut acc = Accumulator::new();
    let mut labels: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();

    for path in files {
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(e) => {
                acc.warn(format!("Failed to read {}: {}", path.display(), e));
                continue;
            }
        };
        let res = dialect::best_effort_parse(&content, None);
        labels.insert(res.label.clone());
        for w in res.warnings {
            acc.warn(format!("{}: {}", path.display(), w));
        }
        acc.ingest(res.statements, &path.to_string_lossy());
    }

    let dialect = if labels.is_empty() {
        "generic".to_string()
    } else {
        labels.into_iter().collect::<Vec<_>>().join(", ")
    };
    acc.finish(dialect)
}

/// Parse raw SQL text (paste box / tests). `hint` optionally forces a dialect.
pub fn parse_text(sql: &str, hint: Option<&str>) -> SchemaModel {
    let mut acc = Accumulator::new();
    let res = dialect::best_effort_parse(sql, hint);
    for w in res.warnings {
        acc.warn(w);
    }
    acc.ingest(res.statements, "<input>");
    acc.finish(res.label)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table_ids(m: &SchemaModel) -> Vec<String> {
        let mut v: Vec<String> = m.tables.iter().map(|t| t.id.clone()).collect();
        v.sort();
        v
    }

    #[test]
    fn postgres_inline_and_table_level_fk() {
        let sql = r#"
            CREATE TABLE users (
                id SERIAL PRIMARY KEY,
                email TEXT NOT NULL UNIQUE
            );
            CREATE TABLE posts (
                id SERIAL PRIMARY KEY,
                author_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
                title TEXT
            );
        "#;
        let m = parse_text(sql, None);
        assert_eq!(table_ids(&m), vec!["posts", "users"]);
        assert_eq!(m.relationships.len(), 1);
        let rel = &m.relationships[0];
        assert_eq!(rel.from_table, "posts");
        assert_eq!(rel.to_table, "users");
        assert_eq!(rel.from_columns, vec!["author_id"]);
        assert_eq!(rel.to_columns, vec!["id"]);
        assert_eq!(rel.on_delete.as_deref(), Some("CASCADE"));

        let posts = m.tables.iter().find(|t| t.id == "posts").unwrap();
        let author = posts
            .columns
            .iter()
            .find(|c| c.name == "author_id")
            .unwrap();
        assert!(author.is_foreign_key);
        assert!(!author.nullable);
        let id_col = posts.columns.iter().find(|c| c.name == "id").unwrap();
        assert!(id_col.is_primary_key);
    }

    #[test]
    fn mysql_backtick_table_level_fk() {
        let sql = r#"
            CREATE TABLE `customers` (
                `id` INT PRIMARY KEY AUTO_INCREMENT,
                `name` VARCHAR(255) NOT NULL
            ) ENGINE=InnoDB;
            CREATE TABLE `orders` (
                `id` INT PRIMARY KEY AUTO_INCREMENT,
                `customer_id` INT NOT NULL,
                CONSTRAINT `fk_cust` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`)
            ) ENGINE=InnoDB;
        "#;
        let m = parse_text(sql, None);
        assert_eq!(table_ids(&m), vec!["customers", "orders"]);
        assert_eq!(m.relationships.len(), 1);
        assert_eq!(m.relationships[0].from_table, "orders");
        assert_eq!(m.relationships[0].to_table, "customers");
    }

    #[test]
    fn sqlite_composite_fk() {
        let sql = r#"
            CREATE TABLE parts (
                maker TEXT NOT NULL,
                model TEXT NOT NULL,
                PRIMARY KEY (maker, model)
            );
            CREATE TABLE inventory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                maker TEXT NOT NULL,
                model TEXT NOT NULL,
                FOREIGN KEY (maker, model) REFERENCES parts (maker, model)
            );
        "#;
        let m = parse_text(sql, None);
        assert_eq!(m.relationships.len(), 1);
        let rel = &m.relationships[0];
        assert_eq!(rel.from_columns, vec!["maker", "model"]);
        assert_eq!(rel.to_columns, vec!["maker", "model"]);

        let parts = m.tables.iter().find(|t| t.id == "parts").unwrap();
        assert!(parts.columns.iter().filter(|c| c.is_primary_key).count() == 2);
    }

    #[test]
    fn alter_table_add_foreign_key_resolves() {
        let sql = r#"
            CREATE TABLE a (id INT PRIMARY KEY);
            CREATE TABLE b (id INT PRIMARY KEY, a_id INT);
            ALTER TABLE b ADD CONSTRAINT fk_b_a FOREIGN KEY (a_id) REFERENCES a (id);
        "#;
        let m = parse_text(sql, None);
        assert_eq!(m.relationships.len(), 1);
        assert_eq!(m.relationships[0].from_table, "b");
        assert_eq!(m.relationships[0].to_table, "a");
        let b = m.tables.iter().find(|t| t.id == "b").unwrap();
        assert!(
            b.columns
                .iter()
                .find(|c| c.name == "a_id")
                .unwrap()
                .is_foreign_key
        );
    }

    #[test]
    fn schema_qualified_names_normalize() {
        let sql = r#"
            CREATE TABLE public.users (id SERIAL PRIMARY KEY);
            CREATE TABLE public.sessions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES public.users (id)
            );
        "#;
        let m = parse_text(sql, None);
        assert_eq!(table_ids(&m), vec!["public.sessions", "public.users"]);
        assert_eq!(m.relationships.len(), 1);
        assert_eq!(m.relationships[0].to_table, "public.users");
    }

    #[test]
    fn unknown_target_is_warned_not_an_edge() {
        let sql = r#"
            CREATE TABLE orders (
                id INT PRIMARY KEY,
                customer_id INT REFERENCES customers (id)
            );
        "#;
        let m = parse_text(sql, None);
        assert_eq!(m.relationships.len(), 0);
        assert!(m.warnings.iter().any(|w| w.contains("unknown table")));
        // The local column is still flagged as a foreign key.
        let orders = &m.tables[0];
        assert!(
            orders
                .columns
                .iter()
                .find(|c| c.name == "customer_id")
                .unwrap()
                .is_foreign_key
        );
    }

    #[test]
    fn parses_example_directory_end_to_end() {
        // Exercises the real parse_schema path: recursive .sql scan +
        // multi-file merge + cross-file FK resolution.
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../examples");
        let files = crate::fs_scan::collect_sql_files(&[dir.to_string()]);
        assert_eq!(files.len(), 3, "expected 3 example .sql files");

        let m = parse_files(&files);
        assert_eq!(m.tables.len(), 9, "9 tables across the example files");
        assert_eq!(m.relationships.len(), 9, "9 resolved FK relationships");
        // Every FK resolves within the merged schema -> no "unknown table" warnings.
        assert!(
            !m.warnings.iter().any(|w| w.contains("unknown table")),
            "cross-file FKs should all resolve: {:?}",
            m.warnings
        );
        // A cross-file FK (orders.user_id in 03 -> users in 01) must exist.
        assert!(m
            .relationships
            .iter()
            .any(|r| r.from_table == "orders" && r.to_table == "users"));
    }

    #[test]
    fn infers_relationship_from_naming_convention() {
        let sql = r#"
            CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT);
            CREATE TABLE posts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                title TEXT
            );
        "#;
        let m = parse_text(sql, None);
        assert_eq!(m.relationships.len(), 1);
        let rel = &m.relationships[0];
        assert!(rel.inferred, "edge should be marked as inferred");
        assert_eq!(rel.from_table, "posts");
        assert_eq!(rel.from_columns, vec!["user_id"]);
        assert_eq!(rel.to_table, "users");
        assert_eq!(rel.to_columns, vec!["id"]);

        let posts = m.tables.iter().find(|t| t.id == "posts").unwrap();
        let user_col = posts.columns.iter().find(|c| c.name == "user_id").unwrap();
        assert!(!user_col.is_foreign_key);
    }

    #[test]
    fn infers_relationship_singular_match() {
        let sql = r#"
            CREATE TABLE category (id INT PRIMARY KEY, label TEXT);
            CREATE TABLE item (id INT PRIMARY KEY, category_id INT);
        "#;
        let m = parse_text(sql, None);
        let inferred: Vec<_> = m.relationships.iter().filter(|r| r.inferred).collect();
        assert_eq!(inferred.len(), 1);
        assert_eq!(inferred[0].to_table, "category");
    }

    #[test]
    fn inference_does_not_duplicate_explicit_fk() {
        let sql = r#"
            CREATE TABLE users (id SERIAL PRIMARY KEY);
            CREATE TABLE posts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users (id)
            );
        "#;
        let m = parse_text(sql, None);
        assert_eq!(m.relationships.len(), 1);
        assert!(!m.relationships[0].inferred);
    }

    #[test]
    fn inference_skips_when_no_target_table() {
        let sql = r#"
            CREATE TABLE orders (
                id INT PRIMARY KEY,
                customer_id INT NOT NULL
            );
        "#;
        let m = parse_text(sql, None);
        assert_eq!(m.relationships.len(), 0);
    }

    #[test]
    fn inference_respects_schema_prefix() {
        let sql = r#"
            CREATE TABLE public.users (id SERIAL PRIMARY KEY);
            CREATE TABLE public.posts (id SERIAL PRIMARY KEY, user_id INT);
        "#;
        let m = parse_text(sql, None);
        let inferred: Vec<_> = m.relationships.iter().filter(|r| r.inferred).collect();
        assert_eq!(inferred.len(), 1);
        assert_eq!(inferred[0].to_table, "public.users");
    }

    #[test]
    fn tolerates_unparseable_statements() {
        // `CREATE EXTENSION` etc. should be skipped without losing the tables.
        let sql = r#"
            CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
            SET statement_timeout = 0;
            CREATE TABLE widgets (id SERIAL PRIMARY KEY, label TEXT);
        "#;
        let m = parse_text(sql, None);
        assert!(m.tables.iter().any(|t| t.id == "widgets"));
    }
}
