# MCC Vendors Module

The Vendors module uses the existing `inventory_vendors` lookup table as the vendor record source so current inventory `vendor_id` links remain intact.

## Data

Required:

- Company Name

Optional:

- Website URL
- Company phone type, phone number, and extension
- Address line 1, address line 2, city, state, postal code, country
- Contact name, title, phone type, phone number, extension, and email
- Notes

Website URL is optional and must be a safe `http` or `https` URL. Vendor cards show a favicon loaded from the website origin when available, with a small URL fallback badge if the favicon fails. The favicon, host name, and website link open in a new browser tab with `rel="noopener noreferrer"`.

Vendor company names are matched with a normalized key that trims, ignores case, collapses punctuation and spacing, and treats names such as `McMaster-Carr`, `Mcmaster Carr`, and `McMaster - Carr` as the same company. Creating or importing a vendor with an existing normalized company name updates the existing record in upsert mode instead of creating a duplicate.

Vendors also have a status:

- Enabled: normal selectable vendor.
- Disabled: visible in Vendors, hidden from normal Inventory vendor choices, and shown as inactive on linked inventory rows.
- Deleted: soft-deleted only. Linked inventory rows keep the vendor name and show the same inactive warning.

## API

- `GET /api/vendors`
- `GET /api/vendors/export/csv`
- `GET /api/vendors/export/excel-update-template`
- `GET /api/vendors/export/blank-import-template`
- `GET /api/vendors/:id`
- `GET /api/vendors/options`
- `POST /api/vendors`
- `POST /api/vendors/import`
- `PUT /api/vendors/:id`
- `DELETE /api/vendors/:id`

All vendor routes require login. Create and update use the same permission level as Inventory Add/Edit. Vendor import requires Tier 3 or higher through the Inventory import permission. Delete is limited to Manager/Admin level users and requires a reason note.

## Card Layout

The Vendors page uses compact vendor cards instead of a wide table. Cards show Company Name, Website URL or No website, main phone, contact name, contact email, city/state, status, and View/Edit/Delete actions. The grid shows multiple cards per row on desktop, narrows to two where space allows, and stacks to one card per row on phones.

## Import And Export

Vendor tools support:

- Export CSV
- Export Excel Update Template
- Export Blank Import Template
- Import CSV / Excel

Vendor templates use these headers:

`Company Name, Website URL, Phone Type, Phone Number, EXT #, Address Line 1, Address Line 2, City, State, Postal Code, Country, Contact Name, Contact Title, Contact Phone Type, Contact Phone Number, Contact EXT #, Contact Email, Notes, Status`

Import modes:

- Update existing / upsert: default. Existing normalized company names are updated and new companies are created.
- Add new only: existing normalized company names are rejected and listed as duplicate rejections.

Duplicate company names inside one import file are rejected after the first row for that normalized company key. Import results report added, updated, rejected duplicate, skipped, and error counts. Rejected duplicate rows are shown in a warning modal before the normal completion message.

Vendor import records history actions for imported rows, updated rows, and duplicate rejections. Vendor create, update, import, disable, enable, and delete activity is included in history logs and schedules MCC auto backup protection.

## Inventory Link

Inventory rows include `vendorId`, `vendorDeleted`, and `vendorIsActive`, and show the Vendor column as clickable text. Clicking a vendor opens the vendor detail modal. When Inventory Add/Edit receives a new vendor name that does not match a known vendor case-insensitively, MCC opens the Add Vendor Details modal, creates the vendor, refreshes the dropdown, and selects it on the inventory form.

Inventory import continues to create basic vendor records when a new imported vendor name is found. Those records appear in the Vendors tab and can be completed later.
