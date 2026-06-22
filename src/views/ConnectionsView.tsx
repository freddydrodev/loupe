import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { ConnectionMeta } from "../lib/types";
import { ConnectionForm } from "../components/ConnectionForm";
import { Confirm } from "../components/Confirm";
import { ThemeToggle } from "../components/ThemeToggle";
import brandLogo from "../assets/Logo_With_Name_V.png";
import "./ConnectionsView.css";

interface Props {
  onConnected: (meta: ConnectionMeta) => void;
}

export function ConnectionsView({ onConnected }: Props) {
  const [connections, setConnections] = useState<ConnectionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ConnectionMeta | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [toDelete, setToDelete] = useState<ConnectionMeta | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setConnections(await api.listConnections());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onConnect(meta: ConnectionMeta) {
    setConnectingId(meta.id);
    setError(null);
    try {
      await api.connect(meta.id);
      onConnected(meta);
    } catch (e) {
      setError(String(e));
      setConnectingId(null);
    }
  }

  async function onDeleteConfirmed() {
    if (!toDelete) return;
    try {
      await api.deleteConnection(toDelete.id);
      setToDelete(null);
      void refresh();
    } catch (e) {
      setError(String(e));
      setToDelete(null);
    }
  }

  return (
    <div className="conn-view">
      <header className="conn-header">
        <div className="conn-brand">
          <img className="conn-brand-logo" src={brandLogo} alt="Loupe" />
          <p>Connect to a PostgreSQL database to begin.</p>
        </div>
        <div
          style={{
            display: "flex",
            gap: "var(--space-2)",
            alignItems: "center",
          }}
        >
          <ThemeToggle />
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
          >
            + New connection
          </button>
        </div>
      </header>

      {error && (
        <div className="status err" style={{ marginBottom: "var(--space-4)" }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="conn-empty">Loading…</div>
      ) : connections.length === 0 ? (
        <div className="conn-empty">
          <p>No saved connections.</p>
          <p className="hint">
            Create one to store its password in your OS keychain — never in this
            app.
          </p>
        </div>
      ) : (
        <div className="conn-grid">
          {connections.map((c) => (
            <div
              key={c.id}
              className="card conn-card"
              style={
                c.color
                  ? ({ "--conn-color": c.color } as React.CSSProperties)
                  : undefined
              }
              data-colored={c.color ? "" : undefined}
            >
              <div className="conn-card-top">
                <div className="conn-card-title">
                  <span className="conn-label">
                    <span className="conn-dot" aria-hidden />
                    {c.label}
                  </span>
                  <span className="conn-dsn mono">
                    {c.database}@{c.host}
                  </span>
                </div>
                <div className="conn-tags">
                  {c.isProd && <span className="pill pill-prod">prod</span>}
                  {c.readOnly && <span className="pill">read-only</span>}
                </div>
              </div>
              <div className="conn-card-meta mono">
                {c.username} · :{c.port} ·{" "}
                {c.sslMode === "verifyFull" ? "verify-full" : "require"}
              </div>
              <div className="conn-card-actions">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => onConnect(c)}
                  disabled={connectingId !== null}
                >
                  {connectingId === c.id ? "Connecting…" : "Connect"}
                </button>
                <div style={{ flex: 1 }} />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setEditing(c);
                    setShowForm(true);
                  }}
                >
                  Edit
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => setToDelete(c)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <ConnectionForm
          initial={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            void refresh();
          }}
        />
      )}

      {toDelete && (
        <Confirm
          title="Delete connection"
          danger
          confirmLabel="Delete"
          body={
            <>
              Remove <strong>{toDelete.label}</strong> and its stored password
              from your keychain? This cannot be undone.
            </>
          }
          onConfirm={onDeleteConfirmed}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  );
}
