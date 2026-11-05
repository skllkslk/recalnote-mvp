# RecallNote Interactive Agent UX Design v0.1

## 0. 목적과 범위

이 문서는 Record, Evidence, Proposal, Quest를 사용자가 직접 조립하지 않아도 되도록
사용자 경험을 NPC 대화와 동적 카드 중심으로 바꾸기 위한 MVP 설계다.

이번 MVP는 두 가지 사용 목적만 지원한다.

- `CAREER`: 경력기술서 초안 작성
- `LEARNING`: 학습 로드맵 생성

지도(Map) 시각화, 로그인, 외부 검색, 자동 Quest 완료 처리는 이번 범위에서 제외한다.
승인된 결과는 기존 Proposal/Quest 원장에 저장하고, 이후 Map 노드로 확장할 수 있는 결과 타입을 남긴다.

핵심 원칙:

```text
사용자는 경험을 말한다
→ Agent가 구조화한다
→ 사용자가 사실과 근거를 확인한다
→ Agent가 결과를 제안한다
→ 사용자가 승인한다
```

내부 원장 구조는 유지한다.

```text
Record → Evidence → Proposal → Quest → QuestEvent
```

사용자 화면에는 다음 용어를 우선 사용한다.

| 내부 개념 | 사용자 화면 용어 |
|---|---|
| Record | 원본 기록 / 경험 |
| Evidence | 원본 근거 |
| Proposal | AI 제안 |
| Quest | 작성 단계 / 학습 단계 |
| Agent session | NPC 대화 |

## 1. Information Architecture

```text
온보딩 / 프로필
├─ 사용 목적 선택
├─ 목적별 기본 정보 입력
└─ 첫 경험 또는 학습 재료 입력

홈 허브
├─ 현재 목표(Epic)
├─ NPC 대화 이어가기
├─ 검토 대기 중인 AI 제안
└─ 최근 승인 결과

NPC 대화방
├─ Agent 메시지
├─ 동적 선택지
├─ 자유 입력
├─ AI 해석 확인 카드
├─ 원본 근거 확인 카드
└─ 결과 승인 카드

원본 기록 보관함
└─ Record 조회·수정·삭제 및 고급 근거 확인

결과물 작업실
└─ 승인된 경력기술서 초안 또는 학습 단계 확인
```

기존 `기억의 세계`, 플레이어 레벨, 학습 추천 화면은 기본 온보딩 흐름에서 숨기고 후속 기능으로 유지한다.

## 2. 공통 사용자 여정

### 2.1 시작

1. 사용자가 앱에 진입한다.
2. 사용 목적을 선택한다.
3. 목적에 맞는 Epic이 활성화된다.
4. 목적별 기본 프로필 폼이 표시된다.
5. 사용자는 자유 형식 텍스트를 입력하거나 Markdown을 업로드한다.

프로필은 로그인 대체 수단이 아니다. 현재 MVP에서는 테스트 컨텍스트와 Agent 개인화 맥락으로 사용한다.

### 2.2 NPC 대화

NPC 대화는 일반 채팅이 아니라 `메시지 + 선택지 + 자유 입력`이 결합된 짧은 단계형 인터랙션이다.

```text
CAPTURED
→ INTERPRETING
→ NEEDS_INPUT
→ NEEDS_CONFIRMATION
→ READY_FOR_PROPOSAL
→ PROPOSAL_PENDING
→ APPROVED / REJECTED
```

사용자에게는 내부 상태 대신 다음 표현을 사용한다.

| 내부 상태 | 표시 문구 |
|---|---|
| `CAPTURED` | 기록을 받았어요 |
| `INTERPRETING` | 내용을 정리하고 있어요 |
| `NEEDS_INPUT` | 한 가지만 더 알려주세요 |
| `NEEDS_CONFIRMATION` | 이렇게 이해했어요 |
| `READY_FOR_PROPOSAL` | 제안을 준비했어요 |
| `PROPOSAL_PENDING` | 결과를 확인해 주세요 |
| `APPROVED` | 결과를 저장했어요 |
| `REJECTED` | 이번 제안을 보류했어요 |

