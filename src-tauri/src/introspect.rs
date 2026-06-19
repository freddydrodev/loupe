//! Read-only schema introspection over the Postgres catalog.

use crate::error::AppResult;
use serde::Serialize;
use sqlx::{PgPool, Row};

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
