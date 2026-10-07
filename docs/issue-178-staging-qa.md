# Issue 178 staging QA

Implemented on `issue-178-pm-no-work-order-exception`, verified October 6, 2026.

## Behavior

The completion form has a default-unchecked **Machine not scheduled / not running** checkbox beside the Work Order Number label. Checking it allows a blank number and no work-order PDF/photo. Both fields show that their requirements are waived. Unchecking restores normal validation without discarding entered values or selected attachments. A stale missing-PDF message clears when the exception is checked; invalid optional uploads still receive normal validation.

The server accepts the exception only as JSON `true` or multipart string `true`. Missing/false values retain normal validation; arbitrary strings, numbers, objects, arrays, and null cannot bypass it. Completion date, meter/cycle rules, notes, follow-up, technicians, attachments, authorization, and immutable history behavior retain their existing paths. The pre-existing `N/A` validation path remains compatible; selecting the new exception never requires entering `N/A`.

The immutable completion and completion audit payload persist the exception. Task history, all asset PM history, general History Logs, the history PDF export, and the PM workbook display the recorded reason. An optional entered WO number remains stored and appears alongside the reason in PM history/workbook output.

## Additive migration

The existing startup migration in `backend/src/server/index.ts` adds:

```sql
ALTER TABLE pm_history ADD COLUMN machine_not_scheduled_or_running
  INTEGER NOT NULL DEFAULT 0 CHECK(machine_not_scheduled_or_running IN (0,1));
```

New databases include the same column in the table definition. Existing rows default to false, including legacy blank or `N/A` work orders. Existing rows are not reinterpreted or rewritten. Repeated startup is idempotent. There is no separate migration file, table rebuild, version bump, or deployment.

## Changed files

| File | Change |
| --- | --- |
| `backend/src/server/index.ts` | Additive schema migration, persisted flag, completion validation/insert, history/audit serialization, PDF and workbook displays |
| `backend/src/server/pmWorkOrders.ts` | Strict explicit exception validation and optional blank WO validation |
| `frontend/src/modules/preventive-maintenance/PmWorkflowModals.tsx` | Checkbox, requirement notices, conditional validation, submitted flag |
| `frontend/src/modules/preventive-maintenance/WorkOrderPdfField.tsx` | Attachment waiver, optional label, stale required-error clearing |
| `frontend/src/modules/preventive-maintenance/pmWorkOrderException.ts` | Shared history display wording |
| `frontend/src/modules/preventive-maintenance/PmAssetControls.tsx` | Asset PM history exception display |
| `frontend/src/modules/machine-library/PreventiveMaintenanceTracking.tsx` | History normalization and shared machine/equipment task history display |
| `frontend/src/modules/history/HistoryPage.tsx` | General audit history exception display |
| `frontend/src/styles/glass-system.css` | Wrapping label row, 44px touch target, keyboard focus indicator |
| `tests/issue-178-pm-exception-api.mjs` | API, forged requests, immutable persistence, audit/workbook output, restart and equipment cycle coverage |
| `tests/pm-excel-migration.mjs` | False legacy defaults, constraint enforcement, repeated-startup compatibility |
| `tests/pm-excel-ui.spec.ts` | Machine/equipment task and asset history, legacy records, general audit display |
| `tests/pm-work-order-photo-pdf.spec.ts` | Requirements restored on uncheck, keyboard/touch, blank/optional WO, other validation, responsive checks and screenshots |
| `docs/issue-178-staging-qa.md` | This implementation and QA handoff |

## Verification results

| Command | Result |
| --- | --- |
| `npm run build` | Passed frontend TypeScript/Vite and backend TypeScript builds |
| `node tests/issue-178-pm-exception-api.mjs` | Passed, including history PDF generation and optional attachment validation |
| `node tests/pm-excel-migration.mjs` | Passed; one initial startup timeout during concurrent tests passed on rerun |
| `node tests/pm-work-order-attachments.mjs` | Passed existing validation, N/A, atomic storage, idempotency, PDF permissions, workbook/ZIP and backup/restore coverage |
| `node tests/pm-workflow-upgrade.mjs` | Passed machine/equipment meters, multi-technician history, legacy compatibility, schedule deletion retention and permissions |
| `git diff --check` | Passed |

