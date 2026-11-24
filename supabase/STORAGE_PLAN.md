# Darajati media Storage plan

This plan and its companion SQL are local preparation only. No buckets or
policies have been created, no files have been uploaded, and the Supabase
project has not been contacted.

## Buckets and access

| Bucket | Visibility | Limit | Accepted content |
|---|---|---:|---|
| `darajati-images` | Private | 8 MiB per object | JPEG, PNG, WebP |
| `darajati-videos` | Private | 35 MiB per object | MP4, WebM, MOV |

Do not grant `anon` or `authenticated` direct `SELECT`, `INSERT`, `UPDATE`, or
`DELETE` access on `storage.objects`. The app uses its existing Express
authorization model (admin session/CSRF, owner token or owner media grant), so
Storage access must remain server-mediated with the server-only Supabase key.
Do not create public URLs or expose signed URLs to the browser. The Express
`/uploads/:kind/:filename` URL remains the compatibility layer and returns a
file only after checking whether it is public, admin-authorized, or owner-
authorized. The existing public/private cache headers remain part of that
authorization decision.

## Existing media routes and URL compatibility

- `POST /api/upload/images` and `POST /api/upload/video` write a local copy,
  enforce same-origin/rate/size/MIME/magic-byte checks, upload to the private
  bucket when `MEDIA_STORAGE_WRITE_ENABLED` is true, and save ownership
  metadata in `media_assets`.
- `GET /uploads/:kind/:filename` is the authorization gateway. Public media is
  limited to active public catalog references or an actually referenced image
  or video on an approved/sold, visible, non-demo listing. Pending, rejected,
  hidden, demo, and unattached uploads remain private to the admin or verified
  owner.
- There is no media-delete endpoint. Deleting a listing or removing a reference
  must not delete its object during this migration. Unreferenced files belong
  in the report for separate review.
- The compatibility GET route checks authorization before reading either
  source. It prefers the private Storage object, falls back to the local file
  when the object is missing or Storage is unavailable, returns 404 when both
  are missing, and returns 503 when Storage is unavailable and no local copy
  exists. A Storage failure with a local fallback is logged server-side.
- Server-only read and upload repositories are implemented, but they do not
  provision buckets or policies. Tests inject local mocks and do not call the
  Supabase project.
- To roll back to local-only reads without deploying older code, set the
  server-only `MEDIA_STORAGE_READ_ENABLED=false` and
  `MEDIA_STORAGE_WRITE_ENABLED=false`; the old URLs and local files remain
  unchanged. These switches do not roll back database writes.
- Images and videos are served with an extension-validated `Content-Type`,
  revalidated public responses or private `no-store` headers, and byte-range
  responses for video playback. The service worker does not cache mutable
  `/uploads/...` responses, so a visibility change is checked on the next
  request. Unsupported kind/extension combinations are rejected.

Use the existing URL as the compatibility key:

| Old local path / served URL | Private bucket | Object key |
|---|---|---|
| `uploads/images/<filename>` / `/uploads/images/<filename>` | `darajati-images` | `<filename>` |
| `uploads/videos/<filename>` / `/uploads/videos/<filename>` | `darajati-videos` | `<filename>` |

Express maps the old URL to the bucket and object key; do not rewrite listing,
category, or slider URLs during the first cutover. `/src/assets/images/...`
files are bundled static assets and are not upload candidates.

## No-loss transfer sequence

1. Keep the local `uploads/images` and `uploads/videos` files in place. Pause
   uploads only during a separately approved cutover window.
2. Run `node scripts/media-storage-plan.mjs --inventory` and retain the output
   as the source manifest (object path, byte size, SHA-256).
3. Generate a reference report using `createMediaReferenceReport`. It maps
   each listing ID and each catalog/media-metadata reference to its legacy URL,
   local path, new bucket/object path, and stable served URL. Review missing
   local files and unreferenced files before upload.
4. The prepared `runResumableMediaTransfer` function requires an injected
   storage adapter; no Supabase adapter or Supabase client is included. The
   adapter contract is `exists`, create-only `uploadCreateOnly`, and
   `downloadToFile`. The function:
   - hashes every source file and rechecks it immediately before upload;
   - writes an atomic checkpoint outside the source directory, protected by a
     lock file, and refuses changed source/reference manifests on resume;
   - downloads and compares size and SHA-256 after upload;
   - verifies an existing object and skips it when it matches, never silently
     overwriting a mismatched object;
   - keeps every source file in place.
5. Before switching Express, reconcile the report with all `media_assets`,
   listing image/video fields, category images, and slider images. Require
   matching source/destination manifests and no missing or changed objects.
6. Only after separate approval, apply
   `supabase/migrations/20261124000000_darajati_private_media_buckets.sql`.
   It fails closed if any `anon`, `authenticated`, or `public` policy exists on
   `storage.objects`; this includes policies for unrelated buckets, which must
   be reviewed manually before proceeding. Confirm service-role access and
   private-object behavior in a staging project before enabling either media
   switch in production. Express then serves Storage objects behind the
   existing authorization checks while retaining the local fallback. No local
   or remote object deletion is part of this transfer.

## Local-only verification

`npm test` exercises the transfer using generated temporary files and a local
filesystem adapter. It simulates interruption after upload, verifies resume
does not upload twice, checks changed/mismatched content, and confirms the
source remains intact. Media delivery tests inject a fake Storage repository
and temporary local files. They do not call the Supabase project. The local
preview command rebuilds with a loopback API base and binds to loopback rather
than using `.env.production`.

Inventory and `--verify` modes are read-only and reject symlinks or unsupported
extensions rather than silently skipping them. The resumable transfer writes
only to the injected destination and its checkpoint; it never writes to the
source media root.
