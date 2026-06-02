#!/usr/bin/env node
// Generate a synthetic SchemaModel JSON for performance benchmarking.
// Output matches src-tauri/src/model.rs (and the ts-rs bindings) so it
// can be fed straight into the same buildGraph / runLayout code paths
// the running app uses.
//
// Usage:
//   node scripts/gen-bench-schema.mjs --tables 200 --avg-cols 8 \
//     --fk-ratio 0.7 --seed 42 --out tmp/bench-200.json

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function parseArgs(argv) {
  const out = {
    tables: 200,
    avgCols: 8,
    fkRatio: 0.6,
    seed: 1,
    out: "tmp/bench-schema.json",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eat = () => argv[++i];
    switch (a) {
      case "--tables":
        out.tables = Number(eat());
        break;
      case "--avg-cols":
        out.avgCols = Number(eat());
        break;
      case "--fk-ratio":
        out.fkRatio = Number(eat());
        break;
      case "--seed":
        out.seed = Number(eat());
        break;
      case "--out":
        out.out = eat();
        break;
      case "-h":
      case "--help":
        console.log(
          "gen-bench-schema --tables N --avg-cols K --fk-ratio R --seed S --out path",
        );
        process.exit(0);
        break;
    }
  }
  return out;
}

// Tiny deterministic PRNG (mulberry32) so the same --seed reproduces
// the same schema across machines and runs.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DATA_TYPES = [
  "INTEGER",
  "BIGINT",
  "TEXT",
  "VARCHAR(255)",
  "BOOLEAN",
  "TIMESTAMP",
  "NUMERIC(10,2)",
  "DATE",
];

function generate({ tables, avgCols, fkRatio, seed }) {
  const rand = rng(seed);
  const out = { tables: [], relationships: [], warnings: [], dialect: "bench" };

  for (let i = 0; i < tables; i++) {
    const name = `t_${String(i).padStart(4, "0")}`;
    const colCount = Math.max(2, Math.round(avgCols + (rand() - 0.5) * 4));
    const cols = [
      {
        name: "id",
        data_type: "BIGINT",
        nullable: false,
        is_primary_key: true,
        is_foreign_key: false,
        default: null,
        unique: false,
      },
    ];
    for (let c = 1; c < colCount; c++) {
      cols.push({
        name: `col_${c}`,
        data_type: DATA_TYPES[Math.floor(rand() * DATA_TYPES.length)],
        nullable: rand() < 0.4,
        is_primary_key: false,
        is_foreign_key: false,
        default: null,
        unique: false,
      });
    }
    out.tables.push({
      id: name,
      name,
      schema: null,
      columns: cols,
      source_file: "<bench>",
    });
  }

  // Wire up FKs: every non-first table gets `fkRatio` probability of one FK
  // to an earlier table (so the graph stays a DAG, no self-loops, and
  // resolves cleanly). Add an `fk_<n>` column to hold the FK.
  let relId = 0;
  for (let i = 1; i < tables; i++) {
    if (rand() >= fkRatio) continue;
    const target = Math.floor(rand() * i);
    const child = out.tables[i];
    const parent = out.tables[target];
    const fkColName = `fk_${target}`;
    child.columns.push({
      name: fkColName,
      data_type: "BIGINT",
      nullable: true,
      is_primary_key: false,
      is_foreign_key: true,
      default: null,
      unique: false,
    });
    out.relationships.push({
      id: `r_${String(relId++).padStart(5, "0")}`,
      from_table: child.id,
      from_columns: [fkColName],
      to_table: parent.id,
      to_columns: ["id"],
      on_delete: null,
      on_update: null,
    });
  }

  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const schema = generate(args);
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(schema));
  const cols = schema.tables.reduce((n, t) => n + t.columns.length, 0);
  console.log(
    `wrote ${args.out}: ${schema.tables.length} tables, ` +
      `${schema.relationships.length} relationships, ${cols} columns ` +
      `(seed=${args.seed}, fk-ratio=${args.fkRatio})`,
  );
}

main();
