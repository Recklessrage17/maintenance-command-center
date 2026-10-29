# Patch 1 requisition implementation review

Implementation/testing: October 28, 2026. Final report: October 29, 2026.
Local engineering review; no release authorization.

Base: `c69f8cb6c63922c4f415eacf8ee28e7c056a0a1e`, including merged PR #205.
The existing detached task checkout is retained. No branch switch, commit,
push, merge, CI dispatch, updater execution or production access occurred.

## Application changes

| File | Change |
| --- | --- |
| `backend/src/server/index.ts` | Center the existing wrapped item-number cell in both workbook layouts; color only B34/C36 COMMENTS label `C00000`; persist native checkbox state in both OOXML control properties and legacy VML before conversion. Remove the superseded Excel-only control-coordinate heuristic and its unused arguments. |
| `frontend/src/modules/requisitions/RequisitionsPage.tsx` | Initialize a fresh staging review's P.O. Initiator from the authenticated `userFullName` prop. |
| `frontend/src/modules/inventory/InventoryPage.tsx` | Apply the same default to a fresh inventory requisition form. |

Both variants use the official workbook renderer. The unused PDF-coordinate
stamp helpers are not the active export route. The original item-number writer
applied the general top-aligned wrapping style. Changing only its horizontal
and vertical alignment preserves its existing text, wrap limit, font size,
row-height calculation and all adjacent columns.
The Over template's comment-body cell was already red and bold; that existing
body styling is preserved. Under's body remains black. Only the static label
receives the new dark red color in both formats.

The workbook templates contain six unchecked native controls. Previously only
the Excel COM path applied choices, using caption/position grouping; LibreOffice
received unchanged checkbox state. The new shared preparation uses the exact
verified template control/shape identities and rejects missing or changed shapes.
It writes selected `checked="Checked"` properties and VML Checked elements;
cleared controls omit those optional states, as an Excel-saved reference does.
Tax Exempt, Material Cert and FOB remain separate selections.

Controlled Excel probes found that explicitly writing `checked="Unchecked"`
caused these legacy workbooks to be rejected by this installed Excel version.
The final encoding uses omission for clear controls. Original template,
filled-without-states, properties-only, VML-only, and selected-only variants
were compared; original and selected-only exports succeeded. Probe evidence is
retained, and the temporary diagnostic probe source was removed.

The form default is set when a new review opens, after the application's
authenticated initialization. It does not run a recurring effect over saved
or edited values. Existing manual editing, validation, session ownership,
preview confirmation, identity audit and permissions remain unchanged. A missing
authoritative name stays blank and fails the existing required validation.

No schema migration, historical-record rewrite, saved-PDF rewrite, dependency
change, threshold change, template-binary modification or inventory lifecycle
change was introduced.

## Test changes

- `tests/requisition-staging-layout.spec.ts`: delayed session initialization,
  two creator names, missing name, authorized edits, tax selection and Back/Edit.
- `tests/issue-208-requisition-pdf.spec.mts`: real preview, official create,
  reopen, unrelated edit, download/reprint, totals, unauthenticated rejection;
  both formats, Yes/No, 1/3/13 items, wrapped descriptions and item numbers.
- `tests/helpers/inspect-requisition-pdf.py`: render every actual PDF page,
  inspect text/color/geometry and ink inside individual checkbox interiors.
- `tests/helpers/requisition-export-observer.mjs` and the opt-in hook in
  `tests/helpers/security-process.mjs`: retain synthetic filled workbooks and
  converter results; isolate a LibreOffice profile if fallback is available.
- `tests/issue-208-requisition-workflow.spec.mts`: real owner/manager sessions,
  mixed vendor/tier grouping, actual browser PDF iframe and download, print-button
  target, official persisted identities, cross-session rejection, token replay,
  reload, direct Inventory form defaults/edit preservation and logout. The
  embedded-frame print method is observed to avoid sending paper.
- `tests/issue-208-native-print-preview.spec.mts`: use a separately owned full,
  headed Chromium profile for actual native PDF rendering and `chrome://print/`,
  independently for both tiers and both tax choices. Capture color and grayscale
  previews. Never click Print or send a physical printer job. These screenshots
  stay private because the dialog can show local printer configuration.
