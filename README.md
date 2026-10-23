# Punchdeck → Grist integration foundation

This is a resource-independent foundation for sending API and scraper data into a self-hosted Grist deployment.

It intentionally uses a mock source until the real Punchdeck API/scraper resources are available. It provides:

- typed source-adapter and writer interfaces
- deterministic normalization and content hashing
- idempotent Grist upsert structure
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

The tests do not require a Grist server because they use an in-memory writer. A real API smoke test requires a Grist document, table, and API key.

## Configuration

Copy `.env.example` to `.env` and fill in real values only outside source control. Keep `DRY_RUN=true` and `MOCK_SOURCE=true` for the first foundation smoke test.

The first real adapter should implement `SourceAdapter` and convert source responses into the contract in `docs/DATA_CONTRACT.md`. It must be added only after the source API, authentication, unique key, and expected fields are known.

## Admin gateway and local Grist UI

The project includes a small authentication gateway in `src/admin-gateway.ts`. After login it shows a Sheets-inspired open-source workspace home with templates and recent files, then opens the real Grist editor under `/grist/`. It protects the Grist UI and Grist admin routes and proxies HTTP and WebSocket traffic.

For local testing, create `.env.admin.local` from `.env.example`, set a password of at least 12 characters and a session secret of at least 32 characters, then run:

```powershell
npm run build
npm run start:gateway
```

Open `http://127.0.0.1:3000/`. `/control` is the technical admin dashboard, `/` is the Sheets-inspired file home, and `/editor` opens the authenticated editor shell with the File/Edit/View/Insert/Format/Data/Tools/Extensions/Help row plus the formatting toolbar above the real Grist workspace. `/grist/` remains the direct Grist surface for administration and troubleshooting. Keep Grist bound to localhost or an internal Docker network so users cannot bypass the gateway through port `8484`.

The Compose gateway binds to host port `8487` for staging and `8488` for production; place HTTPS termination and the public subdomain in front of those gateway ports.

The gateway is intentionally dependency-free. It is a protective entry point for this project, not a replacement for a public identity provider, HTTPS termination, rate limiting, or a production secret manager.

See [`docs/GOOGLE_SHEETS_UI_REVIEW.md`](docs/GOOGLE_SHEETS_UI_REVIEW.md) for the reference review and [`docs/REPORTING_WORKSPACE_ROADMAP.md`](docs/REPORTING_WORKSPACE_ROADMAP.md) for the Excel/Google feature mapping, delivery priorities, CRM boundary, and remaining production work. The home shell is Sheets-inspired; Grist remains the actual spreadsheet engine.

## Deployment notes

- Use `deploy/compose.staging.yml` for staging first.
- Set a real public URL and reverse-proxy it with WebSocket forwarding.
- Use a separate `/persist` directory for staging and production.
- Pin the production Grist image; do not use `latest` in production.
- Do not commit `.env`, API keys, cookies, or VPS credentials.

This project is not production-ready until the real adapters, schema mapping, VPS configuration, backup/restore test, and end-to-end smoke test are implemented.
