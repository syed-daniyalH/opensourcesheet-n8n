# Final release audit

Date: 2026-10-24  
Local target: `http://127.0.0.1:3000`  
Verdict: **Ready for staging only**

This audit separates what is implemented and evidenced from what is only represented in the UI. A control being visible in the Sheets-style shell does not mean the underlying Grist engine supports that operation.

## Evidence collected

| Area | Result | Evidence |
|---|---|---|
| TypeScript build | Pass | `npm run check` |
| Automated tests | Pass: 21/21 | `npm run check` |
| Executable smoke tests | Pass: 2/2 | `npm run test:smoke` |
| Dependency audit | Pass: 0 vulnerabilities | `npm audit --omit=dev` |
| Formatting check | Pass | `git diff --check` |
| Staging Compose syntax | Pass with placeholders | `docker compose -f deploy/compose.staging.yml config -q` |
| Production Compose syntax | Pass with placeholders | `docker compose -f deploy/compose.production.yml config -q` |
| Local Docker runtime | Pass | `grist-local` is running on `127.0.0.1:8484`; no deployment stack was started by this audit |
| Public health endpoint | Pass | `GET /healthz` returns JSON `status: ok` |
| Unauthenticated protection | Pass | `/`, `/editor`, `/control`, and `/grist/` redirect to `/login` |
| Invalid login | Pass | `POST /login` returns `401` |
| Valid login/session | Pass | `POST /login` returns `303 /` and sets an HttpOnly session cookie |
| Authenticated routes | Pass | `/`, `/editor`, `/control`, and `/admin` return `200`; `/grist/` reaches the upstream redirect |
| Logout/session invalidation | Pass | `/logout` redirects to `/login`; the previous session can no longer open `/editor` |
| Top menu shell | Pass | File, Edit, View, Insert, Format, Data, Tools, Extensions, and Help opened and closed in the browser |
| Reporting ribbon | Pass as navigation | Home, Insert, Draw, Page Layout, Formulas, Data, Review, View, and Help all selected the expected panel |
| Responsive ribbon layout | Pass after fix | Direct tab labels now remain in a horizontal, scrollable row at narrow viewport widths |
| Embedded Grist grid | Pass | A real document loaded inside the same-origin iframe; `Smoke Test` and formula result `2` were visible |
| Formula/undo smoke path | Pass in existing smoke coverage | The executable pipeline and prior browser smoke run cover formula data, undo, and redo behavior |
| Unsupported-control disclosure | Pass | Currency format displays a clear “not exposed by the current Grist engine” message |

## Endpoint and feature matrix

| Surface | Status | Notes |
|---|---|---|
| `/healthz` | Implemented and tested | Gateway liveness only; it does not prove upstream Grist or source/CRM health |
| `/login`, `/logout` | Implemented and tested | In-memory sessions; production requires process strategy and secret rotation |
| `/`, `/control` | Implemented and tested | Admin shell and deployment status links |
| `/editor` | Implemented and tested | Sheets-style chrome around the Grist engine |
| `/grist/*` HTTP proxy | Implemented and tested | Authenticated same-origin proxy; upstream behavior remains Grist behavior |
| `/grist/*` WebSocket upgrade | Implemented in code | Browser iframe loaded; no independent CLI WebSocket assertion was run |
| API ingestion | Implemented and tested with mock source | Real Meta/source adapter, source authentication, field mapping, and read-back are still missing |
| Idempotent Grist upsert | Implemented and tested against a Grist-compatible fake endpoint | Real Grist write/read-back requires actual document/table/API key |
| Google/Excel menus and ribbon | Implemented as navigation shell | Many operations are deliberately placeholders until a matching engine API is wired |
| Cell formatting | Not implemented through the shell | Currency, percent, number formats, font, colors, borders, and alignment show a disclosure toast |
| Insert chart/table/pivot/map | Not implemented through the shell | Visible in the Insert panel only |
| Draw tools | Not implemented | Visible in the Draw panel only |
| Page setup/gridlines/margins | Not implemented through the shell | Print button is wired to the embedded frame; page-layout controls are not |
| Formula library/auditing | Partially implemented | Formula guide and function-reference links work; native formula evaluation remains Grist's responsibility |
| Sort/filter/validation/text-to-columns | Not implemented through the shell | Grist may expose related capabilities, but no adapter is wired here |
| Comments/protection/accessibility | Partially implemented | Accessibility control shows an informational status; comment/protect controls are placeholders |
| Full screen | Implemented in browser code | Requires browser permission/user gesture and was not treated as a production guarantee |
| Zoom/freeze panes/gridlines | Not implemented through the shell | Visible in the View panel only |
| Bottom status/sheet navigation | Delegated to Grist | The shell does not yet provide a Google Sheets-style custom bottom status bar or sheet-tab model |

## What was already present

- Authenticated gateway with session cookies and same-origin Grist proxying.
- Mock-source ingestion, normalization, stable idempotency keys, retries, and batch writes.
- Grist Docker-based local workspace.
- Google Sheets-like home screen, top menus, formatting toolbar, and Excel-style reporting ribbon.
- Staging/production Compose skeletons and CI test workflow.

## What is missing before production

- A real Meta/API/scraper adapter and its contract, credentials, rate limits, pagination, and field mapping.
- Real Grist staging write/read-back using a pinned image and a non-test document/table.
- Operational sync state, dead-letter handling, audit/provenance views, and alerting.
- Actual implementations for the formatting, charts, pivot, draw, page-layout, validation, comment, protection, freeze, and bottom-bar features listed above.
- VPS deployment with DNS, HTTPS, firewall policy, secret storage, monitoring, backup restore, and rollback rehearsal.
- Persistent session strategy if more than one gateway replica is used.

## Production-readiness decision

**Ready for staging only.** The gateway and sheet-ingestion foundation are testable and healthy locally, but claiming “fully matched,” “100% complete,” or “production ready” would be inaccurate because several visible ribbon controls are placeholders and the real Meta adapter, VPS, backup, restore, HTTPS, and rollback paths have not been verified.
