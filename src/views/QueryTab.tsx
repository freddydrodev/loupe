import { useState } from "react";
import { api } from "../lib/api";
import { formatInt } from "../lib/format";
import { analyzeDestructive } from "../lib/sqlGuard";
import type { ConnectionMeta, QueryOutcome } from "../lib/types";
import { ResultGrid } from "../components/ResultGrid";
import { Confirm } from "../components/Confirm";
import { Switch } from "../components/Switch";
import "./QueryTab.css";

interface Props {
  connection: ConnectionMeta;
}

export function QueryTab({ connection }: Props) {
  const [sql, setSql] = useState("");
  const [outcome, setOutcome] = useState<QueryOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [readOnlyToggle, setReadOnlyToggle] = useState(connection.readOnly);
  const [confirmWarnings, setConfirmWarnings] = useState<string[] | null>(null);

  // A prod/read-only connection forces read-only regardless of the toggle.
  const effectiveReadOnly = connection.readOnly || readOnlyToggle;

  async function execute() {
    setRunning(true);
    setError(null);
    try {
      const r = await api.runQuery(sql, effectiveReadOnly);
      setOutcome(r);
    } catch (e) {
      setError(String(e));
      setOutcome(null);
    } finally {
      setRunning(false);
    }
  }

  function attemptRun() {
    if (!sql.trim() || running) return;
    // Writable runs of destructive statements require explicit confirmation.
    if (!effectiveReadOnly) {
      const warnings = analyzeDestructive(sql);
      if (warnings.length > 0) {
        setConfirmWarnings(warnings);
        return;
      }
    }
    void execute();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      attemptRun();
    }
  }

  const hasColumns = (outcome?.columns.length ?? 0) > 0;

  return (
    <div className="query-tab">
      <div className="query-editor">
        <textarea
          className="input mono query-input"
          placeholder="SELECT * FROM …   —   run with ⌘/Ctrl + Enter"
          value={sql}
          onChange={(e) => setSql(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          aria-label="SQL editor"
        />
        <div className="query-toolbar">
          <button className="btn btn-primary btn-sm" onClick={attemptRun} disabled={running || !sql.trim()}>
            {running ? "Running…" : "Run ⌘↵"}
          </button>
          <Switch
            label="Read-only"
            checked={effectiveReadOnly}
            onChange={setReadOnlyToggle}
          />
          {connection.readOnly && (
            <span className="hint">forced by connection</span>
          )}
          <div style={{ flex: 1 }} />
          {outcome && !error && (
            <span className="status muted">
              {hasColumns
                ? `${formatInt(outcome.rows.length)} ${outcome.rows.length === 1 ? "row" : "rows"}`
                : `${formatInt(outcome.rowsAffected)} ${outcome.rowsAffected === 1 ? "row" : "rows"} affected`}
              {" · "}
              {outcome.ms} ms
            </span>
          )}
        </div>
      </div>

      <div className="query-result">
        {error ? (
          <div className="query-error status err">{error}</div>
        ) : !outcome ? (
          <div className="ws-placeholder">Results appear here.</div>
        ) : hasColumns ? (
          <ResultGrid columns={outcome.columns} rows={outcome.rows} />
        ) : (
          <div className="ws-placeholder">
            Statement executed — {formatInt(outcome.rowsAffected)} row
            {outcome.rowsAffected === 1 ? "" : "s"} affected in {outcome.ms} ms.
          </div>
        )}
      </div>

      {confirmWarnings && (
        <Confirm
          title="Run a destructive statement?"
          danger
          confirmLabel="Run anyway"
          body={
            <ul style={{ margin: 0, paddingLeft: "1.1em" }}>
              {confirmWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          }
          onConfirm={() => {
            setConfirmWarnings(null);
            void execute();
          }}
          onCancel={() => setConfirmWarnings(null)}
        />
      )}
    </div>
  );
}
