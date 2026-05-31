import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { SchemaModel } from "../types";

/** Parse a list of file/directory paths into one merged schema (Rust side). */
export async function parseSchema(paths: string[]): Promise<SchemaModel> {
  return await invoke<SchemaModel>("parse_schema", { paths });
}

/** Parse raw SQL text directly. */
export async function parseSqlText(
  sql: string,
  dialect?: string,
): Promise<SchemaModel> {
  return await invoke<SchemaModel>("parse_sql_text", {
    sql,
    dialect: dialect ?? null,
  });
}

/** Open the native dialog to pick one or more `.sql` files. */
export async function pickSqlFiles(): Promise<string[] | null> {
  const selected = await open({
    multiple: true,
    filters: [{ name: "SQL", extensions: ["sql"] }],
  });
  if (selected == null) return null;
  return Array.isArray(selected) ? selected : [selected];
}

/** Open the native dialog to pick a directory (scanned recursively for `.sql`). */
export async function pickDirectory(): Promise<string[] | null> {
  const selected = await open({ directory: true });
  if (selected == null) return null;
  return [selected as string];
}
