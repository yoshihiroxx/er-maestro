// Persistence for the "recently opened schema" history.
//
// Backed by tauri-plugin-store. Calls are guarded so the feature degrades to
// an empty list when the Vite dev server is running outside of Tauri.

import { LazyStore } from "@tauri-apps/plugin-store";

export type RecentSourceKind = "files" | "directory";

export interface RecentEntry {
  id: string;
  paths: string[];
  kind: RecentSourceKind;
  label: string;
  openedAt: number;
}

const STORE_FILE = "recent-schemas.json";
const KEY = "entries";
const MAX_ENTRIES = 12;

const store = new LazyStore(STORE_FILE, { defaults: {}, autoSave: 300 });

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

function makeId(paths: string[]): string {
  return JSON.stringify([...paths].sort());
}

function makeLabel(paths: string[], kind: RecentSourceKind): string {
  if (paths.length === 0) return "(空)";
  const first = basename(paths[0]);
  if (kind === "directory") return first;
  if (paths.length === 1) return first;
  return `${first} 他 ${paths.length - 1} 件`;
}

export async function getRecentEntries(): Promise<RecentEntry[]> {
  try {
    const entries = await store.get<RecentEntry[]>(KEY);
    if (!Array.isArray(entries)) return [];
    return [...entries].sort((a, b) => b.openedAt - a.openedAt);
  } catch {
    return [];
  }
}

export async function recordRecentOpen(
  paths: string[],
  kind: RecentSourceKind,
): Promise<RecentEntry[]> {
  const entry: RecentEntry = {
    id: makeId(paths),
    paths: [...paths],
    kind,
    label: makeLabel(paths, kind),
    openedAt: Date.now(),
  };
  try {
    const existing = await getRecentEntries();
    const next = [entry, ...existing.filter((e) => e.id !== entry.id)].slice(
      0,
      MAX_ENTRIES,
    );
    await store.set(KEY, next);
    await store.save();
    return next;
  } catch {
    return [entry];
  }
}

export async function removeRecentEntry(id: string): Promise<RecentEntry[]> {
  try {
    const next = (await getRecentEntries()).filter((e) => e.id !== id);
    await store.set(KEY, next);
    await store.save();
    return next;
  } catch {
    return [];
  }
}

export async function clearRecentEntries(): Promise<void> {
  try {
    await store.set(KEY, []);
    await store.save();
  } catch {
    // Nothing persisted, nothing to clear.
  }
}
