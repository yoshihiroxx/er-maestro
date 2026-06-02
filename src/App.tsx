import { ReactFlowProvider } from "@xyflow/react";
import "./App.css";

import { useSchemaStore } from "./store/schemaStore";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { Canvas } from "./components/Canvas";
import { EmptyState } from "./components/EmptyState";
import { SqlPasteModal } from "./components/SqlPasteModal";

function App() {
  const schema = useSchemaStore((s) => s.schema);
  const status = useSchemaStore((s) => s.status);

  const hasSchema = schema !== null && status !== "loading";

  return (
    <div className="app">
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
      <SqlPasteModal />
    </div>
  );
}

export default App;
