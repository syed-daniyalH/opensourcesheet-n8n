# Spreadsheet UI review and implementation boundary

## Reference reviewed

The open Google Sheets home page was reviewed only as a visual and interaction reference. No user document was opened, edited, downloaded, copied, or transmitted. The existing files shown in the account were intentionally left untouched.

The reference home screen has these important patterns:

- a compact top bar with a main menu, product identity, global search, app launcher, and account control;
- a template strip with a blank spreadsheet and named starter templates;
- a recent-file list grouped by time;
- owner and last-opened metadata;
- file actions, sharing indicators, grid/list controls, sorting, filtering, and file-picker access;
- responsive behavior that keeps the file list usable on smaller screens.

The spreadsheet editor reference has a separate working surface:

- document title and star/favorite control;
- menus for File, Edit, View, Insert, Format, Data, Tools, Extensions, and Help;
- undo/redo, print, formatting, number-format, borders, alignment, and other toolbars;
- formula/name bar, column letters, row numbers, a cell selection model, and a large editable grid;
- sheet tabs at the bottom;
- collaboration/share, comments/activity, and account controls;
- document history, filters, sorting, import/export, and extension/automation entry points.

## What the current project uses as the base

The project does not reimplement a spreadsheet engine. It uses the open-source Grist server as the data and editing engine and places an authenticated gateway in front of it.

| Surface | Current implementation | Evidence |
|---|---|---|
| Login | Node gateway with an HTTP-only session cookie | `src/admin-gateway.ts`, gateway tests |
| Home screen | Sheets-inspired open-source shell with search, templates, recent files, owner/date columns, navigation drawer, and sign-out | `src/admin-gateway.ts` `renderHome()` |
| Grid editor | Official Grist editor routed through `/grist/` | Browser smoke test reached a real document and table grid |
| Formulas, tables, pages, raw data, history, access rules | Provided by Grist | Verified through the Grist document surface; do not duplicate in the shell |
| HTTP and WebSocket traffic | Gateway proxy | `proxyHttp()` and `proxyUpgrade()` |
| Ingestion | Existing typed API-to-Grist pipeline | `src/pipeline.ts`, `src/grist-client.ts` |

## Functional gap assessment

The current home shell is functional for navigation and search, but the named template cards are not yet separate template generators. They currently open the Grist workspace. Creating true starter documents requires either seeded Grist documents or a document-creation/template-copy API flow.

The following Google-specific capabilities are not claimed as implemented:

- Google Drive identity and sharing;
- Apps Script and Google Workspace add-ons;
- Google-specific comments, notifications, and offline synchronization;
- exact Google Sheets keyboard behavior and pixel-identical rendering;
- Google Sheets file import/export fidelity beyond what Grist supports.

The safe architecture is to implement equivalent behavior on top of Grist where Grist supports it, and to label unsupported Google-only behavior rather than pretending it exists.

## Next implementation phases

1. Replace the static recent-file metadata with a server-side Grist document/workspace listing.
2. Add a real `Create document` flow and seed the named starter templates into dedicated Grist documents.
3. Add file actions for rename, archive/trash, favorite, and ownership display through authenticated Grist APIs.
4. Add gateway rate limiting, persistent sessions or an external identity provider, CSRF protection for state-changing gateway actions, and audit logging.
5. Add end-to-end browser tests for login, home search, template creation, document open, grid edit, and logout.
6. Keep the public deployment behind HTTPS and ensure the Grist upstream port is not publicly reachable.

## Engineering decision

Use the new shell for navigation and project-specific workflows, while keeping Grist as the actual spreadsheet surface. Rebuilding the entire Google Sheets editor from scratch would create a second spreadsheet engine, duplicate years of functionality, and weaken compatibility with the existing API-to-Grist pipeline.
