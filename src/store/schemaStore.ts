import { create } from "zustand";
import type { SchemaModel } from "../types";
import { parseSchema, parseSqlText } from "../api/commands";
import {
  clearRecentEntries,
  getRecentEntries,
  recordRecentOpen,
  removeRecentEntry,
  type RecentEntry,
  type RecentSourceKind,
} from "../api/recentStore";

export type LayoutKind = "dagre-lr" | "dagre-tb" | "elk";
export type EdgeKind = "smoothstep" | "simplebezier";
export type Status = "idle" | "loading" | "error";

const INFERENCE_STORAGE_KEY = "er-maestro:inferenceEnabled";
const AUTO_FIT_ON_SCOPE_STORAGE_KEY = "er-maestro:autoFitOnScope";
const EDGE_KIND_STORAGE_KEY = "er-maestro:edgeKind";

function readInferencePref(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(INFERENCE_STORAGE_KEY);
    if (raw === null) return true;
    return raw === "true";
  } catch {
    return true;
  }
}

function writeInferencePref(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(INFERENCE_STORAGE_KEY, String(on));
  } catch {
    // Storage quota / private mode - ignore; runtime state still works.
  }
}

function readAutoFitOnScopePref(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(AUTO_FIT_ON_SCOPE_STORAGE_KEY);
    if (raw === null) return true;
    return raw === "true";
  } catch {
    return true;
  }
}

function writeAutoFitOnScopePref(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTO_FIT_ON_SCOPE_STORAGE_KEY, String(on));
  } catch {
    // Storage quota / private mode - ignore; runtime state still works.
  }
}

function readEdgeKindPref(): EdgeKind {
  if (typeof window === "undefined") return "smoothstep";
  try {
    const raw = window.localStorage.getItem(EDGE_KIND_STORAGE_KEY);
    return raw === "simplebezier" ? "simplebezier" : "smoothstep";
  } catch {
    return "smoothstep";
  }
}

function writeEdgeKindPref(kind: EdgeKind): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EDGE_KIND_STORAGE_KEY, kind);
  } catch {
    // Storage quota / private mode - ignore; runtime state still works.
  }
}

export type ColumnRef = { tableId: string; columnName: string };

interface SchemaState {
  schema: SchemaModel | null;
  status: Status;
  error: string | null;
  /** Human label for what's currently loaded (path or file count). */
  sourceLabel: string | null;

  selectedTableId: string | null;
  /** Column currently hovered (transient). Cleared on mouse leave. */
  hoveredColumn: ColumnRef | null;
  /** Column pinned by click. Persists across hover changes until cleared/toggled. */
  pinnedColumn: ColumnRef | null;
  /** When true, selecting a table hides everything not related to it. */
  focusMode: boolean;
  /** BFS depth used to compute the "related" set around the selection. */
  focusDepth: number;
  layoutKind: LayoutKind;
  edgeKind: EdgeKind;
  searchQuery: string;
  inferenceEnabled: boolean;
  /**
   * When true, selecting/focusing a scope auto-fits the viewport. Schema loads,
   * layout changes, and explicit search jumps still move the viewport either way.
   */
  autoFitOnScope: boolean;
  /**
   * Bumped whenever the user explicitly asks to center the viewport on the
   * selected table (e.g. pressing Enter in the sidebar search). Canvas watches
   * this counter to pan/zoom instead of just fitting all visible nodes.
   */
  jumpToken: number;
  sqlPasteOpen: boolean;
  /** Recently opened sources, newest first (persisted across restarts). */
  recent: RecentEntry[];

  loadFromPaths: (paths: string[], kind?: RecentSourceKind) => Promise<void>;
  loadFromText: (sql: string, dialect?: string) => Promise<void>;
  setSchema: (schema: SchemaModel, label?: string) => void;
  selectTable: (id: string | null) => void;
  setHoveredColumn: (ref: ColumnRef | null) => void;
  togglePinnedColumn: (ref: ColumnRef) => void;
  clearPinnedColumn: () => void;
  setFocusMode: (on: boolean) => void;
  setFocusDepth: (depth: number) => void;
  setLayoutKind: (kind: LayoutKind) => void;
  setEdgeKind: (kind: EdgeKind) => void;
  setSearchQuery: (query: string) => void;
  setInferenceEnabled: (on: boolean) => void;
  setAutoFitOnScope: (on: boolean) => void;
  clearSelection: () => void;
  reset: () => void;
  /** Select `id` and signal Canvas to center on it. */
  jumpToTable: (id: string) => void;
  openSqlPaste: () => void;
  closeSqlPaste: () => void;
  /** Load the persisted history into state (call once on startup). */
  refreshRecent: () => Promise<void>;
  removeRecent: (id: string) => Promise<void>;
  clearRecent: () => Promise<void>;
}

