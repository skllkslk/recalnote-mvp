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
- NPC sessions generate from the session's records and confirmed answers, together with profile, Epic, and existing quest context. The legacy direct generation endpoint still uses recent records.
- Review and edit the generated Markdown result, objective, steps, completion criteria, rationale, and source evidence before approval; rejection creates no Quest.
- On acceptance, persist the edited title, objective, steps, completion criteria, evidence links, and creation event. The quest board displays the structured plan.

Proposal and quest steps are stored as JSONB; completion criteria are stored separately. Existing rows are preserved by Flyway migration V2.

Flyway V6 adds onboarding completion and the `result_markdown` columns on proposals and quests. Existing quests remain readable. First-time users choose an Epic on the profile screen. Pending NPC sessions can be resumed after reload using `/api/v1/agent-sessions/latest`.

The default `AGENT_MODE=mock` exercises the full flow without a model key and returns a deterministic draft template or learning roadmap. NPC questions and confirmation cards currently follow a fixed short flow. `AGENT_MODE=openai` uses the Agents SDK, while `AGENT_MODE=gemini` uses the Google GenAI SDK and `GEMINI_API_KEY` to generate the final result. Review and edit generated facts before accepting them.

For OpenAI on Railway, set `AGENT_MODE=openai`, `OPENAI_API_KEY`, and `OPENAI_MODEL=gpt-4.1-mini` on the **agent service**, then redeploy it with this source. The model defaults to `gpt-4.1-mini` and can be overridden without editing code. Keep `INTERNAL_API_KEY` identical on the API and agent services. No frontend or database change is required. OpenAI failures log the model, exception type, HTTP status and provider request ID without recording prompts, keys or response bodies. Generation is limited to 75 seconds, within the core API's 90-second agent timeout.

OpenAI receives structured source evidence and generated citations must match the record ID, version and a verbatim excerpt. An empty or unusable result receives at most one correction attempt within the same 75-second deadline; this can incur a second model call. Validation logs show generated/usable proposal counts without record contents. If no usable result remains, the agent and core API return 422 instead of silently repeating the evidence confirmation card. Deploy the agent, backend and frontend together for this validation and user-facing error behavior.

## Prerequisites

- Docker Desktop with Docker Compose v2
- For frontend work, Node.js 22 and pnpm (Next.js app in `frontend/`)

## Start locally (PowerShell)

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
curl http://localhost:8080/api/v1/epics/active
# Use the returned epic id:
curl -X POST http://localhost:8080/api/v1/agent/quest-proposals -H 'Content-Type: application/json' \
  -d '{"epicId":"<epic-id>"}'
curl http://localhost:8080/api/v1/quest-proposals
# Use the returned proposal id:
curl -X POST http://localhost:8080/api/v1/quest-proposals/<proposal-id>/decisions \
  -H 'Content-Type: application/json' -d '{"action":"ACCEPT"}'
curl http://localhost:8080/api/v1/quests
```

`POST /api/v1/records` → Agent proposal generation → `PENDING` proposal storage → user review → `ACCEPT`, `ACCEPT_EDITED`, or `REJECT`. Acceptance stores the quest, evidence links, reviewed result body, and creation event in one database transaction. Spring validates evidence ownership, supplied record scope, version, and verbatim excerpts before storing evidence. Approval rejects changed or deleted source records.

## Stop and preserve data

```powershell
docker compose down
```

The named volume remains. To remove all local database data, run `docker compose down -v` (destructive).

## Configuration and deployment

Copy `.env.example` to `.env`; never commit `.env`. Compose requires explicit `POSTGRES_PASSWORD`, `DB_PASSWORD`, and `INTERNAL_API_KEY`. Set distinct strong secrets in each environment. Set `SPRING_PROFILES_ACTIVE=prod` and `DEV_USER_ENABLED=false` outside local development. In that mode the core API requires `X-Authenticated-User`; place it behind an authentication gateway that sets this header and strips client-supplied copies. The app provisions the authenticated subject on first request and scopes records and all user-owned resources to it. Do not expose this header as an unauthenticated identity mechanism.

For actual model calls, set `AGENT_MODE=gemini` and provide `GEMINI_API_KEY` to the agent container only. Optionally set `GEMINI_MODEL` to a model enabled for your Gemini API account. Keep provider keys out of browser variables and source control. Compose exposes core API only on loopback by default; terminate TLS and add gateway authentication before public deployment. Configure `AGENT_BASE_URL`, `DB_HOST`, `DB_PORT`, `DB_NAME`, credentials and service keys through environment variables without changing application code.

Health endpoints: Spring `/actuator/health/liveness` and `/actuator/health/readiness`; internal Agent `/health/live` and `/health/ready`. PostgreSQL uses `pg_isready`. The Agent container has no host port mapping. The Next.js route handler proxies browser requests to Spring. Set `API_BASE_URL=http://localhost:8080` in the Next.js process only when Spring is not at its default address; the browser calls the same-origin Next.js proxy.

Flyway migrations live in `backend/src/main/resources/db/migration`. Hibernate schema generation is set to `validate`. The initial schema uses PostgreSQL JSONB for tags and leaves pgvector installation to a later migration; record text remains the authoritative data.

## Troubleshooting

- `docker compose config` checks Compose interpolation and YAML.
- `docker compose logs -f core-api agent-api postgres` shows startup and migration logs.
- If credentials change after first startup, the existing named volume retains the old database credentials; recreate local data with `docker compose down -v` only if it is safe to discard.

## Developer documentation

For isolated integration checks with mock generation:

```powershell
docker compose -p recallnote-flow-check -f compose.flow-test.yaml up --build -d
# Wait for http://localhost:18081/actuator/health/readiness to report UP.
python -m unittest discover -s tests -v
docker compose -p recallnote-flow-check -f compose.flow-test.yaml down -v
```

This environment uses a separate disposable database and test-only credentials. It does not connect to the normal application's database. Run Agent unit tests from `agent/` with `python -m unittest discover -s tests -v`; run backend tests with JDK 17 and `mvn test`; run the frontend production build with `pnpm build`.

- [Agent quest proposal contract](docs/agent-quest-contract.md) describes the Spring-to-Agent request/response schema, evidence checks, and mock/OpenAI behavior.
- [Local development and MVP smoke flow](docs/local-development.md) covers Compose, the separate Next.js dev server, and one quest cycle.
