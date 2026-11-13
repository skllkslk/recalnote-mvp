# RecallNote MVP

RecallNote turns freely entered experience into a reviewable career draft or learning roadmap. The primary MVP flow is:

```text
Profile / Epic selection (CAREER or LEARNING)
  → optional structured fields + free text
  → NPC dialogue: role / level → facts confirmation → evidence confirmation
  → editable result review → approve or reject
```

Internally, Spring stores Record → Evidence → Proposal; approval atomically creates the Quest with the reviewed Markdown, evidence links, and a QuestEvent. A proposed Quest remains a Proposal until the person approves it. The Agent cannot approve or write these entities itself.

```text
Next.js → Spring Boot → FastAPI Agent → Spring Boot/PostgreSQL → user review → Quest
```

Spring Boot (Java 17) is the public API and PostgreSQL is the source of truth. FastAPI is only reachable on the Compose network; the Core API calls it at `http://agent-api:8000` with `INTERNAL_API_KEY`. Schema changes are applied by Flyway at startup. PostgreSQL data lives in the `postgres_data` named volume.

## Implemented MVP behavior

- Create, list, view, update, and soft-delete Markdown records; read the active Epic.
- NPC sessions generate from the chosen project's records, supplements and confirmed answers, together with profile, Epic, and existing quest context. Direct generation without an NPC session returns 410.
- Review and edit the generated Markdown result, objective, steps, completion criteria, rationale, and source evidence before approval; rejection creates no Quest.
- On acceptance, persist the edited title, objective, steps, completion criteria, evidence links, and creation event. The quest board displays the structured plan.

Proposal and quest steps are stored as JSONB; completion criteria are stored separately. Existing rows are preserved by Flyway migration V2.

Flyway V6 adds onboarding completion and the `result_markdown` columns on proposals and quests. Existing quests remain readable. First-time users choose an Epic on the profile screen. Pending NPC sessions can be resumed after reload using `/api/v1/agent-sessions/latest`.

The default `AGENT_MODE=mock` exercises the full flow without a model key and returns a deterministic draft template or learning roadmap. NPC questions and confirmation cards currently follow a fixed short flow. `AGENT_MODE=openai` uses the Agents SDK, while `AGENT_MODE=gemini` uses the Google GenAI SDK and `GEMINI_API_KEY` to generate the final result. Review and edit generated facts before accepting them.

For OpenAI on Railway, set `AGENT_MODE=openai`, `OPENAI_API_KEY`, and `OPENAI_MODEL=gpt-4.1-mini` on the **agent service**, then redeploy it with this source. The model defaults to `gpt-4.1-mini` and can be overridden without editing code. Keep `INTERNAL_API_KEY` identical on the API and agent services. No frontend or database change is required. OpenAI failures log the model, exception type, HTTP status and provider request ID without recording prompts, keys or response bodies. Generation is limited to 75 seconds, within the core API's 90-second agent timeout.

OpenAI selects source IDs from server-created excerpt chunks (up to 4,800 characters per record in 240-character chunks; longer records use the first and last 2,400 characters). The server resolves only those selected IDs to the original record ID, version and exact text, then validates them against the supplied records. The model does not rewrite citations, and unknown source IDs never fall back to another record. An empty or unusable result receives at most one correction attempt within the same 75-second deadline; this can incur a second model call. Validation logs show generated/usable proposal counts and rejection categories without record contents. If no usable result remains, the agent and core API return 422 instead of silently repeating the evidence confirmation card. Deploy the agent, backend and frontend together for this validation and user-facing error behavior. Subsequent changes to source selection alone require only an agent deployment.

## Prerequisites

- Docker Desktop with Docker Compose v2
- For frontend work, Node.js 22 and pnpm (Next.js app in `frontend/`)

## Start locally (PowerShell)

Notion Markdown & CSV export ZIPs can be uploaded at **내 경험 → 기록 가져오기 → Notion ZIP**. See [Notion import](docs/notion-import.md) for limits, duplicate handling, and deployment order.

```powershell
Copy-Item .env.example .env
# Edit .env and replace POSTGRES_PASSWORD, DB_PASSWORD and INTERNAL_API_KEY.
docker compose up --build -d
docker compose ps
```

Wait until all three services report healthy. The public API is at `http://localhost:8080`; FastAPI has no published host port. The local profile uses `DEV_USER_ID` and requires no login. The agent defaults to deterministic mock mode, so an OpenAI key is not needed for the end-to-end flow.

Example flow with curl (PowerShell users can run these in Git Bash, WSL, or use `Invoke-RestMethod`):

