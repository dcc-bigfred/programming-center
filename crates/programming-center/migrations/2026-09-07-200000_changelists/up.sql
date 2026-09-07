-- Create changelists (named CV snapshots per decoder).

CREATE TABLE changelists (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  decoder_id TEXT NOT NULL,
  name TEXT NOT NULL,
  cvs_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX changelists_decoder ON changelists (decoder_id);
