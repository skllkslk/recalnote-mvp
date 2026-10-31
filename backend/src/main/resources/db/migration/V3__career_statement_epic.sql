UPDATE epic
SET title = '경력기술서 초안 완성',
    completion_criteria = '프로젝트별 역할, 문제 해결 과정, 실행한 행동과 검증 가능한 성과를 원본 경험 기록에 근거해 경력기술서 초안으로 정리한다.'
WHERE user_id = 'dev-user-001'
  AND status = 'ACTIVE'
  AND title = 'Developer skill building';
