import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { ConnectionMeta } from "../lib/types";
import "./ConnectionSwitcher.css";

interface Props {
  current: ConnectionMeta;
  /** Connect to another saved connection in place. Rejects if the pool fails. */
  onSwitch: (meta: ConnectionMeta) => Promise<void>;
  /** Tear down the session and return to the connections manager. */
  onDisconnect: () => void;
}

/**
 * Titlebar control that shows the live connection and, on click, drops a menu
 * of every saved connection so the user can hop between databases without
 * leaving the workspace. Each entry carries its own color identity so prod and
 * staging never blur together.
 */
export function ConnectionSwitcher({ current, onSwitch, onDisconnect }: Props) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<ConnectionMeta[]>([current]);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Refresh the list each time the menu opens so newly-saved connections show.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .listConnections()
      .then((cs) => {
        if (!cancelled && cs.length) setAll(cs);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function pick(meta: ConnectionMeta) {
    if (meta.id === current.id) {
      setOpen(false);
      return;
    }
    setSwitchingId(meta.id);
    setError(null);
    try {
      await onSwitch(meta);
      setOpen(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSwitchingId(null);
    }
  }

  const dotColor = current.color ?? "var(--accent)";

  return (
    <div className="conn-switch" ref={rootRef}>
      <button
        className="conn-switch-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch connection"
      >
        <span className="conn-switch-dot" style={{ background: dotColor }} aria-hidden />
        <span className="conn-switch-text">
          <span className="conn-switch-label">{current.label}</span>
          <span className="conn-switch-sub mono">
            {current.database}@{current.host}
          </span>
        </span>
        {current.isProd && <span className="pill pill-prod">prod</span>}
        {current.readOnly && <span className="pill">read-only</span>}
        <span className={`conn-switch-caret ${open ? "open" : ""}`} aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="conn-switch-menu" role="listbox">
          <div className="conn-switch-menu-head">Connections</div>
          <ul className="conn-switch-list">
            {all.map((c) => {
              const isCurrent = c.id === current.id;
              const isSwitching = switchingId === c.id;
              return (
                <li key={c.id}>
                  <button
                    className={`conn-switch-item ${isCurrent ? "current" : ""}`}
                    onClick={() => pick(c)}
                    disabled={switchingId !== null}
                    role="option"
                    aria-selected={isCurrent}
                  >
                    <span
                      className="conn-switch-item-dot"
                      style={{ background: c.color ?? "var(--text-faint)" }}
                      aria-hidden
                    />
                    <span className="conn-switch-item-text">
                      <span className="conn-switch-item-label">
                        {c.label}
                        {c.isProd && <span className="pill pill-prod">prod</span>}
                        {c.readOnly && <span className="pill">read-only</span>}
                      </span>
                      <span className="conn-switch-item-sub mono">
                        {c.database}@{c.host}
                      </span>
                    </span>
                    <span className="conn-switch-item-mark" aria-hidden>
                      {isSwitching ? "…" : isCurrent ? "●" : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {error && <div className="conn-switch-error">{error}</div>}

          <div className="conn-switch-foot">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setOpen(false);
                onDisconnect();
              }}
            >
              Disconnect & manage…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
