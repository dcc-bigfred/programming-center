//! Diesel schema for the programming-center SQLite database.

diesel::table! {
    changelists (id) {
        id -> Integer,
        decoder_id -> Text,
        name -> Text,
        cvs_json -> Text,
        created_at -> BigInt,
    }
}
