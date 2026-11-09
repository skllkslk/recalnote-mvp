ALTER TABLE record ADD COLUMN source_type varchar(30);
ALTER TABLE record ADD COLUMN source_path text;
ALTER TABLE record ADD COLUMN source_page_id varchar(32);
ALTER TABLE record ADD COLUMN import_key char(64);

-- Per-user, concurrency-safe deduplication. Deleted records may be imported again.
CREATE UNIQUE INDEX record_user_import_key_idx ON record(user_id, import_key) WHERE deleted_at IS NULL;
