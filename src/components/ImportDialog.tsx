import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { api } from "../lib/api";
import { cellText } from "../lib/cells";
import { formatInt } from "../lib/format";
import type {
  ColumnInfo,
  ImportMode,
  ImportOpts,
  ImportPreview,
  ImportReport,
  TableRef,
} from "../lib/types";
import { TypeBadge } from "./TypeBadge";
import "./ImportDialog.css";

type Phase = "picking" | "loading" | "configure" | "running" | "report" | "error";

interface Props {
  table: TableRef;
  onClose: () => void;
  onImported: () => void;
}

export function ImportDialog({ table, onClose, onImported }: Props) {
  const [phase, setPhase] = useState<Phase>("picking");
  const [path, setPath] = useState<string>("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [target, setTarget] = useState<ColumnInfo[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<ImportMode>("insert");
  const [conflictKey, setConflictKey] = useState<string[]>([]);
  const [batchSize, setBatchSize] = useState(500);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  // Pick a file as soon as the dialog opens.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Data", extensions: ["json", "xlsx", "xls", "xlsm"] }],
      });
      if (typeof picked !== "string") {
        onClose();
        return;
      }
      setPath(picked);
      setPhase("loading");
      try {
        const [pv, cols] = await Promise.all([
          api.importPreview(picked),
          api.getTableColumns(table.schema, table.name),
        ]);
        setPreview(pv);
        setTarget(cols);
        // Auto-map by case-insensitive name match.
        const autoMap: Record<string, string> = {};
        for (const c of cols) {
          const hit = pv.columns.find((f) => f.toLowerCase() === c.name.toLowerCase());
          autoMap[c.name] = hit ?? "";
        }
        setMapping(autoMap);
        setConflictKey(cols.filter((c) => c.isPk).map((c) => c.name));
        setPhase("configure");
      } catch (e) {
        setError(String(e));
        setPhase("error");
      }
    })();
  }, [onClose, table.schema, table.name]);

  const isUpsert = mode === "upsertUpdate" || mode === "upsertIgnore";
  const mappedPairs = Object.entries(mapping).filter(([, file]) => file !== "");

  function buildOpts(dryRun: boolean): ImportOpts {
    return {
      path,
      schema: table.schema,
      table: table.name,
      mapping: mappedPairs.map(([column, file]) => ({ file, column })),
      mode,
      conflictKey: isUpsert ? conflictKey : [],
      dryRun,
      batchSize,
    };
  }

  async function run(dryRun: boolean) {
    setPhase("running");
    setProgress(0);
    setError(null);
    const unlisten = await listen<number>("import-progress", (e) => setProgress(e.payload));
    try {
      const r = await api.importData(buildOpts(dryRun));
      setReport(r);
      setPhase("report");
      if (!dryRun && (r.inserted > 0 || r.updated > 0)) onImported();
    } catch (e) {
      setError(String(e));
      setPhase("error");
    } finally {
      unlisten();
    }
  }

  const canRun = mappedPairs.length > 0 && (!isUpsert || conflictKey.length > 0);

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && phase !== "running") onClose();
      }}
    >
      <div className="modal import-modal" role="dialog" aria-modal="true" aria-label="Import">
        <div className="modal-header">
          <h3>
            Import into <span className="mono">{table.schema}.{table.name}</span>
          </h3>
          {phase !== "running" && (
            <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </div>

        <div className="modal-body">
          {phase === "loading" && <div className="status muted">Reading file…</div>}

          {phase === "configure" && preview && (
            <>
              <div className="import-file mono">{path}</div>

              <section className="import-section">
                <h4>Preview</h4>
                {preview.columns.length === 0 ? (
                  <p className="hint">No columns detected in the file.</p>
                ) : (
                  <div className="import-preview-scroll">
                    <table className="struct-table">
                      <thead>
                        <tr>
                          {preview.columns.map((c) => (
                            <th key={c} className="mono">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.sampleRows.slice(0, 8).map((row, ri) => (
                          <tr key={ri}>
                            {row.map((cell, ci) => (
                              <td key={ci} className="mono" title={cellText(cell)}>
                                {cellText(cell)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="hint">{preview.sampleRows.length} sample rows shown.</p>
              </section>

              <section className="import-section">
                <h4>Column mapping</h4>
                <div className="map-grid">
                  {target.map((c) => (
                    <div className="map-row" key={c.name}>
                      <div className="map-target">
                        <TypeBadge dataType={c.dataType} compact />
                        <span className="mono">{c.name}</span>
                        {c.isPk && <span className="key-tag pk">PK</span>}
                      </div>
                      <span className="map-arrow">←</span>
                      <select
                        className="select"
                        value={mapping[c.name] ?? ""}
                        onChange={(e) =>
                          setMapping((m) => ({ ...m, [c.name]: e.currentTarget.value }))
                        }
                      >
                        <option value="">— skip —</option>
                        {preview.columns.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </section>

              <section className="import-section">
                <h4>Options</h4>
                <div className="field">
                  <label htmlFor="imp-mode">On conflict</label>
                  <select
                    id="imp-mode"
                    className="select"
                    value={mode}
                    onChange={(e) => setMode(e.currentTarget.value as ImportMode)}
                  >
                    <option value="insert">Insert only (fail on duplicates)</option>
                    <option value="upsertUpdate">Upsert — update existing rows</option>
                    <option value="upsertIgnore">Upsert — ignore existing rows</option>
                  </select>
                </div>

                {isUpsert && (
                  <div className="field">
                    <label>Conflict key</label>
                    <div className="conflict-keys">
                      {target.map((c) => (
                        <label key={c.name} className="ck-chip">
                          <input
                            type="checkbox"
                            checked={conflictKey.includes(c.name)}
                            onChange={(e) =>
                              setConflictKey((k) =>
                                e.currentTarget.checked
                                  ? [...k, c.name]
                                  : k.filter((x) => x !== c.name),
                              )
                            }
                          />
                          <span className="mono">{c.name}</span>
                        </label>
                      ))}
                    </div>
                    {conflictKey.length === 0 && (
                      <span className="hint" style={{ color: "var(--danger)" }}>
                        Select at least one conflict-key column.
                      </span>
                    )}
                  </div>
                )}

                <div className="field" style={{ maxWidth: 180 }}>
                  <label htmlFor="imp-batch">Batch size</label>
                  <input
                    id="imp-batch"
                    className="input mono"
                    type="number"
                    value={batchSize}
                    onChange={(e) => setBatchSize(Number(e.currentTarget.value) || 1)}
                  />
                </div>
              </section>
            </>
          )}

          {phase === "running" && (
            <div className="status muted">
              Importing… {progress > 0 ? `${formatInt(progress)} rows processed` : "starting"}
            </div>
          )}

          {phase === "report" && report && (
            <div className="import-report">
              {report.dryRun && (
                <div className="pill" style={{ color: "var(--type-datetime)" }}>
                  dry run — nothing was written
                </div>
              )}
              <div className="report-grid">
                <Stat label="Inserted" value={report.inserted} tone="ok" />
                <Stat label="Updated" value={report.updated} tone="ok" />
                <Stat label="Skipped" value={report.skipped} tone="muted" />
                <Stat label="Rejected" value={report.rejected} tone={report.rejected ? "err" : "muted"} />
              </div>
              {report.errors.length > 0 && (
                <div className="report-errors">
                  <h4>Rejected rows</h4>
                  <ul>
                    {report.errors.map((e, i) => (
                      <li key={i}>
                        <span className="mono">row {e.row}</span>: {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {phase === "error" && <div className="status err">{error}</div>}
        </div>

        <div className="modal-footer">
          {phase === "configure" && (
            <>
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <div style={{ flex: 1 }} />
              <button className="btn" onClick={() => run(true)} disabled={!canRun} title="Validate without writing">
                Dry run
              </button>
              <button className="btn btn-primary" onClick={() => run(false)} disabled={!canRun}>
                Import
              </button>
            </>
          )}
          {phase === "report" && report && (
            <>
              {report.dryRun && report.rejected === 0 && (
                <button className="btn" onClick={() => run(false)}>
                  Run import for real
                </button>
              )}
              <div style={{ flex: 1 }} />
              <button className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </>
          )}
          {phase === "error" && (
            <button className="btn btn-primary" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "ok" | "err" | "muted" }) {
  const color = tone === "ok" ? "var(--success)" : tone === "err" ? "var(--danger)" : "var(--text-muted)";
  return (
    <div className="stat">
      <div className="stat-value mono" style={{ color }}>
        {formatInt(value)}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
