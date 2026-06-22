import { useEffect, useState } from "react";
import { api } from "./lib/api";
import type { ConnectionMeta } from "./lib/types";
import { ConnectionsView } from "./views/ConnectionsView";
import { Workspace } from "./views/Workspace";

function App() {
  const [active, setActive] = useState<ConnectionMeta | null>(null);
  const [restoring, setRestoring] = useState(true);

  // Restore an already-open connection (survives a dev HMR reload).
  useEffect(() => {
    api
      .currentConnection()
      .then(setActive)
      .catch(() => setActive(null))
      .finally(() => setRestoring(false));
  }, []);

  async function disconnect() {
    await api.disconnect().catch(() => {});
    setActive(null);
  }

  // Switch to another saved connection in place. The Rust `connect` command
  // closes the previous pool and swaps the active one, so we only flip state
  // once the new pool is live — a failed switch leaves the current session intact.
  async function switchConnection(meta: ConnectionMeta) {
    await api.connect(meta.id);
    setActive(meta);
  }

  if (restoring) {
    return (
      <main style={{ flex: 1, display: "grid", placeItems: "center" }}>
        <span className="status muted">starting…</span>
      </main>
    );
  }

  return active ? (
    <Workspace
      connection={active}
      onDisconnect={disconnect}
      onSwitch={switchConnection}
    />
  ) : (
    <ConnectionsView onConnected={setActive} />
  );
}

export default App;
