# MCC Vendors

The Vendors page manages the companies used by MCC inventory and requisitions.

## Vendor Cards

- Active vendors show as normal cards without an extra Enabled badge.
- Disabled vendors show the warning `Company no longer uses this vendor.`
- Deleted vendors show the warning `Vendor record deleted.`
- Select the company pill to open the vendor detail modal.
- Select the Contacts box to open the vendor contacts modal.

## Website URL

Vendor records support an optional `Website URL` field.

- Blank values are allowed.
- URLs must start with `http://` or `https://`.
- The vendor card and detail modal link directly to the saved URL.
- The favicon/bookmark image is loaded from the website origin in the browser with a letter fallback if the icon cannot load.

## General Email

The vendor-level email is treated as the general sales/service email.

- Vendor cards copy the full email address when the General Email box is selected.
- Contact emails copy the full email address from the contacts modal.
- Email copy uses the browser clipboard when available and falls back to a safe selectable-text copy method.
- Email copy actions are not logged.

## Multi-Contact System

Each vendor can have multiple contacts. Contact fields are:

- `Contact Name`
- `Contact Title`
- `Email`
- `Phone Type`
- `Phone Number`
- `EXT #`
- `Notes`
- `Primary Contact`

Allowed contact phone types are `Cell`, `Mobile`, `Work`, `Office`, and `Other`. The `EXT #` field is emphasized when `Office` is selected; it remains optional.

Vendor cards show `0 contacts`, `1 contact`, or `2 contacts`. If a primary contact exists, the card includes the primary contact name.

Existing single-contact vendor fields remain in the database for compatibility. During migration, old single-contact data is seeded into `vendor_contacts` only if the vendor has no contact rows yet.

## Contact Modal

The contacts modal shows:

- Vendor company name
- Website/favicon link when available
- Contact name and title
- Contact email with click-to-copy
- Phone type, phone number, and extension
- Contact notes
- Primary label
- Add, edit, and delete actions when the user has permission

The empty state is `No contacts saved for this vendor.`

## Duplicate Names

MCC normalizes vendor names before duplicate checks. Case, whitespace, and hyphen spacing are ignored so names such as `McMaster-Carr`, `Mcmaster Carr`, and `McMaster - Carr` are treated as the same company.

Creating a new vendor with a duplicate company name returns a clear duplicate-name error instead of creating another vendor record.

## CSV Import And Export

Vendor CSV templates and exports include vendor fields plus contact fields.

Supported CSV headers include:

- `Company Name`
- `Website URL`
- `General Email`
- `Phone Type`
- `Phone Number`
- `EXT #`
- `Address Line 1`
- `Address Line 2`
- `City`
- `State`
- `Postal Code`
- `Country`
- `Status`
- `Notes`
- `Contact Name`
- `Contact Title`
- `Contact Email`
- `Contact Phone Type`
- `Contact Phone Number`
- `Contact EXT #`
- `Contact Notes`
- `Primary Contact`

Multiple rows with the same company name import as one vendor with multiple contacts. Duplicate contacts under the same vendor are detected by normalized contact name plus email when email exists, or normalized contact name plus phone number when no email exists.

Exports repeat vendor-level fields on each contact row. Vendors with no contacts export one row with blank contact fields.

Import summaries report vendors added, vendors updated, contacts added, contacts updated, duplicate contacts skipped, and warnings/errors.

## Contact History

Vendor contact changes are logged as:

- `vendor_contact_created`
- `vendor_contact_updated`
- `vendor_contact_deleted`
- `vendor_contact_restored`
- `vendor_import_contact_created`
- `vendor_import_contact_updated`

Delete history includes the reason note when provided. Email copy actions are not logged.
