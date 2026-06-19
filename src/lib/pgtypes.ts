// Maps a Postgres type name to a color family + glyph. This is Lagune's
// signature: every type is identifiable by color in the data grid and the
// structure view. Unknown types fall back to the neutral "other" family.

export type TypeFamily =
  | "int"
  | "text"
  | "decimal"
  | "datetime"
  | "bool"
  | "uuid"
  | "json"
  | "other";

export interface TypeStyle {
  family: TypeFamily;
  /** CSS variable holding the family color. */
  colorVar: string;
  /** Single-character glyph shown in column headers and structure rows. */
  glyph: string;
}

const STYLES: Record<TypeFamily, Omit<TypeStyle, "family">> = {
  int: { colorVar: "var(--type-int)", glyph: "#" },
  text: { colorVar: "var(--type-text)", glyph: "T" },
  decimal: { colorVar: "var(--type-decimal)", glyph: "≈" },
  datetime: { colorVar: "var(--type-datetime)", glyph: "⏱" },
  bool: { colorVar: "var(--type-bool)", glyph: "◑" },
  uuid: { colorVar: "var(--type-uuid)", glyph: "⬡" },
  json: { colorVar: "var(--type-json)", glyph: "{}" },
  other: { colorVar: "var(--type-other)", glyph: "•" },
};

/** Normalizes a Postgres type name (e.g. "character varying", "int4",
 *  "timestamp with time zone", "_text") into a family. */
export function typeFamily(rawType: string): TypeFamily {
  // Arrays render by their element family; strip a leading underscore or [].
  let t = rawType.trim().toLowerCase();
  t = t.replace(/\[\]$/, "").replace(/^_/, "").trim();
  // Drop precision/length qualifiers: "numeric(10,2)" → "numeric".
  t = t.replace(/\(.*\)$/, "").trim();

  switch (t) {
    case "smallint":
    case "integer":
    case "bigint":
    case "int2":
    case "int4":
    case "int8":
    case "serial":
    case "smallserial":
    case "bigserial":
    case "serial2":
    case "serial4":
    case "serial8":
    case "oid":
      return "int";

    case "text":
    case "character varying":
    case "varchar":
    case "character":
    case "char":
    case "bpchar":
    case "name":
    case "citext":
      return "text";

    case "numeric":
    case "decimal":
    case "real":
    case "double precision":
    case "float4":
    case "float8":
    case "money":
      return "decimal";

    case "timestamp":
    case "timestamptz":
    case "timestamp without time zone":
    case "timestamp with time zone":
    case "date":
    case "time":
    case "timetz":
    case "time without time zone":
    case "time with time zone":
    case "interval":
      return "datetime";

    case "boolean":
    case "bool":
      return "bool";

    case "uuid":
      return "uuid";

    case "json":
    case "jsonb":
      return "json";

    default:
      return "other";
  }
}

export function typeStyle(rawType: string): TypeStyle {
  const family = typeFamily(rawType);
  return { family, ...STYLES[family] };
}