- `tests/issue-208-api-regressions.spec.mts`: execute three existing API suites
  under the managed runner. Their fixture locations now use `fixtureDirectory`;
  process shutdown is awaited and escalated before owned cleanup.
- `tests/requisition-status-api.mjs`, `tests/inventory-obsolete-api.mjs`,
  `tests/dashboard-inventory-attention-api.mjs`: the preceding ownership/shutdown
  adaptation; existing functional assertions retained.

## Validation

Final verification: **79 distinct passing test cases, 2 pre-existing mobile duplicate skips** across the focused suites below. Counts exclude repeated passes and diagnostic probes. Earlier failures were retained and corrected; they are not waived.

Build: `npm run build` passed frontend TypeScript/Vite and backend TypeScript.
The separate browser regression command was:

```
npm run test:playwright -- tests/requisition-staging-layout.spec.ts tests/requisitions-lifecycle.spec.ts tests/dashboard-requisition-metrics.spec.ts tests/inventory-part-info-link.spec.ts tests/issue-106-inventory-obsolete.spec.ts tests/issue-109-inventory-live-refresh.spec.ts tests/user-security-permissions.spec.ts --workers=2
```

Result: **44 passed, 2 skipped**. The two pre-existing mobile duplicates are
`uses a 10-second cycle and exposes refreshing, updated, live, and stale states accessibly`
and `serializes refreshes, preserves Inventory context and active edits, and stops after navigation`.
Their desktop equivalents passed. No Patch 1 case is intentionally skipped.

Initial runs and failures remain retained for review. Besides checkbox encoding,
test setup corrections included the Over template's actual title (it does not
say "Over $100"), Excel's coalesced vertical borders, and waiting for real export
rather than assuming the browser iframe is ready in five seconds. Excel can
wrap one workbook line into several PDF spans; geometry assertions now group
the actual full identifier rather than assuming one span per supplied newline.
The original Over comment-body red was verified against its template instead
of incorrectly requiring a new black style.
The rendered-checkbox ink probe now follows the actual native-control image
scale on each page, avoiding border sampling after fit-to-page reduction.
The mobile Inventory flow expands the existing collapsed Inventory Controls
before using Preview; its initial harness omitted that interaction.

The long Windows worktree path initially contributed an export-path concern;
controlled probes established the checkbox-state encoding defect independently.
A temporary short drive alias to this exact checkout was used for PDF testing;
it does not relocate storage or bypass managed ownership checks.

## Preservation and cleanup

Private before/after SHA-256 inventories and the selective source snapshot are
under `diagnostics/patch1-20261028/`. The before inventory covers all 193
pre-existing modified/untracked Gate 2 files in the primary checkout, five
Patch 1 source/template baselines, and both archived patch identities.

Patch 2 snapshot: `ac69951278ef3078308aace01206a592d5d77fae`, tree
`dbd968215af245ede86f2f81f3ddb1b07b63bc62`.
Patch 3 snapshot: `37acbb76284bc1f5338a9b837e5f42884cfc0656`, tree
`735a75a6ed5da8c3a3d626895c851778938bb0ec`.
Both have the reviewed release base as their parent. Neither was restored or
modified. Gate 2 source/evidence and the approved login/Equipment designs are
outside this patch's implementation.

Failed early browser tests stopped their backends during an Excel export.
Four orphaned COM Excel processes were identified using the initial no-Excel
baseline, exact automation commands, recorded process creation identities and
the corresponding owned run. They were stopped and awaited before cleanup.
The ownership record remains private. Partial cleanup evidence was preserved
under a separate attempt directory before the explicit dry-run/apply retry;
diagnostics and recovery snapshots were not deleted.

The initial dependency-copy setup also encountered a circular local package.
That owned copy was stopped and removed before copying only actual installed
dependencies. Original dependencies, source and evidence were not modified.

## Remaining acceptance

Windows Excel exports, the full Chromium PDF viewer and actual Chromium native
print-preview rendering are locally verified. LibreOffice/native ARM64 rendering,
the combined three-patch candidate, production storage, the Windows system print
dialog, physical printer output and production acceptance remain separate checks.
No physical printer received a job. See the release-readiness plan.

