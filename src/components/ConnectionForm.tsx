import { useState, type CSSProperties } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/api";
import {
  blankConnection,
  CONNECTION_COLORS,
  type ConnectionMeta,
} from "../lib/types";
import { Switch } from "./Switch";
import "./ConnectionForm.css";

interface Props {
  /** Existing connection to edit, or null to create a new one. */
  initial: ConnectionMeta | null;
  onClose: () => void;
  onSaved: (meta: ConnectionMeta) => void;
}

type Busy = null | "test" | "save";
type Tab = "uri" | "advanced";

/** Build a libpq URL from structured metadata. Used to seed the string tab so
 * the two views stay coherent. The password is included only when present in
 * memory — it is never persisted here. */
function buildConnectionString(m: ConnectionMeta, pw: string): string {
  if (!m.host) return "";
  const cred = m.username
    ? `${encodeURIComponent(m.username)}${pw ? `:${encodeURIComponent(pw)}` : ""}@`
    : "";
  const port = m.port ? `:${m.port}` : "";
  const db = m.database ? `/${encodeURIComponent(m.database)}` : "";
  const ssl = m.sslMode === "verifyFull" ? "verify-full" : "require";
  return `postgresql://${cred}${m.host}${port}${db}?sslmode=${ssl}`;
}

/** Pull a password out of a URL in memory only. The backend parser drops it on
 * purpose; we recover it client-side so the string tab can be a single field. */
function passwordFromUri(uri: string): string | null {
  try {
    const u = new URL(uri.trim().replace(/^postgres(ql)?:/i, "http:"));
    return u.password ? decodeURIComponent(u.password) : null;
  } catch {
    return null;
  }
}

