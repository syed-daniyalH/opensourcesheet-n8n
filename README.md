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
```

See `docs/TEST_REPORT.md` for the executed unit, functional, and deployment-configuration checks.

The tests do not require a Grist server because they use an in-memory writer. A real API smoke test requires a Grist document, table, and API key.

## Configuration

Copy `.env.example` to `.env` and fill in real values only outside source control. Keep `DRY_RUN=true` and `MOCK_SOURCE=true` for the first foundation smoke test.

The first real adapter should implement `SourceAdapter` and convert source responses into the contract in `docs/DATA_CONTRACT.md`. It must be added only after the source API, authentication, unique key, and expected fields are known.

## Deployment notes

- Use `deploy/compose.staging.yml` for staging first.
- Set a real public URL and reverse-proxy it with WebSocket forwarding.
- Use a separate `/persist` directory for staging and production.
- Pin the production Grist image; do not use `latest` in production.
- Do not commit `.env`, API keys, cookies, or VPS credentials.

This project is not production-ready until the real adapters, schema mapping, VPS configuration, backup/restore test, and end-to-end smoke test are implemented.
