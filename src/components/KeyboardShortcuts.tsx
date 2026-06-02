import { useEffect } from "react";
import { useReactFlow } from "@xyflow/react";

import { useSchemaStore } from "../store/schemaStore";

const SEARCH_INPUT_ID = "sidebar-search-input";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

function focusSearchInput(): boolean {
  const input = document.getElementById(
    SEARCH_INPUT_ID,
  ) as HTMLInputElement | null;
  if (!input) return false;
  input.focus();
  input.select();
  return true;
}

/**
 * Global keyboard shortcuts for the ER canvas. Mounted under <ReactFlowProvider>
 * so it can drive viewport actions via useReactFlow().
 *
 * - `/` or `Cmd/Ctrl+K`: focus the sidebar search input
 * - `Escape`: blur the focused editor, or clear the current selection
 * - `f` / `0`: fit the whole graph in view
 * - `+` / `=`: zoom in   `-` / `_`: zoom out
 */
export function KeyboardShortcuts() {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const clearSelection = useSchemaStore((s) => s.clearSelection);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const editable = isEditableTarget(e.target);
      const mod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl+K focuses the search bar regardless of where focus is.
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        if (focusSearchInput()) e.preventDefault();
        return;
      }

      if (e.key === "Escape") {
        if (editable && e.target instanceof HTMLElement) {
          e.target.blur();
        } else {
          clearSelection();
        }
        return;
      }

      // The remaining shortcuts only fire when the user is NOT typing.
      if (editable) return;
      if (mod || e.altKey) return;

      switch (e.key) {
        case "/":
          if (focusSearchInput()) e.preventDefault();
          return;
        case "f":
        case "F":
        case "0":
          e.preventDefault();
          fitView({ padding: 0.2, duration: 300 });
          return;
        case "+":
        case "=":
          e.preventDefault();
          zoomIn({ duration: 150 });
          return;
        case "-":
        case "_":
          e.preventDefault();
          zoomOut({ duration: 150 });
          return;
        default:
          return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fitView, zoomIn, zoomOut, clearSelection]);

  return null;
}