export function ConnectionForm({ initial, onClose, onSaved }: Props) {
  const editing = initial !== null;
  const [meta, setMeta] = useState<ConnectionMeta>(
    initial ?? blankConnection(),
  );
  const [password, setPassword] = useState("");
  const [tab, setTab] = useState<Tab>("uri");
  const [uri, setUri] = useState(() =>
    initial ? buildConnectionString(initial, "") : "",
  );
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [swatchOpen, setSwatchOpen] = useState(false);

  function patch(p: Partial<ConnectionMeta>) {
    setMeta((m) => ({ ...m, ...p }));
    setOk(null);
    setError(null);
  }

  // The password is sent only when the user provided one. Editing without a
  // fresh password keeps the existing keychain secret untouched.
  const passwordArg = () => (password.length > 0 ? password : null);

  /** Fold the string tab back into structured metadata + in-memory password.
   * Runs before any test/save issued from the string tab, and on tab switch. */
  async function syncFromUri(): Promise<ConnectionMeta> {
    if (tab !== "uri" || !uri.trim()) return meta;
    const parsed = await api.parseConnectionString(uri.trim());
    const merged: ConnectionMeta = {
      ...parsed,
      id: meta.id,
      label: meta.label,
      color: meta.color,
      readOnly: meta.readOnly,
      isProd: meta.isProd,
      prismaSchemaPath: meta.prismaSchemaPath,
    };
    setMeta(merged);
    const pw = passwordFromUri(uri);
    if (pw) setPassword(pw);
    return merged;
  }

  async function switchTab(next: Tab) {
    if (next === tab) return;
    setError(null);
    setOk(null);
    try {
      if (next === "advanced") {
        await syncFromUri();
      } else {
        // Going back to the string view: regenerate from the latest fields.
        setUri(buildConnectionString(meta, password));
      }
      setTab(next);
    } catch (e) {
      setError(String(e));
    }
  }

  async function onBrowseCert() {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [
        { name: "Certificate", extensions: ["crt", "pem", "cer", "ca"] },
      ],
    });
    if (typeof path === "string") patch({ rootCertPath: path });
  }

  async function onBrowsePrisma() {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Prisma schema", extensions: ["prisma"] }],
    });
    if (typeof path === "string") patch({ prismaSchemaPath: path });
  }

  async function onTest() {
    setBusy("test");
    setError(null);
    setOk(null);
    try {
      const m = await syncFromUri();
      const pw =
        tab === "uri" ? (passwordFromUri(uri) ?? passwordArg()) : passwordArg();
      await api.testConnection(m, pw);
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
      const m = await syncFromUri();
      const pw =
        tab === "uri" ? (passwordFromUri(uri) ?? passwordArg()) : passwordArg();
      const saved = await api.saveConnection(m, pw);
      onSaved(saved);
    } catch (e) {
      setError(String(e));
      setBusy(null);
    }
  }

  const accent = meta.color ?? "var(--accent)";
  const themeStyle = { "--conn-accent": accent } as CSSProperties;

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal cf-modal"
        role="dialog"
        aria-modal="true"
        aria-label={editing ? "Edit connection" : "New connection"}
        style={themeStyle}
      >
        {/* Identity band — name + color are always present, above the tabs. */}
        <div className="cf-identity">
          <div className="cf-swatch-wrap">
            <button
              type="button"
              className="cf-swatch"
              aria-label="Connection color"
              aria-expanded={swatchOpen}
              style={{ background: meta.color ?? "transparent" }}
              onClick={() => setSwatchOpen((v) => !v)}
            >
              {!meta.color && <span className="cf-swatch-empty" />}
            </button>
            {swatchOpen && (
              <div
                className="cf-swatch-pop"
                role="listbox"
                aria-label="Pick a color"
              >
                <button
                  type="button"
                  className={`cf-chip cf-chip-none ${meta.color === null ? "is-on" : ""}`}
                  title="No color"
                  onClick={() => {
                    patch({ color: null });
                    setSwatchOpen(false);
                  }}
                />
                {CONNECTION_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    className={`cf-chip ${meta.color === c.value ? "is-on" : ""}`}
                    title={c.name}
                    style={{ background: c.value }}
                    onClick={() => {
                      patch({ color: c.value });
                      setSwatchOpen(false);
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          <input
            autoFocus={!editing}
            className="cf-name"
            value={meta.label}
            onChange={(e) => patch({ label: e.currentTarget.value })}
            placeholder={editing ? "Connection name" : "Untitled connection"}
            aria-label="Connection name"
          />

          <button
            className="btn btn-ghost btn-sm cf-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Segmented tabs — string-first, advanced second. */}
        <div className="cf-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "uri"}
            className={`cf-tab ${tab === "uri" ? "is-active" : ""}`}
            onClick={() => switchTab("uri")}
          >
            <span className="cf-tab-glyph">⌁</span> Connection String
          </button>
          <button
            role="tab"
            aria-selected={tab === "advanced"}
            className={`cf-tab ${tab === "advanced" ? "is-active" : ""}`}
            onClick={() => switchTab("advanced")}
          >
            <span className="cf-tab-glyph">⚙</span> Advanced
          </button>
          <span
            className={`cf-tab-rail ${tab === "advanced" ? "right" : ""}`}
            aria-hidden
          />
        </div>

        <div className="modal-body cf-body">
          {tab === "uri" ? (
            <div className="cf-uri-pane">
              <div className="field">
                <label htmlFor="cf-uri">Paste your connection string</label>
                <textarea
                  id="cf-uri"
                  className="input cf-uri-input"
                  rows={3}
                  spellCheck={false}
                  placeholder="postgresql://user:password@ep-xxx.aws.neon.tech/neondb?sslmode=require"
                  value={uri}
                  onChange={(e) => {
                    setUri(e.currentTarget.value);
                    setOk(null);
                    setError(null);
                  }}
                />
                <span className="hint">
                  TLS is mandatory — Loupe upgrades any string to{" "}
                  <code>sslmode=require</code> at minimum. Everything past the
                  password is read on save; the secret goes straight to your OS
                  keychain.
                </span>
              </div>

              <button
                className="cf-fields-link"
                onClick={() => switchTab("advanced")}
              >
                Prefer fields? Open Advanced →
              </button>
            </div>
          ) : (
            <div className="cf-adv-pane">
              <div className="cf-row cf-row-2-1">
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
                    onChange={(e) =>
                      patch({ port: Number(e.currentTarget.value) || 5432 })
                    }
                  />
                </div>
              </div>

              <div className="cf-row cf-row-2">
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
                  Password{" "}
                  {editing && (
                    <span className="hint">— leave blank to keep current</span>
                  )}
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
                  onChange={(e) =>
                    patch({
                      sslMode: e.currentTarget
                        .value as ConnectionMeta["sslMode"],
                    })
                  }
                >
                  <option value="require">
                    require — encrypted, no cert check (Neon minimum)
                  </option>
                  <option value="verifyFull">
                    verify-full — encrypted + verified server cert
                  </option>
                </select>
                <span className="hint">
                  TLS is mandatory. Plaintext connections are refused.
                </span>
              </div>

              {meta.sslMode === "verifyFull" && (
                <div className="field">
                  <label htmlFor="cf-cert">Root certificate</label>
                  <div className="cf-cert-row">
                    <input
                      id="cf-cert"
                      className="input mono"
                      value={meta.rootCertPath ?? ""}
                      onChange={(e) =>
                        patch({ rootCertPath: e.currentTarget.value || null })
                      }
                      placeholder="/path/to/root.crt"
                    />
                    <button className="btn btn-sm" onClick={onBrowseCert}>
                      Browse…
                    </button>
                  </div>
                </div>
              )}

              <div className="cf-row cf-row-2 cf-guards">
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
                  onChange={(v) =>
                    patch({ isProd: v, readOnly: v ? true : meta.readOnly })
                  }
                />
              </div>

              <div className="cf-row cf-row-2">
                <div className="field">
                  <label htmlFor="cf-timeout">Statement timeout (ms)</label>
                  <input
                    id="cf-timeout"
                    className="input mono"
                    type="number"
                    value={meta.statementTimeoutMs}
                    onChange={(e) =>
                      patch({
                        statementTimeoutMs: Number(e.currentTarget.value) || 0,
                      })
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
                    onChange={(e) =>
                      patch({ rowLimit: Number(e.currentTarget.value) || 0 })
                    }
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="cf-prisma">Prisma schema (optional)</label>
                <div className="cf-cert-row">
                  <input
                    id="cf-prisma"
                    className="input mono"
                    value={meta.prismaSchemaPath ?? ""}
                    onChange={(e) =>
                      patch({ prismaSchemaPath: e.currentTarget.value || null })
                    }
                    placeholder="/path/to/schema.prisma"
                  />
                  <button className="btn btn-sm" onClick={onBrowsePrisma}>
                    Browse…
                  </button>
                  {meta.prismaSchemaPath && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => patch({ prismaSchemaPath: null })}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <span className="hint">
                  Enriches delete warnings with Prisma model names and
                  app-declared <code>onDelete</code> actions.
                </span>
              </div>
            </div>
          )}

          {(error || ok) && (
            <div className={`status ${error ? "err" : "ok"}`}>
              {error ?? ok}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            className="btn btn-ghost"
            onClick={onTest}
            disabled={busy !== null}
          >
            {busy === "test" ? "Testing…" : "Test connection"}
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={busy !== null}>
            Cancel
          </button>
          <button
            className="btn cf-save"
            onClick={onSave}
            disabled={busy !== null}
          >
            {busy === "save" ? "Saving…" : editing ? "Save" : "Save & connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
