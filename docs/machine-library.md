# Machine Library

The Machine Library stores MCC press assets, brand colors, replacement dates, machine-specific history, and import/export templates.

## Press Asset Editing

- Shot Size (oz) accepts decimal values such as `6`, `6.5`, and `6.25`.
- Department is hidden from the press add/edit UI and machine cards. Existing database values are preserved for compatibility.
- Screw Installed Date, Screw Tip Installed Date, Barrel Installed Date, and Barrel End Cap Installed Date use date picker behavior when the stored value is blank or parseable as a date.
- Notes display in yellow/amber text.
- Critical Notes display in red text.

## Screw And Barrel Boxes

The advanced editor splits screw and barrel details into two bordered boxes:

- Screw Box: Screw Type, Screw Tip Type, Screw Rebuild / Repaired, Screw Installed Date, Screw Tip Installed Date, Screw Length, and Screw condition.
- Barrel Box: Barrel Diameter, Barrel Rebuild / Repaired, Barrel Installed Date, Barrel End Cap Installed Date, Barrel Length, and Barrel condition.

Replacement actions for New Screw, New Screw Tip, New Barrel, and New Barrel End Cap remain available for existing assets.

## Injection Setup

When Add Machine Asset is clicked, MCC opens a Machine Injection Setup modal before the asset editor. The setup asks:

- Does this machine have double shot injection?
- Does this machine have plunger injection?

Standard injection machines show the normal Screw Box and Barrel Box. They are labeled Screw and Barrel, not Unit 1 or Screw 1.

Double shot machines show Injection Unit 1 and Injection Unit 2. Unit 1 uses the original screw and barrel fields. Unit 2 has its own Screw 2 and Barrel 2 fields, rebuild/repaired checkboxes, condition labels, install dates, and length/diameter values.

Plunger injection machines add a Plunger Injection section below the screw/barrel area. The Plunger Box has plunger type, rebuild/repaired, install date, length, diameter, and condition. The Plunger Barrel / Cylinder Barrel Box has type, rebuild/repaired, install dates, length, diameter, and condition. Plungers do not have a screw tip field.

Existing hidden data is not deleted when setup changes. Turning Double Shot or Plunger off only hides those component fields in the editor; if the setup is turned back on later, saved values can reappear.

## Condition Labels

Condition labels are stored separately for screw and barrel components:

- New: green
- Used: orange
- Worn: red
- Rebuilt / Repaired: cyan/amber

If Screw Rebuild / Repaired or Barrel Rebuild / Repaired is unchecked, the visible condition defaults to New. If checked, the visible condition becomes Rebuilt / Repaired. Measurement Inspection is a placeholder only in this patch; a later inspection form can move conditions from New to Used to Worn.

## Measurement Inspection

The Machine Asset editor includes a Measurement Inspection button in the Screw / Barrel area for users with machine edit access. Clicking it shows the coming-next message. View-only users can see condition labels without receiving the action button.

Measurement Inspection applies to screw, barrel, and plunger components in future work. A later form can move conditions from New to Used to Worn.

## Dimension Units

Machine Length, Machine Width, Machine Height, Full Die Height Length / Range, Barrel Length, and Screw Length store the original user-entered text and support these units:

- `mm`, `millimeter`, `millimeters`
- `in`, `inch`, `inches`, `"`
- `ft`, `foot`, `feet`, `'`

When a value is valid, the form shows a compact conversion display and an Edit action:

- `100mm` displays `100mm / 3.94in / 0.33ft`
- `72in` displays `1828.8mm / 72in / 6ft`
- `72"` displays `1828.8mm / 72in / 6ft`
- `6ft` displays `1828.8mm / 72in / 6ft`

Conversion colors are green for millimeters, yellow/amber for inches, and red/orange-red for feet.

The same mm / in / ft display and edit behavior is used for Screw 2 Length, Barrel 2 Length, Plunger Length, Plunger Diameter, Plunger Barrel Length, and Plunger Barrel Diameter.

## Import And Export

The machine blank template includes injection setup headers:

- Double Shot Injection
- Plunger Injection
- Screw 2 Type, Screw 2 Tip Type, Screw 2 Rebuild / Repaired, Screw 2 Condition Status, Screw 2 Installed Date, Screw 2 Tip Installed Date, Screw 2 Length
- Barrel 2 Diameter, Barrel 2 Rebuild / Repaired, Barrel 2 Condition Status, Barrel 2 Installed Date, Barrel 2 End Cap Installed Date, Barrel 2 Length
- Plunger Type, Plunger Rebuild / Repaired, Plunger Condition Status, Plunger Installed Date, Plunger Length, Plunger Diameter
- Plunger Barrel Type, Plunger Barrel Rebuild / Repaired, Plunger Barrel Condition Status, Plunger Barrel Installed Date, Plunger Barrel End Cap Installed Date, Plunger Barrel Length, Plunger Barrel Diameter

Imports accept yes/no, true/false, y/n, and 1/0 for Double Shot Injection and Plunger Injection. Old machine import files without these headers still work and default both setup choices to No.

## Import Duplicate Safety

Machine Library imports have an Import Mode selector:

- Add New Only: creates new Asset Numbers and rejects Asset Numbers that already exist in MCC.
- Update Existing / Upsert: updates existing Asset Numbers and creates new Asset Numbers.

Asset Number duplicate checks normalize values by trimming spaces, collapsing repeated spaces, comparing case-insensitively, and removing extra spaces around hyphens. For example, `Press 41`, `press 41`, `PRESS 41`, and `Press    41` are treated as the same Asset Number.

Duplicate rows inside the same import file are rejected after the first valid occurrence. If MCC already contains multiple active machine records with the same normalized Asset Number, the import row is rejected with a cleanup message instead of guessing which record to update.

The import response reports added, updated, skipped, rejected duplicate, error, rejected duplicate row, and changed Asset Number details. If duplicates are rejected, MCC shows a warning popup listing the first rejected rows before showing the final import toast. If nothing changes, the final toast is a warning/error message instead of a green success message.

An automatic backup is scheduled only when an import adds or updates at least one machine asset.

## History And Backups

Machine asset create and update actions write to the `machine_library` history section with `machine_asset` entity data, including changed numeric fields, rebuild flags, condition statuses, notes, dates, and dimensions where old/new values are available. Successful machine asset saves continue to schedule an automatic backup through the current backup system.
