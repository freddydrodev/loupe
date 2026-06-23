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
  /** Optional hex color tag for visual identification. null = neutral. */
  color: string | null;
  sslMode: SslMode;
  rootCertPath: string | null;
  readOnly: boolean;
  isProd: boolean;
  statementTimeoutMs: number;
  rowLimit: number;
  /** Optional path to a Prisma schema file used to enrich relation info. */
  prismaSchemaPath: string | null;
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
  /** Permitted values (native enum labels or single-column CHECK literals), else null. */
  allowedValues: string[] | null;
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
export type Cell =
  | string
  | number
  | boolean
  | null
  | Cell[]
  | { [k: string]: Cell };

export interface RowsResult {
  columns: RowColumn[];
  rows: Cell[][];
  total: number;
}

// ── Row writes & relations ───────────────────────────────────────────────────

export type OnDeleteAction =
  | "noAction"
  | "restrict"
  | "cascade"
  | "setNull"
  | "setDefault";

/** A foreign key in another table that points at the current table. */
export interface ReferencingConstraint {
  constraintName: string;
  referencingSchema: string;
  referencingTable: string;
  /** Columns on the current (referenced) table. */
  referencedColumns: string[];
  /** Columns on the referencing table, aligned to referencedColumns. */
  referencingColumns: string[];
  onDelete: OnDeleteAction;
  /** Prisma model mapped to the referencing table, when a Prisma schema is set. */
  prismaModel: string | null;
  /** `onDelete` declared in the Prisma schema (may differ from the DB action). */
  prismaOnDelete: string | null;
}

export interface CellEdit {
  column: string;
  value: Cell;
}

/** Identifies a row by one of its primary-key columns and that column's value. */
export interface PkPredicate {
  column: string;
  value: Cell;
}

export interface UpdateRowOpts {
  schema: string;
  table: string;
  edits: CellEdit[];
  /** Original primary-key values identifying the row. */
  pk: PkPredicate[];
}

export interface UpdateResult {
  columns: RowColumn[];
  row: Cell[];
  affected: number;
}

export interface BulkUpdateOpts {
  schema: string;
  table: string;
  column: string;
  value: Cell;
  /** One full PK predicate per row to update. */
  pks: PkPredicate[][];
}

export interface DeleteRowsOpts {
  schema: string;
  table: string;
  /** One full PK predicate per row to delete. */
  pks: PkPredicate[][];
}

export interface AffectedResult {
  affected: number;
}

export interface FkSampleOpts {
  schema: string;
  table: string;
  column: string;
  labelColumn?: string | null;
  search?: string | null;
  limit: number;
}

export interface FkSample {
  value: Cell;
  label: string | null;
}

export interface ImportPreview {
  columns: string[];
  sampleRows: Cell[][];
}

export interface ColumnMap {
  file: string;
  column: string;
}

export type ImportMode = "insert" | "upsertUpdate" | "upsertIgnore";

export interface ImportOpts {
  path: string;
  schema: string;
  table: string;
  mapping: ColumnMap[];
  mode: ImportMode;
  conflictKey: string[];
  dryRun: boolean;
  batchSize: number;
  maxBytes?: number | null;
}

export interface RowError {
  row: number;
  message: string;
}

export interface ImportReport {
  inserted: number;
  updated: number;
  skipped: number;
  rejected: number;
  errors: RowError[];
  dryRun: boolean;
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

/** Connection color tags — reused from the shared type-color palette so the
 * connection swatches stay cohesive with the rest of Loupe. */
export const CONNECTION_COLORS: { name: string; value: string }[] = [
  { name: "Periwinkle", value: "#7c83ff" },
  { name: "Blue", value: "#56a8f5" },
  { name: "Teal", value: "#2dd4bf" },
  { name: "Emerald", value: "#34d399" },
  { name: "Amber", value: "#fbbf24" },
  { name: "Orange", value: "#fb923c" },
  { name: "Rose", value: "#f4717f" },
  { name: "Pink", value: "#f472b6" },
  { name: "Violet", value: "#c084fc" },
];

export function blankConnection(): ConnectionMeta {
  return {
    id: "",
    label: "",
    host: "",
    port: 5432,
    database: "",
    username: "",
    color: null,
    sslMode: "require",
    rootCertPath: null,
    readOnly: false,
    isProd: false,
    statementTimeoutMs: 30_000,
    rowLimit: 100,
    prismaSchemaPath: null,
  };
}
