import { useEffect, useState } from "react";
import type { ConnectionMeta, TableRef } from "../lib/types";
import { Sidebar } from "../components/Sidebar";
import { ThemeToggle } from "../components/ThemeToggle";
import { ConnectionSwitcher } from "../components/ConnectionSwitcher";
import { ConnectionForm } from "../components/ConnectionForm";
import { MainPane } from "./MainPane";
import "./Workspace.css";

interface Props {
  connection: ConnectionMeta;
  onDisconnect: () => void;
  onSwitch: (meta: ConnectionMeta) => Promise<void>;
}

/**
 * Workspace shell: a titlebar carrying the brand and the connection switcher, a
 * sidebar schema tree, and the tabbed main pane. The active connection's color
 * threads through the chrome (the left rail, the switcher, selections) so the
 * database you're in is unmistakable at a glance.
 */
export function Workspace({ connection, onDisconnect, onSwitch }: Props) {
  const [selected, setSelected] = useState<TableRef | null>(null);
  const [showForm, setShowForm] = useState(false);

  // A switch swaps the whole database under us — drop any stale selection.
  useEffect(() => {
    setSelected(null);
  }, [connection.id]);

  const conn = connection.color ?? "var(--accent)";

  return (
    <div
      className="ws"
      data-prod={connection.isProd ? "" : undefined}
      style={{ "--conn": conn } as React.CSSProperties}
    >
      <header className="ws-titlebar">
        <div className="ws-brand">
          <span className="ws-brand-mark" aria-hidden />
          Loupe
        </div>
        <div className="ws-titlebar-sep" aria-hidden />
        <ConnectionSwitcher
          current={connection}
          onSwitch={onSwitch}
          onDisconnect={onDisconnect}
        />
        <button
          className="ws-add-conn"
          onClick={() => setShowForm(true)}
          aria-label="New connection"
          title="New connection"
        >
          +
        </button>
        <div style={{ flex: 1 }} />
        <ThemeToggle />
        <button className="btn btn-sm" onClick={onDisconnect}>
          Disconnect
        </button>
      </header>

      <div className="ws-body">
        <aside className="ws-sidebar">
          {/* Remount on switch so the schema tree reloads for the new database. */}
          <Sidebar key={connection.id} selected={selected} onSelect={setSelected} />
        </aside>
        <main className="ws-main">
          <MainPane connection={connection} table={selected} />
        </main>
      </div>

      {showForm && (
        <ConnectionForm
          initial={null}
          onClose={() => setShowForm(false)}
          onSaved={(meta) => {
            setShowForm(false);
            // Hop straight into the freshly-saved connection.
            void onSwitch(meta).catch(() => {});
          }}
        />
      )}
    </div>
  );
}
