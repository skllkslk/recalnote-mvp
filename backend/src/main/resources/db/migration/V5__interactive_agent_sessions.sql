ALTER TABLE user_profile
    ADD COLUMN use_case varchar(20) NOT NULL DEFAULT 'CAREER';

ALTER TABLE epic
    ADD COLUMN use_case varchar(20) NOT NULL DEFAULT 'CAREER';

UPDATE epic SET use_case = 'CAREER' WHERE use_case IS NULL;

INSERT INTO epic(user_id, title, completion_criteria, use_case)
SELECT 'dev-user-001',
       '개인 학습 로드맵 생성',
       '학습 목표와 현재 수준에 맞는 실행 가능한 학습 단계를 정리한다.',
       'LEARNING'
WHERE EXISTS (SELECT 1 FROM app_user WHERE id = 'dev-user-001')
  AND NOT EXISTS (SELECT 1 FROM epic WHERE user_id = 'dev-user-001' AND use_case = 'LEARNING');

CREATE TABLE agent_session (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id varchar(100) NOT NULL REFERENCES app_user(id),
    epic_id uuid NOT NULL REFERENCES epic(id),
    use_case varchar(20) NOT NULL,
    state varchar(40) NOT NULL,
    context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    pending_cards_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    approved_context_json jsonb,
    proposal_id uuid REFERENCES quest_proposal(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_session_user_updated_idx ON agent_session(user_id, updated_at DESC);
