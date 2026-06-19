//! Ad-hoc SQL execution for the Query tab.
//!
//! A statement may return rows (SELECT) or an affected-row count (DML/DDL); a
//! single pass over the result stream captures whichever applies — the
//! statement is never executed twice. Read-only mode runs inside a `READ ONLY`
//! transaction so the server itself rejects any write, independent of any SQL
//! parsing on the client.

use crate::cell::cell_to_json;
use crate::error::AppResult;
use crate::rows::RowColumn;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{raw_sql, Column, Either, PgConnection, PgPool, Row, TypeInfo};
use std::time::Instant;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryOpts {
    /// Force read-only for this run (in addition to any connection-level guard).
    #[serde(default)]
    pub read_only: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryOutcome {
    pub columns: Vec<RowColumn>,
    pub rows: Vec<Vec<Value>>,
    pub rows_affected: i64,
    pub ms: i64,
}

/// Runs `sql` once, collecting rows and the affected-row count in one pass.
async fn run_collect(
    conn: &mut PgConnection,
    sql: &str,
) -> AppResult<(Vec<RowColumn>, Vec<Vec<Value>>, u64)> {
    use futures::TryStreamExt;

    let mut collected: Vec<sqlx::postgres::PgRow> = Vec::new();
    let mut affected: u64 = 0;
    {
        // raw_sql uses the simple-query protocol: it supports multiple
        // semicolon-separated statements and yields rows and/or command tags.
        let mut stream = raw_sql(sql).fetch_many(&mut *conn);
        while let Some(item) = stream.try_next().await? {
            match item {
                Either::Left(result) => affected += result.rows_affected(),
                Either::Right(row) => collected.push(row),
            }
        }
    }

    let columns: Vec<RowColumn> = match collected.first() {
        Some(first) => first
            .columns()
            .iter()
            .map(|c| RowColumn {
                name: c.name().to_string(),
                data_type: c.type_info().name().to_lowercase(),
            })
            .collect(),
        None => Vec::new(),
    };

    let mut rows = Vec::with_capacity(collected.len());
    for row in &collected {
        let mut cells = Vec::with_capacity(columns.len());
        for i in 0..columns.len() {
            cells.push(cell_to_json(row, i)?);
        }
        rows.push(cells);
    }
    Ok((columns, rows, affected))
}

pub async fn run_query(pool: &PgPool, sql: &str, read_only: bool) -> AppResult<QueryOutcome> {
    let started = Instant::now();

    let (columns, rows, affected) = if read_only {
        let mut tx = pool.begin().await?;
        sqlx::query("SET TRANSACTION READ ONLY")
            .execute(&mut *tx)
            .await?;
        let collected = run_collect(&mut tx, sql).await?;
        tx.commit().await?;
        collected
    } else {
        let mut conn = pool.acquire().await?;
        run_collect(&mut conn, sql).await?
    };

    Ok(QueryOutcome {
        columns,
        // For a SELECT, sqlx reports the row count as "affected"; the UI shows
        // the real row count instead, so only surface this for column-less runs.
        rows_affected: affected as i64,
        rows,
        ms: started.elapsed().as_millis() as i64,
    })
}
