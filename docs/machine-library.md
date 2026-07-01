# Machine Library

Machine Library stores MCC machine asset records for injection molding presses.

## Machine Asset Fields

Required fields are Asset Number / Press Number and Brand. Model and Serial Number should be entered when available.

Core fields include Asset Name, Brand, Model, Serial Number, Machine Year, Machine Type, Power Type, decimal Shot Size (oz), Tonnage, Barrel/Screw Diameter, Location, and Status. The legacy Department column is preserved for existing records but is not shown or required for press add/edit.

Technical fields include Voltage, Voltage Type, Full Load Amp, Machine Length, Machine Width, Machine Height, Full Die Height Length / Range, injection setup flags, Screw Type, Screw Tip Type, install dates for screw, screw tip, barrel, and barrel end cap, Barrel Length, Screw Length, Notes, and Critical Notes.

Injection setup fields are stored as `has_double_shot_injection` and `has_plunger_injection`. Existing machines default to Standard injection with both fields off. Hidden Unit 2 or Plunger values are not deleted when a setup option is turned off, so the data returns if the setup is re-enabled later.

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

`Asset Number, Asset Name, Brand, Model, Serial Number, Machine Year, Machine Type, Power Type, Shot Size (oz), Tonnage, Barrel/Screw Diameter, Double Shot Injection, Plunger Injection, Location, Status, Voltage, Voltage Type, Full Load Amp, Machine Length, Machine Width, Machine Height, Full Die Height Length / Range, Screw Type, Screw Tip Type, Screw Rebuild / Repaired, Barrel Rebuild / Repaired, Screw Installed Date, Screw Tip Installed Date, Barrel Installed Date, Barrel End Cap Installed Date, Barrel Length, Screw Length, Screw 2 Type, Screw 2 Tip Type, Screw 2 Rebuild / Repaired, Screw 2 Installed Date, Screw 2 Tip Installed Date, Screw 2 Length, Barrel 2 Rebuild / Repaired, Barrel 2 Installed Date, Barrel 2 End Cap Installed Date, Barrel 2 Length, Barrel 2 Diameter, Plunger Type, Plunger Rebuild / Repaired, Plunger Installed Date, Plunger Length, Plunger Diameter, Plunger Barrel Type, Plunger Barrel Rebuild / Repaired, Plunger Barrel Installed Date, Plunger Barrel End Cap Installed Date, Plunger Barrel Length, Plunger Barrel Diameter, Notes, Critical Notes`

Department is intentionally excluded from Machine Library import/export templates.

Import supports flexible header names, including Press / Press Number / Machine Number for Asset Number, Mfg / Manufacturer for Brand, Model # for Model, S/N / Serial # / Equip Serial # for Serial Number, Shot / Shot (oz) for Shot Size, Ton / Tons for Tonnage, H&E / Hydraulic/Electric for Power Type, and Barrel / Screw Diameter / Barrel Diameter for Barrel/Screw Diameter.

Double Shot Injection and Plunger Injection accept Yes / No, True / False, Y / N, and 1 / 0. These columns are optional. Missing values import as No so old machine files continue to work.

Import modes:

- Add new only: default. Existing Asset Numbers are rejected and no duplicate active machine asset is created.
- Update existing / upsert: existing Asset Numbers are updated and new Asset Numbers are created.

Asset Number matching trims spaces, collapses extra spaces, and compares case-insensitively. Duplicate Asset Numbers inside the import file are rejected after the first row for that Asset Number. If existing MCC data already contains duplicate active Asset Numbers after normalization, import rejects that Asset Number and asks the user to clean up existing records first.

Import result handling shows a duplicate rejection modal first when duplicate rows are rejected. After the user clicks OK, the normal import completion banner appears. Missing Brand values import as Unknown.

## Permissions

All logged-in MCC users can view Machine Library assets. Tier 3, Manager, Admin, and Owner Admin can add/edit assets, import machine lists, export the template, edit brand colors, and update replacement dates. Manager, Admin, and Owner Admin can disable, enable, or delete machine assets.

Backend routes enforce these permissions. The frontend hides or disables restricted controls for lower tiers.

## Injection Setups

Add Machine Asset opens a Machine Injection Setup modal first. The setup asks whether the machine has Double Shot injection and whether it has Plunger injection, then opens the add form with the matching sections.

Edit Machine Asset opens directly. The edit form includes an Injection Setup section with editable Yes / No controls. Changing these controls warns that fields may be shown or hidden and confirms that existing saved data will not be deleted.

