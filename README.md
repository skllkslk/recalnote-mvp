# RecallNote MVP

RecallNote turns saved work records into reviewable, actionable quest proposals. The implemented flow is:

```text
Next.js → Spring Boot → FastAPI Agent → Spring Boot/PostgreSQL → user review → Quest
```

Spring Boot (Java 17) is the public API and PostgreSQL is the source of truth. FastAPI is only reachable on the Compose network; the Core API calls it at `http://agent-api:8000` with `INTERNAL_API_KEY`. Schema changes are applied by Flyway at startup. PostgreSQL data lives in the `postgres_data` named volume.

## Implemented MVP behavior

- Create, list, view, update, and soft-delete Markdown records; read the active Epic.
- Generate a proposal from the current user's profile, active Epic, recent records, and active quests.
- Review the proposal's objective, 2–5 steps, completion criteria, rationale, and source-record evidence. Edit the plan before accepting, or reject it.
- On acceptance, persist the edited title, objective, steps, completion criteria, evidence links, and creation event. The quest board displays the structured plan.

Proposal and quest steps are stored as JSONB; completion criteria are stored separately. Existing rows are preserved by Flyway migration V2.

The default `AGENT_MODE=mock` exercises the full flow without a model key, but returns a predictable general verification and regression-prevention plan. `AGENT_MODE=openai` uses the Agents SDK and the supplied record context to create a more tailored proposal. Neither mode guarantees that every generated step is useful; review and edit proposals before accepting them.

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

`POST /api/v1/records` → Agent proposal generation → `PENDING` proposal storage → user review → `ACCEPT`, `ACCEPT_EDITED`, or `REJECT`. Acceptance stores the quest, evidence links, and creation event in one database transaction. Spring checks that evidence IDs belong to the current user and that record versions still match before storing evidence. It does not compare the excerpt text against the record body.

## Stop and preserve data

```powershell
docker compose down
```

The named volume remains. To remove all local database data, run `docker compose down -v` (destructive).

## Configuration and deployment

Copy `.env.example` to `.env`; never commit `.env`. Compose requires explicit `POSTGRES_PASSWORD`, `DB_PASSWORD`, and `INTERNAL_API_KEY`. Set distinct strong secrets in each environment. Set `SPRING_PROFILES_ACTIVE=prod` and `DEV_USER_ENABLED=false` outside local development. In that mode the core API requires `X-Authenticated-User`; place it behind an authentication gateway that sets this header and strips client-supplied copies. The app provisions the authenticated subject on first request and scopes records and all user-owned resources to it. Do not expose this header as an unauthenticated identity mechanism.

For actual model calls, set `AGENT_MODE=openai` and provide `OPENAI_API_KEY` to the agent container only. Keep it out of browser variables and source control. Compose exposes core API only on loopback by default; terminate TLS and add gateway authentication before public deployment. Configure `AGENT_BASE_URL`, `DB_HOST`, `DB_PORT`, `DB_NAME`, credentials and service keys through environment variables without changing application code.

Health endpoints: Spring `/actuator/health/liveness` and `/actuator/health/readiness`; internal Agent `/health/live` and `/health/ready`. PostgreSQL uses `pg_isready`. The Agent container has no host port mapping. The Next.js route handler proxies browser requests to Spring. Set `API_BASE_URL=http://localhost:8080` in the Next.js process only when Spring is not at its default address; the browser calls the same-origin Next.js proxy.

Flyway migrations live in `backend/src/main/resources/db/migration`. Hibernate schema generation is set to `validate`. The initial schema uses PostgreSQL JSONB for tags and leaves pgvector installation to a later migration; record text remains the authoritative data.

## Troubleshooting

- `docker compose config` checks Compose interpolation and YAML.
- `docker compose logs -f core-api agent-api postgres` shows startup and migration logs.
- If credentials change after first startup, the existing named volume retains the old database credentials; recreate local data with `docker compose down -v` only if it is safe to discard.

## Developer documentation

- [Agent quest proposal contract](docs/agent-quest-contract.md) describes the Spring-to-Agent request/response schema, evidence checks, and mock/OpenAI behavior.
- [Local development and MVP smoke flow](docs/local-development.md) covers Compose, the separate Next.js dev server, and one quest cycle.