Broad browser regression command:

```powershell
npx playwright test tests/pm-work-order-photo-pdf.spec.ts tests/pm-excel-ui.spec.ts tests/dashboard-pm-alerts.spec.ts --workers=2
```

Initial broad run: 85 passed, 1 intentional mobile skip for a desktop wheel-continuity test, and 2 history-label casing failures. The original label casing was restored. New history fixtures/permissions and a screenshot-related keyboard-focus assumption were also corrected while developing the added tests.

Final browser command against the rebuilt app:

```powershell
npx playwright test tests/pm-work-order-photo-pdf.spec.ts tests/pm-excel-ui.spec.ts --grep 'issue 178|plain HTTP|captures oriented|keeps Choose PDF|keeps photo actions' --workers=2
```

**20 passed** in desktop and mobile Chromium, including every previously failing scenario. Across the broad regression and final focused run, 93 distinct browser cases passed and one existing desktop-only test was intentionally skipped in the mobile project. Screenshots of the checked exception were generated in Playwright's ignored `test-results` directory and visually inspected. Responsive checks cover 320px phones, phone portrait/landscape, tablets, and desktop.

## Staging checks

1. With the box unchecked, attempt blank WO and then a real WO without PDF/photo: both must be rejected. Complete with a real WO and valid PDF/photo.
2. Check the box, leave WO blank, attach nothing, and complete. Confirm the reason, actor, date, reading, notes, follow-up, and timestamp in task history, All PM History, and History Logs.
3. Toggle the box back off: the WO and matching PDF/photo requirements must return. Verify keyboard Space and touch activation and check phone portrait/landscape layout.
4. Open pre-existing completions, including legacy N/A records, and confirm unchanged meaning and readable attachments. Restart staging and verify that the new exception remains recorded.

Changes are local and uncommitted. No merge, version bump, tag, push, or deployment was performed.

## UI refinement — October 7, 2026

The Complete PM form now uses compact glass pill actions with at least 44px touch targets, a native round checkbox with checked/hover/focus-visible states, and an integrated Calendar pill. Completion details, work-order evidence, and outcome/notes are grouped with quieter help text and tighter spacing. Date-only tasks use a content-sized completion-details group. Fields and actions wrap without horizontal overflow on phones, tablets, and desktop.

The existing Issue 178 submission and validation paths are unchanged. This refinement adds no backend or schema changes and does not alter stored records. The original additive exception migration described above remains in place. Calendar Escape handling now closes the owned calendar before the surrounding modal can dismiss the PM form, preserving the selected date and returning focus to the opener.

Files changed by this refinement:

| File | Change |
| --- | --- |
| `frontend/src/components/MccDateInput.tsx` | Optional visible trigger text and calendar Escape ownership |
| `frontend/src/main.tsx` | Load completion-specific styling |
| `frontend/src/modules/preventive-maintenance/PmWorkflowModals.tsx` | Grouped completion form, integrated date trigger, quieter requirement messages |
| `frontend/src/styles/pm-complete.css` | Scoped glass layout, content-sized pills, round native checkbox, touch/focus and responsive styling |
| `tests/pm-work-order-photo-pdf.spec.ts` | Checkbox states, keyboard focus/Space, compact action sizing, date interaction/submission and expanded responsive coverage |
| `tests/pm-excel-ui.spec.ts` | Round existing PM-card action heights to hundredths of a pixel to avoid a floating-point geometry false failure |
| `docs/issue-178-staging-qa.md` | Refinement results and staging recheck guidance |

Refinement verification:

- `npm run build`: frontend and backend builds passed.
- `node tests/issue-178-pm-exception-api.mjs`, `node tests/pm-workflow-upgrade.mjs`, and `node tests/pm-work-order-attachments.mjs`: passed.
- The browser command below completed with **100 passed, 1 intentional mobile skip, and 1 subpixel geometry assertion failure**. All Issue 178, date accessibility, work-order attachment/photo, history/audit, and modal tests passed. The remaining failure was an existing equipment PM-card target measured at `39.99993896484375px` instead of exactly `40px`; its geometry assertion now rounds to hundredths of a pixel.