Standard injection shows the current Screw and Barrel boxes only. It does not show Screw 1, Barrel 1, Screw 2, Barrel 2, Plunger Injection, or Plunger Barrel labels.

Double Shot injection shows Injection Unit 1 and Injection Unit 2. Unit 1 maps to the original Screw and Barrel fields. Unit 2 stores its own Screw 2 and Barrel 2 type, rebuild/repaired, condition, installed-date, length, diameter, tip, and end-cap values.

Plunger injection adds a Plunger Injection section below the Screw / Barrel area. Plunger fields include Plunger Type, Plunger Rebuild / Repaired, Plunger Installed Date, Plunger Length, Plunger Diameter, and Plunger Condition Status. Plunger has no screw tip field.

Plunger Barrel / Cylinder Barrel fields include type, rebuild/repaired, installed date, end cap installed date, length, diameter, and condition status.

## Screw / Barrel Layout

The asset editor splits Screw and Barrel details into two bordered boxes. On desktop the boxes sit side by side; on tablet and mobile they stack vertically. Filled fields use a slightly brighter border and input treatment so completed values are easier to scan without changing saved data.

The Screw box includes Screw Type, Screw Tip Type, Screw Rebuild / Repaired, Screw Installed Date, Screw Tip Installed Date, Screw Length conversion preview, condition label, and the New Screw / New Screw Tip actions for existing assets.

The Barrel box includes Barrel Diameter, Barrel Rebuild / Repaired, Barrel Installed Date, Barrel End Cap Installed Date, Barrel Length conversion preview, condition label, and the New Barrel / New Barrel End Cap actions for existing assets.

Measurement Inspection remains a placeholder action below the Screw and Barrel boxes. Double Shot machines show Unit 1 and Unit 2 placeholder buttons. Plunger machines show Plunger and Plunger Barrel placeholder buttons. The future workflow is tracked by GitHub issue #16 and will move condition from New to Used to Worn for screw, barrel, Unit 2, plunger, and plunger barrel measurement flow.

Asset cards show an Injection Setup badge for Standard, Double Shot, Plunger, or Double Shot + Plunger. Standard cards keep the compact Screw / Tip / Barrel / End Cap summary. Double Shot cards show compact Unit 1 and Unit 2 screw/tip/barrel summaries. Plunger cards add compact Plunger and Plunger Barrel summaries. Unknown or non-exact install dates display Unknown. On very narrow phone widths, the mini boxes stack one per row to avoid overflow.

## Replacement Date Badges

Asset detail includes small action badges for:

- New Screw
- New Screw Tip
- New Barrel
- New Barrel End Cap

Saving a replacement update changes the related install date, updates the displayed age count, logs the change, and schedules MCC auto backup protection. Unit 2 and Plunger replacement actions use the same flow for their installed-date fields.

## Screw / Barrel Condition

Screw, Barrel, Screw 2, Barrel 2, Plunger, and Plunger Barrel each include a Rebuild / Repaired checkbox where applicable. Unchecked assets display New in green unless a future inspection status is stored. Checked assets display Rebuilt / Repaired. The backend stores condition status fields ready for the future Measurement Inspection workflow tracked by GitHub issue #16.

Current placeholder statuses are:

- New: green
- Used: orange
- Worn: red
- Rebuilt / Repaired: cyan

Tier 3 and higher users can see the Measurement Inspection placeholder action in the Screw / Barrel section. It opens a coming-next notice only; the inspection form is not built yet.

## History Logs

Machine actions are recorded in `history_logs` with `section=machine_library` and `entity_type=machine_asset` where applicable.

Logged actions include asset create/update/disable/enable/delete, machine injection setup updates, brand color changes, import create/update/rejected duplicate actions, and replacement updates. Asset Number links in Machine Library open a machine-specific log modal with date/time, action, user, and reason/note.

Machine asset create and update records include old/new snapshots for changed asset fields such as Shot Size, notes, critical notes, install dates, dimensions, injection setup, Screw Rebuild / Repaired, Barrel Rebuild / Repaired, Unit 2 fields, Plunger fields, and Plunger Barrel fields. Dedicated setup-change history uses `machine_injection_setup_updated`. Replacement history includes `new_screw2_installed`, `new_barrel2_installed`, `new_plunger_installed`, and `new_plunger_barrel_installed`. Create/update/import actions schedule MCC auto backup protection.
