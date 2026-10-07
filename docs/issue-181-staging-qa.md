# Issue #181 staging QA

Branch: `issue-181-work-orders-notes-summary`

Base: `dce90cc` (includes #176 compact cards, #175 machine status, and #173 barrel size).

## Result

Machine Library and Equipment Library share `AssetNotesAttachments`. Its section title is now **Work Orders & Notes**. Notes counts ordinary notes, active issues, and held issues; resolved issues count only toward Resolved. The attachment summary pill is removed. Notes uses the existing amber warning token and Resolved uses the existing green success token used for Schedules.

Attachment rendering, files, downloads, permissions, lifecycle, history, exports, deep links, and unsaved-work guards retain their existing implementation. No backend or schema changes.

## Changed files

- `frontend/src/modules/machine-library/AssetNotesAttachments.tsx`: shared title, counts, and summary tones; remove attachment count calculation/pill.
- `tests/issue-181-work-orders-notes-summary.spec.ts`: both-library count scenarios, semantic colors, search-independent totals, keyboard expansion, 1440/820/390/320px overflow checks, and attachment previews/downloaded bytes in ordinary notes and resolved history.
- `tests/issue-176-compact-detail-cards.spec.ts`: new title, resolved-only count expectation, absent attachment pill.
- `tests/machine-library-summary-tokens.spec.ts`: new title and summary contents; retain large-count and tablet checks.
- `tests/issue-128-asset-notes-work-orders.spec.ts`: new title; supply blank component installation dates in the machine fixture.
- `tests/issue-129-asset-notes-ui.spec.ts`: new title; supply blank component installation dates in the machine fixture.
- `tests/issue-136-work-order-pdf-history.spec.ts`: new title; supply blank component installation dates in the machine fixture.
- `tests/equipment-library.spec.ts`: updated section-title selectors.
- `tests/issue-80-facility-assets-action-progress.spec.ts`: updated section-title selector.
- `tests/machine-asset-document-library.spec.ts`: updated section-title selectors; scope document notices so #175's machine status announcement does not make status assertions ambiguous.
- `tests/machine-library-asset-card.spec.ts`: updated section-title selector.
- `tests/machine-library-setup-type.spec.ts`: updated section-title selector.
- `tests/warning-issue-lifecycle.spec.ts`: updated section-title selectors; scope lifecycle notices so #175's machine status announcement does not make status assertions ambiguous; exclude #176's boxless `display: contents` wrappers from clipping measurements.
- `docs/issue-181-staging-qa.md`: QA handoff and file manifest.

## Validation

- `npm run build`: passed (frontend and backend).
- New Issue #181 Playwright suite: **8 passed**, desktop and mobile Chromium. Each count test checks desktop, tablet, phone, and narrow phone sizes.
- Compact-card and existing summary suites: **19 passed, 1 skipped** (the existing tablet-only test skips the mobile project).
- Focused existing regressions: **217 cases verified, 3 existing skips**, including #175/#173. The broad run returned 210 passed, 3 skipped, and 7 failures in outdated test assertions. All seven failures passed after scoping status notices and excluding boxless compact-card wrappers from clipping measurements: document rerun **4 passed**, lifecycle rerun **8 passed**, glow rerun **4 passed**. The reruns include both libraries and desktop/mobile projects.
- `node tests/warning-issue-lifecycle-api.mjs`: passed for both libraries, including technician permissions, resolution/reopen, correction attachments, PDF/ZIP, audit records, and ordinary notes.
- `node tests/issue-128-work-order-records-api.mjs`: passed for both libraries, including export permissions, stable hashes, master export, and restore.
- `git diff --check`: passed. Package versions and lockfiles are unchanged.

Playwright commands:

```powershell
$env:MCC_PLAYWRIGHT_PORT='4275'
npx playwright test tests/issue-181-work-orders-notes-summary.spec.ts --workers=2 --output=tmp/issue-181-focused-results
npx playwright test tests/issue-176-compact-detail-cards.spec.ts tests/machine-library-summary-tokens.spec.ts --workers=2 --output=tmp/issue-181-compact-results
$env:MCC_PLAYWRIGHT_PORT='4274'
npx playwright test tests/issue-128-asset-notes-work-orders.spec.ts tests/issue-129-asset-notes-ui.spec.ts tests/issue-136-work-order-pdf-history.spec.ts tests/warning-issue-lifecycle.spec.ts tests/issue-175-machine-status-pill.spec.ts tests/issue-139-machine-library-component-cards.spec.ts tests/equipment-library.spec.ts tests/machine-library-asset-card.spec.ts tests/machine-library-setup-type.spec.ts tests/machine-asset-document-library.spec.ts tests/issue-80-facility-assets-action-progress.spec.ts --workers=3 --output=tmp/issue-181-regression-results
$env:MCC_PLAYWRIGHT_PORT='4275'
npx playwright test tests/machine-asset-document-library.spec.ts --grep 'document library supports folder creation|document library supports rename' --workers=2 --output=tmp/issue-181-document-results
npx playwright test tests/warning-issue-lifecycle.spec.ts --grep 'warning issue active lifecycle|warning issue resolved lifecycle' --workers=2 --output=tmp/issue-181-lifecycle-results
npx playwright test tests/warning-issue-lifecycle.spec.ts --grep 'Update Entry glow' --workers=2 --output=tmp/issue-181-glow-results
```

Total: **244 distinct passing Playwright cases**, **4 existing skips**, with all initially failing regression cases covered by passing corrected reruns. Logs and screenshots are in the local ignored `tmp/issue-181-*` paths.

## Staging checks

Run these on both Machine Library and Equipment Library with saved staging records:

1. An asset with zero unresolved and one resolved record shows **0 notes / 1 resolved**.
2. An asset with ordinary, active, held, and resolved records counts each unresolved record once in Notes and each resolved record once in Resolved. Search/filter changes do not alter asset totals.
3. Resolve an issue and reopen it; verify totals move between Notes and Resolved after each saved transition.
4. Verify the **Work Orders & Notes** title, amber Notes, green Resolved, and absence of an attachment count pill.
5. Open, preview, download, and permission-appropriately add/remove note attachments; inspect resolved history and export records with attachments.
6. Check note creation/editing, work-order history, permission restrictions, warning deep links, and unsaved-note switching guards.
7. Check desktop, tablet, mobile, and narrow mobile card layouts; confirm no horizontal overflow and keyboard/touch operation.
8. Verify #175 live status, #173 barrel size, and #176 compact card behavior.

## #178 integration boundary

The #178 implementation is on the separate local `issue-178-pm-no-work-order-exception` branch (`97135ea`), and is absent from this branch's base. Its PM components/backend are untouched by #181. Combined #178/#181 behavior must be checked when both changes are present in staging; it was not claimed as tested here. No merge was performed.

Stopped after local implementation/testing. No version bump, tag, push, or deployment.
