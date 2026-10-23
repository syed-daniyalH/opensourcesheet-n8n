# Data contract foundation

This is a placeholder contract until the real API and scraper schemas are available.

Every source adapter must emit:

- `source`: stable source identifier
- `externalId`: source-owned unique identifier
- `fetchedAt`: ISO-8601 collection timestamp
- `sourceUpdatedAt`: source timestamp when available
- `sourceUrl`: provenance URL when available
- `payload`: original JSON-compatible source data

The normalizer produces stable Grist fields:

- `Source`
- `ExternalId`
- `CanonicalKey`
- `FetchedAt`
- `SourceUpdatedAt`
- `SourceUrl`
- `ContentHash`
- `RawPayload`
- `Status`

The domain-specific adapter may add typed business fields after the real API contract is confirmed. `CanonicalKey` is the default idempotency key and is currently formed as `source:externalId`.
