import { useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";

import { useSchemaStore } from "./store/schemaStore";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { Canvas } from "./components/Canvas";
import { EmptyState } from "./components/EmptyState";

function App() {
  const schema = useSchemaStore((s) => s.schema);
  const status = useSchemaStore((s) => s.status);
  const loadFromPaths = useSchemaStore((s) => s.loadFromPaths);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "enter") {
          setIsDragOver(true);
        } else if (event.payload.type === "leave") {
          setIsDragOver(false);
        } else if (event.payload.type === "drop") {
          setIsDragOver(false);
          const paths = event.payload.paths;
          if (paths.length > 0) {
            loadFromPaths(paths);
          }
        }
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, [loadFromPaths]);

  const hasSchema = schema !== null && status !== "loading";

  return (
    <div className={`app${isDragOver ? " app--drag-over" : ""}`}>
      {isDragOver && (
        <div className="drag-overlay">
          <div className="drag-overlay__inner">
            <span className="drag-overlay__icon">&#8681;</span>
            <p className="drag-overlay__label">.sql ファイルをドロップして読み込む</p>
          </div>
        </div>
      )}
      <Toolbar />
      <div className="app__body">
        {hasSchema ? <Sidebar /> : null}
        <main className="app__canvas">
          {hasSchema ? (
            <ReactFlowProvider>
              <Canvas />
            </ReactFlowProvider>
          ) : (
            <EmptyState />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
