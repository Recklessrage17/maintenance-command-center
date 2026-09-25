# Issue #146: Asset Notes Hold state

Branch: `issue-146-asset-notes-hold-state`. Target release: v1.5.15.
Baseline: latest fetched main `52f025a`, plus its existing v1.5.14 release commit `cd77be2` (version files only). The implementation keeps v1.5.14 unchanged.

## Behavior and compatibility

- Both libraries use the shared Asset Notes editor, lifecycle history, PDF generator, and Dashboard attention viewer.
- `hold` is separate from the existing `active` / `resolved` lifecycle. Only unresolved Needs Attention notes generate alerts. Tech Open excludes held notes; Hold includes only held notes.
- New notes default to Hold off. Needs Attention off clears/disables Hold. Existing warning notes keep their lifecycle lock: use Resolve, rather than clearing Needs Attention.
- Resolve retains Hold but removes the note from both alerts. Reopen restores the persisted Hold choice. Omitted `hold` on legacy edit requests preserves the existing choice.
- Creator / manager / admin edit and transition rules are unchanged. Hold edits append `hold_enabled` / `hold_disabled` lifecycle events, with actor, timestamp, and old/new values. Creation history includes the initial Hold value.
- Note and Work Order History filters provide Tech Open, On Hold, and All. Resolved history remains separate.
- `GET .../warning-issues?status=active` now means Tech Open; `status=hold` means unresolved held issues. `status=all` includes both and resolved issues. API lifecycle `status` remains compatible; consumers use `hold` to distinguish unresolved states.
- Work Order Records JSON includes `hold` and `statusLabel`; generated PDFs print On Hold for unresolved held issues and Resolved after resolution. Attachments, updates, labor and work-order references remain intact.

## Schema

Startup's existing idempotent lifecycle migration adds `is_on_hold INTEGER NOT NULL DEFAULT 0` to `machine_asset_notes` and `equipment_asset_notes`. Existing rows default to zero. No tables are replaced. Master backup/restore retains the new column.

## Human staging QA

PASS / APPROVED by human staging QA after the Dashboard and Asset Notes polish follow-ups.

1. In both libraries, create an issue on Hold, edit Hold off/on, and verify user-visible history and permissions using real technician and manager accounts.
2. With both open and held issues on one asset, verify the combined `WO ( Open X / Hold Y )` badge on desktop, tablet, and phone. Each count retains its filtered viewer and deep link. Check yellow/amber contrast and keyboard focus in the deployed theme.
3. Follow each Dashboard pill through its filtered list into the exact asset/note. Confirm notes open automatically, the correct issue expands/focuses, and its temporary highlight expires; repeat with reduced motion.
4. Resolve and reopen a held issue. Verify both active counts exclude resolved records and reopen returns the issue to Hold.
5. Review a generated PDF and yearly Work Order Records export with realistic long notes, attachments, photos and multiple technicians. Verify staging backup/restore preserves Hold.

Do not close #146 until staging QA, merge, v1.5.15 production deployment, and live verification are complete. This implementation does not deploy or change production.

## Automated validation

- `npm run build`: PASS (frontend TypeScript/Vite and backend TypeScript), application version unchanged at 1.5.14.
- `git diff --check`: PASS.
- `node tests/warning-issue-lifecycle-api.mjs`: PASS.
- `node tests/work-order-records-export.mjs`: PASS.
- `node tests/issue-128-work-order-records-api.mjs`: PASS, including Hold JSON and master restore assertions.
- `node tests/issue-129-asset-notes-api.mjs`: PASS, including held/resolved PDF status assertions.
- `node tests/portable-master-backup.mjs`: PASS.
- Browser suites for warning lifecycle, Dashboard PM, Issue 129, Equipment Library, Issue 128, and Issue 136: 121 passed, 3 intentional skips (desktop-only wheel continuity and duplicate export fallback/cancellation cases).
- `npx playwright test tests/industrial-suite-visual.spec.ts --workers=2`: 7 passed, 5 intentional alternate-project skips (27.7s). The older fixture omitted `/api/dashboard/inventory-attention`; it now supplies the current empty response.
- Earlier broad browser results: 128 passed, 8 intentional skips, zero remaining failures.
- Desktop/phone screenshots verified amber Hold controls, split Dashboard presentation, and containment. The final shared editor groups the two compact toggles together and wraps them when needed.

Approved for commit, branch push, and PR creation only. No merge, deployment, production mutation, issue closure, or new application version bump is authorized.

## Files changed

