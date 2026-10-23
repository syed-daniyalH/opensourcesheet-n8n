# Reporting workspace roadmap

The Excel and Google Sheets screenshots are treated as interaction references, not as code to copy. The project keeps Grist as the spreadsheet engine and uses the gateway as the sales-team workspace shell.

## Priority model

| Priority | Capability | Why it matters for company reports | Implementation direction |
|---|---|---|---|
| P0 | Reliable grid editing, formula entry, undo/redo, print, sheets, filters, frozen headers, import/export | Daily sales work must be safe and familiar | Use Grist capabilities through the authenticated editor shell |
| P0 | API and scraper ingestion with idempotent upserts | CRM data must not duplicate when a source is retried | Existing typed pipeline, normalization, content hashes, and retry queue |
| P0 | Sync state, validation errors, audit trail, and source provenance | Teams need to know whether a report is current and trustworthy | Add an ingestion status endpoint and visible status panel before production |
| P0 | Authentication, roles, HTTPS, rate limits, CSRF, backups, and rollback | Company data must be protected | Gateway and VPS deployment hardening |
| P1 | Home ribbon, report templates, charts, conditional formatting, data validation, comments, protected ranges | Makes recurring reports faster for sales and operations | Build on Grist widgets and document APIs; do not duplicate the grid engine |
| P1 | CRM-focused views: leads, contacts, activities, owners, status, last sync, error queue | Makes the product an operational workspace instead of a generic blank sheet | Add domain schema and views after the real CRM contract is supplied |
| P1 | PDF/print layouts, report export, scheduled refresh, and report snapshots | Required for management reporting | Add server-side report jobs and tested export flows |
| P2 | Pivot tables, forecasting, formula auditing, drawing, macros, add-ins, offline mode, and advanced Excel parity | Valuable later, but expensive and not required for the first safe sales workflow | Evaluate one feature at a time against Grist support and maintenance cost |

## Screenshot-to-feature mapping

- Home: clipboard, undo/redo, font, alignment, number formats, styles, cells, and editing map to the editor toolbar and Home ribbon.
- Insert: tables, charts, pivot reports, maps, links, text, and symbols map to Grist widgets, report templates, and future insert actions.
- Draw: pen, shapes, ink conversion, and replay are lower priority for a CRM reporting product.
- Page Layout: print, page setup, scaling, gridlines, headings, and arrange map to print/report configuration.
- Formulas: function library, names, tracing, error checking, and calculation options map to formula help, validation, and future audit tools.
- Data: source import, refresh, sort/filter, validation, grouping, and forecast map directly to the ingestion pipeline and report views.
- Review: comments, accessibility, protection, and audit history are P1/P0 collaboration and governance features.
- View and footer: zoom, gridlines, freeze panes, sheet tabs, sync state, and record counts are P0 usability and trust signals.

## Current implementation boundary

The editor route now has the Google-style menu row plus an Excel-style ribbon with Home, Insert, Draw, Page Layout, Formulas, Data, Review, View, and Help tabs. Undo, redo, print, full screen, navigation, documentation, and CRM pipeline status navigation are wired. The remaining ribbon controls are visible but report their unsupported status until a corresponding Grist operation is implemented and tested.

The current ingestion code does not yet connect to a real CRM or source API. It only has a mock adapter and a tested Grist writer. A production CRM connection requires the API contract, authentication method, unique record key, field mapping, ownership rules, and a real staging read-back test.

## Recommended delivery sequence

1. Confirm the real CRM/source API and field-level data contract.
2. Add ingestion health, last-success, failure counts, and a retry/error queue to the admin panel.
3. Add one sales report template with real columns, validation, filters, and a tested API-to-Grist sync.
4. Add role-based access and protected report areas.
5. Add charts, PDF/export, scheduled refresh, backup/restore, and rollback rehearsal.
6. Expand into advanced Excel-class features only when a real team workflow justifies them.

The evidence-based status remains Ready for staging only until these external integrations and deployment checks are completed.
