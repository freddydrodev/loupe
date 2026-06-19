// Mirror of the Rust command contract. Field names are camelCase to match the
// serde `rename_all = "camelCase"` structs. No type here ever carries a password.

export type SslMode = "require" | "verifyFull";

export interface ConnectionMeta {
  id: string;
  label: string;
  host: string;
  port: number;
  database: string;
  username: string;
  sslMode: SslMode;
  rootCertPath: string | null;
  readOnly: boolean;
  isProd: boolean;
  statementTimeoutMs: number;
  rowLimit: number;
}

export type ObjectKind = "table" | "view" | "materializedView" | "foreignTable";

export interface ObjectNode {
  name: string;
  kind: ObjectKind;
  estimatedRows: number | null;
}

export interface SchemaNode {
  schema: string;
  objects: ObjectNode[];
}

/** A selected database object the workspace operates on. */
export interface TableRef {
  schema: string;
  name: string;
  kind: ObjectKind;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  default: string | null;
  isPk: boolean;
  fkTarget: string | null;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
  definition: string;
}

export type ConstraintKind =
  | "primaryKey"
  | "unique"
  | "foreignKey"
  | "check"
  | "exclusion"
  | "other";

export interface ConstraintInfo {
  name: string;
  kind: ConstraintKind;
  definition: string;
}

export interface RowColumn {
  name: string;
  dataType: string;
}

/** A decoded cell: JSON-compatible value. */
export type Cell = string | number | boolean | null | Cell[] | { [k: string]: Cell };

export interface RowsResult {
  columns: RowColumn[];
  rows: Cell[][];
  total: number;
}

export type ExportFormat = "json" | "xlsx";

export interface ExportOpts {
  source: "table" | "query";
  format: ExportFormat;
  path: string;
  schema?: string | null;
  table?: string | null;
  filter?: string | null;
  sort?: SortSpec | null;
  sql?: string | null;
}

export interface ExportResult {
  rows: number;
  path: string;
}

export interface QueryOutcome {
  columns: RowColumn[];
  rows: Cell[][];
  rowsAffected: number;
  ms: number;
}

export interface SortSpec {
  column: string;
  descending: boolean;
}

export interface GetRowsOpts {
  filter: string | null;
  sort: SortSpec | null;
  limit: number;
  offset: number;
}

export function blankConnection(): ConnectionMeta {
  return {
    id: "",
    label: "",
    host: "",
    port: 5432,
    database: "",
    username: "",
    sslMode: "require",
    rootCertPath: null,
    readOnly: false,
    isProd: false,
    statementTimeoutMs: 30_000,
    rowLimit: 1_000,
  };
}
