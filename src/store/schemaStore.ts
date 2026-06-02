import { create } from "zustand";
import type { SchemaModel } from "../types";
import { parseSchema, parseSqlText } from "../api/commands";

export type LayoutKind = "dagre-lr" | "dagre-tb" | "elk";
export type Status = "idle" | "loading" | "error";

interface SchemaState {
  schema: SchemaModel | null;
  status: Status;
  error: string | null;
  /** Human label for what's currently loaded (path or file count). */
  sourceLabel: string | null;

  selectedTableId: string | null;
  /** When true, selecting a table hides everything not related to it. */
  focusMode: boolean;
  /** BFS depth used to compute the "related" set around the selection. */
  focusDepth: number;
  layoutKind: LayoutKind;
  searchQuery: string;
  /**
   * Bumped whenever the user explicitly asks to center the viewport on the
   * selected table (e.g. pressing Enter in the sidebar search). Canvas watches
   * this counter to pan/zoom instead of just fitting all visible nodes.
   */
  jumpToken: number;
  sqlPasteOpen: boolean;

  loadFromPaths: (paths: string[]) => Promise<void>;
  loadFromText: (sql: string, dialect?: string) => Promise<void>;
  setSchema: (schema: SchemaModel, label?: string) => void;
  selectTable: (id: string | null) => void;
  setFocusMode: (on: boolean) => void;
  setFocusDepth: (depth: number) => void;
  setLayoutKind: (kind: LayoutKind) => void;
  setSearchQuery: (query: string) => void;
  clearSelection: () => void;
  reset: () => void;
  /** Select `id` and signal Canvas to center on it. */
  jumpToTable: (id: string) => void;
  openSqlPaste: () => void;
  closeSqlPaste: () => void;
}

export const useSchemaStore = create<SchemaState>((set) => ({
  schema: null,
  status: "idle",
  error: null,
  sourceLabel: null,

  selectedTableId: null,
  focusMode: true,
  focusDepth: 1,
  layoutKind: "dagre-lr",
  searchQuery: "",
  jumpToken: 0,
  sqlPasteOpen: false,

  loadFromPaths: async (paths) => {
    set({ status: "loading", error: null });
    try {
      const schema = await parseSchema(paths);
      set({
        schema,
        status: "idle",
        error: null,
        selectedTableId: null,
        searchQuery: "",
        sourceLabel:
          paths.length === 1 ? paths[0] : `${paths.length} 件のパス`,
      });
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
      sourceLabel: label ?? "テキスト入力",
    }),

  selectTable: (id) => set({ selectedTableId: id }),
  setFocusMode: (on) => set({ focusMode: on }),
  setFocusDepth: (depth) => set({ focusDepth: depth }),
  setLayoutKind: (kind) => set({ layoutKind: kind }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  clearSelection: () => set({ selectedTableId: null }),
  jumpToTable: (id) =>
    set((s) => ({ selectedTableId: id, jumpToken: s.jumpToken + 1 })),
  reset: () =>
    set({
      schema: null,
      status: "idle",
      error: null,
      selectedTableId: null,
      sourceLabel: null,
      searchQuery: "",
    }),
  openSqlPaste: () => set({ sqlPasteOpen: true }),
  closeSqlPaste: () => set({ sqlPasteOpen: false }),
}));
