# Source-to-sheet ingestion architecture

## Product boundary

This project is a sheet-backed ingestion and reporting surface. It receives records from Meta and other approved sources, stores them in Grist, and makes the data available to CRM or reporting consumers. It is not itself a customer-follow-up schema.

The main pattern is:

```text
Meta Lead API / other source
          ↓
SourceAdapter
  auth · pagination · rate limits · source mapping
          ↓
Common source envelope
  source · externalId · fetchedAt · payload
          ↓
Normalizer
  validation · canonical key · content hash · provenance
          ↓
GristWriter.upsert
          ↓
Grist sheet / report views
          ↓
CRM export, CRM reader, or other downstream consumer
```

## Why the adapter exists

Meta and other providers do not return the same field names, pagination shape, timestamps, error formats, or identifiers. The adapter isolates those differences. It fetches records and converts them to the common source envelope; it does not own the spreadsheet UI, does not write directly to Grist, and does not add follow-up behavior.

The pipeline then performs the source-independent work:

1. Validate the required source identifier, external identifier, and collection timestamp.
2. Preserve the original JSON payload.
3. Derive a deterministic `CanonicalKey` for idempotent upserts.
4. Calculate a content hash for change detection.
5. Write batches to Grist with retry behavior.
6. Report counts and failures for the sync run.

## What the sheet represents

The Grist document is the operational data workspace. It is a sheet-like storage and reporting surface, not a formal CRM schema. Its stable system columns make records traceable and safely repeatable. Source-specific columns are added only when the source contract and business mapping are confirmed.

The recommended logical tabs are:

- `LeadsRaw` / `MetaLeadsRaw` for the source envelope and raw payload.
- `LeadsNormalized` for human-friendly report columns.
- `SyncRuns` for ingestion run history.
- `SyncErrors` for records that need retry or review.

CRM views, exports, or API consumers can read the normalized sheet. A CRM may also be a separate downstream writer, but that is a separate integration boundary and is not silently assumed by this repository.

## Current implementation status

The reusable pipeline, normalizer, retrying Grist writer, gateway, and mock adapter are implemented and tested. The real Meta adapter is not implemented yet. Completing that adapter requires:

- Meta app/page or ad-account access and a secure token configuration.
- The selected lead source and endpoint contract.
- Form/page/ad-account identifiers and required permissions.
- Pagination, rate-limit, webhook-versus-polling, and retry decisions.
- The unique source record key and field-level mapping.
- A staging Grist document and read-back verification.

Until those inputs are supplied and tested, the mock adapter is the only claimable source implementation. The production verdict must therefore remain staging-only for Meta ingestion.