### 2.3 사용자 승인 원칙

승인은 두 단계다.

1. 사실·근거 승인: Agent가 정리한 내용과 연결한 Record를 확인한다.
2. 결과 승인: 최종 Proposal을 확인하고 저장 여부를 결정한다.

Agent가 두 단계를 대신 완료할 수 없다.

## 3. CAREER 사용자 여정

### 3.1 Epic

```text
경력기술서 초안 완성
```

### 3.2 입력 폼

필수 입력을 최소화한다.

- 현재 역할
- 목표 직무 또는 작성 목적
- 경험을 자유롭게 설명하는 입력창
- 선택: Markdown 파일 업로드

선택 입력:

- 관심 기술
- 경력 요약
- 프로젝트 이름

사용자가 모든 필드를 완성하지 않아도 NPC 대화를 시작할 수 있어야 한다.

### 3.3 NPC 대화 예시

```text
NPC: 좋아요. 이 경험을 경력기술서에 사용할 수 있도록 정리해볼게요.
     이 작업에서 가장 가까운 역할은 무엇인가요?

[기능을 개발했어요]
[문제를 분석하고 수정했어요]
[테스트와 검증을 했어요]
[여러 역할을 맡았어요]
[직접 입력할게요]
```

```text
NPC: 결과를 어떻게 확인했나요?

[자동화 테스트]
[운영 로그]
[사용자 피드백]
[수치로 확인]
[아직 확인하지 못했어요]
```

### 3.4 AI 해석 확인

```text
AI가 이해한 경험

문제
협력사 계정의 권한 검증 오류

내가 한 일
권한 체크 로직을 수정하고 회귀 테스트를 추가함

결과
동일한 오류가 재발하지 않도록 검증 절차를 보완함

[맞아요] [수정할게요] [삭제]
```

각 항목은 원본 Record와 연결되어야 한다. 근거가 없거나 원문과 일치하지 않으면 `확인 필요`로 표시하고 최종 제안의 확정 사실로 사용하지 않는다.

### 3.5 결과 승인

```text
AI 제안

권한 검증 오류를 수정하고 회귀 테스트를 추가한 경험 정리

1. 문제 상황과 담당 범위를 정리한다.
2. 수정한 권한 로직과 판단 근거를 설명한다.
3. 테스트 방식과 확인 결과를 경력기술서 문장으로 다듬는다.

[이대로 승인] [수정하기] [다시 질문하기] [보류]
```

승인 후 내부적으로 `Quest`를 생성한다. 화면에서는 `경력기술서 작성 단계`라고 표시한다.

## 4. LEARNING 사용자 여정

### 4.1 Epic

```text
개인 학습 로드맵 생성
```

### 4.2 입력 폼

- 배우고 싶은 주제
- 현재 수준
- 학습 목표
- 주당 학습 가능 시간
- 원하는 결과물
- 선택: 관련 경험, 노트, Markdown 업로드

예시 입력:

```text
Spring Security를 처음부터 다시 공부해서 실제 프로젝트에 적용하고 싶어요.
```

### 4.3 NPC 대화 예시

```text
NPC: 현재 Spring Security를 어느 정도 알고 있나요?

[처음 접해요]
[기본 개념은 알아요]
[프로젝트에 사용해봤어요]
[문제 해결 경험이 있어요]
[직접 입력할게요]
```

```text
NPC: 이번 학습이 끝났을 때 무엇을 할 수 있으면 좋을까요?

[인증과 인가를 설명할 수 있어요]
[권한 검증 API를 만들 수 있어요]
[테스트를 작성할 수 있어요]
[프로젝트에 적용할 수 있어요]
[직접 입력할게요]
```

### 4.4 결과 승인

```text
학습 로드맵 제안

목표
Spring Security의 권한 검증을 이해하고 프로젝트에 적용한다.

학습 단계
1. 인증과 인가의 차이를 정리한다.
2. 현재 프로젝트의 권한 흐름을 추적한다.
3. 허용·거부 요청에 대한 테스트를 작성한다.

완료 기준
두 가지 권한 시나리오를 테스트로 검증할 수 있다.

[이대로 승인] [수정하기] [다시 질문하기] [보류]
```

