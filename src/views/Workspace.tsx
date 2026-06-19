import { useState } from "react";
import type { ConnectionMeta, TableRef } from "../lib/types";
import { Sidebar } from "../components/Sidebar";
import { ThemeToggle } from "../components/ThemeToggle";
import { MainPane } from "./MainPane";
import "./Workspace.css";

interface Props {
  connection: ConnectionMeta;
  onDisconnect: () => void;
}

/**
 * Workspace shell: title bar with the live connection pill, sidebar tree, and
 * the main pane. The Data/Structure/Query tabs render into the main pane in
 * later phases; for now it reflects the current selection.
 */
export function Workspace({ connection, onDisconnect }: Props) {
  const [selected, setSelected] = useState<TableRef | null>(null);

  return (
    <div className="ws">
      <header className="ws-titlebar">
        <div className="ws-brand">Lagune</div>
        <div className="ws-conn">
          <span className="pill pill-success">
            <span className="dot" />
            {connection.database}@{connection.host}
          </span>
          {connection.isProd && <span className="pill pill-prod">prod</span>}
          {connection.readOnly && <span className="pill">read-only</span>}
        </div>
        <div style={{ flex: 1 }} />
        <ThemeToggle />
        <button className="btn btn-sm" onClick={onDisconnect}>
          Disconnect
        </button>
      </header>

      <div className="ws-body">
        <aside className="ws-sidebar">
          <Sidebar selected={selected} onSelect={setSelected} />
        </aside>
        <main className="ws-main">
          <MainPane connection={connection} table={selected} />
        </main>
      </div>
    </div>
  );
}
