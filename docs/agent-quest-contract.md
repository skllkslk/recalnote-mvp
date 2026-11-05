# Agent Quest Proposal Contract

This document describes the contract implemented between the Spring Core API and the FastAPI Agent. Spring is the only public API and remains the source of truth for records, proposals, decisions, and quests. The Agent proposes work; it does not write to the database or make user decisions.

## Request

Spring sends an authenticated `POST` request to:

```text
/internal/v1/quest-proposals/generate
```

The request includes `Content-Type: application/json` and `X-Internal-Api-Key`. In Compose, Spring calls `http://agent-api:8000`; port 8000 is not published on the host.

Example request:

```json
{
  "runId": "2bb3d2fc-1dde-432a-a348-d8b97c7a12e2",
  "userContext": {
    "userId": "dev-user-001",
    "occupation": "Developer",
    "interests": ["learning", "software"]
  },
  "epic": {
    "id": "8c8558f2-66c4-4f45-bb64-27468d12af1e",
    "title": "Developer skill building",
    "completionCriteria": "Create a practical learning outcome"
  },
  "records": [
    {
      "id": "5b22cc1c-9da2-43a2-8348-d971c82d5dc1",
      "title": "Authorization regression fix",
      "contentMarkdown": "Fixed a missing permission check and verified the endpoint.",
      "version": 2
    }
  ],
  "existingQuests": [
    {
      "title": "Add authorization regression tests",
      "description": "Cover allowed and denied requests.",
      "status": "TODO"
    }
  ]
}
```

NPC generation supplies only the records selected in the session context, plus `answers` containing confirmed role/level and confirmation decisions. The legacy direct endpoint supplies up to 20 recent records. `useCase` is `CAREER` or `LEARNING`. `existingQuests` contains up to 20 active quests for the selected Epic. Profile data may be empty.

## Response

Successful responses have `status: "SUCCEEDED"`. `proposals` may be empty when there is no usable evidence.

```json
{
  "runId": "2bb3d2fc-1dde-432a-a348-d8b97c7a12e2",
  "status": "SUCCEEDED",
  "proposals": [
    {
      "title": "Authorization regression test coverage",
      "description": "Make the permission fix repeatable and check nearby endpoints for the same gap.",
      "steps": [
        "List the affected endpoint and its allowed and denied behaviors.",
        "Add regression tests for an authorized request and an unauthorized request.",
        "Run the tests and record any related endpoints that still need review."
      ],
      "completionCriteria": "Both permission cases pass in automated tests, and any remaining endpoints are recorded.",
      "resultMarkdown": "# Career draft\n\nFixed a missing permission check and verified the endpoint.\n\nRole and measured outcome: [confirmation needed]",
      "rationale": "The saved record describes a permission-check fix that can be protected with regression coverage.",
      "evidence": [
        {
          "recordId": "5b22cc1c-9da2-43a2-8348-d971c82d5dc1",
          "recordVersion": 2,
          "excerpt": "Fixed a missing permission check and verified the endpoint."
        }
      ]
    }
  ],
  "warnings": []
}
```

### Proposal requirements

- `title`, `description`, `completionCriteria`, and `resultMarkdown` must be non-empty.
- `steps` must contain 2–5 non-empty action steps.
- `evidence` must contain at least one item with `recordId`, `recordVersion`, and `excerpt`.
- A proposal must be grounded in the supplied records. Do not invent user experience or outcomes.
- Avoid proposing work that duplicates an existing active quest. Return no proposal if there is no relevant evidence.

Spring verifies that evidence belongs to supplied records, that excerpts occur verbatim in those records, and that the database record belongs to the user, has the supplied version, and is not deleted. A proposal with no valid evidence is discarded. Approval locks source records and rejects changed or deleted evidence with HTTP 409.

## Persistence and decisions

Spring persists proposal steps in `quest_proposal.steps_json` and the completion criterion in `quest_proposal.completion_criteria`. The V2 Flyway migration adds these columns with defaults so existing rows remain readable. On acceptance, Spring copies the reviewed content to the corresponding `quest` columns in the same decision transaction as the quest, evidence links, and creation event.

`POST /api/v1/quest-proposals/{proposalId}/decisions` supports:

- `ACCEPT`: accept the stored proposal content.
- `ACCEPT_EDITED`: accept optional `editedTitle`, `editedDescription`, `editedSteps`, `editedCompletionCriteria`, and `editedResultMarkdown`; omitted fields retain proposal values.
- `REJECT`: mark the proposal rejected; no quest is created.

An accepted quest requires a non-empty title and objective, 2–5 non-empty steps, and a non-empty completion criterion. A proposal can only be decided once.

## Modes and current limits

`AGENT_MODE=mock` returns a deterministic career draft template or learning roadmap and skips duplicate active titles. It exercises the full persistence and review flow without a model key.

`AGENT_MODE=openai` invokes the OpenAI Agents SDK with the user context, Epic, active quests, and supplied records. Its instructions ask for a practical proposal in the language of the records, with concrete steps and record evidence. It still produces at most one proposal per run. Configure `OPENAI_API_KEY` only for the Agent service. Model output quality is not guaranteed by the schema; Spring validates structural and evidence ownership constraints before persistence.

The Agent does not retrieve or modify records, approve results, or change quest status. NPC questions currently follow a fixed role/level → facts → evidence flow; `AGENT_MODE=openai` applies to final result generation.

## NPC sessions

- `POST /api/v1/agent-sessions` captures free text (including optional structured form fields) into a Record.
- `POST /api/v1/agent-sessions/{id}/turns` accepts the currently displayed card only. Fact edits or evidence rejection request supplemental text, stored by Spring as a new Record requiring fresh confirmation.
- Generation requires both `facts-check=confirm` and `source-check=confirm`.
- `GET /api/v1/agent-sessions/latest` resumes the latest unfinished session for the user's selected Epic; it returns `{}` if none exists.
- `POST /api/v1/agent-sessions/{id}/approve` accepts optional edited fields, including `editedResultMarkdown`, and creates a Quest and creation Event atomically. V6 stores the result Markdown on both Proposal and Quest.
- `POST /api/v1/agent-sessions/{id}/reject` rejects the pending result without creating a Quest.
- Approved or rejected sessions cannot receive more turns. Decisions through the legacy proposal endpoint also update the linked session state.
