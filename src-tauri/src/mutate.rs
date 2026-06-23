//! Row-level writes: single-row edit, single-column bulk edit, and deletion.
//!
//! Safety properties mirror the rest of Loupe:
//!  - Identifiers (schema/table/column) are quoted via `sql::quote_ident`.
//!  - Values travel only as bound parameters, each cast to its column's type
//!    (`$n::<data_type>`) so the text the grid round-trips re-parses correctly.
//!  - Every row is targeted by its **full** primary key; a table without a PK,
//!    or a partial PK predicate, is rejected — a write can never fan out.
//!  - Bulk operations run inside one transaction (all-or-nothing).

use crate::bind::value_to_bind;
use crate::error::{AppError, AppResult};
use crate::introspect::table_columns;
use crate::rows::{projection, RowColumn};
use crate::sql::{quote_ident, quote_qualified};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{PgPool, Row};
use std::collections::HashMap;

/// Defensive ceiling on how many rows one bulk call may touch.
const MAX_BULK_ROWS: usize = 100_000;

// ── Request / response shapes ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellEdit {
    pub column: String,
    pub value: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PkPredicate {
    pub column: String,
    pub value: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRowOpts {
    pub schema: String,
    pub table: String,
    pub edits: Vec<CellEdit>,
    /// Original primary-key values identifying the row.
    pub pk: Vec<PkPredicate>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
    pub columns: Vec<RowColumn>,
    pub row: Vec<Value>,
    pub affected: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkUpdateOpts {
    pub schema: String,
    pub table: String,
    pub column: String,
    pub value: Value,
    /// One full PK predicate per row to update.
    pub pks: Vec<Vec<PkPredicate>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRowsOpts {
    pub schema: String,
    pub table: String,
    /// One full PK predicate per row to delete.
    pub pks: Vec<Vec<PkPredicate>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AffectedResult {
    pub affected: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FkSampleOpts {
    /// Referenced table the FK points at.
    pub schema: String,
    pub table: String,
    /// Referenced column (the bound value).
    pub column: String,
    /// Optional human-friendly display column.
    pub label_column: Option<String>,
    /// Case-insensitive substring filter on value (and label).
    pub search: Option<String>,
    pub limit: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FkSample {
    pub value: Value,
    pub label: Option<String>,
}

// ── Table shape ──────────────────────────────────────────────────────────────

/// Column display types (by name) plus the ordered primary-key column names.
struct TableShape {
    types: HashMap<String, String>,
    pk: Vec<String>,
    /// Columns in attribute order — used to build the RETURNING projection.
    columns: Vec<crate::introspect::ColumnInfo>,
}

async fn table_shape(pool: &PgPool, schema: &str, table: &str) -> AppResult<TableShape> {
    let columns = table_columns(pool, schema, table).await?;
    if columns.is_empty() {
        return Err(AppError::Validation(format!(
            "Relation {schema}.{table} has no readable columns."
        )));
    }
    let pk: Vec<String> = columns
        .iter()
        .filter(|c| c.is_pk)
        .map(|c| c.name.clone())
        .collect();
    if pk.is_empty() {
        return Err(AppError::Validation(format!(
            "{schema}.{table} has no primary key; rows cannot be edited or deleted. \
             Add a primary key or unique constraint to enable editing."
        )));
    }
    let types = columns
        .iter()
        .map(|c| (c.name.clone(), c.data_type.clone()))
        .collect();
    Ok(TableShape { types, pk, columns })
}

// ── SQL builders (pure, unit-testable) ───────────────────────────────────────

/// The bind text for a value targeting a typed column, mapping coercion
/// failures to a validation error.
fn bind_for(shape: &TableShape, column: &str, value: &Value) -> AppResult<Option<String>> {
    let ty = shape
        .types
        .get(column)
        .ok_or_else(|| AppError::Validation(format!("Unknown column: {column}")))?;
    value_to_bind(value, ty).map_err(AppError::Validation)
}

/// Validates that `pk` predicates name exactly the table's primary-key columns
/// (in any order) — never a subset, which would risk a mass update/delete.
fn validate_full_pk(shape: &TableShape, pk: &[PkPredicate]) -> AppResult<()> {
    if pk.len() != shape.pk.len() || !pk.iter().all(|p| shape.pk.contains(&p.column)) {
        return Err(AppError::Validation(format!(
            "The row must be identified by its full primary key ({}).",
            shape.pk.join(", ")
        )));
    }
    Ok(())
}

/// Builds the WHERE clause matching a row by its PK, appending binds to `binds`
/// starting at placeholder index `start` (1-based). Returns the clause text.
fn pk_where(
    shape: &TableShape,
    pk: &[PkPredicate],
    start: usize,
    binds: &mut Vec<Option<String>>,
) -> AppResult<String> {
    let mut parts = Vec::with_capacity(pk.len());
    for (i, p) in pk.iter().enumerate() {
        let ty = shape
            .types
            .get(&p.column)
            .ok_or_else(|| AppError::Validation(format!("Unknown column: {}", p.column)))?;
        parts.push(format!(
            "{} = ${}::{}",
            quote_ident(&p.column),
            start + i,
            ty
        ));
        binds.push(bind_for(shape, &p.column, &p.value)?);
    }
    Ok(parts.join(" AND "))
}

/// Builds the full UPDATE statement and its ordered bind list (edits first,
/// then PK predicates). Exposed for unit testing.
fn build_update_sql(
    shape: &TableShape,
    schema: &str,
    table: &str,
    edits: &[CellEdit],
    pk: &[PkPredicate],
) -> AppResult<(String, Vec<Option<String>>)> {
    if edits.is_empty() {
        return Err(AppError::Validation("No columns to update.".into()));
    }
    validate_full_pk(shape, pk)?;

    let mut binds: Vec<Option<String>> = Vec::with_capacity(edits.len() + pk.len());
    let mut sets = Vec::with_capacity(edits.len());
    for (i, e) in edits.iter().enumerate() {
        let ty = shape
            .types
            .get(&e.column)
            .ok_or_else(|| AppError::Validation(format!("Unknown column: {}", e.column)))?;
        sets.push(format!("{} = ${}::{}", quote_ident(&e.column), i + 1, ty));
        binds.push(bind_for(shape, &e.column, &e.value)?);
    }

    let where_sql = pk_where(shape, pk, edits.len() + 1, &mut binds)?;
    let from = quote_qualified(schema, table);
    let sql = format!(
        "UPDATE {from} SET {} WHERE {} RETURNING {}",
        sets.join(", "),
        where_sql,
        projection(&shape.columns)
    );
    Ok((sql, binds))
}

// ── Execution ────────────────────────────────────────────────────────────────

pub async fn update_row(pool: &PgPool, opts: &UpdateRowOpts) -> AppResult<UpdateResult> {
    let shape = table_shape(pool, &opts.schema, &opts.table).await?;
    let (sql, binds) = build_update_sql(&shape, &opts.schema, &opts.table, &opts.edits, &opts.pk)?;

    let mut q = sqlx::query(&sql);
    for b in &binds {
        q = q.bind(b.clone());
    }
    let row = q
        .fetch_optional(pool)
        .await
        .map_err(|e| AppError::Db(e.to_string()))?;

    let row = row.ok_or_else(|| {
        AppError::Validation("No row matched the primary key (it may have changed).".into())
    })?;

    let columns: Vec<RowColumn> = shape
        .columns
        .iter()
        .map(|c| RowColumn {
            name: c.name.clone(),
            data_type: c.data_type.clone(),
        })
        .collect();
    let mut cells = Vec::with_capacity(columns.len());
    for i in 0..columns.len() {
        cells.push(crate::cell::cell_to_json(&row, i)?);
    }

    Ok(UpdateResult {
        columns,
        row: cells,
        affected: 1,
    })
}

pub async fn bulk_update_column(pool: &PgPool, opts: &BulkUpdateOpts) -> AppResult<AffectedResult> {
    if opts.pks.len() > MAX_BULK_ROWS {
        return Err(AppError::Validation(format!(
            "Too many rows in one operation (max {MAX_BULK_ROWS})."
        )));
    }
    let shape = table_shape(pool, &opts.schema, &opts.table).await?;
    let ty = shape
        .types
        .get(&opts.column)
        .ok_or_else(|| AppError::Validation(format!("Unknown column: {}", opts.column)))?
        .clone();
    let set_bind = bind_for(&shape, &opts.column, &opts.value)?;
    let from = quote_qualified(&opts.schema, &opts.table);

    let mut tx = pool.begin().await?;
    let mut affected: i64 = 0;
    for pk in &opts.pks {
        validate_full_pk(&shape, pk)?;
        // $1 is the SET value; PK predicates start at $2.
        let mut binds: Vec<Option<String>> = vec![set_bind.clone()];
        let where_sql = pk_where(&shape, pk, 2, &mut binds)?;
        let sql = format!(
            "UPDATE {from} SET {} = $1::{ty} WHERE {where_sql}",
            quote_ident(&opts.column)
        );
        let mut q = sqlx::query(&sql);
        for b in &binds {
            q = q.bind(b.clone());
        }
        let res = q
            .execute(&mut *tx)
            .await
            .map_err(|e| AppError::Db(e.to_string()))?;
        affected += res.rows_affected() as i64;
    }
    tx.commit().await?;
    Ok(AffectedResult { affected })
}

pub async fn delete_rows(pool: &PgPool, opts: &DeleteRowsOpts) -> AppResult<AffectedResult> {
    if opts.pks.len() > MAX_BULK_ROWS {
        return Err(AppError::Validation(format!(
            "Too many rows in one operation (max {MAX_BULK_ROWS})."
        )));
    }
    let shape = table_shape(pool, &opts.schema, &opts.table).await?;
    let from = quote_qualified(&opts.schema, &opts.table);

    let mut tx = pool.begin().await?;
    let mut affected: i64 = 0;
    for pk in &opts.pks {
        validate_full_pk(&shape, pk)?;
        let mut binds: Vec<Option<String>> = Vec::with_capacity(pk.len());
        let where_sql = pk_where(&shape, pk, 1, &mut binds)?;
        let sql = format!("DELETE FROM {from} WHERE {where_sql}");
        let mut q = sqlx::query(&sql);
        for b in &binds {
            q = q.bind(b.clone());
        }
        let res = q
            .execute(&mut *tx)
            .await
            .map_err(|e| AppError::Db(e.to_string()))?;
        affected += res.rows_affected() as i64;
    }
    tx.commit().await?;
    Ok(AffectedResult { affected })
}

pub async fn fk_sample_values(pool: &PgPool, opts: &FkSampleOpts) -> AppResult<Vec<FkSample>> {
    // Validate the referenced columns exist on the target table.
    let columns = table_columns(pool, &opts.schema, &opts.table).await?;
    let names: std::collections::HashSet<&str> = columns.iter().map(|c| c.name.as_str()).collect();
    if !names.contains(opts.column.as_str()) {
        return Err(AppError::Validation(format!(
            "Unknown column {} on {}.{}",
            opts.column, opts.schema, opts.table
        )));
    }
    let label = match &opts.label_column {
        Some(l) if names.contains(l.as_str()) => Some(l.clone()),
        Some(l) => {
            return Err(AppError::Validation(format!(
                "Unknown label column {} on {}.{}",
                l, opts.schema, opts.table
            )))
        }
        None => None,
    };

    let from = quote_qualified(&opts.schema, &opts.table);
    let value_q = quote_ident(&opts.column);
    let limit = opts.limit.clamp(1, 200);

    let (select, has_label) = match &label {
        Some(l) => (
            format!(
                "{value_q}::text AS value, {}::text AS label",
                quote_ident(l)
            ),
            true,
        ),
        None => (format!("{value_q}::text AS value"), false),
    };

    let search = opts
        .search
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());

    let where_sql = match (&label, search) {
        (Some(l), Some(_)) => format!(
            " WHERE {value_q}::text ILIKE $1 OR {}::text ILIKE $1",
            quote_ident(l)
        ),
        (None, Some(_)) => format!(" WHERE {value_q}::text ILIKE $1"),
        (_, None) => String::new(),
    };

    let sql = format!(
        "SELECT DISTINCT {select} FROM {from}{where_sql} ORDER BY value LIMIT {limit}"
    );

    let mut q = sqlx::query(&sql);
    if let Some(s) = search {
        q = q.bind(format!("%{s}%"));
    }
    let rows = q
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Db(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|r| FkSample {
            value: r
                .try_get::<Option<String>, _>("value")
                .ok()
                .flatten()
                .map(Value::String)
                .unwrap_or(Value::Null),
            label: if has_label {
                r.try_get::<Option<String>, _>("label").ok().flatten()
            } else {
                None
            },
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn shape() -> TableShape {
        use crate::introspect::ColumnInfo;
        let columns = vec![
            ColumnInfo {
                name: "id".into(),
                data_type: "integer".into(),
                nullable: false,
                default: None,
                is_pk: true,
                fk_target: None,
            },
            ColumnInfo {
                name: "name".into(),
                data_type: "text".into(),
                nullable: true,
                default: None,
                is_pk: false,
                fk_target: None,
            },
            ColumnInfo {
                name: "tags".into(),
                data_type: "text[]".into(),
                nullable: true,
                default: None,
                is_pk: false,
                fk_target: None,
            },
        ];
        let types = columns
            .iter()
            .map(|c| (c.name.clone(), c.data_type.clone()))
            .collect();
        TableShape {
            types,
            pk: vec!["id".into()],
            columns,
        }
    }

    #[test]
    fn build_update_casts_and_orders_binds() {
        let s = shape();
        let edits = vec![CellEdit {
            column: "name".into(),
            value: json!("Alice"),
        }];
        let pk = vec![PkPredicate {
            column: "id".into(),
            value: json!(1),
        }];
        let (sql, binds) = build_update_sql(&s, "public", "users", &edits, &pk).unwrap();
        assert!(sql.contains("SET \"name\" = $1::text"));
        assert!(sql.contains("WHERE \"id\" = $2::integer"));
        assert!(sql.contains("RETURNING"));
        assert_eq!(binds, vec![Some("Alice".to_string()), Some("1".to_string())]);
    }

    #[test]
    fn build_update_array_value_round_trips_as_literal() {
        let s = shape();
        let edits = vec![CellEdit {
            column: "tags".into(),
            value: json!(["a", "b"]),
        }];
        let pk = vec![PkPredicate {
            column: "id".into(),
            value: json!(7),
        }];
        let (sql, binds) = build_update_sql(&s, "public", "users", &edits, &pk).unwrap();
        assert!(sql.contains("\"tags\" = $1::text[]"));
        assert_eq!(binds[0], Some("{\"a\",\"b\"}".to_string()));
    }

    #[test]
    fn null_edit_binds_none() {
        let s = shape();
        let edits = vec![CellEdit {
            column: "name".into(),
            value: Value::Null,
        }];
        let pk = vec![PkPredicate {
            column: "id".into(),
            value: json!(1),
        }];
        let (_, binds) = build_update_sql(&s, "public", "users", &edits, &pk).unwrap();
        assert_eq!(binds[0], None);
    }

    #[test]
    fn partial_or_empty_pk_is_rejected() {
        let s = shape();
        let edits = vec![CellEdit {
            column: "name".into(),
            value: json!("x"),
        }];
        // Empty PK.
        assert!(build_update_sql(&s, "public", "users", &edits, &[]).is_err());
        // Wrong column as PK.
        let bad = vec![PkPredicate {
            column: "name".into(),
            value: json!("x"),
        }];
        assert!(build_update_sql(&s, "public", "users", &edits, &bad).is_err());
    }

    #[test]
    fn empty_edits_rejected() {
        let s = shape();
        let pk = vec![PkPredicate {
            column: "id".into(),
            value: json!(1),
        }];
        assert!(build_update_sql(&s, "public", "users", &[], &pk).is_err());
    }
}
