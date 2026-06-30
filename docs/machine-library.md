# Machine Library

Machine Library stores MCC machine asset records for injection molding presses.

## Machine Asset Fields

Required fields are Asset Number / Press Number and Brand. Model and Serial Number should be entered when available.

Core fields include Asset Name, Brand, Model, Serial Number, Machine Year, Machine Type, Power Type, Shot Size (oz), Tonnage, Barrel/Screw Diameter, Location, Department, and Status.

Technical fields include Voltage, Voltage Type, Full Load Amp, Machine Length, Machine Width, Machine Height, Full Die Height Length / Range, Screw Type, Screw Tip Type, install dates for screw, screw tip, barrel, and barrel end cap, Barrel Length, Screw Length, Notes, and Critical Notes.

Install dates are stored as text so unknown, year-only, and exact date values can be preserved. The frontend shows a year count when the value parses as a date. Blank or non-date values show Unknown.

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

## History Logs

Machine actions are recorded in `history_logs` with `section=machine_library` and `entity_type=machine_asset` where applicable.

Logged actions include asset create/update/disable/enable/delete, brand color changes, import create/update actions, and replacement updates. Asset Number links in Machine Library open a machine-specific log modal with date/time, action, user, and reason/note.