Gate 1 remains PASS; Gate 2 remains NOT ACCEPTED, controller `accepted_hold`.
The existing release pin is unchanged. The feature issue stays open for
separately authorized integration/release acceptance.

## Final evidence index and commands

| Scope | Verified result | Retained managed run |
| --- | --- | --- |
| Requisition/staging, inventory UI, dashboard and security | 44 passed, 2 existing skips | [browser regression](../diagnostics/playwright/run-1793208771713-e10ff031-097b-40cf-aef0-9973ddd8fb36/html/index.html) |
| PR #205 maintenance-record PDFs and Machine/Equipment completion/history | 18 passed | [broader regression](../diagnostics/playwright/run-1793209809914-ca8133bc-af63-4c6c-aa5e-84627be5d3be/html/index.html) |
| Existing requisition and inventory APIs | 3 passed, 160 internal assertions | [final API run](../diagnostics/playwright/run-1793210218563-50fb2993-d516-4a77-bf37-874fdf5c95cb/html/index.html) |
| Both-tier PDF matrix, 1/3/13 items, preview/create/edit/reprint | 6 passed; 18 PDFs / 24 rendered pages | [final PDF matrix](../diagnostics/playwright/run-1793210410611-435dccff-d7ec-4054-a4df-5490ef3b49d9/html/index.html) |
| Real owner/manager workflow, desktop | 2 passed | [desktop workflow](../diagnostics/playwright/run-1793210329095-3256312b-583d-4d1c-9668-1894c01d2f55/html/index.html) |
| Same workflow and direct Inventory form, mobile | 2 passed | [corrected mobile run](../diagnostics/playwright/run-1793210634337-31bb7ff8-403d-4445-a7d3-4b8c16a8483e/html/index.html) |
| Full Chromium viewer + actual print preview, both tiers and both tax choices | 4 passed; color and grayscale captures | [native print run](../diagnostics/playwright/run-1793210900305-8ac34f67-0dc2-46d5-8ace-450cf06c2f23/html/index.html) |

The broader regression run also contained four new PDF-harness failures; the desktop workflow run contained two mobile-harness failures. Those failures are explicitly retained in their reports. All six final PDF scenarios and both corrected mobile scenarios passed in the dedicated final runs linked above. No application change was made to waive those assertions.

Additional exact commands:

```
npm run test:playwright -- tests/issue-208-api-regressions.spec.mts --project=desktop-chromium --workers=1
npm run test:playwright -- tests/issue-208-requisition-pdf.spec.mts --project=desktop-chromium --workers=1
npm run test:playwright -- tests/issue-208-requisition-workflow.spec.mts --workers=1
npm run test:playwright -- tests/issue-208-requisition-workflow.spec.mts --project=mobile-chromium --workers=1
npm run test:playwright -- tests/issue-208-native-print-preview.spec.mts --project=desktop-chromium --workers=1
```

The broader command was:

```
npm run test:playwright -- tests/issue-208-requisition-pdf.spec.mts tests/issue-208-api-regressions.spec.mts tests/issue-208-requisition-workflow.spec.mts tests/asset-maintenance-record-pdf.spec.ts tests/issue-136-work-order-pdf-history.spec.ts --project=desktop-chromium --workers=1
```

Every preview/saved/reprint page in the final PDF matrix was rendered. Automated assertions verify actual cell geometry, full item-number content, label color, preserved body color, exactly the selected Tax Exempt mark and the independent Material Cert choice. Representative single-, multi-item and both continuation-page outputs were visually inspected. The full Chromium PDF viewer and actual native print-preview screenshots were visually inspected for both YES/NO choices in both formats, including grayscale. The synthetic PR #205 maintenance-record output was also visually inspected. No physical print job was sent.

All **23 managed runs** have cleanup receipts; the runtime directory is empty. The final cleanup dry run reports no managed stale runs. No interrupted runtime is retained. All diagnostics, initial failure evidence and any recovery snapshots remain local. The temporary short drive alias is absent. The 193-file preservation inventory and both archived snapshot trees were rechecked on October 29 and remain unchanged.

