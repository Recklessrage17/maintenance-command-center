# Machine Library

Machine Library stores MCC machine asset records for injection molding presses.

## Machine Asset Fields

Required fields are Asset Number / Press Number and Brand. Model and Serial Number should be entered when available.

Core fields include Asset Name, Brand, Model, Serial Number, Machine Year, Machine Type, Power Type, decimal Shot Size (oz), Tonnage, Barrel/Screw Diameter, Location, and Status. The legacy Department column is preserved for existing records but is not shown or required for press add/edit.

Technical fields include Voltage, Voltage Type, Full Load Amp, Machine Length, Machine Width, Machine Height, Full Die Height Length / Range, Screw Type, Screw Tip Type, install dates for screw, screw tip, barrel, and barrel end cap, Barrel Length, Screw Length, Notes, and Critical Notes.

Install dates are stored as text so unknown, year-only, and exact date values can be preserved. The frontend keeps a text field and adds a date picker control for exact dates saved as `YYYY-MM-DD`. The frontend shows a year count when the value parses as an exact date. Blank or non-date values show Unknown.

Length and dimension fields store the original typed text. When a user enters `mm`, `millimeter`, `millimeters`, `in`, `inch`, `inches`, or `"`, the form previews the converted millimeter and inch values without changing the stored text.

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

## Import Mapping

Machine list import supports CSV or `.xlsx` files with these headers:

`Press,Shot (oz),Ton,H&E,Mfg,Barrel,Year,Model #,Equip Serial #`

Mapping:

- Press -> Asset Number / Press Number
- Shot (oz) -> Shot Size Oz
- Ton -> Tonnage
- H&E -> Power Type
- Mfg -> Brand
- Barrel -> Barrel/Screw Diameter
- Year -> Machine Year
- Model # -> Model
- Equip Serial # -> Serial Number

Import uses smart upsert by Asset Number / Press Number. Existing assets are updated; new assets are created; duplicate press rows in the same file are skipped. Missing brand color settings are created automatically.

## Permissions

All logged-in MCC users can view Machine Library assets. Tier 3, Manager, Admin, and Owner Admin can add/edit assets, import machine lists, export the template, edit brand colors, and update replacement dates. Manager, Admin, and Owner Admin can disable, enable, or delete machine assets.

Backend routes enforce these permissions. The frontend hides or disables restricted controls for lower tiers.

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

Logged actions include asset create/update/disable/enable/delete, brand color changes, import create/update actions, and replacement updates. Asset Number links in Machine Library open a machine-specific log modal with date/time, action, user, and reason/note.

Machine asset create and update records include old/new snapshots for changed asset fields such as Shot Size, notes, critical notes, install dates, dimensions, Screw Rebuild / Repaired, and Barrel Rebuild / Repaired. Create/update/import actions schedule MCC auto backup protection.