승인 후 내부적으로 `Quest`를 생성한다. 화면에서는 `학습 단계` 또는 `학습 로드맵`으로 표시한다.

## 5. Dynamic Card Contract

Agent는 임의 HTML이나 실행 명령을 반환하지 않고, 허용된 카드 스키마만 반환한다.

```json
{
  "type": "CHOICE",
  "id": "role",
  "title": "이 경험에서 가장 가까운 역할은 무엇인가요?",
  "options": [
    { "id": "build", "label": "기능을 개발했어요" },
    { "id": "debug", "label": "문제를 분석하고 수정했어요" },
    { "id": "test", "label": "테스트와 검증을 했어요" },
    { "id": "free_text", "label": "직접 입력할게요", "requiresText": true }
  ],
  "allowFreeText": true,
  "required": true
}
```

허용 카드 타입:

- `TEXT`: 자유 입력
- `CHOICE`: 단일 또는 복수 선택
- `CONFIRMATION`: AI 해석 확인
- `EVIDENCE`: 원본 기록과 인용문 확인
- `PROPOSAL`: 최종 결과 승인

카드 응답은 Agent가 직접 DB를 변경하는 명령이 아니다. Spring이 세션 맥락에 저장하고 다음 Agent 실행의 입력으로만 전달한다.

## 6. Agent 세션 모델

현재의 단일 요청형 `POST /api/v1/agent/quest-proposals`는 대화형 흐름을 표현하기 어렵다. MVP에서는 Agent 세션을 추가한다.

### 6.1 핵심 모델

```text
agent_session
├─ id
├─ user_id
├─ epic_id
├─ use_case
├─ state
├─ context_json
├─ pending_cards_json
├─ approved_context_json
├─ created_at
└─ updated_at
```

기존 `agent_run`은 호출 이력과 성공·실패 추적에 사용하고, `agent_session`은 사용자가 이어가는 대화 상태로 사용한다.

### 6.2 최소 API

```text
POST /api/v1/agent-sessions
대화 세션 생성

GET /api/v1/agent-sessions/{sessionId}
현재 NPC 대화 상태 조회

POST /api/v1/agent-sessions/{sessionId}/turns
자유 입력 또는 카드 응답 제출

POST /api/v1/agent-sessions/{sessionId}/approve
최종 Proposal 승인 및 Quest 생성

POST /api/v1/agent-sessions/{sessionId}/reject
제안 보류 또는 거절
```

승인 API는 기존 결정 API와 연결할 수 있다. 초기 구현에서는 세션에서 생성된 Proposal ID를 기존
`/quest-proposals/{id}/decisions`에 전달해도 된다.

### 6.3 세션 응답 예시

```json
{
  "sessionId": "session-001",
  "useCase": "CAREER",
  "state": "NEEDS_CONFIRMATION",
  "npc": {
    "name": "리콜 가이드",
    "message": "제가 이렇게 이해했어요. 맞는지 확인해 주세요."
  },
  "cards": [
    {
      "type": "CONFIRMATION",
      "id": "claim-role",
      "title": "내가 한 일",
      "value": "권한 체크 로직을 수정하고 회귀 테스트를 추가함",
      "sourceRefs": [
        {
          "recordId": "record-001",
          "recordVersion": 2,
          "excerpt": "권한 체크 로직을 수정하고 테스트를 추가했다."
        }
      ],
      "actions": ["CONFIRM", "EDIT", "REMOVE"]
    }
  ]
}
```

## 7. Agent Guardrails와 Tool 정책

### 7.1 공통 Guardrail

