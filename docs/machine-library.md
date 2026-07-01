# Machine Library

Machine Library stores MCC machine asset records for injection molding presses.

## Machine Asset Fields

Required fields are Asset Number / Press Number and Brand. Model and Serial Number should be entered when available.

Core fields include Asset Name, Brand, Model, Serial Number, Machine Year, Machine Type, Power Type, decimal Shot Size (oz), Tonnage, Barrel/Screw Diameter, Location, and Status. The legacy Department column is preserved for existing records but is not shown or required for press add/edit.

Technical fields include Voltage, Voltage Type, Full Load Amp, Machine Length, Machine Width, Machine Height, Full Die Height Length / Range, Screw Type, Screw Tip Type, install dates for screw, screw tip, barrel, and barrel end cap, Barrel Length, Screw Length, Notes, and Critical Notes.

Install dates are stored as text so unknown, year-only, and exact date values can be preserved. The frontend keeps a text field and adds a date picker control for exact dates saved as `YYYY-MM-DD`. The frontend shows a year count when the value parses as an exact date. Blank or non-date values show Unknown.

Length and dimension fields store the original typed text. When a user enters `mm`, `millimeter`, `millimeters`, `in`, `inch`, `inches`, `"`, `ft`, `foot`, `feet`, or `'`, the form displays converted millimeter, inch, and foot values without changing the stored text.

Machine Length, Machine Width, Machine Height, Full Die Height Length / Range, Barrel Length, and Screw Length use display/edit mode. Blank fields show the input with the placeholder `100mm, 72in, 6ft`. Valid entries collapse after blur into a bordered display box such as `100mm / 3.94in / 0.33ft` with green millimeters, amber inches, and red-orange feet plus a compact Edit button. Invalid values keep the input visible and show the hint `Enter a value like 100mm, 72in, or 6ft.`

Notes are displayed in amber/yellow. Critical Notes are displayed in red.

## Brand Colors

Brand color settings live in `machine_brand_settings`. Default colors are:

- Toyo: light blue
- Arburg: teal green
- Husky: yellow
- Engel: blue gray
- Sodick: purple blue
- Default / Unknown: cyan

Only Tier 3 and higher can edit brand colors. Color values are validated as safe `#RRGGBB` hex strings. A confirmation warning is shown before saving because a brand color update changes every matching machine asset card.

Machine cards apply the brand color to the card accent border, a subtle card glow, and the brand text glass pill. Brand color settings remain live: changing Toyo, Arburg, Husky, Engel, or any other brand color updates all matching card accents and brand pills.

Active machine cards use a compact green pulsing dot with `Status: Active` accessibility text instead of a full Active pill. Down uses an orange/red dot, Disabled uses a muted red/gray dot, and Removed uses a gray dot. The detail modal and edit form still show status text. The pulse respects reduced-motion preferences.

## Import Mapping

Machine Library tools support:

- Export CSV
- Export Excel Update Template
- Export Blank Import Template
- Import CSV / Excel

Blank and update templates use these headers:

`Asset Number, Asset Name, Brand, Model, Serial Number, Machine Year, Machine Type, Power Type, Shot Size (oz), Tonnage, Barrel/Screw Diameter, Location, Status, Voltage, Voltage Type, Full Load Amp, Machine Length, Machine Width, Machine Height, Full Die Height Length / Range, Screw Type, Screw Tip Type, Screw Rebuild / Repaired, Barrel Rebuild / Repaired, Screw Installed Date, Screw Tip Installed Date, Barrel Installed Date, Barrel End Cap Installed Date, Barrel Length, Screw Length, Notes, Critical Notes`

Department is intentionally excluded from Machine Library import/export templates.

Import supports flexible header names, including Press / Press Number / Machine Number for Asset Number, Mfg / Manufacturer for Brand, Model # for Model, S/N / Serial # / Equip Serial # for Serial Number, Shot / Shot (oz) for Shot Size, Ton / Tons for Tonnage, H&E / Hydraulic/Electric for Power Type, and Barrel / Screw Diameter / Barrel Diameter for Barrel/Screw Diameter.

