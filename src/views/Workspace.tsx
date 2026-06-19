import type { ConnectionMeta } from "../lib/types";
import "./Workspace.css";

interface Props {
  connection: ConnectionMeta;
  onDisconnect: () => void;
}

/**
 * Workspace shell: title bar with the live connection pill, plus the
 * sidebar/main split. The sidebar tree and tabbed panes are added in later
 * phases; this establishes the frame and the disconnect path.
 */
export function Workspace({ connection, onDisconnect }: Props) {
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
        <button className="btn btn-sm" onClick={onDisconnect}>
          Disconnect
        </button>
      </header>

      <div className="ws-body">
        <aside className="ws-sidebar">
          <div className="ws-placeholder">Schema tree — next phase</div>
        </aside>
        <main className="ws-main">
          <div className="ws-placeholder">Select a table to explore its data.</div>
        </main>
      </div>
    </div>
  );
}
