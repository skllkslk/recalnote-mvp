ALTER TABLE user_profile ADD COLUMN onboarding_completed boolean NOT NULL DEFAULT false;
ALTER TABLE quest_proposal ADD COLUMN result_markdown text NOT NULL DEFAULT '';
ALTER TABLE quest ADD COLUMN result_markdown text NOT NULL DEFAULT '';