### Complete run ledger

| Run | Passed | Failed | Skipped | Runtime removed |
| --- | ---: | ---: | ---: | --- |
| `run-1793208661167-4782f3fb-0045-4452-ac72-2a68d6c5144b` | 0 | 1 | 0 | Yes |
| `run-1793208752219-9692d154-7fae-4e03-b799-8fca76881420` | 0 | 1 | 0 | Yes |
| `run-1793208771713-e10ff031-097b-40cf-aef0-9973ddd8fb36` | 44 | 0 | 2 | Yes |
| `run-1793208861012-c48423a2-efa8-4458-b1e7-6e773164ac8e` | 0 | 1 | 0 | Yes |
| `run-1793209036209-d170d854-12d0-4570-82c6-027d6d5f0616` | 0 | 1 | 0 | Yes |
| `run-1793209081302-6c48cd20-82eb-4e8e-be4b-4918557b5550` | 1 | 0 | 0 | Yes |
| `run-1793209107150-0ae10a1f-41d1-47e6-b852-59862adc8a3d` | 1 | 0 | 0 | Yes |
| `run-1793209133857-e1ee22ca-7c45-4aa3-bc07-414ceaa0e479` | 1 | 0 | 0 | Yes |
| `run-1793209171595-28f4edf9-5ca7-4256-9b9b-eb731c5e858a` | 0 | 1 | 0 | Yes |
| `run-1793209207704-358677e1-843f-4158-a44e-1832e81916df` | 1 | 0 | 0 | Yes |
| `run-1793209249366-a53d2207-3597-4e80-8821-ad9ba52f7c52` | 2 | 2 | 0 | Yes |
| `run-1793209533172-6971c357-d63f-4357-9324-f99b32695ce2` | 22 | 5 | 0 | Yes |
| `run-1793209605015-e01e4f53-f532-4226-9e32-7a2b2c317ecb` | 0 | 4 | 0 | Yes |
| `run-1793209704557-11b8bb52-508d-4252-9aab-66ba4feaabcc` | 1 | 0 | 0 | Yes |
| `run-1793209809914-ca8133bc-af63-4c6c-aa5e-84627be5d3be` | 25 | 4 | 0 | Yes |
| `run-1793210117568-802bb097-60d6-48c6-aa2c-ba9caba3189c` | 5 | 1 | 0 | Yes |
| `run-1793210218563-50fb2993-d516-4a77-bf37-874fdf5c95cb` | 3 | 0 | 0 | Yes |
| `run-1793210329095-3256312b-583d-4d1c-9668-1894c01d2f55` | 2 | 2 | 0 | Yes |
| `run-1793210410611-435dccff-d7ec-4054-a4df-5490ef3b49d9` | 6 | 0 | 0 | Yes |
| `run-1793210634337-31bb7ff8-403d-4445-a7d3-4b8c16a8483e` | 2 | 0 | 0 | Yes |
| `run-1793210753557-024f710b-58c8-46e0-815b-8603981c5a62` | 2 | 0 | 0 | Yes |
| `run-1793210833053-2f393b39-f553-4efb-aab4-1248fa47404a` | 2 | 0 | 0 | Yes |
| `run-1793210900305-8ac34f67-0dc2-46d5-8ace-450cf06c2f23` | 4 | 0 | 0 | Yes |

## Published sanitized continuity records

- [Implementation report on #208](https://github.com/Recklessrage17/maintenance-command-center/issues/208#issuecomment-6494026888)
- [Integration/manual-release plan on #211](https://github.com/Recklessrage17/maintenance-command-center/issues/211#issuecomment-6494045484)
- [Milestone on #206](https://github.com/Recklessrage17/maintenance-command-center/issues/206#issuecomment-6494053298)

Selective local review artifacts: [source snapshot](../diagnostics/patch1-20261028/source-snapshot.zip), [before/after source manifest](../diagnostics/patch1-20261028/after.json), [tracked diff](../diagnostics/patch1-20261028/tracked.patch), [preservation verification](../diagnostics/patch1-20261028/preservation.json). They remain local and were not published with the issue comments.
