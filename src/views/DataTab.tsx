import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { cellText } from "../lib/cells";
import { formatInt } from "../lib/format";
import { typeFamily } from "../lib/pgtypes";
import type { ConnectionMeta, RowColumn, RowsResult, SortSpec, TableRef } from "../lib/types";
import { CellValue } from "../components/CellValue";
import { TypeBadge } from "../components/TypeBadge";
import { ExportDialog } from "../components/ExportDialog";
import { ImportDialog } from "../components/ImportDialog";
import "./DataTab.css";

interface Props {
  connection: ConnectionMeta;
  table: TableRef;
}

export function DataTab({ connection, table }: Props) {
  const pageSize = Math.max(1, connection.rowLimit || 1000);

  const [result, setResult] = useState<RowsResult | null>(null);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<SortSpec | null>(null);
  const [filterInput, setFilterInput] = useState("");
  const [appliedFilter, setAppliedFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Reset view state whenever the selected table changes.
  useEffect(() => {
    setOffset(0);
    setSort(null);
    setFilterInput("");
    setAppliedFilter("");
  }, [table.schema, table.name]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.getRows(table.schema, table.name, {
        filter: appliedFilter.trim() || null,
        sort,
        limit: pageSize,
        offset,
      });
      setResult(r);
    } catch (e) {
      setError(String(e));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [table.schema, table.name, appliedFilter, sort, pageSize, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const families = useMemo(
    () => (result?.columns ?? []).map((c) => typeFamily(c.dataType)),
    [result],
  );

  function onSortClick(col: RowColumn) {
    setOffset(0);
    setSort((prev) => {
      if (!prev || prev.column !== col.name) return { column: col.name, descending: false };
      if (!prev.descending) return { column: col.name, descending: true };
      return null; // third click clears the sort
    });
  }

  function applyFilter() {
    setOffset(0);
    setAppliedFilter(filterInput);
  }

  const total = result?.total ?? 0;
  const shown = result?.rows.length ?? 0;
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = offset + shown;
  const canPrev = offset > 0;
  const canNext = offset + pageSize < total;

  return (
    <div className="data-tab">
      <div className="data-toolbar">
        <div className="filter-box">
          <span className="filter-where mono">WHERE</span>
          <input
            className="input mono"
            placeholder="e.g. status = 'active' AND created_at > now() - interval '7 days'"
            value={filterInput}
            onChange={(e) => setFilterInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyFilter();
            }}
            aria-label="Filter condition"
          />
          <button className="btn btn-sm" onClick={applyFilter} disabled={loading}>
            Apply
          </button>
          {appliedFilter && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setFilterInput("");
                setOffset(0);
                setAppliedFilter("");
              }}
            >
              Clear
            </button>
          )}
        </div>
        <div style={{ flex: 1 }} />
        {table.kind === "table" && (
          <button className="btn btn-sm" onClick={() => setShowImport(true)}>
            Import
          </button>
        )}
        <button className="btn btn-sm" onClick={() => setShowExport(true)}>
          Export
        </button>
        <button className="btn btn-sm" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <div className="data-error">
          <div className="status err">{error}</div>
          <p className="hint">Check the filter expression, then Apply again.</p>
        </div>
      ) : (
        <div className="grid-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th className="rownum-h" />
                {(result?.columns ?? []).map((c) => {
                  const active = sort?.column === c.name;
                  return (
                    <th key={c.name}>
                      <button className="col-head" onClick={() => onSortClick(c)} title="Sort">
                        <TypeBadge dataType={c.dataType} compact />
                        <span className="col-name">{c.name}</span>
                        <span className="sort-ind">
                          {active ? (sort?.descending ? "▼" : "▲") : ""}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {(result?.rows ?? []).map((row, ri) => (
                <tr key={ri}>
                  <td className="rownum mono">{offset + ri + 1}</td>
                  {row.map((cell, ci) => (
                    <td key={ci} title={cellText(cell)}>
                      <CellValue value={cell} family={families[ci] ?? "other"} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && shown === 0 && (
            <div className="data-empty">
              {appliedFilter ? "No rows match this filter." : "This relation has no rows."}
            </div>
          )}
        </div>
      )}

      <div className="data-footer">
        <span className="count mono">
          {total === 0 ? "0 rows" : `${formatInt(rangeStart)}–${formatInt(rangeEnd)} of ${formatInt(total)}`}
        </span>
        <div style={{ flex: 1 }} />
        <button
          className="btn btn-sm"
          onClick={() => setOffset(Math.max(0, offset - pageSize))}
          disabled={!canPrev || loading}
        >
          ‹ Prev
        </button>
        <button
          className="btn btn-sm"
          onClick={() => setOffset(offset + pageSize)}
          disabled={!canNext || loading}
        >
          Next ›
        </button>
      </div>

      {showExport && (
        <ExportDialog
          source={{
            kind: "table",
            schema: table.schema,
            table: table.name,
            filter: appliedFilter.trim() || null,
            sort,
            defaultName: table.name,
          }}
          onClose={() => setShowExport(false)}
        />
      )}

      {showImport && (
        <ImportDialog
          table={table}
          onClose={() => setShowImport(false)}
          onImported={() => void load()}
        />
      )}
    </div>
  );
}
