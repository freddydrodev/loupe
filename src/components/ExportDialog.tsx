import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { api } from "../lib/api";
import { formatInt } from "../lib/format";
import type { ExportFormat, ExportOpts, ExportResult, SortSpec } from "../lib/types";

export type ExportSource =
  | {
      kind: "table";
      schema: string;
      table: string;
      filter: string | null;
      sort: SortSpec | null;
      defaultName: string;
    }
  | { kind: "query"; sql: string; defaultName: string };

type Phase = "choose" | "running" | "done" | "error";

export function ExportDialog({ source, onClose }: { source: ExportSource; onClose: () => void }) {
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [phase, setPhase] = useState<Phase>("choose");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function buildOpts(path: string): ExportOpts {
    if (source.kind === "table") {
      return {
        source: "table",
        format,
        path,
        schema: source.schema,
        table: source.table,
        filter: source.filter,
        sort: source.sort,
      };
    }
    return { source: "query", format, path, sql: source.sql };
  }

  async function doExport() {
    const ext = format;
    const path = await save({
      defaultPath: `${source.defaultName}.${ext}`,
      filters: [{ name: format.toUpperCase(), extensions: [ext] }],
    });
    if (!path) return; // user cancelled the save dialog

    setPhase("running");
    setProgress(0);
    const unlisten = await listen<number>("export-progress", (e) => setProgress(e.payload));
    try {
      const res = await api.exportData(buildOpts(path));
      setResult(res);
      setPhase("done");
    } catch (e) {
      setError(String(e));
      setPhase("error");
    } finally {
      unlisten();
    }
  }

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && phase !== "running") onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Export" style={{ width: "min(440px, 100%)" }}>
        <div className="modal-header">
          <h3>Export {source.kind === "table" ? source.defaultName : "query result"}</h3>
        </div>
        <div className="modal-body">
          {phase === "choose" && (
            <>
              <div className="field">
                <label>Format</label>
                <div style={{ display: "flex", gap: "var(--space-3)" }}>
                  <FormatChoice value="xlsx" current={format} onPick={setFormat} label="XLSX" hint="Excel spreadsheet" />
                  <FormatChoice value="json" current={format} onPick={setFormat} label="JSON" hint="Array of objects" />
                </div>
              </div>
              <p className="hint">
                Exports the entire selection (every row, not just the current page), streamed from the server and
                respecting the active filter and sort.
              </p>
            </>
          )}
          {phase === "running" && (
            <div className="status muted">
              Exporting… {progress > 0 ? `${formatInt(progress)} rows written` : "starting"}
            </div>
          )}
          {phase === "done" && result && (
            <div className="status ok">
              Exported {formatInt(result.rows)} row{result.rows === 1 ? "" : "s"} to
              <br />
              <span className="mono" style={{ wordBreak: "break-all" }}>{result.path}</span>
            </div>
          )}
          {phase === "error" && <div className="status err">{error}</div>}
        </div>
        <div className="modal-footer">
          {phase === "choose" && (
            <>
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={doExport}>
                Export
              </button>
            </>
          )}
          {phase === "running" && <span className="hint">Working…</span>}
          {(phase === "done" || phase === "error") && (
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function FormatChoice({
  value,
  current,
  onPick,
  label,
  hint,
}: {
  value: ExportFormat;
  current: ExportFormat;
  onPick: (f: ExportFormat) => void;
  label: string;
  hint: string;
}) {
  const active = value === current;
  return (
    <button
      className="card"
      onClick={() => onPick(value)}
      style={{
        flex: 1,
        padding: "var(--space-3)",
        textAlign: "left",
        borderColor: active ? "var(--accent)" : "var(--border)",
        background: active ? "var(--accent-soft)" : "var(--surface-1)",
      }}
      aria-pressed={active}
    >
      <div style={{ fontWeight: 600 }}>{label}</div>
      <div className="hint">{hint}</div>
    </button>
  );
}