- `backend/src/server/index.ts`
- `backend/src/server/workOrderRecordsExport.ts`
- `frontend/src/modules/dashboard/DashboardPage.tsx`
- `frontend/src/modules/dashboard/DashboardPmAttention.tsx`
- `frontend/src/modules/dashboard/dashboardPm.ts`
- `frontend/src/modules/machine-library/AssetNotesAttachments.tsx`
- `frontend/src/styles/app.css`
- `frontend/src/styles/dashboard.css`
- `tests/dashboard-pm-alerts.spec.ts`
- `tests/equipment-library.spec.ts`
- `tests/industrial-suite-visual.spec.ts`
- `tests/issue-128-work-order-records-api.mjs`
- `tests/issue-129-asset-notes-api.mjs`
- `tests/issue-129-asset-notes-ui.spec.ts`
- `tests/warning-issue-lifecycle-api.mjs`
- `tests/warning-issue-lifecycle.spec.ts`
- `docs/issue-146-staging-qa.md`

## Regression coverage

Eight added browser cases (Machine and Equipment on desktop and phone) exercise create/edit Hold controls, submitted on/off values, default/disabled/cleared Hold, split Dashboard counts and lists, amber styling, responsive layout, focus restoration and exact deep-link URLs. Existing lifecycle deep-link/highlight tests now exercise held issues, including reduced motion. Dashboard badge expectations use WO with Open and Hold counts.

The lifecycle API suite now exercises both libraries with default-off input, forced Hold on ordinary notes, unauthorized Hold edits, on/off/on persistence, omitted-field compatibility, append-only updates and attachments, status filters, held and open resolution, Hold-preserving reopen, audit actors/timestamps, and migration of existing rows from a database without the column.

PDF tests assert On Hold while unresolved and Resolved after resolution. Archive tests assert Hold and its display label in JSON, and preserve Hold through master restore. Existing portable backup tests validate exact PDF/attachment hashes and recovery behavior.

A generated three-page held maintenance record was visually reviewed after rendering its summary page; status, labor and text layout were legible without overlap.

Full main browser command (both desktop and mobile Chromium):

```powershell
npx playwright test tests/warning-issue-lifecycle.spec.ts tests/dashboard-pm-alerts.spec.ts tests/issue-129-asset-notes-ui.spec.ts tests/equipment-library.spec.ts tests/issue-128-asset-notes-work-orders.spec.ts tests/issue-136-work-order-pdf-history.spec.ts --workers=4
```

The earlier combined run also included the industrial suite, which was then rerun successfully after correcting its missing API fixture. All six main suites passed at that stage (121 passed, 3 skipped). Subsequent polish validation is recorded below.

## Approved staging follow-ups and final validation

- Removed the duplicate floating Dashboard section summaries; PM due indicators remain in their cards/lists.
- Combined work-order counts into `WO ( Open X / Hold Y )`, retaining separate Open/Hold filters, exact deep links, focus restoration, and responsive containment.
- Made On Hold badges and Hold ON controls bright yellow/amber; OFF styling stays default. Reduced the lifecycle lock pill to 20px with its lock icon intact.
- Zero-valued labor Hours select on focus/click so entering 1 replaces 0; decimals, totals, saved technician data, validation, and permissions remain intact.
- Stabilized mobile Equipment Edit Note coverage by scrolling to the target card/action trigger and waiting for the correctly scoped menu to be interactable.

Validation runs are separate and overlap; do not add them as unique test counts:

- Post-menu-fix broad regression: 128 passed, 0 failed, 8 intentional skips across Dashboard PM, Asset Notes, Equipment Library, warning lifecycle, work-order records, PDF history, and industrial visual suites.
- Final polish regression: 78 passed, 0 failed, 2 intentional skips across `issue-129-asset-notes-ui.spec.ts`, `issue-128-asset-notes-work-orders.spec.ts`, `issue-136-work-order-pdf-history.spec.ts`, and `warning-issue-lifecycle.spec.ts` on desktop/mobile Chromium.
- Final polish API validation: 2 scripts passed, 0 failed (`issue-129-asset-notes-api.mjs` and `issue-128-work-order-records-api.mjs`), covering Machine/Equipment labor, PDF/history/export and restore preservation.
- Final `npm run build` and `git diff --check`: PASS. Desktop/mobile screenshots reviewed.

Human staging QA: PASS / APPROVED. Target release remains v1.5.15; current version remains v1.5.14. Production remains untouched. Keep Issue #146 open until production deployment and live verification are complete.
