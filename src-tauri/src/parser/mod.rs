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
        let display = path.display().to_string();
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(e) => {
                acc.warn(format!("Failed to read {}: {}", display, e));
                continue;
            }
        };
        let res = dialect::best_effort_parse(&content, None);
        labels.insert(res.label.clone());
        for mut w in res.warnings {
            if w.source_file.is_none() {
                w.source_file = Some(display.clone());
            }
            acc.warn_raw(w);
        }
        acc.ingest(res.statements, &display);
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
    for mut w in res.warnings {
        if w.source_file.is_none() {
            w.source_file = Some("<input>".to_string());
        }
        acc.warn_raw(w);
    }
    acc.ingest(res.statements, "<input>");
    acc.finish(res.label)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{RelationshipCardinality, RelationshipVia, TableKind};

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
    fn alter_table_add_column_merges_into_existing_table() {
        let sql = r#"
            CREATE TABLE work_sessions (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'queued'
            );
            ALTER TABLE work_sessions ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE work_sessions ADD COLUMN usage_capture_mode TEXT NOT NULL DEFAULT 'structured';
        "#;
        let m = parse_text(sql, Some("sqlite"));
        let work_sessions = m.tables.iter().find(|t| t.id == "work_sessions").unwrap();

        assert!(work_sessions
            .columns
            .iter()
            .any(|c| c.name == "usage_capture_mode"
                && c.data_type == "TEXT"
                && !c.nullable
                && c.default.as_deref() == Some("'structured'")));
        assert!(work_sessions
            .columns
            .iter()
            .any(|c| c.name == "input_tokens"));
    }

    #[test]
    fn alter_table_add_column_with_inline_fk_resolves() {
        let sql = r#"
            CREATE TABLE users (id INT PRIMARY KEY);
            CREATE TABLE posts (id INT PRIMARY KEY);
            ALTER TABLE posts ADD COLUMN user_id INT REFERENCES users (id);
        "#;
        let m = parse_text(sql, None);
        let posts = m.tables.iter().find(|t| t.id == "posts").unwrap();
        let user_id = posts.columns.iter().find(|c| c.name == "user_id").unwrap();
        assert!(user_id.is_foreign_key);

        assert_eq!(m.relationships.len(), 1);
        assert_eq!(m.relationships[0].from_table, "posts");
        assert_eq!(m.relationships[0].from_columns, vec!["user_id"]);
        assert_eq!(m.relationships[0].to_table, "users");
    }

    #[test]
    fn unique_constraints_feed_cardinality() {
        let sql = r#"
            CREATE TABLE users (id INT PRIMARY KEY);
            CREATE TABLE profiles (
                id INT PRIMARY KEY,
                user_id INT UNIQUE REFERENCES users (id)
            );
            CREATE TABLE sessions (
                id INT PRIMARY KEY,
                user_id INT NOT NULL UNIQUE,
                FOREIGN KEY (user_id) REFERENCES users (id)
            );
            CREATE TABLE orders (
                id INT PRIMARY KEY,
                user_id INT REFERENCES users (id)
            );
            CREATE TABLE invoices (
                id INT PRIMARY KEY,
                user_id INT NOT NULL REFERENCES users (id)
            );
        "#;
        let m = parse_text(sql, None);

        let cardinality = |from_table: &str| {
            m.relationships
                .iter()
                .find(|r| r.from_table == from_table)
                .unwrap()
                .from_cardinality
                .as_ref()
                .unwrap()
        };

        assert_eq!(cardinality("profiles"), &RelationshipCardinality::ZeroOrOne);
        assert_eq!(cardinality("sessions"), &RelationshipCardinality::One);
        assert_eq!(cardinality("orders"), &RelationshipCardinality::ZeroOrMany);
        assert_eq!(cardinality("invoices"), &RelationshipCardinality::OneOrMany);
    }

    #[test]
    fn table_level_composite_unique_is_preserved() {
        let sql = r#"
            CREATE TABLE accounts (
                tenant_id INT NOT NULL,
                account_no INT NOT NULL,
                UNIQUE (tenant_id, account_no)
            );
            CREATE TABLE account_profiles (
                id INT PRIMARY KEY,
                tenant_id INT NOT NULL,
                account_no INT NOT NULL,
                FOREIGN KEY (tenant_id, account_no)
                    REFERENCES accounts (tenant_id, account_no)
            );
        "#;
        let m = parse_text(sql, None);
        let accounts = m.tables.iter().find(|t| t.id == "accounts").unwrap();
        assert_eq!(
            accounts.unique_constraints,
            vec![vec!["tenant_id".to_string(), "account_no".to_string()]]
        );
        assert!(!accounts.columns.iter().any(|c| c.unique));

        let rel = m
            .relationships
            .iter()
            .find(|r| r.from_table == "account_profiles")
            .unwrap();
        assert_eq!(
            rel.from_cardinality.as_ref(),
            Some(&RelationshipCardinality::OneOrMany)
        );
    }

    #[test]
    fn alter_unique_and_unique_index_are_preserved() {
        let sql = r#"
            CREATE TABLE users (id INT PRIMARY KEY);
            CREATE TABLE profiles (
                id INT PRIMARY KEY,
                user_id INT REFERENCES users (id),
                external_id TEXT
            );
            ALTER TABLE profiles ADD CONSTRAINT profiles_user_uq UNIQUE (user_id);
            CREATE UNIQUE INDEX profiles_external_uq ON profiles (external_id);
        "#;
        let m = parse_text(sql, None);
        let profiles = m.tables.iter().find(|t| t.id == "profiles").unwrap();
        assert!(profiles
            .unique_constraints
            .iter()
            .any(|c| c == &vec!["user_id".to_string()]));
        assert!(profiles
            .unique_constraints
            .iter()
            .any(|c| c == &vec!["external_id".to_string()]));
        assert!(
            profiles
                .columns
                .iter()
                .find(|c| c.name == "user_id")
                .unwrap()
                .unique
        );
        assert!(
            profiles
                .columns
                .iter()
                .find(|c| c.name == "external_id")
                .unwrap()
                .unique
        );

        let rel = m
            .relationships
            .iter()
            .find(|r| r.from_table == "profiles")
            .unwrap();
        assert_eq!(
            rel.from_cardinality.as_ref(),
            Some(&RelationshipCardinality::ZeroOrOne)
        );
    }

    #[test]
    fn alter_table_add_column_skips_duplicates() {
        let sql = r#"
            CREATE TABLE work_sessions (id TEXT PRIMARY KEY);
            ALTER TABLE work_sessions ADD COLUMN id TEXT;
        "#;
        let m = parse_text(sql, None);
        let work_sessions = m.tables.iter().find(|t| t.id == "work_sessions").unwrap();

        assert_eq!(
            work_sessions
                .columns
                .iter()
                .filter(|c| c.name == "id")
                .count(),
            1
        );
        assert!(m.warnings.iter().any(|w| w.contains("Duplicate column")));
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
    fn create_view_adds_view_node_and_dependency_edges() {
        let sql = r#"
            CREATE TABLE users (id INT PRIMARY KEY);
            CREATE TABLE orders (id INT PRIMARY KEY, user_id INT REFERENCES users (id));
            CREATE VIEW user_orders AS
                SELECT u.id, o.id AS order_id
                FROM users u
                JOIN orders o ON o.user_id = u.id;
        "#;
        let m = parse_text(sql, None);
        let view = m.tables.iter().find(|t| t.id == "user_orders").unwrap();
        assert_eq!(view.kind, TableKind::View);

        let view_edges: Vec<_> = m
            .relationships
            .iter()
            .filter(|r| r.via == RelationshipVia::ViewDependency)
            .collect();
        assert_eq!(view_edges.len(), 2);
        assert!(view_edges.iter().all(|r| !r.inferred));
        assert!(view_edges
            .iter()
            .any(|r| r.from_table == "user_orders" && r.to_table == "users"));
        assert!(view_edges
            .iter()
            .any(|r| r.from_table == "user_orders" && r.to_table == "orders"));
    }

    #[test]
    fn unknown_view_dependency_warning_carries_location() {
        let sql = "\nCREATE VIEW missing_orders AS SELECT * FROM orders;\n";
        let m = parse_text(sql, None);
        assert!(m.tables.iter().any(|t| t.id == "missing_orders"));
        assert_eq!(m.relationships.len(), 0);
        let w = m
            .warnings
            .iter()
            .find(|w| w.contains("unknown table"))
            .expect("expected an unknown view dependency warning");
        assert!(
            w.contains("View `missing_orders`"),
            "warning should mention view: {w}"
        );
        assert!(w.contains("(at "), "warning should carry a location: {w}");
        assert!(w.contains("<input>"), "warning should mention source: {w}");
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

    #[test]
    fn skipped_statement_warning_carries_file_and_line() {
        let sql = "\nCREATE TABLE good (id INT PRIMARY KEY);\n            THIS IS NOT SQL;\n";
        let m = parse_text(sql, None);
        assert!(m.tables.iter().any(|t| t.id == "good"));
        let w = m
            .warnings
            .iter()
            .find(|w| w.contains("Skipped"))
            .expect("expected a skipped-statement warning");
        assert!(w.contains("<input>"), "expected source label in: {w}");
        assert!(
            w.contains(":3:13)") || w.contains(":3)"),
            "expected line 3 of <input> in: {w}"
        );
    }

    #[test]
    fn unknown_fk_target_warning_carries_line_number() {
        let sql = "\n\nCREATE TABLE orders (\n  id INT PRIMARY KEY,\n  customer_id INT REFERENCES customers (id)\n);\n";
        let m = parse_text(sql, None);
        let w = m
            .warnings
            .iter()
            .find(|w| w.contains("unknown table"))
            .expect("expected an unknown-table warning");
        assert!(w.contains("(at "), "warning should carry a location: {w}");
        assert!(w.contains("<input>"), "warning should mention source: {w}");
    }

    #[test]
    fn skipped_statement_warning_carries_source_file_in_parse_files() {
        let dir = std::env::temp_dir().join(format!("er-maestro-pbi005-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("schema.sql");
        std::fs::write(
            &file,
            "CREATE TABLE keep (id INT PRIMARY KEY);\nTHIS IS NOT SQL;\n",
        )
        .unwrap();

        let m = parse_files(std::slice::from_ref(&file));
        let display = file.display().to_string();
        assert!(m.tables.iter().any(|t| t.id == "keep"));
        let w = m
            .warnings
            .iter()
            .find(|w| w.contains("Skipped"))
            .expect("expected a skipped-statement warning");
        assert!(
            w.contains(&display),
            "warning should mention the file path {display}: {w}"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
