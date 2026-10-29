# Patch 2 — Equipment Library layout (#209)

## Before/after parity map (recorded before implementation)

Reference: existing `MachineLibraryPage.tsx`, `MccCompactDetailGrid.tsx`,
`MccCategoryAccordion.tsx`, and the compact-grid rules in `app.css`.

| Behavior | Machine reference | Equipment before | Patch 2 target |
| --- | --- | --- | --- |
| Initial detail | All cards collapsed | Basic Information open | All cards collapsed |
| Note deep link | Notes open | Notes open | Preserve |
| Panel positioning | One selected panel below all cards | Same shared grid | Preserve shared grid and styles |
| Selection / close | Toggle active card; Escape closes outside edit | Toggle active card; no Escape handler | Follow Machine Escape behavior |
| Editing | One editor; other Edit actions cannot replace its draft | Another Edit Mode can replace draft | Guard begin-edit while editing |
| Save / Cancel / back | Save current fields; cancel restores; dirty back prompts | Existing Equipment equivalents | Preserve fields, persistence, validation and guards |
| Responsive / focus / centering | Shared 3/2/1 columns, keyboard, reduced motion | Same components/styles | Reuse unchanged |

Equipment keeps its six cards, utilities/capacity fields, semantic accents,
header/actions, PM, documents, notes, attachments, history and PDF features.
No Machine source, shared styles, backend, schema, auth or updater changes planned.

## Preservation baseline

This task started clean at detached HEAD
`c69f8cb6c63922c4f415eacf8ee28e7c056a0a1e`. Keep that Git state;
no commit, branch switch, push, merge, deployment or production access.
Patch 3 is preserved separately in the app's existing archived Git snapshot
`37acbb76284bc1f5338a9b837e5f42884cfc0656`; its original worktree is no longer
present. This patch does not reconstruct or overwrite the login. Gate 2 files in
the separate primary checkout remain outside the edit scope. Gate 2 stays on hold.

## Implementation

`EquipmentLibraryPage.tsx` now initializes the selected section to `null`, while
preserving the existing note deep link. All six existing section components stay
mounted in the unchanged shared grid, with their existing content and editors.
Escape collapses the selected section outside Edit Mode, matching Machine.
`begin()` rejects another Edit action while editing, preserving the current draft.
No Equipment fields, editors, endpoints or stored records were removed.

Changed files:

- `frontend/src/modules/equipment-library/EquipmentLibraryPage.tsx`
- `tests/issue-176-compact-detail-cards.spec.ts`
- `tests/issue-209-equipment-persistence.spec.mts`
- This report.

Machine, shared components/styles, authentication, backend, schema, permissions,
PDF generation, updater and workflow source are unchanged from this checkout's
baseline. All 193 existing modified/untracked primary-checkout files match the
before-work SHA-256 inventory. The Patch 3 snapshot ref is unchanged. Patch 2 is
isolated on the release base; combined Patch 2/Patch 3 release integration and
validation remain future work.

## Final validation — October 28, 2026

Windows, Node 22.22.3, local loopback backends, synthetic/demo assets only.

- `npm run build`: frontend TypeScript/Vite and backend TypeScript passed.
- Final managed browser run: **80 passed, 0 failed, 2 skipped, 0 flaky**;
  desktop Chromium 41 passed, mobile Chromium 39 passed / 2 skipped.
- Desktop/tablet/narrow widths: 1440, 820, 768, 390 and 320px across the focused
  layout coverage; mobile project also exercises touch activation.
- Initial collapsed state, every card's reveal/collapse, single selected panel
  below all cards, keyboard/focus, native centering, reduced motion, no horizontal
  overflow, Escape, Save/Cancel, dirty-back and cross-editor guards passed.
- Real isolated backends verified reads/edits/persistence/reload for all 22 stored
  Basic/Utility/Capacity fields, plus dynamic age display in existing UI tests.
  Category, status and criticality remain editable. Child PM schedules, documents,
  warning/work-order note and attachment survive the edits. Equipment specification,
  note and document responses load as valid PDFs. Full History opens; Disable and
  Remove prompts were canceled. No real records were used.
