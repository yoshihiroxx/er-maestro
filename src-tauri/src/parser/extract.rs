//! Walk a list of parsed SQL `Statement`s and accumulate them into a
//! normalized [`SchemaModel`]. Handles `CREATE TABLE` (column-level and
//! table-level constraints), inline `REFERENCES`, and `ALTER TABLE ... ADD
//! CONSTRAINT ... FOREIGN KEY` (common in pg_dump-style schemas).

use std::collections::{HashMap, HashSet};

use sqlparser::ast::{
    AlterTable, AlterTableOperation, CreateTable, Expr, ForeignKeyConstraint, Ident, IndexColumn,
    ObjectName, Spanned, Statement, TableConstraint,
};
use sqlparser::tokenizer::Span;

use super::dialect::ParseWarning;
use crate::model::{table_key, Column, Relationship, SchemaModel, Table};

/// Accumulates tables and pending foreign keys across many files/statements,
/// then resolves them into a [`SchemaModel`] in [`Accumulator::finish`].
#[derive(Default)]
pub struct Accumulator {
    tables: Vec<Table>,
    /// normalized table key -> index into `tables`
    index: HashMap<String, usize>,
    pending: Vec<PendingFk>,
    warnings: Vec<ParseWarning>,
}

struct PendingFk {
    from_table: String,
    from_columns: Vec<String>,
    to_table: String,
    to_columns: Vec<String>,
    on_delete: Option<String>,
    on_update: Option<String>,
    source_file: Option<String>,
    line: Option<usize>,
    column: Option<usize>,
}

impl Accumulator {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn warn(&mut self, msg: String) {
        self.warnings.push(ParseWarning::new(msg));
    }

    pub fn warn_raw(&mut self, warning: ParseWarning) {
        self.warnings.push(warning);
    }

    /// Feed every statement parsed from one source file.
    pub fn ingest(&mut self, statements: Vec<Statement>, source_file: &str) {
        for stmt in statements {
            let (line, column) = location_from_span(stmt.span());
            match stmt {
                Statement::CreateTable(ct) => {
                    self.ingest_create_table(ct, source_file, line, column)
                }
                Statement::AlterTable(at) => self.ingest_alter_table(at, source_file, line, column),
                _ => {}
            }
        }
    }

    fn ingest_create_table(
        &mut self,
        ct: CreateTable,
        source_file: &str,
        stmt_line: Option<usize>,
        stmt_column: Option<usize>,
    ) {
        let (schema, name) = split_object_name(&ct.name);
        if name.is_empty() {
            return;
        }
        let key = table_key(schema.as_deref(), &name);
        let mut columns: Vec<Column> = Vec::with_capacity(ct.columns.len());

        for col in &ct.columns {
            let col_name = col.name.value.clone();
            let mut c = Column {
                name: col_name.clone(),
                data_type: col.data_type.to_string(),
                nullable: true,
                is_primary_key: false,
                is_foreign_key: false,
                default: None,
                unique: false,
            };
            for opt in &col.options {
                use sqlparser::ast::ColumnOption::*;
                match &opt.option {
                    NotNull => c.nullable = false,
                    Null => c.nullable = true,
                    PrimaryKey(_) => {
                        c.is_primary_key = true;
                        c.nullable = false;
                    }
                    Unique(_) => c.unique = true,
                    Default(expr) => c.default = Some(expr.to_string()),
                    ForeignKey(fk) => {
                        c.is_foreign_key = true;
                        let from_cols = if fk.columns.is_empty() {
                            vec![col_name.clone()]
                        } else {
                            idents_to_strings(&fk.columns)
                        };
                        let (line, column) =
                            first_known(location_from_span(opt.span()), (stmt_line, stmt_column));
                        self.push_fk(&key, from_cols, fk, source_file, line, column);
                    }
                    _ => {}
                }
            }
            columns.push(c);
        }

        for constraint in &ct.constraints {
            match constraint {
                TableConstraint::PrimaryKey(pk) => {
                    for name in index_column_names(&pk.columns) {
                        mark_column(&mut columns, &name, |c| {
                            c.is_primary_key = true;
                            c.nullable = false;
                        });
                    }
                }
                TableConstraint::Unique(u) => {
                    let names = index_column_names(&u.columns);
                    if names.len() == 1 {
                        mark_column(&mut columns, &names[0], |c| c.unique = true);
                    }
                }
                TableConstraint::ForeignKey(fk) => {
                    let from_cols = idents_to_strings(&fk.columns);
                    let (line, column) = first_known(
                        location_from_span(constraint.span()),
                        (stmt_line, stmt_column),
                    );
                    self.push_fk(&key, from_cols, fk, source_file, line, column);
                }
                _ => {}
            }
        }

        let table = Table {
            id: key.clone(),
            name,
            schema,
            columns,
            source_file: source_file.to_string(),
        };
        self.insert_table(key, table);
    }