- Record에 없는 사실·수치·역할을 확정하지 않는다.
- 모든 Evidence는 허용된 Record ID와 version을 사용한다.
- `excerpt`가 원문에 포함되는지 서버가 검증한다.
- 근거가 없으면 `확인 필요` 또는 빈 제안을 반환한다.
- 카드 타입과 필드는 서버의 허용 목록으로 검증한다.
- Agent는 Record, Proposal, Quest를 직접 저장하거나 승인하지 않는다.
- 사용자가 최종 승인하기 전에는 Quest를 생성하지 않는다.
- 대화 턴 수, 입력 길이, Record 수를 제한한다.
- Agent timeout과 실패를 명시적인 세션 상태로 저장한다.

### 7.2 CAREER Guardrail

- 팀 성과를 사용자의 개인 성과로 바꾸지 않는다.
- 프로필의 직업·목표를 성과 Evidence로 사용하지 않는다.
- 확인되지 않은 수치를 경력기술서 문장에 넣지 않는다.
- 역할, 문제, 행동, 결과를 구분한다.

### 7.3 LEARNING Guardrail

- 사용자의 수준을 임의로 단정하지 않는다.
- 검증하지 않은 참고자료나 링크를 생성하지 않는다.
- 학습 효과를 보장하지 않는다.
- 각 학습 단계에 완료 기준 또는 확인 방법을 포함한다.
- 외부 결제·신청·메시지 발송은 수행하지 않는다.

### 7.4 Tool 정책

초기 MVP에는 Tool을 최소화한다. Spring이 사용자 소유 Record와 기존 Quest를 조회해 Agent에 전달한다.

추후 허용할 읽기 전용 Tool:

- `search_records`
- `get_record`
- `get_learning_notes`
- `get_existing_quests`

금지 Tool:

- `create_record`
- `create_quest`
- `accept_proposal`
- `delete_record`
- `update_profile`
- 외부 서비스 결제·신청·메시지 전송

## 8. 구현 순서

### Phase 1: 설계 고정

- `CAREER`, `LEARNING` use case 정의
- 목적별 Epic 정의
- 카드 스키마 정의
- 세션 상태 정의
- 승인 경계 정의

### Phase 2: CAREER thin slice

```text
목적 선택
→ 자유 입력
→ AI 해석 카드
→ 근거 확인
→ 경력기술서 Proposal
→ 사용자 승인
→ 기존 Quest 저장
```

### Phase 3: LEARNING 분기

- 학습 입력 폼 추가
- 학습용 NPC 질문 추가
- 학습용 Prompt와 Validator 추가
- 학습용 Proposal 라벨 추가
- 기존 Quest 저장 구조 재사용

### Phase 4: 기존 고급 UI 정리

- Record 직접 선택 UI를 기본 흐름에서 제거
- 필요할 때만 “다른 기록 찾기”로 노출
- Quest, Evidence 용어를 사용자 화면에서 숨김
- NPC 대화 진행 상태와 재개 기능 추가

### Phase 5: Map 확장 지점

승인된 결과에 다음 메타데이터를 남긴다.

```text
result_type: CAREER_DRAFT | LEARNING_PLAN
source_session_id
source_proposal_id
source_record_ids
```

이후 이 결과를 Map 노드로 변환한다. 이번 MVP에서는 Map UI와 직접 연결하지 않는다.

## 9. MVP 완료 기준

### CAREER

- 사용자가 경력기술서 목적을 선택할 수 있다.
- 자유로운 경험 입력만으로 대화를 시작할 수 있다.
- Agent가 1~3개의 확인 카드와 근거를 제시한다.
- 사용자가 사실을 수정·삭제·승인할 수 있다.
- 근거가 확인된 Proposal만 생성된다.
- 사용자가 최종 승인해야 Quest가 저장된다.

### LEARNING

- 사용자가 학습 목적을 선택할 수 있다.
- 주제·수준·목표를 입력할 수 있다.
- Agent가 학습 단계와 완료 기준을 제안한다.
- 사용자가 제안을 수정하거나 거절할 수 있다.
- 승인된 결과가 학습 단계로 저장된다.

### 공통

- 새로고침 후 세션을 다시 불러올 수 있다.
- Agent 실패 시 재시도할 수 있다.
- Agent 응답이 임의의 UI나 DB 명령을 실행하지 않는다.
- Record 원문과 승인된 Evidence의 연결을 추적할 수 있다.
