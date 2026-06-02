import { useState } from "react";
import { Panel, useReactFlow } from "@xyflow/react";

import { exportDiagram, type ExportFormat } from "../graph/exportImage";
import { useSchemaStore } from "../store/schemaStore";

function defaultFileName(label: string | null, ext: ExportFormat): string {
  const base = label
    ? label.split(/[\\/]/).pop()?.replace(/\.sql$/i, "") || "er-diagram"
    : "er-diagram";
  return `${base}.${ext}`;
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

export function ExportPanel() {
  const sourceLabel = useSchemaStore((s) => s.sourceLabel);
  const { fitView } = useReactFlow();
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async (format: ExportFormat) => {
    if (busy) return;
    setBusy(format);
    setError(null);
    try {
      fitView({ padding: 0.1, duration: 0 });
      await waitForFrame();
      await exportDiagram(format, defaultFileName(sourceLabel, format));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel position="top-right" className="export-panel">
      <button
        type="button"
        onClick={() => handleExport("png")}
        disabled={busy !== null}
        title="現在のER図ビュー全体をPNGとして保存"
      >
        {busy === "png" ? "PNG 保存中..." : "PNG 保存"}
      </button>
      <button
        type="button"
        onClick={() => handleExport("svg")}
        disabled={busy !== null}
        title="現在のER図ビュー全体をSVGとして保存"
      >
        {busy === "svg" ? "SVG 保存中..." : "SVG 保存"}
      </button>
      {error ? (
        <span className="export-panel__error" role="alert">
          {error}
        </span>
      ) : null}
    </Panel>
  );
}
