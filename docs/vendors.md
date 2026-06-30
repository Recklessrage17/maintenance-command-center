# MCC Vendors Module

The Vendors module uses the existing `inventory_vendors` lookup table as the vendor record source so current inventory `vendor_id` links remain intact.

## Data

Required:

- Company Name

Optional:

- Company phone type, phone number, and extension
- Address line 1, address line 2, city, state, postal code, country
- Contact name, title, phone type, phone number, extension, and email
- Notes

Active vendor company names are matched case-insensitively. Creating a vendor with an existing company name updates the existing active record instead of creating a duplicate.

## API

- `GET /api/vendors`
- `GET /api/vendors/:id`
- `GET /api/vendors/options`
- `POST /api/vendors`
- `PUT /api/vendors/:id`
- `DELETE /api/vendors/:id`

All vendor routes require login. Create and update use the same permission level as Inventory Add/Edit. Delete is limited to Manager/Admin level users, requires a reason note, and is blocked when active inventory parts reference the vendor.

## Inventory Link

Inventory rows include `vendorId` and show the Vendor column as clickable text. Clicking a vendor opens the vendor detail modal. When Inventory Add/Edit receives a new vendor name that does not match an active vendor case-insensitively, MCC opens the Add Vendor Details modal, creates the vendor, refreshes the dropdown, and selects it on the inventory form.

Inventory import continues to create basic vendor records when a new imported vendor name is found. Those records appear in the Vendors tab and can be completed later.
