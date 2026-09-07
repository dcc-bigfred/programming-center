//! Diesel row types for the programming-center database.

use diesel::prelude::*;

use crate::schema::changelists;

#[derive(Debug, Clone, Queryable, Selectable, Identifiable)]
#[diesel(table_name = changelists)]
pub struct ChangelistRow {
    pub id: i32,
    pub decoder_id: String,
    pub name: String,
    pub cvs_json: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Insertable)]
#[diesel(table_name = changelists)]
pub struct NewChangelist {
    pub decoder_id: String,
    pub name: String,
    pub cvs_json: String,
    pub created_at: i64,
}
