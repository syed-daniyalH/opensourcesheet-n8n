# Ingestion envelope and sheet column contract

This document describes the boundary between a source adapter and the Grist sheet. It is an ingestion contract, not the customer data model and not a follow-up workflow schema. The adapter preserves source data and provenance; Grist stores the resulting records in a sheet-like workspace.

## Adapter output: source envelope

Every source adapter must emit:

- `source`: stable source identifier
- `externalId`: source-owned unique identifier
- `fetchedAt`: ISO-8601 collection timestamp
- `sourceUpdatedAt`: source timestamp when available
- `sourceUrl`: provenance URL when available
- `payload`: original JSON-compatible source data

The adapter owns source-specific concerns such as authentication, pagination, rate limits, webhooks or polling, and mapping the source identifier. It must not write directly to Grist. The pipeline owns normalization and delivery.

## Stable sheet columns

The normalizer produces these stable Grist columns for every source:

- `Source`
- `ExternalId`
- `CanonicalKey`
- `FetchedAt`
- `SourceUpdatedAt`
- `SourceUrl`
- `ContentHash`
- `RawPayload`
- `Status`

These columns support provenance, deduplication, retries, and auditability. `CanonicalKey` is the default idempotency key and is currently formed as `source:externalId`.

## Optional source fields

A source-specific adapter may add typed columns after the real API contract is confirmed. For Meta leads, the exact fields must be agreed from the chosen lead form/page/ad-account response and permissions; this repository does not invent or claim those fields are implemented yet. Preserve the full source response in `RawPayload` while the mapping is being validated.

Recommended sheet tabs are:

- `LeadsRaw` or `MetaLeadsRaw`: source records and preserved payloads.
- `LeadsNormalized`: optional typed columns used by reports and downstream CRM exports.
- `SyncRuns`: run id, source, start/end time, counts, and result.
- `SyncErrors`: failed records, error details, retry state, and last attempt.

Do not create a `CustomerFollowUps` table as part of ingestion. Follow-ups are a separate downstream workflow and should only be added when the product explicitly requires them.
