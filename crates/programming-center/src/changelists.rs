//! Named CV snapshots (changelists), stored in the daemon SQLite database.

use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use serde::{Deserialize, Serialize};

use pc_core::{valid_cv, CvEntry};

use crate::db::{self, Db};
use crate::error::{ApiError, ApiResult};
use crate::models::{ChangelistRow, NewChangelist};
use crate::schema::changelists::dsl::{
    changelists, created_at, cvs_json, decoder_id, id as id_col,
};
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub decoder: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBody {
    pub decoder: String,
    pub name: String,
    pub cvs: Vec<CvEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceBody {
    pub cvs: Vec<CvEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChangelistJson {
    pub id: i32,
    pub decoder: String,
    pub name: String,
    pub cvs: Vec<CvEntry>,
}

impl ChangelistJson {
    fn from_row(row: ChangelistRow) -> Result<Self, ApiError> {
        let cvs: Vec<CvEntry> = serde_json::from_str(&row.cvs_json)
            .map_err(|err| ApiError::internal("changelist_corrupt").with_detail(err.to_string()))?;
        Ok(Self {
            id: row.id,
            decoder: row.decoder_id,
            name: row.name,
            cvs,
        })
    }
}

async fn require_enabled(state: &AppState) -> ApiResult<()> {
    if !state.config().await.enabled {
        return Err(ApiError::forbidden("pc_disabled"));
    }
    Ok(())
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn normalize_decoder(raw: &str) -> Result<String, ApiError> {
    let decoder = raw.trim().to_string();
    if decoder.is_empty() {
        return Err(ApiError::bad_request("missing_decoder"));
    }
    Ok(decoder)
}

fn normalize_name(raw: &str) -> Result<String, ApiError> {
    let name = raw.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::bad_request("empty_name"));
    }
    Ok(name)
}

fn encode_cvs(cvs: &[CvEntry]) -> Result<String, ApiError> {
    if cvs.is_empty() {
        return Err(ApiError::bad_request("empty_changelist"));
    }
    for entry in cvs {
        if !valid_cv(entry.cv) {
            return Err(ApiError::bad_request("invalid_cv"));
        }
    }
    serde_json::to_string(cvs)
        .map_err(|err| ApiError::internal("changelist_encode_failed").with_detail(err.to_string()))
}

fn list_rows(conn: &mut SqliteConnection, decoder: &str) -> Result<Vec<ChangelistRow>, ApiError> {
    changelists
        .filter(decoder_id.eq(decoder))
        .order(created_at.desc())
        .select(ChangelistRow::as_select())
        .load(conn)
        .map_err(|err| ApiError::internal("db_query_failed").with_detail(err.to_string()))
}

fn insert_row(
    conn: &mut SqliteConnection,
    decoder: &str,
    name: &str,
    json: &str,
) -> Result<ChangelistRow, ApiError> {
    diesel::insert_into(changelists)
        .values(&NewChangelist {
            decoder_id: decoder.to_string(),
            name: name.to_string(),
            cvs_json: json.to_string(),
            created_at: now_unix(),
        })
        .returning(ChangelistRow::as_returning())
        .get_result(conn)
        .map_err(|err| ApiError::internal("db_insert_failed").with_detail(err.to_string()))
}

fn update_cvs(conn: &mut SqliteConnection, id: i32, json: &str) -> Result<ChangelistRow, ApiError> {
    diesel::update(changelists.filter(id_col.eq(id)))
        .set(cvs_json.eq(json))
        .returning(ChangelistRow::as_returning())
        .get_result(conn)
        .map_err(|err| match err {
            diesel::result::Error::NotFound => ApiError::not_found(),
            other => ApiError::internal("db_update_failed").with_detail(other.to_string()),
        })
}

fn delete_row(conn: &mut SqliteConnection, id: i32) -> Result<(), ApiError> {
    let n = diesel::delete(changelists.filter(id_col.eq(id)))
        .execute(conn)
        .map_err(|err| ApiError::internal("db_delete_failed").with_detail(err.to_string()))?;
    if n == 0 {
        return Err(ApiError::not_found());
    }
    Ok(())
}

async fn with_db<T, F>(db: Db, f: F) -> ApiResult<T>
where
    T: Send + 'static,
    F: FnOnce(&mut SqliteConnection) -> ApiResult<T> + Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        let mut conn = db::lock(&db)?;
        f(&mut conn)
    })
    .await
    .map_err(|err| ApiError::internal("db_join_failed").with_detail(err.to_string()))?
}

