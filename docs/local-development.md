# Local Development and MVP Smoke Flow

This guide runs PostgreSQL, Spring Core API, and FastAPI Agent with Docker Compose. Next.js runs separately in development mode. The Agent is internal to the Compose network and has no host port.

## Requirements

- Docker Desktop with Docker Compose v2
- Node.js 22 and pnpm for frontend development

## Start the services

From the repository root in PowerShell, create the local environment file once:

```powershell
Copy-Item .env.example .env
```

Set local values for `POSTGRES_PASSWORD`, `DB_PASSWORD`, and `INTERNAL_API_KEY` in `.env`. `AGENT_MODE=mock` works without an OpenAI key. Do not commit `.env`.

Build and start the database, Agent, and Core API:

```powershell
docker compose up --build -d
docker compose ps
```

Wait for `postgres`, `agent-api`, and `core-api` to report healthy. The Core API is at `http://localhost:8080`.

Start the frontend in a second PowerShell window:

```powershell
Set-Location frontend
pnpm install
pnpm dev
```

Open `http://localhost:3000`. The Next.js `/api/v1/*` route proxies requests to Spring at `http://localhost:8080` by default. Set `API_BASE_URL` for the Next.js process only if Spring is at a different address.

## Exercise one result cycle in the UI

1. Select and save a Career or Learning Epic.
2. Add/import records, then choose the result creation action in the archive or search screen.
3. Select saved records and optionally add explanatory text. That text supplements the selected target.
4. If multiple candidate records exist, select the project group. Confirm the role, facts and source evidence.
5. Use the supplement action to add/correct facts while preserving originals. The explicit replacement action starts with a new source instead.
6. Review and edit the generated Markdown, then approve it.
7. Open the results screen and verify the saved body and every evidence passage. Reload and verify persistence.
8. To test rejection, generate another result and reject it; no new approved result should be created.

The old direct `POST /api/v1/agent/quest-proposals` endpoint returns 410. All generation now goes
through NPC target/fact/evidence confirmation. The README contains a single-record local API example;
production mutations also require the normal authenticated session and CSRF token.

For database-backed evidence migration and approval checks, use a disposable database with
`TEST_DB_URL`, `TEST_DB_USER`, and `TEST_DB_PASSWORD`, then run `mvn test` under JDK 17.
See [result quality evaluation](result-quality-evaluation.md) for offline cases, saved-response checks,
and optional live OpenAI evaluation.

## Use OpenAI mode

Set these entries in the root `.env`:

```dotenv
AGENT_MODE=openai
OPENAI_API_KEY=your-key
```

Recreate the Agent container so it receives the updated environment:

```powershell
docker compose up --build -d agent-api
docker compose ps agent-api
```

Keep the key in `.env` and provide it only to the Agent container. Return to `AGENT_MODE=mock` to use the offline deterministic flow.

## Logs and shutdown

```powershell
docker compose logs --since 5m --tail 100 core-api agent-api postgres
docker compose down
```

`docker compose down` preserves the named PostgreSQL volume. `docker compose down -v` deletes the local database volume and all records, proposals, and quests stored in it; use it only when you intend to reset local data.
