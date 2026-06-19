import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/api";
import { blankConnection, type ConnectionMeta } from "../lib/types";
import { Switch } from "./Switch";

interface Props {
  /** Existing connection to edit, or null to create a new one. */
  initial: ConnectionMeta | null;
  onClose: () => void;
  onSaved: (meta: ConnectionMeta) => void;
}

type Busy = null | "test" | "save";

export function ConnectionForm({ initial, onClose, onSaved }: Props) {
  const editing = initial !== null;
  const [meta, setMeta] = useState<ConnectionMeta>(initial ?? blankConnection());
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteValue, setPasteValue] = useState("");

  function patch(p: Partial<ConnectionMeta>) {
    setMeta((m) => ({ ...m, ...p }));
    setOk(null);
    setError(null);
  }

  // The password is sent only when the user typed one. Editing without typing a
  // password keeps the existing keychain secret untouched.
  const passwordArg = () => (password.length > 0 ? password : null);

  async function onParse() {
    setError(null);
    try {
      const parsed = await api.parseConnectionString(pasteValue.trim());
      // Preserve user-chosen guards and the editing id; never the password.
      setMeta((m) => ({
        ...parsed,
        id: m.id,
        label: m.label || parsed.label,
        readOnly: m.readOnly,
        isProd: m.isProd,
      }));
      setPasteOpen(false);
      setPasteValue("");
      setOk("Parsed. Re-enter the password — it is never read from the string.");
    } catch (e) {
      setError(String(e));
    }
  }

  async function onBrowseCert() {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Certificate", extensions: ["crt", "pem", "cer", "ca"] }],
    });
    if (typeof path === "string") patch({ rootCertPath: path });
  }

  async function onTest() {
    setBusy("test");
    setError(null);
    setOk(null);
    try {
      await api.testConnection(meta, passwordArg());
      setOk("Connection succeeded over TLS.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onSave() {
    setBusy("save");
    setError(null);
    try {
      const saved = await api.saveConnection(meta, passwordArg());
      onSaved(saved);
    } catch (e) {
      setError(String(e));
      setBusy(null);
    }
  }

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={editing ? "Edit connection" : "New connection"}
      >
        <div className="modal-header">
          <h3>{editing ? "Edit connection" : "New connection"}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <button
            className="btn btn-ghost btn-sm"
            style={{ justifySelf: "start" }}
            onClick={() => setPasteOpen((v) => !v)}
          >
            {pasteOpen ? "− Hide" : "+ Paste a connection string"}
          </button>
          {pasteOpen && (
            <div className="field">
              <textarea
                className="input"
                rows={2}
                placeholder="postgresql://user@host/db?sslmode=require"
                value={pasteValue}
                onChange={(e) => setPasteValue(e.currentTarget.value)}
              />
              <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
                <button className="btn btn-sm" onClick={onParse} disabled={!pasteValue.trim()}>
                  Parse into fields
                </button>
                <span className="hint">
                  The password and <code>channel_binding</code> are dropped — Lagune sets neither.
                </span>
              </div>
            </div>
          )}

          <div className="field">
            <label htmlFor="cf-label">Label</label>
            <input
              id="cf-label"
              className="input"
              value={meta.label}
              onChange={(e) => patch({ label: e.currentTarget.value })}
              placeholder="My Neon database"
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 96px", gap: "var(--space-3)" }}>
            <div className="field">
              <label htmlFor="cf-host">Host</label>
              <input
                id="cf-host"
                className="input mono"
                value={meta.host}
                onChange={(e) => patch({ host: e.currentTarget.value })}
                placeholder="ep-xxx.eu-central-1.aws.neon.tech"
              />
            </div>
            <div className="field">
              <label htmlFor="cf-port">Port</label>
              <input
                id="cf-port"
                className="input mono"
                type="number"
                value={meta.port}
                onChange={(e) => patch({ port: Number(e.currentTarget.value) || 5432 })}
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
            <div className="field">
              <label htmlFor="cf-db">Database</label>
              <input
                id="cf-db"
                className="input mono"
                value={meta.database}
                onChange={(e) => patch({ database: e.currentTarget.value })}
                placeholder="neondb"
              />
            </div>
            <div className="field">
              <label htmlFor="cf-user">User</label>
              <input
                id="cf-user"
                className="input mono"
                value={meta.username}
                onChange={(e) => patch({ username: e.currentTarget.value })}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="cf-pw">
              Password {editing && <span className="hint">— leave blank to keep current</span>}
            </label>
            <input
              id="cf-pw"
              className="input"
              type="password"
              value={password}
              autoComplete="off"
              onChange={(e) => {
                setPassword(e.currentTarget.value);
                setOk(null);
                setError(null);
              }}
              placeholder={editing ? "••••••••" : "Required"}
            />
          </div>

          <div className="field">
            <label htmlFor="cf-ssl">SSL mode</label>
            <select
              id="cf-ssl"
              className="select"
              value={meta.sslMode}
              onChange={(e) => patch({ sslMode: e.currentTarget.value as ConnectionMeta["sslMode"] })}
            >
              <option value="require">require — encrypted, no cert check (Neon minimum)</option>
              <option value="verifyFull">verify-full — encrypted + verified server cert</option>
            </select>
            <span className="hint">TLS is mandatory. Plaintext connections are refused.</span>
          </div>

          {meta.sslMode === "verifyFull" && (
            <div className="field">
              <label htmlFor="cf-cert">Root certificate</label>
              <div style={{ display: "flex", gap: "var(--space-3)" }}>
                <input
                  id="cf-cert"
                  className="input mono"
                  value={meta.rootCertPath ?? ""}
                  onChange={(e) => patch({ rootCertPath: e.currentTarget.value || null })}
                  placeholder="/path/to/root.crt"
                />
                <button className="btn btn-sm" onClick={onBrowseCert}>
                  Browse…
                </button>
              </div>
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "var(--space-3)",
              alignItems: "center",
            }}
          >
            <Switch
              label="Read-only"
              hint="Block all writes on this connection"
              checked={meta.readOnly}
              onChange={(v) => patch({ readOnly: v })}
            />
            <Switch
              label="Mark as production"
              hint="Defaults the connection to read-only"
              checked={meta.isProd}
              onChange={(v) => patch({ isProd: v, readOnly: v ? true : meta.readOnly })}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
            <div className="field">
              <label htmlFor="cf-timeout">Statement timeout (ms)</label>
              <input
                id="cf-timeout"
                className="input mono"
                type="number"
                value={meta.statementTimeoutMs}
                onChange={(e) =>
                  patch({ statementTimeoutMs: Number(e.currentTarget.value) || 0 })
                }
              />
            </div>
            <div className="field">
              <label htmlFor="cf-rowlimit">Default row cap</label>
              <input
                id="cf-rowlimit"
                className="input mono"
                type="number"
                value={meta.rowLimit}
                onChange={(e) => patch({ rowLimit: Number(e.currentTarget.value) || 0 })}
              />
            </div>
          </div>

          {(error || ok) && (
            <div className={`status ${error ? "err" : "ok"}`}>{error ?? ok}</div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onTest} disabled={busy !== null}>
            {busy === "test" ? "Testing…" : "Test connection"}
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={busy !== null}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onSave} disabled={busy !== null}>
            {busy === "save" ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
