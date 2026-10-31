ALTER TABLE user_profile
    ADD COLUMN display_name text NOT NULL DEFAULT '',
    ADD COLUMN current_goal text NOT NULL DEFAULT '',
    ADD COLUMN experience_summary text NOT NULL DEFAULT '';