function sameColumnRef(a: ColumnRef | null, b: ColumnRef | null): boolean {
  if (!a || !b) return a === b;
  return a.tableId === b.tableId && a.columnName === b.columnName;
}

export const useSchemaStore = create<SchemaState>((set) => ({
  schema: null,
  status: "idle",
  error: null,
  sourceLabel: null,

  selectedTableId: null,
  hoveredColumn: null,
  pinnedColumn: null,
  focusMode: true,
  focusDepth: 1,
  layoutKind: "dagre-lr",
  edgeKind: readEdgeKindPref(),
  searchQuery: "",
  inferenceEnabled: readInferencePref(),
  autoFitOnScope: readAutoFitOnScopePref(),
  jumpToken: 0,
  sqlPasteOpen: false,
  recent: [],

  loadFromPaths: async (paths, kind = "files") => {
    set({ status: "loading", error: null });
    try {
      const schema = await parseSchema(paths);
      set({
        schema,
        status: "idle",
        error: null,
        selectedTableId: null,
        hoveredColumn: null,
        pinnedColumn: null,
        searchQuery: "",
        sourceLabel:
          paths.length === 1 ? paths[0] : `${paths.length} 件のパス`,
      });
      const recent = await recordRecentOpen(paths, kind);
      set({ recent });
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },

  loadFromText: async (sql, dialect) => {
    set({ status: "loading", error: null });
    try {
      const schema = await parseSqlText(sql, dialect);
      set({
        schema,
        status: "idle",
        error: null,
        selectedTableId: null,
        searchQuery: "",
        sourceLabel: "テキスト入力",
        sqlPasteOpen: false,
      });
    } catch (e) {
      set({ status: "error", error: String(e) });
      throw e;
    }
  },

  setSchema: (schema, label) =>
    set({
      schema,
      status: "idle",
      error: null,
      selectedTableId: null,
      hoveredColumn: null,
      pinnedColumn: null,
      sourceLabel: label ?? "テキスト入力",
    }),

  selectTable: (id) =>
    set({ selectedTableId: id, hoveredColumn: null, pinnedColumn: null }),
  setHoveredColumn: (ref) =>
    set((s) => (sameColumnRef(s.hoveredColumn, ref) ? s : { hoveredColumn: ref })),
  togglePinnedColumn: (ref) =>
    set((s) => ({
      pinnedColumn: sameColumnRef(s.pinnedColumn, ref) ? null : ref,
    })),
  clearPinnedColumn: () => set({ pinnedColumn: null }),
  setFocusMode: (on) => set({ focusMode: on }),
  setFocusDepth: (depth) => set({ focusDepth: depth }),
  setLayoutKind: (kind) => set({ layoutKind: kind }),
  setEdgeKind: (kind) => {
    writeEdgeKindPref(kind);
    set({ edgeKind: kind });
  },
  setSearchQuery: (query) => set({ searchQuery: query }),
  setInferenceEnabled: (on) => {
    writeInferencePref(on);
    set({ inferenceEnabled: on });
  },
  setAutoFitOnScope: (on) => {
    writeAutoFitOnScopePref(on);
    set({ autoFitOnScope: on });
  },
  clearSelection: () =>
    set({ selectedTableId: null, hoveredColumn: null, pinnedColumn: null }),
  jumpToTable: (id) =>
    set((s) => ({ selectedTableId: id, jumpToken: s.jumpToken + 1 })),
  reset: () =>
    set({
      schema: null,
      status: "idle",
      error: null,
      selectedTableId: null,
      hoveredColumn: null,
      pinnedColumn: null,
      sourceLabel: null,
      searchQuery: "",
    }),
  openSqlPaste: () => set({ sqlPasteOpen: true }),
  closeSqlPaste: () => set({ sqlPasteOpen: false }),
  refreshRecent: async () => {
    const recent = await getRecentEntries();
    set({ recent });
  },
  removeRecent: async (id) => {
    const recent = await removeRecentEntry(id);
    set({ recent });
  },
  clearRecent: async () => {
    await clearRecentEntries();
    set({ recent: [] });
  },
}));