Import modes:

- Add new only: default. Existing Asset Numbers are rejected and no duplicate active machine asset is created.
- Update existing / upsert: existing Asset Numbers are updated and new Asset Numbers are created.

Asset Number matching trims spaces, collapses extra spaces, and compares case-insensitively. Duplicate Asset Numbers inside the import file are rejected after the first row for that Asset Number. If existing MCC data already contains duplicate active Asset Numbers after normalization, import rejects that Asset Number and asks the user to clean up existing records first.

Import result handling shows a duplicate rejection modal first when duplicate rows are rejected. After the user clicks OK, the normal import completion banner appears. Missing Brand values import as Unknown.

## Permissions

All logged-in MCC users can view Machine Library assets. Tier 3, Manager, Admin, and Owner Admin can add/edit assets, import machine lists, export the template, edit brand colors, and update replacement dates. Manager, Admin, and Owner Admin can disable, enable, or delete machine assets.

Backend routes enforce these permissions. The frontend hides or disables restricted controls for lower tiers.

## Screw / Barrel Layout

The asset editor splits Screw and Barrel details into two bordered boxes. On desktop the boxes sit side by side; on tablet and mobile they stack vertically. Filled fields use a slightly brighter border and input treatment so completed values are easier to scan without changing saved data.

The Screw box includes Screw Type, Screw Tip Type, Screw Rebuild / Repaired, Screw Installed Date, Screw Tip Installed Date, Screw Length conversion preview, condition label, and the New Screw / New Screw Tip actions for existing assets.

The Barrel box includes Barrel Diameter, Barrel Rebuild / Repaired, Barrel Installed Date, Barrel End Cap Installed Date, Barrel Length conversion preview, condition label, and the New Barrel / New Barrel End Cap actions for existing assets.

Measurement Inspection remains a placeholder action below the Screw and Barrel boxes. The future workflow is tracked by GitHub issue #16 and will move condition from New to Used to Worn.

Asset cards show Screw and Barrel condition badges in their own row, then a compact 2x2 Screw / Tip / Barrel / End Cap summary underneath. Screw and Tip display their type plus install-date year count, Barrel displays length or diameter plus install-date year count, and End Cap displays its install-date year count. Unknown or non-exact install dates display Unknown. On very narrow phone widths, the mini boxes stack one per row to avoid overflow.

## Replacement Date Badges

Asset detail includes small action badges for:

- New Screw
- New Screw Tip
- New Barrel
- New Barrel End Cap

Saving a replacement update changes the related install date, updates the displayed age count, logs the change, and schedules MCC auto backup protection.

## Screw / Barrel Condition

Screw and Barrel each include a Rebuild / Repaired checkbox. Unchecked assets display New in green. Checked assets display Rebuilt / Repaired. The backend also stores condition status fields ready for the future Measurement Inspection workflow tracked by GitHub issue #16.

Current placeholder statuses are:

- New: green
- Used: orange
- Worn: red
- Rebuilt / Repaired: cyan

Tier 3 and higher users can see the Measurement Inspection placeholder action in the Screw / Barrel section. It opens a coming-next notice only; the inspection form is not built yet.

## History Logs

Machine actions are recorded in `history_logs` with `section=machine_library` and `entity_type=machine_asset` where applicable.

Logged actions include asset create/update/disable/enable/delete, brand color changes, import create/update/rejected duplicate actions, and replacement updates. Asset Number links in Machine Library open a machine-specific log modal with date/time, action, user, and reason/note.

Machine asset create and update records include old/new snapshots for changed asset fields such as Shot Size, notes, critical notes, install dates, dimensions, Screw Rebuild / Repaired, and Barrel Rebuild / Repaired. Create/update/import actions schedule MCC auto backup protection.
