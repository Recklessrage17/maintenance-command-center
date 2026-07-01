# MCC Vendors Module

The Vendors module uses the existing `inventory_vendors` lookup table as the vendor company source so current inventory `vendor_id` links remain intact. Vendor people live in `vendor_contacts`.

## Data

Required:

- Company Name

Optional:

- Website URL
- General Email
- Company phone type, phone number, and extension
- Address line 1, address line 2, city, state, postal code, country
- Notes

Website URL is optional and must be a safe `http` or `https` URL. Vendor cards show a favicon loaded from the website origin when available, with a small URL fallback badge if the favicon fails. The favicon, host name, and website link open in a new browser tab with `rel="noopener noreferrer"`.

Each vendor can have multiple contacts. A contact has name, title, email, phone type, phone number, optional office extension, notes, and primary-contact state. The migration creates contacts from the legacy single-contact fields when those fields already contain data.

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
- `GET /api/vendors/:id/contacts`
- `POST /api/vendors`
- `POST /api/vendors/import`
- `POST /api/vendors/:id/contacts`
- `PUT /api/vendors/:id`
- `PUT /api/vendors/:vendorId/contacts/:contactId`
- `DELETE /api/vendors/:id`
- `DELETE /api/vendors/:vendorId/contacts/:contactId`
- `POST /api/vendors/:vendorId/contacts/:contactId/restore`

All vendor routes require login. Vendor create/update and contact create/update/delete/restore use the same permission level as Inventory Add/Edit. Vendor import requires Tier 3 or higher through the Inventory import permission. Vendor delete is limited to Manager/Admin level users and requires a reason note.

## Card Layout

The Vendors page uses compact vendor cards instead of a wide table. Cards show a glossy company-name pill, Website URL or No website, main phone, clickable contact count, click-to-copy general email, city/state, and View/Edit/Delete actions. The green Enabled badge is hidden on normal active cards. Disabled/deleted cards use a red treatment and show `Company no longer uses this vendor.`

## Import And Export

Vendor tools support:

- Export CSV
- Export Excel Update Template
- Export Blank Import Template
- Import CSV / Excel

Vendor templates use these headers:

`Company Name, Website URL, General Email, Phone Type, Phone Number, EXT #, Address Line 1, Address Line 2, City, State, Postal Code, Country, Contact Name, Contact Title, Contact Email, Contact Phone Type, Contact Phone Number, Contact EXT #, Contact Notes, Notes, Status`

Exports write one row per active contact with vendor fields repeated. Vendors with no contacts still export one row with blank contact fields. The blank import template contains headers only.

Import modes:

- Update existing / upsert: default. Existing normalized company names are updated and new companies are created.
- Add new only: existing normalized company names are rejected and listed as duplicate rejections.

Multiple import rows with the same company are allowed so one company can create or update multiple contacts. In upsert mode, the same contact under the same vendor updates the existing contact instead of creating a duplicate. In add-only mode, existing vendors and existing duplicate contacts are rejected. Import results report added, updated, rejected duplicate, skipped, and error counts. Rejected duplicate rows are shown in a warning modal before the normal completion message.

Vendor import records history actions for imported rows, updated rows, contact imports, contact updates, and duplicate rejections. Vendor create, update, import, disable, enable, delete, contact create, contact update, contact delete, and contact restore activity is included in history logs and schedules MCC auto backup protection where applicable.

## Inventory Link

Inventory rows include `vendorId`, `vendorDeleted`, and `vendorIsActive`, and show the Vendor column as clickable text. Clicking a vendor opens the vendor detail modal. When Inventory Add/Edit receives a new vendor name that does not match a known vendor case-insensitively, MCC opens the Add Vendor Details modal, creates the vendor, refreshes the dropdown, and selects it on the inventory form.

Inventory import continues to create basic vendor records when a new imported vendor name is found. Those records appear in the Vendors tab and can be completed later.