    fn ingest_alter_table(
        &mut self,
        at: AlterTable,
        source_file: &str,
        stmt_line: Option<usize>,
        stmt_column: Option<usize>,
    ) {
        let (schema, name) = split_object_name(&at.name);
        if name.is_empty() {
            return;
        }
        let key = table_key(schema.as_deref(), &name);
        for op in &at.operations {
            if let AlterTableOperation::AddConstraint { constraint, .. } = op {
                if let TableConstraint::ForeignKey(fk) = constraint {
                    let from_cols = idents_to_strings(&fk.columns);
                    let (line, column) = first_known(
                        location_from_span(constraint.span()),
                        (stmt_line, stmt_column),
                    );
                    self.push_fk(&key, from_cols, fk, source_file, line, column);
                }
            }
        }
    }

    fn push_fk(
        &mut self,
        from_key: &str,
        from_columns: Vec<String>,
        fk: &ForeignKeyConstraint,
        source_file: &str,
        line: Option<usize>,
        column: Option<usize>,
    ) {
        let (fschema, fname) = split_object_name(&fk.foreign_table);
        if fname.is_empty() {
            return;
        }
        let to_table = table_key(fschema.as_deref(), &fname);
        self.pending.push(PendingFk {
            from_table: from_key.to_string(),
            from_columns,
            to_table,
            to_columns: idents_to_strings(&fk.referred_columns),
            on_delete: fk.on_delete.as_ref().map(|a| a.to_string()),
            on_update: fk.on_update.as_ref().map(|a| a.to_string()),
            source_file: Some(source_file.to_string()),
            line,
            column,
        });
    }

    fn insert_table(&mut self, key: String, table: Table) {
        if let Some(&existing) = self.index.get(&key) {
            // Keep the first definition but merge column metadata when a later
            // CREATE adds columns we hadn't seen (rare; usually a redefinition).
            self.warnings.push(ParseWarning::new(format!(
                "Duplicate table definition `{}` (keeping the first; later one in {} ignored)",
                key, table.source_file
            )));
            let _ = existing;
            return;
        }
        self.index.insert(key, self.tables.len());
        self.tables.push(table);
    }

