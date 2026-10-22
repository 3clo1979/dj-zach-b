# Private Studio photo

The frame stores **one original JPEG or PNG, at most 1,000,000 bytes**, in the new `studio_photo` table in the existing Cloudflare D1 database. It does not use R2, add a paid service, place image bytes in source control, or expose a public static URL. Only an authenticated, allowlisted Studio manager can read, upload, replace, or remove it through `/api/manage/studio-photo`.

## Deployment and permission boundary

- `drizzle/0003_private_studio_photo.sql` adds one empty table. It contains no image or customer records and does not modify the existing inquiry, event, testimonial, or audit tables.
- Deploying the feature/schema does **not** upload a photo. Upload is a separate explicit owner action in Studio Settings. Any assistant-managed live upload requires the user's storage authorization first.
- The browser shows a local preview before the explicit **Save original photo to Studio** action. No automatic resize, crop, metadata stripping, AI editing, or transcode is performed. Original metadata is retained as part of the unchanged file.
- Photo GET responses recheck the existing signed Cloudflare Access token and manager allowlist every time. They are `private, no-store`, `nosniff`, and `Cross-Origin-Resource-Policy: same-origin`. The image is loaded into a short-lived browser blob URL, revoked when replaced/unmounted or a refresh fails.
- Upload and removal require the exact `Origin`, manager authentication, and the current version token. Conditional writes reject stale replacements/removals with 409, so another session's change is not silently overwritten. Network failures must be reconciled by reloading, not automatic mutation retry.
- Only bounded JPEG/PNG uploads are accepted. Content type, file signatures, basic container structure, and image dimensions are checked. This is not a full server-side image decoder or antivirus scanner. The browser must successfully display the local preview before the UI offers Save. SVG/HTML are not accepted.
- Removing a photo deletes the active row, not historical database backups. D1 Time Travel normally retains history for 7 days on Free or 30 days on Paid; account-level access/backups remain governed by Cloudflare and the account owner.

## Capacity rationale

Cloudflare documents a 2,000,000-byte maximum BLOB/row. The 1,000,000-byte application limit leaves room for metadata and avoids a new storage product for a single small frame. Oversized originals are rejected rather than silently modified; any derivative or alternate storage needs a separate decision.

Official documentation checked 2026-10-22:

- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [D1 Worker binding types and BLOB conversion](https://developers.cloudflare.com/d1/worker-api/)

## Local verification

`node scripts/verify-studio-photo.cjs` uses in-memory SQLite and the real route/helper modules. `node scripts/verify-studio-photo-ui.cjs` checks the component's upload/preview, repeated-click, cancellation, expiry, recovery, and object-URL cleanup behavior. Neither reads a real family photo, writes production D1, or makes network requests. The existing Access signature suite separately verifies JWT cryptography. Run both along with the full repo tests, typecheck, and build before deployment.

UI integration: `import StudioPhoto from './studio-photo'`; render `<StudioPhoto />` in the header and `<StudioPhoto editable />` in Settings. Both refresh on the same-window `studio-photo-changed` event after a successful mutation. CSS hooks: `studio-photo-frame`, `has-photo`, `studio-photo-placeholder`, `studio-photo-settings`, `studio-photo-storage`, `studio-photo-picker`, `studio-photo-preview`, `studio-photo-actions`. Style images with `object-fit: contain` to display the original without cropping.