```sh
curl -X POST http://localhost:8080/api/v1/records -H 'Content-Type: application/json' \
  -d '{"title":"Spring authorization notes","contentMarkdown":"Reviewed access control and fixed an authorization bug.","tags":["learning"]}'
# Use the returned record id, then the returned sessionId in subsequent calls:
curl -X POST http://localhost:8080/api/v1/agent-sessions -H 'Content-Type: application/json' \
  -d '{"useCase":"CAREER","recordIds":["<record-id>"]}'
curl -X POST http://localhost:8080/api/v1/agent-sessions/<session-id>/turns \
  -H 'Content-Type: application/json' -d '{"cardId":"role","value":"debug"}'
curl -X POST http://localhost:8080/api/v1/agent-sessions/<session-id>/turns \
  -H 'Content-Type: application/json' -d '{"cardId":"facts-check","value":"confirm"}'
curl -X POST http://localhost:8080/api/v1/agent-sessions/<session-id>/turns \
  -H 'Content-Type: application/json' -d '{"cardId":"source-check","value":"confirm"}'
# Review the generated result before approving it:
curl -X POST http://localhost:8080/api/v1/agent-sessions/<session-id>/approve
curl http://localhost:8080/api/v1/quests
```

`POST /api/v1/records` → NPC session → target/fact/evidence confirmation → `PENDING` proposal → user review → approve or reject. Acceptance stores the quest, all distinct evidence passages, reviewed result body, and creation event in one database transaction. Spring validates evidence ownership, supplied record scope, version, and verbatim excerpts before storing evidence. Approval rejects changed or deleted source records. Flyway V9 retains existing evidence and backfills legacy approved-result excerpts. See [result quality evaluation](docs/result-quality-evaluation.md) for synthetic regression cases and opt-in model evaluation.

## Stop and preserve data

```powershell
docker compose down
```

The named volume remains. To remove all local database data, run `docker compose down -v` (destructive).

## Configuration and deployment

Copy `.env.example` to `.env`; never commit `.env`. Production uses Google OIDC login and PostgreSQL-backed sessions. Set `SPRING_PROFILES_ACTIVE=prod`, `DEV_USER_ENABLED=false`, `SESSION_COOKIE_SECURE=true`, the fixed HTTPS `PUBLIC_BASE_URL`, and Google OAuth credentials. `X-Authenticated-User` is no longer accepted. See [Google login setup and verification](docs/social-login.md) before deploying the backend and frontend together.

For actual model calls, set `AGENT_MODE=gemini` and provide `GEMINI_API_KEY` to the agent container only. Optionally set `GEMINI_MODEL` to a model enabled for your Gemini API account. Keep provider keys out of browser variables and source control. Compose exposes core API only on loopback by default; terminate TLS and configure Google login before public deployment. Configure `AGENT_BASE_URL`, `DB_HOST`, `DB_PORT`, `DB_NAME`, credentials and service keys through environment variables without changing application code.

Health endpoints: Spring `/actuator/health/liveness` and `/actuator/health/readiness`; internal Agent `/health/live` and `/health/ready`. PostgreSQL uses `pg_isready`. The Agent container has no host port mapping. The Next.js route handler proxies browser requests to Spring. Set `API_BASE_URL=http://localhost:8080` in the Next.js process only when Spring is not at its default address; the browser calls the same-origin Next.js proxy.

Flyway migrations live in `backend/src/main/resources/db/migration`. Hibernate schema generation is set to `validate`. The initial schema uses PostgreSQL JSONB for tags and leaves pgvector installation to a later migration; record text remains the authoritative data.

## Troubleshooting

- `docker compose config` checks Compose interpolation and YAML.
- `docker compose logs -f core-api agent-api postgres` shows startup and migration logs.
- If credentials change after first startup, the existing named volume retains the old database credentials; recreate local data with `docker compose down -v` only if it is safe to discard.

## Developer documentation

The legacy Python flow harness below predates session authentication and no longer authenticates. Use `mvn test` and the opt-in PostgreSQL checks in [social-login.md](docs/social-login.md) for this release. The Compose environment remains available as an isolated database/agent setup:

```powershell
docker compose -p recallnote-flow-check -f compose.flow-test.yaml up --build -d
# Wait for http://localhost:18081/actuator/health/readiness to report UP.
docker compose -p recallnote-flow-check -f compose.flow-test.yaml down -v
```

This environment uses a separate disposable database and test-only credentials. It does not connect to the normal application's database. Run Agent unit tests from `agent/` with `python -m unittest discover -s tests -v`; run backend tests with JDK 17 and `mvn test`; run the frontend production build with `pnpm build`.

- [Agent quest proposal contract](docs/agent-quest-contract.md) describes the Spring-to-Agent request/response schema, evidence checks, and mock/OpenAI behavior.
- [Local development and MVP smoke flow](docs/local-development.md) covers Compose, the separate Next.js dev server, and one quest cycle.