    /// Resolve pending foreign keys into edges and emit the final model.
    pub fn finish(mut self, dialect: String) -> SchemaModel {
        let pending = std::mem::take(&mut self.pending);
        let mut relationships: Vec<Relationship> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();

        for fk in pending {
            // Mark the local FK columns regardless of whether the target resolves.
            if let Some(&i) = self.index.get(&fk.from_table) {
                for c in self.tables[i].columns.iter_mut() {
                    if fk
                        .from_columns
                        .iter()
                        .any(|fc| fc.eq_ignore_ascii_case(&c.name))
                    {
                        c.is_foreign_key = true;
                    }
                }
            }

            if !self.index.contains_key(&fk.to_table) {
                self.warnings.push(
                    ParseWarning::new(format!(
                        "Foreign key `{}({})` references unknown table `{}` — edge skipped",
                        fk.from_table,
                        fk.from_columns.join(", "),
                        fk.to_table
                    ))
                    .with_location(fk.source_file, fk.line, fk.column),
                );
                continue;
            }

            let id = format!(
                "{}::{}->{}::{}",
                fk.from_table,
                fk.from_columns.join(","),
                fk.to_table,
                fk.to_columns.join(",")
            );
            if !seen.insert(id.clone()) {
                continue; // dedupe identical FKs (e.g. declared in CREATE and ALTER)
            }

            relationships.push(Relationship {
                id,
                from_table: fk.from_table,
                from_columns: fk.from_columns,
                to_table: fk.to_table,
                to_columns: fk.to_columns,
                on_delete: fk.on_delete,
                on_update: fk.on_update,
                inferred: false,
            });
        }

        let table_keys: HashSet<String> = self.tables.iter().map(|t| t.id.clone()).collect();
        for ti in 0..self.tables.len() {
            let from_key = self.tables[ti].id.clone();
            let col_count = self.tables[ti].columns.len();
            for ci in 0..col_count {
                if self.tables[ti].columns[ci].is_foreign_key {
                    continue;
                }
                let col_name = self.tables[ti].columns[ci].name.clone();
                let lower = col_name.to_lowercase();
                let Some(base) = lower.strip_suffix("_id") else {
                    continue;
                };
                if base.is_empty() {
                    continue;
                }
                let Some(target) = resolve_inferred_target(base, &table_keys, &from_key) else {
                    continue;
                };
                if target == from_key {
                    continue;
                }
                let to_pk = primary_key_of(&self.tables, &target);
                let to_cols = if to_pk.is_empty() {
                    vec!["id".to_string()]
                } else {
                    to_pk
                };
                let id = format!(
                    "{}::{}->{}::{}",
                    from_key,
                    col_name,
                    target,
                    to_cols.join(",")
                );
                if !seen.insert(id.clone()) {
                    continue;
                }
                relationships.push(Relationship {
                    id,
                    from_table: from_key.clone(),
                    from_columns: vec![col_name],
                    to_table: target,
                    to_columns: to_cols,
                    on_delete: None,
                    on_update: None,
                    inferred: true,
                });
            }
        }

        SchemaModel {
            tables: self.tables,
            relationships,
            warnings: self.warnings.into_iter().map(|w| w.render()).collect(),
            dialect,
        }
    }
}

fn location_from_span(span: Span) -> (Option<usize>, Option<usize>) {
    let line = if span.start.line == 0 {
        None
    } else {
        Some(span.start.line as usize)
    };
    let column = if span.start.column == 0 {
        None
    } else {
        Some(span.start.column as usize)
    };
    (line, column)
}

fn first_known(
    primary: (Option<usize>, Option<usize>),
    fallback: (Option<usize>, Option<usize>),
) -> (Option<usize>, Option<usize>) {
    if primary.0.is_some() {
        primary
    } else {
        fallback
    }
}

fn resolve_inferred_target(
    base: &str,
    table_keys: &HashSet<String>,
    from_key: &str,
) -> Option<String> {
    let schema_prefix = from_key.rsplit_once('.').map(|(s, _)| s.to_string());
    let bases = [base.to_string(), format!("{base}s"), format!("{base}es")];
    if let Some(s) = &schema_prefix {
        for b in &bases {
            let candidate = format!("{s}.{b}");
            if table_keys.contains(&candidate) {
                return Some(candidate);
            }
        }
    }
    for b in &bases {
        if table_keys.contains(b) {
            return Some(b.clone());
        }
    }
    None
}

fn primary_key_of(tables: &[Table], key: &str) -> Vec<String> {
    if let Some(t) = tables.iter().find(|t| t.id == key) {
        t.columns
            .iter()
            .filter(|c| c.is_primary_key)
            .map(|c| c.name.clone())
            .collect()
    } else {
        Vec::new()
    }
}

fn split_object_name(name: &ObjectName) -> (Option<String>, String) {
    let idents: Vec<&Ident> = name.0.iter().filter_map(|p| p.as_ident()).collect();
    match idents.as_slice() {
        [] => (None, String::new()),
        [t] => (None, t.value.clone()),
        [.., s, t] => (Some(s.value.clone()), t.value.clone()),
    }
}

fn idents_to_strings(idents: &[Ident]) -> Vec<String> {
    idents.iter().map(|i| i.value.clone()).collect()
}

fn index_column_names(cols: &[IndexColumn]) -> Vec<String> {
    cols.iter()
        .filter_map(|ic| expr_ident(&ic.column.expr))
        .collect()
}

fn expr_ident(e: &Expr) -> Option<String> {
    match e {
        Expr::Identifier(i) => Some(i.value.clone()),
        Expr::CompoundIdentifier(parts) => parts.last().map(|i| i.value.clone()),
        _ => None,
    }
}

fn mark_column(columns: &mut [Column], name: &str, f: impl Fn(&mut Column)) {
    for c in columns.iter_mut() {
        if c.name.eq_ignore_ascii_case(name) {
            f(c);
        }
    }
}
