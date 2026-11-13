# Notion ZIP import

## Usage

Sign in, open **내 경험 → 기록 가져오기 → Notion ZIP**, select the export, optionally choose a project, and submit once.
In Notion, export as **Markdown & CSV** with subpages included. Upload the ZIP without extracting it.
The result reports imported pages, duplicates, CSV indexes, attachments/other files, and empty pages.

Each nonempty `.md` file becomes one private record. Its first H1 (or filename without Notion's page ID) supplies the title.
The Markdown body, exported property text, and links are kept; only a UTF-8 BOM and line endings are normalized.
The record stores the source path and, when present, the Notion page ID. The detail drawer shows its original path.
Imported records can be searched, edited, and selected as evidence through the existing app.

After importing, choose **이 기록으로 결과물 만들기** in **내 경험**. Complete the Epic selection if needed,
then select up to 20 saved records on the NPC screen. New text is optional when records are selected.
The NPC session uses the original record IDs without creating copies; confirm the facts and evidence,
review the generated Markdown, and approve it to save the result.
When multiple records are supplied, the NPC first asks which writing target to use.
Only matching explicit `project:` tags or `프로젝트명:` / `프로젝트 이름:` / `Project name:` fields
are automatically grouped. Records without those labels remain separate; shared technologies alone
do not establish a project relationship. Choose another target from the project card to reset the
role, facts, and evidence confirmations. Only the chosen target's records reach result generation.
Fact and evidence cards cover every record in that target and provide original-record buttons.
Project selection requires coordinated Agent, backend, and frontend deployment; no migration is required.
This route requires both the backend and frontend updates: `POST /api/v1/agent-sessions` accepts
optional `recordIds` alongside optional `contentMarkdown`, and requires at least one source.

CSV files are database indexes and are not imported as extra records. CSV-only exports are rejected with instructions to export Markdown.
Images, PDFs, and other attachments are not stored or fetched. Their relative links remain in the source text and will not resolve to uploaded assets.
Notion internal page links also remain as exported text. This feature does not synchronize with the Notion API or render a Notion workspace.

## Repeat imports and failures

Deduplication is scoped to the authenticated user and keyed by Notion page ID plus normalized original body.
Without an ID, the archive-relative source path plus body is used. Unchanged pages are skipped, even if the stored record was edited in RecallNote.
Changed exported bodies create new records and never overwrite local edits. Choosing a different project does not move previously imported duplicates.
Soft-deleted records can be imported again. A partial unique index also protects simultaneous repeat submissions.

The archive is validated before any insert. Inserts use batches of 100 inside one transaction: a failure cancels the whole import.
If a response is lost after a successful commit, retrying the same archive is safe.

Limits: uploaded ZIP **4 MiB**, expanded data **25 MiB**, one Markdown page **1 MiB**, **2,000 pages**, **5,000 archive entries**,
and up to two nested ZIP layers. ZIP paths are never extracted to disk; absolute/traversal paths, invalid UTF-8, and corrupt entries are rejected.
The 4 MiB upload limit leaves room for multipart overhead when proxied through Vercel. Larger exports must be split into smaller Notion exports.

## Deployment

Deploy the Spring backend first, then the Next.js frontend. Flyway migration `V8__notion_import.sql` adds provenance columns and the per-user deduplication index.
No new credentials or environment variables are needed; Vercel continues to use `API_BASE_URL` for Railway.
The endpoint is `POST /api/v1/imports/notion` with multipart fields `file` (ZIP) and optional `project` (up to 100 characters).
It requires the existing session and `X-CSRF-TOKEN`. The browser uploads via the existing same-origin proxy, preserving the multipart boundary.

## Validation

Run with JDK 17:

```powershell
cd backend
mvn test
cd ../frontend
pnpm test:auth
pnpm exec tsc --noEmit
pnpm build
```

Parser tests use generated archives for Unicode, properties, nested exports, duplicate keys, invalid files, and expansion limits.
If `tests/notion_data_ex.zip` is present locally, it is checked for **672 Markdown pages and 10 CSV indexes** without printing its private content.
The private ZIP is not a committed fixture.

Security tests verify authentication, CSRF, user ownership, and readable upload errors. Proxy tests verify the exact multipart body and headers.
`PostgreSQLNotionImportTest` verifies actual migration/insert behavior, repeat imports, owner isolation, preservation of edits, soft deletion, and rollback after a later batch fails.
Like existing PostgreSQL security tests, it is skipped unless `TEST_DB_URL`, `TEST_DB_USER`, and `TEST_DB_PASSWORD` are configured for a **disposable test database**.
Never point those tests at the application database.