```powershell
npx playwright test tests/pm-work-order-photo-pdf.spec.ts tests/pm-excel-ui.spec.ts tests/dashboard-pm-alerts.spec.ts tests/date-input-accessibility.spec.ts --workers=2
```

After the geometry assertion correction:

```powershell
npx playwright test tests/pm-excel-ui.spec.ts --grep 'presents compact.*PM cards' --workers=2
```

**4 passed** on desktop and mobile, including the previously failing equipment case. Across these final runs, **101 distinct browser cases passed and 1 existing desktop-only scrolling case was intentionally skipped on mobile**. `git diff --check` passed. All changes remain local and uncommitted; no merge, version bump, tag, push, or deployment was performed.

The 26 focused Issue 178, attachment/photo, and plain-HTTP PM workflow cases are included in that broad run. Responsive checks cover 320×740, 390×844, 640×960, 768×1024, 844×390, 1024×768, and 1440×900, with no horizontal overflow. Checked exception screenshots were visually inspected on desktop and the narrowest phone layout. There is no new migration to test for this UI refinement.

Staging recheck: verify the round exception checkbox using Tab/Space and touch; toggle it off again to restore both required fields. Open the Calendar control, navigate/select with the keyboard, and press Escape to close only the calendar. Confirm content-sized Close, Add Tech, Choose PDF, Take Photo, Cancel, and Confirm Completion controls remain easy to tap. Check grouped fields, attachment previews, conditional follow-up/meter overrides, and scrolling at 320px phone, tablet, and desktop widths. Complete normal and exception PMs and recheck the existing history/audit wording and attachments.

## Final calendar-trigger polish — October 7, 2026

The visible Calendar text is replaced by a 44×44 icon-only glass trigger. The mini calendar has binding tabs, a header, subtle grid lines, and the selected Completion Date's day number. Both the day number and the accessible name/title update from the existing parsed date value. For example, `10/07/2026` displays `7` with `Open Completion Date calendar — selected October 7, 2026`. Empty or invalid values display a dash and an appropriate accessible description; the icon never falls back to today's day.

This pass changes only `frontend/src/components/MccDateInput.tsx`, `frontend/src/modules/preventive-maintenance/PmWorkflowModals.tsx`, `frontend/src/styles/pm-complete.css`, `tests/pm-work-order-photo-pdf.spec.ts`, and this report. The selected-day presentation is enabled only for Complete PM. Other date controls retain their existing presentation and names. Calendar keyboard, focus return, Escape handling, parsing/validation, PM submission, exception persistence, backend rules, immutable history, and attachments keep their existing paths. No backend/schema changes or record alterations were added.

Staging recheck: set Completion Date to `10/07/2026` and confirm `7` inside the icon. Type another date and choose a date in the calendar; verify both the icon and tooltip update. Confirm two-digit days are readable, Tab/Space/Arrow keys work, and Escape closes only the calendar. Check the centered icon and open calendar on phone, tablet, and desktop widths; complete a PM and verify the selected date in its immutable history.

Final polish verification:

- `npm run build`: frontend and backend builds passed.
- The focused command below: **30 passed** in desktop and mobile Chromium. Coverage includes dynamic one-/two-digit days, typed US/ISO/digit-only dates, leap-day parsing, empty/invalid-date presentation, required-date validation, keyboard/focus/Space/Escape, touch opening, selected date submission, exception rules, history/audit, shared date accessibility, and attachment/photo regressions.
- Responsive trigger alignment and open-calendar overflow checks passed at 320×740, 390×844, 640×960, 768×1024, 844×390, 1024×768, and 1440×900. Desktop/mobile screenshots of the selected-day icon were visually inspected.
- `git diff --check`: passed.

```powershell
npx playwright test tests/pm-work-order-photo-pdf.spec.ts tests/pm-excel-ui.spec.ts tests/date-input-accessibility.spec.ts --grep 'issue 178|plain HTTP|captures oriented|keeps Choose PDF|keeps photo actions|date calendar remains' --workers=2
```

Stopped for staging recheck with local uncommitted changes. No commit, merge, version bump, tag, push, or deployment was performed.
