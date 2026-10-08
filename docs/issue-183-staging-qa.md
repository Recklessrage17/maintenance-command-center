# Issue #183 rebuild — staging QA

Date: 2026-10-08. Rebuilt from the current [issue body](https://github.com/Recklessrage17/maintenance-command-center/issues/183) and its [latest UI correction](https://github.com/Recklessrage17/maintenance-command-center/issues/183#issuecomment-6042589028).

Workspace: `C:\Users\maste\.codex\worktrees\b07b\MCC_V1_FINAL`.
Branch: `issue-183-calendar-work-orders-notes-ui`.
Base / unchanged HEAD: `3be6404e95194d35dc9aa0bc63826f1e19742413`.

## Implementation

- Promoted the approved #178 mini-calendar trigger to the shared `MccDateInput` default. Binding bars, header, grid and selected day now appear on note dates, work-log dates, PM dates, component-installation dates, measurement dates and requisition dates using that component.
- The displayed day and trigger's accessible name/title follow the selected value. Empty or invalid values show a dash, never a fallback to today's day. Editable field names stay stable as the selected day changes. Existing parsing, validation, required/disabled semantics, calendar ownership, keyboard navigation and Escape/focus-return handling remain intact. Existing native date inputs remain native.
- Consolidated calendar styling in one shared stylesheet; removed superseded plain triggers, the work-log masked icon and duplicate PM icon styling. Triggers have 44×44px targets, visible keyboard focus and reduced-motion support.
- Applied content-sized pills and wrapping action groups to the shared notes workflow and its history, attachment viewer, photo preview and export dialogs. Retained primary/secondary and destructive styling. Shortened the initial, vertically resizable note body editor and tightened spacing.
- **Needs Attention and Put on Hold remain present.** Their handlers and lifecycle rules are unchanged, including the locked Needs Attention state when editing an existing warning issue.
- **Only the teal NEW RECORD / EDITING capsule was removed.** Create maintenance record / Update maintenance record headings remain. No replacement badge or toggle was added.
- Both libraries continue using the shared inline editor. No #185 modal work was brought into this branch; its separate worktree was not accessed.
- **No backend, schema, permission or version changes were made.** No commit, push, merge, tag or deployment occurred.

## Exact changed-file list

1. `frontend/src/components/MccDateInput.tsx`
2. `frontend/src/main.tsx`
3. `frontend/src/modules/machine-library/AssetNoteWorkOrderPhoto.tsx`
4. `frontend/src/modules/machine-library/AssetNotesAttachments.tsx`
5. `frontend/src/styles/app.css`
6. `frontend/src/styles/mcc-date-input.css` — new
7. `frontend/src/styles/pm-complete.css`
8. `frontend/src/styles/work-orders-notes.css` — new
9. `tests/date-input-accessibility.spec.ts`
10. `tests/issue-129-asset-notes-ui.spec.ts`
11. `tests/issue-183-calendar-work-orders-notes.spec.ts` — new
12. `tests/warning-issue-lifecycle.spec.ts`
13. `docs/issue-183-staging-qa.md` — new

## Automated validation

Prerequisites: `npm ci`, `npm ci --prefix frontend`, `npm ci --prefix backend`.
All commands ran in the workspace above. Playwright used isolated local previews of the production build, with separate output directories and ports, across desktop Chromium and mobile Chromium projects. These are local automated results, not a deployed staging sign-off.

| Validation | Pass | Skip | Fail |
| --- | ---: | ---: | ---: |
| `npm run build` (frontend + backend) | 1 | 0 | 0 |
| Focused #183 Playwright | 8 | 0 | 0 |
| Broad date/notes/lifecycle/attachments/export/#176/#178/#181 run, before updating two obsolete size assertions | 166 | 2 | 2 |
| Corrected guard-case rerun (both libraries, both projects) | 4 | 0 | 0 |
| #178 task/asset/audit history Playwright | 6 | 0 | 0 |
| API / export regression scripts | 5 | 0 | 0 |
| `git diff --check` | 1 | 0 | 0 |

**Final unique Playwright coverage: 182 pass / 2 skip / 0 unresolved failures across 184 cases.** This includes 8 focused #183 cases, 168 passing cases from the broad regression selection after substituting the successful targeted rerun, and 6 PM history cases. The targeted rerun repeats the two mobile cases that already passed; those duplicates are not added to unique totals. Raw completed final-build attempts total 184 passes / 2 skips / 2 superseded failures across 188 executions. The broad command originally exited 1 because of the obsolete button-height assertions; the corrected targeted command exited 0. The two skips are existing mobile-project skips for the desktop-only ZIP fallback and export-cancel simulations in `issue-128-asset-notes-work-orders.spec.ts`; their desktop cases passed.

Build result: frontend TypeScript/Vite production build and backend TypeScript build passed at version 1.5.18. Whitespace check passed with exit 0. Logs are retained in `tmp/issue-183-final-focused.log`, `tmp/issue-183-final-regressions.log`, `tmp/issue-183-pm-history.log` and `tmp/issue-183-guard-regression.log`.

Final Playwright commands:

```powershell
$env:MCC_PLAYWRIGHT_PORT='4293'
npx playwright test tests/issue-183-calendar-work-orders-notes.spec.ts --workers=2 --output=tmp/issue-183-final-focused

$env:MCC_PLAYWRIGHT_PORT='4294'
npx playwright test tests/date-input-accessibility.spec.ts tests/issue-129-asset-notes-ui.spec.ts tests/warning-issue-lifecycle.spec.ts tests/issue-128-asset-notes-work-orders.spec.ts tests/issue-136-work-order-pdf-history.spec.ts tests/issue-176-compact-detail-cards.spec.ts tests/issue-181-work-orders-notes-summary.spec.ts tests/pm-work-order-photo-pdf.spec.ts --workers=2 --output=tmp/issue-183-final-regressions

$env:MCC_PLAYWRIGHT_PORT='4295'
npx playwright test tests/pm-excel-ui.spec.ts --grep 'issue 178' --workers=1 --output=tmp/issue-183-pm-history

$env:MCC_PLAYWRIGHT_PORT='4293'
npx playwright test tests/warning-issue-lifecycle.spec.ts --grep 'edits an existing update and protects unsaved accordion work' --workers=2 --output=tmp/issue-183-guard-regression
```

Additional checks:

```text
npm run build
node tests/issue-129-asset-notes-api.mjs
node tests/warning-issue-lifecycle-api.mjs
node tests/issue-178-pm-exception-api.mjs
node tests/work-order-records-export.mjs
node tests/issue-128-work-order-records-api.mjs
git diff --check
```

The API scripts each report one completed regression harness rather than individual assertion totals. All five passed: note migration/labor/history/PDF/photo attachments; technician and lifecycle permission matrices, correction windows, attachments and resolve/reopen; PM completion exceptions; archive hierarchy/hash/fallback handling; work-order permissions/export/restore.

Focused #183 checks cover both libraries: typed and picked date changes, selected-day text and accessible description, invalid/empty dates, Enter/Space/ArrowDown activation, roving day selection, focus-visible, Escape/focus return, reduced motion, content-sized 44px pills, preserved toggles and create/edit headings without the capsule.

The relevant existing regressions cover compact detail cards and switching/unsaved-edit guards (#176), PM calendar/exception/normal completion/photo behavior (#178), unresolved/resolved count semantics (#181), note creation/editing and hold persistence, labor, deep links, warning resolve/reopen/history, attachment staging/preview/download/delete permissions, multi-page photo PDFs and incremental/download exports.

## Responsive verification

Both Machine Library and Equipment Library were checked at **1440, 820, 390 and 320px widths** with a 900px test height. The focused tests verify editor/document horizontal overflow ≤1px, content-sized actions, touch targets and calendar bounds within the viewport. Existing regressions also exercise tablet/phone portrait and landscape, including 844×390px, and summary/count layouts at all four widths. Editor screenshots are in `tmp/issue-183-final-focused/`; regression screenshots/traces are in `tmp/issue-183-final-regressions/`.

## Validation repairs

The first focused attempt had 4 passes / 4 failures caused by the editable date's label association after adding a visible day. The next attempt had 7 passes / 1 failure from pressing Enter before roving focus settled. A combined intermediate focused/history attempt had 13 passes / 1 failure when a mobile overflow menu opened from the viewport edge. The original broad regression run was interrupted after identifying the same date-label association problem; it is not counted as final validation.

The editable field now has an explicit stable accessible name. Keyboard tests wait for the next focused day before selecting it, and the focused edit test centers its actual overflow trigger before opening the menu, matching the existing regression practice. The final builds and commands above validate the corrected implementation. Superseded logs are retained under ignored `tmp/` paths.

The broad run also exposed two desktop guard assertions that still capped Update Entry at 34px. These were updated to require 44–48px, matching this issue's touch-target standard without weakening the content-width, overflow or unsaved-work checks. The targeted rerun passed all four machine/equipment desktop/mobile cases (4 pass / 0 skip / 0 fail), including the guard behavior that followed the size assertion. No production code changed for this test expectation repair.

## Human staging/browser QA still required

- Review the visual finish on the actual staging build in both libraries, including a real narrow mobile device and browser zoom.
- Check Safari/iOS and other supported browsers, screen-reader announcements and native input/device interactions; automated browser coverage here is Chromium.
- Exercise real camera capture, multi-page work-order photos, local attachment uploads/downloads/printing and a real selected export folder with staging data. Automated tests simulate camera/file pickers and use isolated fixtures/API storage.

No staging deployment was performed, as requested.
