# Patch 1 - full requisition comments, local review checkpoint

October 29, 2026. Read current #208, #211 and #206 before implementation.
The black COMMENTS label / red entered-text owner correction remains intact.

## Implementation

The Under-$100 merged comment cell had the default 15-point row height, too
short for two 8.5-point text lines. The shared helper also inserted an ellipsis
after two lines; saved-PDF reads collapsed explicit newlines, and creation
silently sliced notes at 1,000 characters while edits already retained them.

Only `backend/src/server/index.ts` application source changes in this follow-up:

- Preserve entered newlines and all comment words, including unbroken tokens;
  wrap conservatively at 72 characters / 300 font-metric points without ellipses.
- Increase the merged comment row only when necessary. Under retains two form
  lines; Over uses three within its existing taller area. A continuation marker
  gets its own line. Following signature rows move with the worksheet grid.
- Overflow prints on numbered, requisition-linked comment-only appendix pages,
  35 lines per page, through the same Excel/LibreOffice workbook exporter.
  Appendices contain no order rows, totals or duplicate signature fields.
- Reuse existing item chunking, PDF merging and page footers. Pagination metadata
  stays outside employee comments; empty notes no longer gain synthetic restock
  text on multi-item-page output. Remove creation's silent 1,000-character slice;
  existing request limits and authorization remain unchanged.

Original workbook binaries, threshold selection, quantities/totals, vendor
grouping and signatures are preserved. All four completed fixes remain:
item-number centering, authenticated initiator defaults, Tax Exempt/native
checkbox persistence and BLACK COMMENTS / RED body. Under body stays C00000;
Over retains FF0000/bold. No schema, dependency, updater or backup changes.

## Exact changed source

| Path | SHA-256 |
| --- | --- |
| `backend/src/server/index.ts` | `a32b7b2a66548b5d4a74f74b6d210c03552db3ae452610c1c021c847c78c82bd` |
| `tests/issue-208-requisition-pdf.spec.mts` | `49b1f2e956bdf2d62bd74611735f50fd4a4b125e335292051ee99826ce37c328` |
| `tests/issue-208-native-print-preview.spec.mts` | `e816a814fa8ef82830dbdca45e0844c3a45de13b2d830821882dfc650ae1eba3` |
| `tests/issue-208-comment-overflow.spec.mts` (new) | `3da3b42cc17cd4af50f143e4f4a0ee9ecfedc5101eb7b7f2670b38f8f743cd9f` |
| `tests/issue-208-comment-staging.spec.mts` (new) | `728b0fcf07ef947aca63d91ebae1eaeaa0b78a0c0d03ef29666c19a860e6c03b` |

This report is the only new documentation path. Prior reports and archives are
preserved as historical evidence. Fresh selective Patch 1 inventory/archive and
working-source inventory are in
`diagnostics/patch1-layout-20261029/correction-identity.json` and
`patch1-source-inventory.json`; these do not approve combined release integration.
Reviewed base / unchanged HEAD remains
`c69f8cb6c63922c4f415eacf8ee28e7c056a0a1e`.

## Final focused coverage

Windows x64, Node 22.22.3, Chromium 149.0.7827.55, PyMuPDF 1.28.0;
actual application PDF exports use installed Windows Excel.

- Frontend TypeScript/Vite and backend TypeScript build PASS. Compared all
  62 files in the retained prior build bundle: only compiled server differs.
- 70 application/API/PDF/history cases PASS on desktop/mobile, zero skips.
  Includes requisition staging/lifecycle, real owner/manager flows, permissions,
  session/replay/logout, PR #205 and Machine/Equipment completion/history.
  Three API suites report 160 assertions each project (46 + 41 + 73).
- Final PDF coverage 16 passing cases: six original both-tier scenarios across
  preview/official create/edit/reprint, eight extended comment cases, two
  staging continuation cases. Blank, short, multiline/blank lines, longer prose,
  240-character wide token, Unicode and 39-line notes retain complete wording.
  Thirteen-item staging with >1,000-character notes produces two order pages
  plus two correctly linked comment pages, full persisted notes and totals.
- Eight native Chromium PDF/print cases PASS: both tiers x blank/short/multiline/
  long, tax YES/NO, color and genuinely regenerated grayscale. Custom page-range
  controls verify each continuation page. No physical print action was sent.

**94 distinct focused case/project IDs have passing final coverage; zero skips.**
All managed commands use zero retries. Reports are separate executions, not one
all-green monolithic run: final PDF execution had 14 passes / two fixture-startup
connection refusals; the dedicated staging rerun passed both without app changes.
All earlier exploratory failures remain retained. They include the discovered
creation cutoff, initial Unicode span-order reading, an unsupported Over template
label expectation, pre-refinement Over continuation counts and partial print
evidence. A first development run was interrupted and specifically cleaned.
An initial ExcelJS Letter enum typing build error was corrected; final builds pass.

32 final PDFs / 64 rendered pages are retained. An independent audit checked
all 413 red text spans: inside safe bounds and clear of black text/signatures/
totals/footer. Full wording is asserted independently. Printed comment sizes
range 6.84-8.52 points under existing template fit-to-page scaling; the requested
cell font remains 8.5 points. Both blank-form PDFs have exactly matching text,
fonts, colors and bounding boxes compared with the preserved color-corrected
revision. Actual PDF and native color/grayscale renders were visually reviewed.

## Evidence, preservation and boundary

Final reports:

- `diagnostics/playwright/run-1793275647223-7ec11bde-869b-455b-a196-8bf4ec90da02/html/index.html` (70 PASS).
- `diagnostics/playwright/run-1793275647247-6732728c-e947-4213-b035-64540a66b3ad/html/index.html` (14 PASS / two fixture-startup failures).
- `diagnostics/playwright/run-1793276014832-15e4a2be-276c-4fe6-ab36-ff1cdfcbfe81/html/index.html` (staging 2 PASS).
- `diagnostics/playwright/run-1793275647223-37e4c128-5eeb-40c3-ae07-35671cd59485/html/index.html` (native 8 PASS).

The private audit directory contains before-source ZIP, source review/diff,
full run ledger, PDF geometry/build comparison and preservation inventories.
All owned runtime is cleaned using managed finalizers or documented specific-run
dry-run/apply. Deferred cleanup preserved 92 partial diagnostic/recovery files
with hashes. No guards were bypassed or unrelated processes stopped.

Patches 2/3, PR #205, all 193 Gate 2 files, original worktree states and all
preexisting diagnostics are preserved and verified by `preservation-audit.json`.
No historical PDF or production record was rewritten. Native print/printer
captures, source archives and recovery evidence remain private.

The reported clipping/cutoff cases now have passing local evidence. Owner review
of the bounded row growth and continuation-page design is next. Stop before
replacement final release integration. Full combined regression/native Linux
ARM64/LibreOffice and separately authorized production preflight/backup/restore/
manual-release approval remain outstanding. Gate 2 NOT ACCEPTED; updater
`accepted_hold`. No commit, push, merge, Actions, updater execution, Pi access,
service restart, production database change or deployment occurred.