pub async fn list(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> ApiResult<Json<Vec<ChangelistJson>>> {
    require_enabled(&state).await?;
    let decoder = normalize_decoder(&q.decoder)?;
    let rows = with_db(state.db.clone(), move |conn| list_rows(conn, &decoder)).await?;
    let out = rows
        .into_iter()
        .map(ChangelistJson::from_row)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(out))
}

pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateBody>,
) -> ApiResult<(StatusCode, Json<ChangelistJson>)> {
    require_enabled(&state).await?;
    let decoder = normalize_decoder(&body.decoder)?;
    let name = normalize_name(&body.name)?;
    let json = encode_cvs(&body.cvs)?;
    let row = with_db(state.db.clone(), move |conn| {
        insert_row(conn, &decoder, &name, &json)
    })
    .await?;
    Ok((StatusCode::CREATED, Json(ChangelistJson::from_row(row)?)))
}

pub async fn replace(
    State(state): State<AppState>,
    Path(id): Path<i32>,
    Json(body): Json<ReplaceBody>,
) -> ApiResult<Json<ChangelistJson>> {
    require_enabled(&state).await?;
    let json = encode_cvs(&body.cvs)?;
    let row = with_db(state.db.clone(), move |conn| update_cvs(conn, id, &json)).await?;
    Ok(Json(ChangelistJson::from_row(row)?))
}

pub async fn delete(State(state): State<AppState>, Path(id): Path<i32>) -> ApiResult<StatusCode> {
    require_enabled(&state).await?;
    with_db(state.db.clone(), move |conn| delete_row(conn, id)).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn memory() -> diesel::sqlite::SqliteConnection {
        let mut conn = diesel::sqlite::SqliteConnection::establish(":memory:").expect("memory");
        db::run_migrations(&mut conn).expect("migrate");
        conn
    }

    #[test]
    fn crud_isolates_decoders() {
        let mut conn = memory();
        let cvs = vec![CvEntry { cv: 2, value: 40 }];
        let json = encode_cvs(&cvs).expect("encode");
        let a = insert_row(&mut conn, "nmra", "one", &json).expect("insert a");
        insert_row(&mut conn, "zimo-ms450", "two", &json).expect("insert b");
        let listed = list_rows(&mut conn, "nmra").expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "one");
        let updated = update_cvs(
            &mut conn,
            a.id,
            &encode_cvs(&[CvEntry { cv: 5, value: 200 }]).expect("encode2"),
        )
        .expect("update");
        let parsed = ChangelistJson::from_row(updated).expect("parse");
        assert_eq!(parsed.cvs, vec![CvEntry { cv: 5, value: 200 }]);
        delete_row(&mut conn, a.id).expect("delete");
        assert!(list_rows(&mut conn, "nmra").expect("list2").is_empty());
        assert_eq!(list_rows(&mut conn, "zimo-ms450").expect("list3").len(), 1);
    }

    #[test]
    fn rejects_empty_and_invalid() {
        assert_eq!(normalize_decoder("  ").unwrap_err().code, "missing_decoder");
        assert_eq!(normalize_name(" \t ").unwrap_err().code, "empty_name");
        assert_eq!(encode_cvs(&[]).unwrap_err().code, "empty_changelist");
        assert_eq!(
            encode_cvs(&[CvEntry { cv: 0, value: 1 }]).unwrap_err().code,
            "invalid_cv"
        );
        assert!(encode_cvs(&[CvEntry { cv: 1, value: 255 }]).is_ok());
    }

    #[test]
    fn update_missing_is_not_found() {
        let mut conn = memory();
        let err = update_cvs(&mut conn, 99, "[]").unwrap_err();
        assert_eq!(err.code, "not_found");
        let err = delete_row(&mut conn, 99).unwrap_err();
        assert_eq!(err.code, "not_found");
    }
}
