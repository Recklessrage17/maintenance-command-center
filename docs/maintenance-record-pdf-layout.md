# Asset Maintenance Record PDF layout

The report continues to use `pdf-lib` and its built-in Helvetica fonts. The
renderer is now a data-only module, `backend/src/server/assetMaintenanceRecordPdf.ts`.
The existing `buildMachineAssetNotePdf` adapter in `backend/src/server/index.ts`
still reads authorized report data, appends deduplicated photographed work-order
PDFs in capture order, adds summary-page footers, and returns the bytes to the
existing storage/export path. No database schema, API, form, permission, backup,
or schedule behavior changed.

## Layout and text

- Metadata uses measured two-column rows with inline labels and values. The
  ordinary four-row panel is 72 points (one inch) high; meaningful location adds
  a row. Long values wrap and may increase its height or continue onto a new page.
- Created, Opened / Note Date, and Resolved By are absent from printed metadata.
  Resolution retains its timestamp and author. All stored values remain intact.
- Matching asset number/name values appear once. Empty or placeholder locations
  are omitted. The primary technician and total recorded labor appear in the
  panel; multiple technicians retain individual labor rows below it.
- Body text uses 10.5-point Helvetica on a 14-point baseline. Section separators
  and spacing are smaller, and empty comments occupy one line.
- US Letter pages retain 44-point side margins, generated timestamps, and page
  numbers. Continuation pages use a compact report/asset/title header. Measured
  space reservations keep section headings, attribution, and initial content
  together. Long paragraphs and daily entries can continue across pages.
- Balanced Markdown `**bold**`, `__bold__`, `*italic*`, `_italic_`,
  `***bold italic***`, and inline backticks render with matching font styles.
  Emphasis delimiters must be at word boundaries and snug against their text.
  Technical identifiers such as `BRG_6205_C3` and formulas such as `3*4*5`
  or `3 * 4 * 5` remain literal in issues, daily entries, and resolutions.
  Paragraph breaks and unmatched markers remain visible. Forms store plain
  text, so HTML is not interpreted.
- The old ASCII sanitizer reproducibly changed `650°F` to `650?F`, removed
  accents from names, and printed Markdown markers literally. The new renderer
  preserves WinAnsi characters such as degrees, accented Latin names, ±, µ,
  multiplication signs, typographic quotes, and bullets. Fonts do not contain
  every Unicode glyph: unsupported characters are explicitly represented as
  `[U+XXXX]`. An already stored literal `650?F` remains unchanged; the renderer
  cannot infer the intended missing character.
- Previously stored PDFs are not rewritten. New and regenerated records use
  this layout; existing download and regeneration behavior is preserved.

## Validation on October 23, 2026

Only synthetic data was used. The attachment contained the task text without
the original example PDF, so the comparison uses an equivalent Press 47 / End
Cap Leaks fixture, not a production record. Running the original generator from
`origin/main` commit `27a649df2c35448e4d561c110bffa14f9f533d81` on the same
fixture produced two pages with only the final resolution paragraph on page 2.
The updated generator produces one page. The first issue-text baseline moves
from 490 to 198 points below the page top, without reducing body font size.

| Synthetic fixture | Pages |
| --- | ---: |
| Press 47 / End Cap Leaks | 1 |
| Long resolution (15 complete stages) | 2 |
| Ten comments, including a single comment longer than one page | 4 |
| Three technicians with individual labor | 1 |
| Long asset name, title, serial and work-order identifier | 1 |
| Empty optional metadata | 1 |
| Unicode and formatted text | 1 |
| Section boundary and flowing resolution | 2 |

All 13 updated fixture pages and both baseline pages were rendered using the
available PyMuPDF/MuPDF renderer and visually reviewed. No clipping, overlap,
orphaned section headings, or footer collisions were found. Automated checks
also verify bounds, line separation, page numbering, complete long identifiers,
comment and resolution sentinels, font styles, and unchanged input objects.

Commands passed:

```powershell
npm run build --prefix backend
npm run build --prefix frontend
npm run test:playwright -- tests/asset-maintenance-record-pdf.spec.ts tests/issue-136-work-order-pdf-history.spec.ts --project=desktop-chromium --workers=1
git diff --check
```

The managed run passed all 17 tests. It includes the existing machine/equipment
API regression for migrations, individual labor, lifecycle history, captured
page order/dimensions and deduplication, supporting attachments, and printable
resolved records. Additional assertions check authentication, inline/download
disposition, PDF content type, and unchanged note content and stored dates.
The existing UI regression verifies PDF preview, download/print controls, and
resolved-history actions for both libraries.

The layout suite requires Python with PyMuPDF (`python -m pip install pymupdf`);
`PYTHON` may select a different executable. Tests write PDF/PNG/JSON artifacts
through `testInfo.outputPath()` and attachments. The API fixture now uses owned
managed runtime storage and stops/awaits its server before cleanup.

Evidence retained under `diagnostics/playwright/`:

- Final passing run: `run-1792777540528-98c43a19-3b80-4ab2-955c-9423f0c8a203`.
  Its `html/index.html` is the report; `test-results/` holds PDFs, page images,
  layout JSON and export logs; `comparison/` holds the two-page baseline.
- Initial run: `run-1792777286739-15db774f-db7c-427e-896b-168327662f5f`.
  Retained failure: text extraction interleaved two metadata columns; the
  identifier assertion was corrected to read the value's column by geometry.
- Second run: `run-1792777469878-7f01f489-e287-4f3d-bf02-21ccc5f6da96`.
  Retained failure: a newly added test assumed unrelated response headers that
  the existing PDF route does not set. It was corrected to assert the existing
  authentication, disposition and content-type contract.

Every owned runtime directory from these three runs was verified absent.
Each retained run contains `cleanup.json` with `runtimeRemoved: true`. No
interrupted run was retained by this task. Existing diagnostics and unrelated
temporary directories were not cleaned.

## Changed files and delivery

- `backend/src/server/assetMaintenanceRecordPdf.ts`: renderer and pagination.
- `backend/src/server/index.ts`: existing generator's adapter to the renderer.
- `tests/asset-maintenance-record-pdf.spec.ts`: synthetic layout and export tests.
- `tests/helpers/inspect-maintenance-pdf.py`: page rendering/text geometry helper.
- `tests/issue-129-asset-notes-api.mjs`: revised compact-layout assertions,
  export contract checks, and owned fixture cleanup.
- `docs/maintenance-record-pdf-layout.md`: behavior, limitations and validation.

Review sample: `output/pdf/Press_47_Asset_Maintenance_Record.pdf` (synthetic).
Branch: `fix/maintenance-record-pdf-layout`, created from `origin/main` after
verifying a clean tree. Changes are uncommitted for review. The backup-safety
branch remains at `156f78d81aa059f96b90aad7864f6fbc5db3025f`. No push, PR,
merge, Raspberry Pi access, deployment, or production-record access occurred.
