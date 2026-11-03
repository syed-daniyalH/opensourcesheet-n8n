# Aureum data-ingestion sheet →  

This is a sheet-backed data-ingestion bridge for sending Meta leads and other API or scraper records into a self-hosted    deployment.    is the primary self-hosted spreadsheet and data store: users enter and edit data directly in the sheet, while adapters import external records into the same document. It is a storage and reporting surface, not a customer-follow-up schema or a replacement CRM.

The source adapter is the boundary between an external system and the sheet:

`Meta Lead API / other source → source adapter → normalized records →    sheet → CRM or reporting consumers`

The repository currently uses a mock source until the real Meta/API resources, credentials, and field mapping are supplied. It provides:

- typed source-adapter and   -writer interfaces
- deterministic normalization and content hashing
- idempotent    upsert structure
- batching and exponential retry behavior
- dry-run support
- mock data and unit tests
- CI workflow and detailed test report
- separate staging and production Compose files
- explicit third-party reuse tracking

## Local validation

```powershell
npm install
npm run check
npm run test:smoke
```

See `docs/TEST_REPORT.md` for the executed unit, functional, and deployment-configuration checks.

The tests do not require a    server because they use an in-memory writer. A real API smoke test requires a    document, table, and API key.

## Configuration

Copy `.env.example` to `.env` and fill in real values only outside source control. Keep `DRY_RUN=true` and `MOCK_SOURCE=true` for the first foundation smoke test.

The first real adapter should implement `SourceAdapter` and convert source responses into the ingestion envelope in `docs/DATA_CONTRACT.md`. It must be added only after the source API, authentication, pagination, unique key, and expected fields are known. The adapter fetches source data; it does not define the sheet UI and it does not silently invent CRM workflow fields.

## Admin gateway and spreadsheet workspace

`src/admin-gateway.ts` is the signed-in entry point. After login it shows the home page (shared spreadsheets and templates) and the editor at `/editor` (`src/assets/sheet/`). The editor is a Google Sheets–style grid: 102 functions, formatting, merges, freeze panes, filters, dropdown validation, conditional formatting, notes, charts, hidden rows and columns, CSV and Excel import/export, and version history.

- **Saving:** spreadsheets are saved on the server (`GATEWAY_STATE_DIR/sheets`) and shared with everyone who signs in. Open editors pick up other people's changes within seconds, and simultaneous edits are merged cell by cell.
- **Roles:** admins, editors and viewers are managed on `/control`, together with the audit log.    (`/  /`) is admin-only.
- **Security:** sessions survive restarts, failed sign-ins are rate-limited, and every page sends a strict Content-Security-Policy.

For local testing, create `.env.admin.local` from `.env.example`. Set `ADMIN_PASSWORD` (12+ characters), `ADMIN_SESSION_SECRET` (32+ characters) and `  _ORIGIN`, then run:

```powershell
npm run build
npm run start:gateway
```

Open `http://127.0.0.1:3000/`. Local state goes to `./data` (gitignored).

## Webhook (n8n) ingestion

Set `WEBHOOK_SECRET` to let n8n post records to `POST /api/webhooks/ingest/<source>` (bearer, header, or HMAC-signed). Records appear in the **Webhook leads** spreadsheet, and every call is logged in its *Sync runs* and *Sync errors* tabs. With `DRY_RUN=false` they are also upserted into   . Meta Lead Ads can post directly to `/api/webhooks/meta`. Setup, payloads, and status codes are in [`docs/WEBHOOK_INTEGRATION.md`](docs/WEBHOOK_INTEGRATION.md).

## Deployment

The compose files in `deploy/` run   , the gateway (non-root, health-checked, data in a `/data` volume), and Caddy for automatic HTTPS. The batch ingestion container is opt-in (`--profile ingestion`) because it runs once and exits. [`docs/OPERATIONS.md`](docs/OPERATIONS.md) covers deployment, users and roles, backups (`deploy/backup-data.sh`), restore, upgrades, and monitoring.

- Use `deploy/compose.staging.yml` first; production requires a pinned `  _IMAGE` and explicit data folders.
- Do not commit `.env`, API keys, cookies, or server credentials.

Current status and the remaining staging checklist are in [`docs/FINAL_AUDIT.md`](docs/FINAL_AUDIT.md); test evidence is in [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md).
