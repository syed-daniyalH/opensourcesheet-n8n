# Sheet-first product acceptance

## Product definition

The first release is a self-hosted spreadsheet website. A user signs in, opens one configured Grist document, enters or edits data in the grid, uses the sheet menus and bottom tabs, and saves directly to the self-hosted Grist document. API ingestion is a later write path into the same document; it is not part of the first sheet usability gate.

```text
Login → Aureum sheet workspace → Grist document/grid → persisted self-hosted data
                                      ↑
                         future Meta/API adapters
```

## Acceptance gate before API work

The sheet phase is complete only when each item below has a passing browser test or a documented engine-level verification:

| Area | Required behavior | Current state |
|---|---|---|
| Login and routing | Login protects home, editor, admin, and the Grist upstream; logout invalidates the session | Implemented and tested |
| Direct sheet open | `/editor` opens one configured document, not the Grist document manager | Implemented locally and verified |
| Grid editing | Select cells, enter text/numbers, edit existing values, add rows and columns | Delegated to Grist; browser acceptance test required |
| Formula engine | Enter a supported formula, recalculate, and show an error for invalid input | Delegated to Grist; smoke coverage exists for a simple formula |
| Sheet navigation | Create/select/rename sheets or document pages and preserve edits | Delegated to Grist; browser acceptance test required |
| Menus | File, Edit, View, Insert, Format, Data, Tools, Extensions, and Help expose real actions or a clearly labeled supported limitation | Shell exists; actions are being wired incrementally |
| Formatting | Number formats, font emphasis, colors, borders, alignment, and column sizing behave through the selected engine API | Not yet fully exposed by the shell |
| Data operations | Sort, filter, validation, grouping, import, export, and refresh operate on the document | Grist capabilities must be verified and surfaced |
| Reporting | Charts, tables, print, page layout, and report views are usable for the team workflow | Print is wired; remaining features need acceptance tests |
| Collaboration and safety | Undo/redo, history, access rules, protected areas, and clear save/sync state work | Partially implemented by the shell/engine; acceptance tests required |
| Responsive layout | The top bar, toolbar, grid, and bottom tabs remain usable at desktop and narrow browser widths | Shell exists; visual test required |

## Engineering rule

The shell must not pretend that a visible Google Sheets or Excel control is implemented. Each control must either:

1. invoke a real Grist operation;
2. invoke a tested Aureum operation around Grist; or
3. be marked as pending with a clear reason and acceptance test.

Once this gate passes, the Meta/API adapter can write into the same Grist document using the existing normalization and idempotent upsert pipeline. That sequencing keeps the primary user experience stable before external data is introduced.
