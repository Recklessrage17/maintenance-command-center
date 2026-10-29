# Patch 1 — final COMMENTS color correction

October 29, 2026. Local implementation and focused Windows validation.
Authoritative request: [owner correction in #208](https://github.com/Recklessrage17/maintenance-command-center/issues/208#issuecomment-6494846131).

## Result and scope

Both Under-$100 and Over-$100 PDFs now use a BLACK `COMMENTS:` label.
Under-$100 actual entered text uses dark red `C00000`; Over-$100 retains its
existing red `FF0000` and bold styling. Blank notes leave the black label alone.

The only application delta from the preserved Patch 1 is two cell-color rules
in `backend/src/server/index.ts`: label cells B34/C36 become `000000`; Under's
mapped body cell C34 becomes `C00000`. Over's mapped body D36 is unchanged.
All other server bytes, including line endings, remain identical after reversing
that exact block. No text, formatting algorithm, positioning, wrapping, font-size,
row-height, schema, historical-record or PDF rewrite was introduced.

The item-number alignment, initiator defaults and OOXML/VML Tax Exempt choices
remain intact. Patches 2/3 and PR #205 source are unchanged. No dependency,
updater, backup or deployment code changed. The existing detached HEAD remains
`c69f8cb6c63922c4f415eacf8ee28e7c056a0a1e`; nothing was staged or committed.

## Changed files and SHA-256

| File | Current SHA-256 |
| --- | --- |
| `backend/src/server/index.ts` | `55bc933cdfe41b5411ed6365930b3325af7d799362d4007031c2c1dcddef39cb` |
| `tests/issue-208-requisition-pdf.spec.mts` | `5c90579db2be91751ab871c9910b38fd60aea6b8271a76b87217ce01192001c9` |
| `tests/issue-208-native-print-preview.spec.mts` | `7c08e0d542fdf38a23faa4ae5fed84609a8662f5861cfbf0a3d9bdb3e1a2ccfd` |

This document is the only additional source/document path. Complete corrected
Patch 1 bytes/hashes and standalone tree identity are recorded in the private
[correction identity](../diagnostics/patch1-colors-20261029/correction-identity.json)
and [source inventory](../diagnostics/patch1-colors-20261029/patch1-source-inventory.json).
The original 16-file Patch 1 inventory is retained, with this report added as
path 17. Older patch/integration reports and archives remain historical evidence;
their earlier red-label claims are superseded by this correction.

## Focused validation

Windows x64, Node 22.22.3, Chromium 149.0.7827.55 and PyMuPDF 1.28.0.
Actual workbook-to-PDF conversion used installed Windows Excel. Linux ARM64 /
LibreOffice has not been executed. All browser tests used the managed npm runner,
isolated synthetic data/ports and zero retries.

- `npm run build`: frontend TypeScript/Vite and backend TypeScript PASS.
  All 53 frontend/backend build files were compared with the preserved build;
  only the compiled server changed, by the same two color rules.
- Staging/initiator, requisition lifecycle, PR #205 generator and Machine/Equipment
  completion/history regressions: **60 passed**, desktop/mobile, zero skips.
- Existing requisition/inventory API suites: **3 passed**, 160 internal assertions.
- Real owner/manager desktop requisition workflows: **2 passed**, including
  authoritative initiator, grouping, preview/download/print targeting,
  official persistence, session rejection/replay rejection and logout.
- Final both-tier PDF matrix: **6 passed**, 18 PDFs / 24 rendered pages,
  preview -> official create -> unrelated edit -> saved/reprint. Cases cover
  empty notes, fitting multiline input, short paginated comments, 1/3/13 items,
  full comment wording, black labels, red body spans, black adjacent/signature
  text, item geometry, Tax Exempt YES/NO and independent Material Cert choices.
- Actual headed Chromium viewer and native print previews: **4 passed**,
  both tiers x YES/NO; blank/nonempty multiline input, color and regenerated
  grayscale. All eight final print captures were visually inspected.
  No Print action or physical paper job was sent.

**75 distinct focused case/project IDs have passing final coverage; zero skips.**
Earlier exploratory failures and their exact source/diagnostics are retained.
A full integrated suite was not rerun for this color-only follow-up.

## Wording, geometry and preserved layout

Actual before/after PDFs with identical blank and entered-comment inputs were
compared for both formats. Full text and every text span's font/bounding box
match exactly. Only the label color changes in both tiers, plus Under's actual
comment color. Existing Over body red/bold styling stays unchanged.
The [geometry comparison](../diagnostics/patch1-colors-20261029/geometry-comparison.json)
records all four comparisons. The original workbook binaries are unchanged.

## Exploratory failures and observed limitation

The first expanded matrix included a longer Under-$100 note that needed a
second printed line. That line was clipped by the current comment-cell layout.
The source string remains intact in the workbook, but complete long-comment
PDF output is not established. The failure PDF and initial fixture are retained.
A workbook audit shows identical alignment, row layout and font properties
apart from color compared with the earlier rendition. This narrow change
preserves those properties; it does not fix the clipping. **Long Under-$100
comment acceptance remains open for separate layout review.**

The accepted color matrix retains fitting multiline input for both formats;
Over's native print audit also verifies a longer two-line rendered comment.
No failing long-comment assertion was represented as fixed. Two paginated
color assertions initially included a black page footer in the comment span
selection. The test now identifies actual employee-comment spans while keeping
full-wording and exact-color assertions; final matrix 6/6 passed.

## Diagnostics and cleanup

Four managed runs, including both earlier failing reports, remain private:

| Run | Result | Scope |
| --- | --- | --- |
| [run-1793272903748-bab98be3-9f60-439b-b378-f52fb749c140](../diagnostics/playwright/run-1793272903748-bab98be3-9f60-439b-b378-f52fb749c140/html/index.html) | 60 pass | Focused regressions |
| [run-1793272914196-d5475f19-5ae9-4c15-beb2-9e45d701fe0d](../diagnostics/playwright/run-1793272914196-d5475f19-5ae9-4c15-beb2-9e45d701fe0d/html/index.html) | 8 pass / 3 fail | 3 API + 2 workflow passes; long-note and initial span matcher failures |
| [run-1793273311435-b6f81a74-7bef-43ca-9dca-c7bfd73a6f3b](../diagnostics/playwright/run-1793273311435-b6f81a74-7bef-43ca-9dca-c7bfd73a6f3b/html/index.html) | 8 pass / 2 fail | 4 native print passes; fitting-note PDF passes; footer-selector failures |
| [run-1793273623410-7ab765ea-eedf-4768-870f-66e7b1d4c4b8](../diagnostics/playwright/run-1793273623410-7ab765ea-eedf-4768-870f-66e7b1d4c4b8/html/index.html) | 6 pass | Final corrected matrix |

All four runs have cleanup receipts. No owned runtime or interrupted run remains.
The last finalizer conservatively deferred after a Windows process-liveness
recheck. A specific dry run later became eligible; 84 partial diagnostic/recovery
files were retained and hash-verified in `cleanup-attempt-1`, then the documented
specific-run apply completed. No process registry edit, guard bypass, unrelated
process stop or stale sweep occurred. No Excel automation process remains.

Before/after checks preserve 193 Gate 2 files, all unrelated inherited source,
original worktree statuses, Patch 2/3 snapshot trees, protected PR #205 source,
and 2,343 preexisting diagnostic files (423,114,844 bytes). No historical
report/archive/evidence was overwritten. Native print captures stay private.

## Release readiness

The revised black-label/red-body color correction is implemented and locally
validated for the tested cases. This supplies a new Patch 1 source identity;
it does not approve a combined release or restore the superseded integration
candidate. Reconcile/re-review the replacement combined candidate, run the
complete relevant suite and native ARM64/LibreOffice stack, and review the
observed long-comment limit before claiming full release readiness.

Production remains HOLD: trusted read-only preflight, authoritative persistent
storage, consistent DB/files backup, independent off-device copy, isolated
verified restore, maintenance/session handling and bounded manual go/no-go
remain required. Gate 1 PASS; Gate 2 NOT ACCEPTED; updater `accepted_hold`.
No commit/push/merge, Actions execution, updater execution, Pi access, service
restart, production DB change or deployment occurred.
