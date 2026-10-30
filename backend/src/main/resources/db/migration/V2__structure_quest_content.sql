ALTER TABLE quest_proposal
    ADD COLUMN steps_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN completion_criteria text NOT NULL DEFAULT '';

ALTER TABLE quest
    ADD COLUMN steps_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN completion_criteria text NOT NULL DEFAULT '';
