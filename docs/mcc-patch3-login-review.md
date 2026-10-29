# Patch 3 login review — Issue #210

Local implementation reviewed October 28, 2026 against
[Issue #210](https://github.com/Recklessrage17/maintenance-command-center/issues/210).

## Reference and implementation measurements

The actual chat attachment was read and visually inspected before implementation.
Its PNG dimensions are **1585 × 992** and its SHA-256 is exactly
`27c5f7ce1cd07d09649de6b72d41970c856871fdd0fade2915fb63101a610306`,
matching the issue. The reference remains outside this repository; it is not a
runtime asset, committed screenshot, background crop, or rasterized form.

The implementation follows these measurements from the reference:

| Element | Approved reference / implemented target |
| --- | --- |
| Single card at 1585 × 992 | Approximately x=499, y=150, 590 × 650; implementation x=498, y=150, 590 × 650 |
| Card outline | 2px, approximately 33px corner radius, blue left/bottom and green right |
| Input fields | Approximately 476 × 66px, fully rounded, icons and focus rings |
| Primary action | Approximately 476 × 72px, blue/cyan/green gradient and circular arrow |
| Copy | Compact centered branding, uppercase subtitle, short support text |
| Overlays | Localized live clock at top right; neutral product pill at bottom left |
| Motion | 360ms entrance; 8s opacity-only glow; 160ms control transitions |

The previous login used a 1080px two-column card. It now uses one portrait card,
500px wide on shorter laptop screens and fluid on mobile. All overlays participate
in document flow, allowing scrolling with short viewports and zoom. Existing MCC
form styles, accessibility feedback, tokens, and icon component are reused where
practical; the exact approved palette is scoped to this login variant. The recovery
page and application shell retain their existing layouts.

## Deliberate visual differences

- The existing repository JBT USA logo is used, including its original colors and
  baked light checker background, inside a small light plaque. It is resized and
  encoded as WebP without redrawing the brand. It differs from the concept's
  illustrative neon logo. The original PNG is unchanged.
- The factory backdrop is a separate synthetic illustration, with similar aisle,
  equipment, lighting and floor reflections. It contains no brand marks, UI,
  production imagery or claimed telemetry. Equipment details differ from the
  approved reference. This asset and the screenshots are available for owner
  review before any release.
- No remember-me feature exists in the current authentication contract, so its
  space contains neutral “Operator sign-in” copy. No persistence policy changed.
- “MCC operator access” and neutral product information replace ungrounded online,
  node and encryption claims. The clock uses actual browser locale/time.
- Dark button text improves contrast on the bright gradient. The accessible page
  heading and field labels remain available to assistive technology.

## Asset provenance and weight

`frontend/src/assets/mcc-login-factory.webp` is **135,618 bytes**, 1586 × 992,
WebP quality 82. SHA-256:
`8e46315479e3450042a15ffdcdcf80620671370afcab41ee95e783bc5147a3dc`.

It was generated with the built-in imagegen tool, independently of the approved
PNG, using this final prompt:

> Use case: stylized-concept. Asset type: background-only raster for a working industrial maintenance login UI. Create a cinematic realistic empty industrial factory control-equipment aisle, landscape 16:10, symmetrical central perspective, cabinets and machinery lining left and right, overhead warehouse beams and slim blue-white ceiling lights, glossy dark floor with long blue and emerald reflections. Equipment in foreground edges, central distant aisle softly out of focus and dark with clear visual space where a real HTML card will overlay. Midnight navy/graphite palette, electric cyan/blue vertical light on left cabinet, emerald green accent lights on right cabinets. Rich photographic materials and restrained bloom, soft depth of field, dark yet visible machinery. No text, no logos, no branding, no people, no UI, no card, no fields, no buttons, no overlays, no telemetry. This is fictional factory atmosphere only. All controls will be rendered separately in code.

`frontend/src/assets/jbt-usa-login.webp` is **11,762 bytes**, 564 × 188,
derived from the existing `JBT_USA _logo.png` with Lanczos resampling and WebP
quality 90. SHA-256:
`96c0e4e5f38570fdfd32dce10e577b4c196b25437ffbab6f495648767d1ef33a`.

Total new image transfer is **147,380 bytes**. No new dependencies, fonts, remote
asset requests, WebGL, video, background drift or continuously animated blur were
added. The clock updates every 30 seconds and clears its timer on unmount. Reduced
motion disables the entrance, glow and transitions. No Raspberry Pi performance
measurement was performed.

## Authentication boundaries

The `authenticate(email, password)`, `onForgot` and `onLogin` integrations are
unchanged. Backend authentication/security code, endpoints, session cookies,
CSRF policy, throttling, reset implementation, routes and forced-password-change
handling were not edited. The password visibility button only changes the input
type in memory, starts masked, exposes its pressed state, and disables during
submission. Credential fields retain their autocomplete values and working labels.
Inline errors are announced and associated with the fields. No credential storage
or remember-me behavior was added. Existing safe server messages are preserved.

## Validation and retained evidence

- `npm run build`: frontend TypeScript/Vite and backend TypeScript passed. The
  frontend build passed again after the final visual adjustment.
- Broader managed run: **16 passed, 6 skipped**, zero failures, covering login,
  readiness/session routing, recovery, dashboard and related UI regressions.
  The six skips are existing desktop-only cases on the mobile project.
  Evidence: [broader run](../diagnostics/playwright/run-1793202136348-61d2c56d-daa3-493d-8463-53df2e3e7a5d/).
- Final managed run, two concurrent workers: **11 passed, 3 skipped**, zero
  failures. It includes final geometry, mocked UI checks and independent real
  backend fixtures on desktop and mobile. The three skips are the existing
  desktop-only loading/recovery/motion audits in the mobile project.
  Command: `npm run test:playwright -- tests/mcc-login-issue-56.spec.ts tests/mcc-login-auth-preservation.spec.ts --workers=2`.
  Evidence: [final run](../diagnostics/playwright/run-1793202267994-4293fa95-eacc-4e5b-8c06-88f45d3ac463/).
- Screenshots inspected at 1585 × 992 and 390 × 844, plus captures at 1366 × 768,
  1920 × 1080 and 768 × 1024. No horizontal overflow. Controls have at least 44px
  touch targets. Keyboard traversal, visibility toggle and visible focus passed;
  200% CSS layout zoom and a 390 × 420 shortened viewport stayed scroll reachable.
- Real-backend checks verify invalid login, HttpOnly/SameSite cookie properties,
  temporary-password sign-in and mandatory rotation, persisted session after
  reload, logout, rejection of the replaced credential, generic reset responses,
  and reset-session invalidation. SMTP delivery is disabled in these isolated
  fixtures, so external email delivery was not exercised.
- No physical mobile device, Safari, full repository suite, production storage,
  Raspberry Pi or deployment validation was used for this local frontend patch.

Final screenshots:

- [Reference-size desktop](../diagnostics/playwright/run-1793202267994-4293fa95-eacc-4e5b-8c06-88f45d3ac463/visual/issue-210/logon-approved-reference-size.png)
- [Laptop](../diagnostics/playwright/run-1793202267994-4293fa95-eacc-4e5b-8c06-88f45d3ac463/visual/issue-210/logon-1366x768.png)
- [Tablet](../diagnostics/playwright/run-1793202267994-4293fa95-eacc-4e5b-8c06-88f45d3ac463/visual/issue-210/logon-tablet-768x1024.png)
- [Mobile](../diagnostics/playwright/run-1793202267994-4293fa95-eacc-4e5b-8c06-88f45d3ac463/visual/issue-210/logon-mobile-390x844.png)

Intermediate failure evidence is retained for human review:
[first UI run](../diagnostics/playwright/run-1793201967347-a334f0e4-bce7-4f8f-9d3d-1382cf3c8bcd/)
(label ambiguity and test timing/storage assumptions) and
[collection failure](../diagnostics/playwright/run-1793202072519-88f03a6c-adad-488f-ba30-948f1658d540/)
(ESM helper imported by a CommonJS-transformed spec). These were corrected; the
final auth fixtures use the native ESM loader and independent owned backends.

All four runs have cleanup receipts confirming removal of owned runtime storage.
The final cleanup dry run reports **no managed stale runs**, and
`tmp/playwright-runs` contains zero directories. Diagnostics and recovery evidence
remain retained. No interrupted runtime was left behind, no tracked generated
files were removed, and no other workspace or live storage was cleaned.

The checkout remains at its original detached HEAD `c69f8cb`; no branch change,
commit, push, merge, deployment, production connection or public upload occurred.
Patch 1/Patch 2 files and updater/recovery code were not edited.
