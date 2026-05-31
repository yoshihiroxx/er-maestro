//! Dialect detection and tolerant ("best effort") parsing.
//!
//! sqlparser is all-or-nothing per call, so we first try to parse the whole
//! file with the most likely dialect (and a few fallbacks). If none parse the
//! entire input, we split the SQL into individual statements and parse each on
//! its own, skipping the ones that fail (vendor-specific DDL, `SET`, etc.) and
//! recording a warning. This keeps a single bad statement from discarding the
//! whole file — exactly what a read-only viewer wants.

use sqlparser::ast::Statement;
use sqlparser::dialect::{
    Dialect, GenericDialect, MsSqlDialect, MySqlDialect, PostgreSqlDialect, SQLiteDialect,
};
use sqlparser::parser::Parser;

pub struct ParseResult {
    pub label: String,
    pub statements: Vec<Statement>,
    pub warnings: Vec<String>,
}

const ALL: [&str; 5] = ["postgres", "mysql", "sqlite", "mssql", "generic"];

fn dialect_for(label: &str) -> Box<dyn Dialect> {
    match label {
        "postgres" => Box::new(PostgreSqlDialect {}),
        "mysql" => Box::new(MySqlDialect {}),
        "sqlite" => Box::new(SQLiteDialect {}),
        "mssql" => Box::new(MsSqlDialect {}),
        _ => Box::new(GenericDialect {}),
    }
}

/// Cheap heuristic to guess the dialect from distinctive syntax.
fn detect(sql: &str) -> &'static str {
    let lower = sql.to_lowercase();
    if sql.contains('`') {
        return "mysql";
    }
    if lower.contains("autoincrement") || lower.contains("without rowid") {
        return "sqlite";
    }
    if lower.contains("nvarchar") || lower.contains("getdate(") || lower.contains("[dbo]") {
        return "mssql";
    }
    if lower.contains("serial")
        || lower.contains("bytea")
        || lower.contains("::")
        || lower.contains("gen_random_uuid")
        || lower.contains("uuid_generate")
        || lower.contains("with time zone")
    {
        return "postgres";
    }
    "generic"
}

/// Build the ordered list of dialects to try: an optional explicit hint first,
/// then the heuristic guess, then everything else (always ending in generic).
fn candidate_order(sql: &str, hint: Option<&str>) -> Vec<&'static str> {
    let mut order: Vec<&'static str> = Vec::new();
    let push = |label: &'static str, order: &mut Vec<&'static str>| {
        if !order.contains(&label) {
            order.push(label);
        }
    };
    if let Some(h) = hint {
        if let Some(known) = ALL.iter().find(|l| **l == h) {
            push(known, &mut order);
        }
    }
    push(detect(sql), &mut order);
    push("generic", &mut order);
    for l in ALL {
        push(l, &mut order);
    }
    order
}

pub fn best_effort_parse(sql: &str, hint: Option<&str>) -> ParseResult {
    let order = candidate_order(sql, hint);

    // 1. Try a full parse with each candidate dialect.
    for label in &order {
        if let Ok(statements) = Parser::parse_sql(&*dialect_for(label), sql) {
            return ParseResult {
                label: (*label).to_string(),
                statements,
                warnings: Vec::new(),
            };
        }
    }

    // 2. Recovery: parse statement-by-statement with the primary candidate.
    let primary = order[0];
    let dialect = dialect_for(primary);
    let mut statements = Vec::new();
    let mut warnings = Vec::new();
    for chunk in split_statements(sql) {
        let trimmed = chunk.trim();
        if trimmed.is_empty() {
            continue;
        }
        match Parser::parse_sql(&*dialect, trimmed) {
            Ok(mut s) => statements.append(&mut s),
            Err(e) => warnings.push(format!(
                "Skipped a statement that failed to parse [{}]: \"{}\" ({})",
                primary,
                snippet(trimmed),
                e
            )),
        }
    }
    ParseResult {
        label: format!("{primary} (partial)"),
        statements,
        warnings,
    }
}

fn snippet(s: &str) -> String {
    let one_line: String = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() > 60 {
        let truncated: String = one_line.chars().take(57).collect();
        format!("{truncated}...")
    } else {
        one_line
    }
}

/// Split SQL into top-level statements on `;`, while respecting single/double/
/// backtick quotes, line (`--`) and block (`/* */`) comments, and Postgres
/// dollar-quoted strings (`$tag$ ... $tag$`).
fn split_statements(sql: &str) -> Vec<String> {
    let chars: Vec<char> = sql.chars().collect();
    let n = chars.len();
    let mut out: Vec<String> = Vec::new();
    let mut start = 0usize;
    let mut i = 0usize;

    while i < n {
        let c = chars[i];
        match c {
            '-' if i + 1 < n && chars[i + 1] == '-' => {
                i += 2;
                while i < n && chars[i] != '\n' {
                    i += 1;
                }
            }
            '/' if i + 1 < n && chars[i + 1] == '*' => {
                i += 2;
                while i + 1 < n && !(chars[i] == '*' && chars[i + 1] == '/') {
                    i += 1;
                }
                i = (i + 2).min(n);
            }
            '\'' | '"' | '`' => {
                let q = c;
                i += 1;
                while i < n {
                    if chars[i] == q {
                        // Doubled quote is an escape inside ' and " strings.
                        if (q == '\'' || q == '"') && i + 1 < n && chars[i + 1] == q {
                            i += 2;
                            continue;
                        }
                        i += 1;
                        break;
                    }
                    i += 1;
                }
            }
            '$' => {
                if let Some(tag_len) = dollar_tag_len(&chars, i) {
                    let tag: Vec<char> = chars[i..i + tag_len].to_vec();
                    i += tag_len;
                    while i < n {
                        if chars[i] == '$' && matches_at(&chars, i, &tag) {
                            i += tag.len();
                            break;
                        }
                        i += 1;
                    }
                } else {
                    i += 1;
                }
            }
            ';' => {
                out.push(chars[start..i].iter().collect());
                i += 1;
                start = i;
            }
            _ => i += 1,
        }
    }
    if start < n {
        out.push(chars[start..n].iter().collect());
    }
    out
}

/// If `chars[i]` starts a dollar-quote opening tag (`$tag$` or `$$`), return the
/// length of that tag in chars (including both `$`), else `None`.
fn dollar_tag_len(chars: &[char], i: usize) -> Option<usize> {
    let mut j = i + 1;
    while j < chars.len() && (chars[j].is_alphanumeric() || chars[j] == '_') {
        j += 1;
    }
    if j < chars.len() && chars[j] == '$' {
        Some(j - i + 1)
    } else {
        None
    }
}

fn matches_at(chars: &[char], i: usize, tag: &[char]) -> bool {
    i + tag.len() <= chars.len() && chars[i..i + tag.len()] == tag[..]
}
