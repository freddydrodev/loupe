//! Read-only schema introspection over the Postgres catalog.

use crate::error::AppResult;
use serde::Serialize;
use sqlx::{PgPool, Row};
use std::collections::{HashMap, HashSet};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectNode {
    pub name: String,
    /// One of: table, view, materializedView, foreignTable.
    pub kind: &'static str,
    /// Planner row estimate; `None` when the relation was never analyzed.
    pub estimated_rows: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaNode {
    pub schema: String,
    pub objects: Vec<ObjectNode>,
}

fn kind_label(relkind: &str) -> &'static str {
    match relkind {
        "r" | "p" => "table",
        "v" => "view",
        "m" => "materializedView",
        "f" => "foreignTable",
        _ => "table",
    }
}

/// Returns the user schemas with their tables/views, grouped and ordered.
/// `pg_catalog`, `information_schema`, and internal `pg_*` schemas are excluded.
pub async fn schema_tree(pool: &PgPool) -> AppResult<Vec<SchemaNode>> {
    let rows = sqlx::query(
        r#"
        SELECT n.nspname                AS schema,
               c.relname                AS name,
               c.relkind::text          AS relkind,
               c.reltuples::bigint      AS est_rows
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'v', 'm', 'p', 'f')
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
          AND n.nspname NOT LIKE 'pg_temp%'
        ORDER BY n.nspname, c.relname
        "#,
    )
    .fetch_all(pool)
    .await?;

    let mut out: Vec<SchemaNode> = Vec::new();
    for row in rows {
        let schema: String = row.try_get("schema")?;
        let name: String = row.try_get("name")?;
        let relkind: String = row.try_get("relkind")?;
        let est: i64 = row.try_get("est_rows")?;

        let node = ObjectNode {
            name,
            kind: kind_label(&relkind),
            estimated_rows: if est < 0 { None } else { Some(est) },
        };

        match out.last_mut() {
            Some(last) if last.schema == schema => last.objects.push(node),
            _ => out.push(SchemaNode {
                schema,
                objects: vec![node],
            }),
        }
    }
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    /// Human display type, e.g. "integer", "character varying(255)", "jsonb".
    pub data_type: String,
    pub nullable: bool,
    pub default: Option<String>,
    pub is_pk: bool,
    /// "schema.table(column)" when this column is a foreign key, else `None`.
    pub fk_target: Option<String>,
}

/// Returns the columns of `schema.table` in attribute order, annotated with
/// primary-key membership and foreign-key targets. Bound parameters only.
pub async fn table_columns(
    pool: &PgPool,
    schema: &str,
    table: &str,
) -> AppResult<Vec<ColumnInfo>> {
    // Primary-key column names.
    let pk: HashSet<String> = sqlx::query(
        r#"
        SELECT a.attname AS name
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indisprimary AND n.nspname = $1 AND c.relname = $2
        "#,
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|r| r.get::<String, _>("name"))
    .collect();

    // Foreign-key targets, keyed by local column name.
    let mut fk: HashMap<String, String> = HashMap::new();
    let fk_rows = sqlx::query(
        r#"
        SELECT att.attname        AS column_name,
               cn.nspname         AS foreign_schema,
               cf.relname         AS foreign_table,
               fatt.attname       AS foreign_column
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace ns ON ns.oid = c.relnamespace
        JOIN pg_class cf ON cf.oid = con.confrelid
        JOIN pg_namespace cn ON cn.oid = cf.relnamespace
        JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
        JOIN unnest(con.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = k.ord
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
        JOIN pg_attribute fatt ON fatt.attrelid = con.confrelid AND fatt.attnum = fk.attnum
        WHERE con.contype = 'f' AND ns.nspname = $1 AND c.relname = $2
        "#,
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await?;
    for r in fk_rows {
        let col: String = r.get("column_name");
        let fs: String = r.get("foreign_schema");
        let ft: String = r.get("foreign_table");
        let fc: String = r.get("foreign_column");
        let target = if fs == "public" {
            format!("{ft}({fc})")
        } else {
            format!("{fs}.{ft}({fc})")
        };
        fk.entry(col).or_insert(target);
    }

    let rows = sqlx::query(
        r#"
        SELECT a.attname                              AS name,
               format_type(a.atttypid, a.atttypmod)   AS data_type,
               NOT a.attnotnull                        AS nullable,
               pg_get_expr(d.adbin, d.adrelid)         AS default_expr
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE n.nspname = $1 AND c.relname = $2
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum
        "#,
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let name: String = r.get("name");
        out.push(ColumnInfo {
            data_type: r.get("data_type"),
            nullable: r.get("nullable"),
            default: r.try_get("default_expr").ok().flatten(),
            is_pk: pk.contains(&name),
            fk_target: fk.get(&name).cloned(),
            name,
        });
    }
    Ok(out)
}
