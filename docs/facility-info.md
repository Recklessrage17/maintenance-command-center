# Facility Info

Facility Info is the MCC searchable facility folder and media library. It reuses the shared MCC authentication, Tier 3+ write rules, history logs, backup/restore pipeline, recovery ZIP conventions, glass cards, summary tokens, resource rows, responsive toolbar, overflow menu, and file-type icons.

## Storage

Metadata is stored in the MCC SQLite database:

- `facility_areas`
- `facility_folders`
- `facility_items`

Original files are never stored as database BLOBs. Physical files use UUID names under:

`backend/uploads/facility-info/facility-<internalId>/files/`

Each Facility directory has `facility-info.json`. Global recovery indexes are:

- `facility-info-index.json`
- `facility-info-index.csv`

Manifests map UUID filenames to visible originals and include SHA-256 checksums. Readable exports use Facility names, nested folder names, and visible filenames.

Images use authenticated browser-native decoding for safe thumbnails and the full-screen viewer. Videos are served from the backend as streams with HTTP `Accept-Ranges`, `Range`, `Content-Range`, and `206 Partial Content` support. MCC does not transcode video; unsupported codecs retain a Download Original path.

## Upload configuration

Defaults:

- `MCC_FACILITY_DOCUMENT_MAX_MB=50`
- `MCC_FACILITY_PICTURE_MAX_MB=50`
- `MCC_FACILITY_VIDEO_MAX_MB=500`

The frontend displays these server values. The backend remains authoritative and validates size, extension, MIME type, signature, safe filename, Facility/folder ownership, and authorization.

Supported types:

- Documents: PDF, DOC, DOCX, XLS, XLSX, TXT
- Pictures: JPG, JPEG, PNG, WEBP
- Videos: MP4, WEBM

MOV is rejected because browser codec support cannot be reliably established from the container alone.

## API route groups

- `/api/facility-info`
- `/api/facility-info/permissions`
- `/api/facility-info/search`
- `/api/facility-info/areas/:areaId`
- `/api/facility-info/areas/:areaId/folders`
- `/api/facility-info/areas/:areaId/folders/:folderId/items`
- `/api/facility-info/items/:itemId`
- `/api/facility-info/items/:itemId/move`
- `/api/facility-info/items/:itemId/content`
- `/api/facility-info/items/:itemId/download`
- `/api/facility-info/areas/:areaId/export`
- `/api/facility-info/recovery-export`

All reads require authenticated Facility Info access. Writes require Maintenance Tech 3, Manager, Admin, or Owner Admin. Full recovery export requires Manager, Admin, or Owner Admin.
