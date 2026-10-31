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

## Exercise one quest cycle in the UI

1. Add one experience record with a specific problem, what you changed, and how you verified it.
2. Choose **제안 생성**. In mock mode, the Agent proposes a general verification and regression-prevention plan based on the newest eligible record.
3. On **퀘스트 제안 검토**, review the objective, 2–5 steps, completion criterion, and evidence excerpt. Edit any field or add/remove steps as needed.
4. Choose **수정 내용으로 수락**. Spring stores the edited quest, evidence links, and creation event transactionally.
5. Open **내 퀘스트** and confirm that the same steps and completion criterion are shown.
6. To check rejection, generate another proposal and choose **거절**. It should appear in completed reviews without creating a quest.

Existing proposals created before Flyway V2 have empty step and completion fields. Fill these fields in the review card before accepting one, or generate a new proposal.

## Exercise the API with PowerShell

The local profile uses `DEV_USER_ID`, so no login header is required. These commands create a record and proposal; accepting the proposal also writes a quest to the local database.

```powershell
$record = @{
  title = "Authorization regression fix"
  contentMarkdown = "Fixed a missing permission check and verified the endpoint."
  tags = @("learning")
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:8080/api/v1/records" `
  -ContentType "application/json" -Body $record

$epic = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/epics/active"
$run = @{ epicId = $epic.id } | ConvertTo-Json
$generated = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:8080/api/v1/agent/quest-proposals" `
  -ContentType "application/json" -Body $run

$proposal = $generated.proposals | Where-Object status -eq "PENDING" | Select-Object -First 1
$decision = @{
  action = "ACCEPT_EDITED"
  editedTitle = $proposal.title
  editedDescription = $proposal.description
  editedSteps = $proposal.steps
  editedCompletionCriteria = $proposal.completionCriteria
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:8080/api/v1/quest-proposals/$($proposal.id)/decisions" `
  -ContentType "application/json" -Body $decision

Invoke-RestMethod -Uri "http://localhost:8080/api/v1/quests"
```

The API sequence is intended for a single fresh run. If there are several pending proposals, select the one created in that run before deciding.

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
