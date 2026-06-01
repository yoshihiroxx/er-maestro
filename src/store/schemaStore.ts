import { create } from "zustand";
import type { SchemaModel } from "../types";
import { parseSchema } from "../api/commands";

export type LayoutKind = "dagre-lr" | "dagre-tb" | "elk";
export type Status = "idle" | "loading" | "error";

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
  searchQuery: string;

  loadFromPaths: (paths: string[]) => Promise<void>;
  setSchema: (schema: SchemaModel, label?: string) => void;
  selectTable: (id: string | null) => void;
  setHoveredColumn: (ref: ColumnRef | null) => void;
  togglePinnedColumn: (ref: ColumnRef) => void;
  clearPinnedColumn: () => void;
  setFocusMode: (on: boolean) => void;
  setFocusDepth: (depth: number) => void;
  setLayoutKind: (kind: LayoutKind) => void;
  setSearchQuery: (query: string) => void;
  clearSelection: () => void;
  reset: () => void;
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
  searchQuery: "",

  loadFromPaths: async (paths) => {
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
    } catch (e) {
      set({ status: "error", error: String(e) });
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
  setSearchQuery: (query) => set({ searchQuery: query }),
  clearSelection: () =>
    set({ selectedTableId: null, hoveredColumn: null, pinnedColumn: null }),
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
}));