- Existing Machine/Equipment regressions cover document folders/imports/media,
  note counters/deep links/read-only roles, camera attachments, work-order exports,
  PDF/history menus, and resolution flows.
- Desktop and mobile initial screenshots and Equipment section screenshots use
  synthetic assets only. Initial desktop/mobile layouts and representative expanded
  content were visually inspected. No production screenshot was read or uploaded.
- `git diff --check` passed. Source diff inspection confirms the four-file scope.

Final command:

```powershell
npm run test:playwright -- tests/issue-176-compact-detail-cards.spec.ts tests/issue-209-equipment-persistence.spec.mts tests/equipment-library.spec.ts tests/machine-library-asset-card.spec.ts tests/issue-128-asset-notes-work-orders.spec.ts tests/issue-136-work-order-pdf-history.spec.ts --workers=2
```

The two existing skips are mobile-only duplicates from
`issue-128-asset-notes-work-orders.spec.ts`: “unsupported browsers receive a truthful
new-package download fallback” (one browser project is sufficient for the download-only
fallback), and “Cancel Export aborts an in-flight file without committing a partial file
or manifest” (one browser project is sufficient for direct-write cancellation).
Both passed on desktop. No Patch 2 test was skipped.

## Retained evidence and cleanup

Final evidence:
[HTML report](../diagnostics/playwright/run-1793205303173-a841b7fa-7973-4daf-8eee-1171cebfc6e2/html/index.html),
[cleanup receipt](../diagnostics/playwright/run-1793205303173-a841b7fa-7973-4daf-8eee-1171cebfc6e2/cleanup.json).
The same run directory contains the private preservation inventory/verification
and synthetic screenshots under `test-results/`. Diagnostics remain local and ignored.

Earlier diagnostic runs remain retained for human review:

| Run ID | Actual result / corrected test setup |
| --- | --- |
| `run-1793204857407-07f488e4-f085-4238-9154-71ed488948ad` | 48 pass / 2 fail; new Machine back selector corrected |
| `run-1793204947358-cf63dbc7-22e3-4f09-ae21-f9cadf397b74` | Collection failure; new backend test changed to ESM `.mts` |
| `run-1793204961384-3d229449-0c0b-4600-bf2c-00cffd2803fc` | 2 fail; new note/attachment fixture corrected |
| `run-1793205010779-9cbc8490-e57f-4b2f-ac08-62ef2fd9de8a` | 48 pass / 2 fail / 2 skip; work order requires warning fixture |
| `run-1793205074263-2d4d37d9-1a54-4115-a9d9-537761c4219a` | 2 fail; exact select-label locator replaced with accessible role |
| `run-1793205225905-2d312b71-00ae-4557-b300-239f26e03c69` | 2 fail; populated textarea locator replaced with accessible role |
| `run-1793205265033-4ebe0fa5-1a76-4c13-945c-f1f74def70aa` | 2 fail; note-title locator narrowed to the issue summary |

All eight runs have receipts confirming removal of their owned runtime directories.
Owned processes exited before managed cleanup. Final `tmp/playwright-runs` has zero
directories; `npm run test:playwright:cleanup` reports no managed stale runs.
No interrupted runs remain. Failure evidence and recovery snapshots were retained;
no unrelated data, fixtures or diagnostics were swept.

Implementation and focused local validation are complete. Owner review and eventual
controlled integration/release remain pending. Nothing was committed, pushed,
merged or deployed; no Pi access occurred. Approved release pin and Gate 2 hold
are unchanged.

Sanitized completion report posted to
[#209](https://github.com/Recklessrage17/maintenance-command-center/issues/209#issuecomment-6474858393),
with milestone summary on
[#206](https://github.com/Recklessrage17/maintenance-command-center/issues/206#issuecomment-6474863444).
