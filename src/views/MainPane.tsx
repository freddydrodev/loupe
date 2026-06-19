import { useState } from "react";
import type { ConnectionMeta, TableRef } from "../lib/types";
import { DataTab } from "./DataTab";
import "./MainPane.css";

type Tab = "data" | "structure" | "query";

interface Props {
  connection: ConnectionMeta;
  table: TableRef | null;
}

export function MainPane({ connection, table }: Props) {
  const [tab, setTab] = useState<Tab>("data");

  const needsTable = tab === "data" || tab === "structure";

  return (
    <div className="mainpane">
      <div className="tabbar">
        <div className="tabs">
          <TabButton label="Data" active={tab === "data"} onClick={() => setTab("data")} />
          <TabButton
            label="Structure"
            active={tab === "structure"}
            onClick={() => setTab("structure")}
          />
          <TabButton label="Query" active={tab === "query"} onClick={() => setTab("query")} />
        </div>
        {table && (
          <div className="tab-target mono">
            {table.schema}.{table.name}
          </div>
        )}
      </div>

      <div className="tab-content">
        {needsTable && !table ? (
          <div className="ws-placeholder">Select a table from the sidebar.</div>
        ) : tab === "data" && table ? (
          <DataTab connection={connection} table={table} key={`${table.schema}.${table.name}`} />
        ) : tab === "structure" ? (
          <div className="ws-placeholder">Structure view — next phase.</div>
        ) : (
          <div className="ws-placeholder">Query editor — coming soon.</div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`tab ${active ? "active" : ""}`} onClick={onClick}>
      {label}
    </button>
  );
}
