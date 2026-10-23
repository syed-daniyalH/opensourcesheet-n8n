# Test report

Date: 2026-10-24

## Automated checks

Command: `npm run check`

Result: **Pass — 13 tests passed, 0 failed.**

Coverage of the current foundation:

| Area | Checks |
|---|---|
| Configuration | Required variables, HTTP(S) URL validation, defaults, booleans, positive integer settings |
| Normalization | Stable source/external ID, canonical idempotency key, sorted JSON hashing, required-field rejection |
| Grist client | URL encoding, `PUT` method, bearer authentication, JSON upsert body, key-field enforcement, bounded error text |
| Retry behavior | Transient recovery, exponential delay sequence, retry budget and final error |
| Pipeline | Dry-run behavior, batch writes, configured key propagation, invalid-record accounting |

## Functional mock run

Command: `node dist/index.js` with `MOCK_SOURCE=true` and `DRY_RUN=true`.

Result: **Pass**

```json
{"event":"ingestion_complete","source":"mock-source","seen":2,"normalized":2,"written":0,"failed":0,"dryRun":true}
```

This proves the executable path from configuration through source collection, normalization, and pipeline summary. It does not prove connectivity to a real Grist server.

## Deployment configuration checks

- Staging Compose interpolation: **Pass** with safe placeholder values.
- Production Compose interpolation: **Pass** with a placeholder pinned image value.
- Docker image build and container startup: **Not run** because the local Docker daemon is unavailable.
- Real Grist API write/read-back: **Not run** because no Grist URL, document/table, or API key was supplied.
- VPS HTTPS, DNS, backups, restore, and rollback: **Not run** because no VPS connection, provider, domain, or backup target was supplied.

## Evidence boundary

The current evidence supports **Ready for staging only**. It does not support “production ready” or “100% complete.” A production verdict requires a real staging deployment, a real Grist upsert/read-back test, an actual source adapter, HTTPS, health checks, backup/restore verification, and a rollback rehearsal.
