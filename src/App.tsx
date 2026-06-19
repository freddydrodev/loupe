import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Phase 1 shell. The connection manager, sidebar, and tabbed workspace are
 * layered on in later phases; for now this confirms the Rust core is reachable
 * and establishes the app frame.
 */
function App() {
  const [coreReady, setCoreReady] = useState<boolean | null>(null);

  useEffect(() => {
    invoke<string>("app_ready")
      .then((id) => setCoreReady(id === "lagune"))
      .catch(() => setCoreReady(false));
  }, []);

  return (
    <main
      style={{
        flex: 1,
        display: "grid",
        placeItems: "center",
        textAlign: "center",
        gap: "var(--space-4)",
      }}
    >
      <div style={{ display: "grid", gap: "var(--space-2)" }}>
        <h1 style={{ fontSize: 34, letterSpacing: "-0.02em" }}>Lagune</h1>
        <p style={{ color: "var(--text-muted)", margin: 0 }}>
          A modern desktop client for PostgreSQL
        </p>
        <p
          className="mono"
          style={{
            marginTop: "var(--space-3)",
            fontSize: 12,
            color:
              coreReady === null
                ? "var(--text-faint)"
                : coreReady
                  ? "var(--success)"
                  : "var(--danger)",
          }}
        >
          {coreReady === null
            ? "connecting to core…"
            : coreReady
              ? "● core ready"
              : "○ core unreachable"}
        </p>
      </div>
    </main>
  );
}

export default App;
