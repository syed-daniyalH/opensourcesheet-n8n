# Formula compatibility contract

The editor uses Grist as its calculation engine. It does not implement a second formula parser in the Punchdeck shell. This keeps recalculation, dependency tracking, and formula errors in the same engine that stores the document.

## What Grist supports

The official Grist documentation says that formulas support most Excel functions, plus Python and Grist-specific record/table helpers. Formula columns recalculate when document data changes. The supported function reference is linked from the editor's Formulas ribbon.

Useful examples for the sales workflow include:

```text
IF($Status == "Won", $Amount, 0)
SUM(Table1.all.Amount)
AVERAGE(Table1.all.Amount)
Table1.lookupOne(ExternalId=$ExternalId).Name
```

Grist formulas are column formulas and use Python-style references such as `$Amount` or `rec.Amount`. This differs from a Google Sheets cell formula such as `=SUM(C2:C20)`. The equivalent Grist formula depends on the table and column IDs, so it must not be translated by guessing.

## What is not promised

“All Google Sheets formulas” is not a safe compatibility claim. Google Sheets has its own function catalog, array behavior, named functions, locale rules, and cell-oriented reference semantics. The project currently has no separate compatibility layer for every Google Sheets function, no automatic formula translator, and no test fixture for every function in either product.

The acceptance rule is therefore:

1. Use the native Grist formula syntax in Grist documents.
2. Add a fixture and a real-engine test for every formula family required by the CRM workflow.
3. Record syntax differences before importing a Google Sheets workbook.
4. Do not mark a formula as supported from a screenshot or from a static formula string alone; verify recalculation and error behavior in the target Grist document.

## Current evidence

- The local Grist document visibly recalculates the smoke formula and shows the result `2`.
- The ingestion tests verify deterministic keys, payload delivery, and retry recovery.
- The Formulas ribbon now links to the official Grist formula guide and function reference.
- A full Google Sheets parity suite has not been run and is not claimed.

## Official references

- [Grist formulas](https://support.getgrist.com/formulas/)
- [Grist function reference](https://support.getgrist.com/functions/)
- [Grist REST API](https://support.getgrist.com/rest-api/)
- [Google Sheets function list](https://support.google.com/docs/table/25273/)
