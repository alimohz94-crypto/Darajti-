<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/6feb3e75-36b3-4539-a4e0-889ca00d27e7

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

`npm run preview` rebuilds in `local-preview` mode, overrides
`VITE_API_BASE_URL` with `http://127.0.0.1:3000`, and binds the preview server
to `127.0.0.1`. It does not preview the production API configuration.

## Supabase

Set these server-only environment variables:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` is accepted only as a legacy server-side alias.

Express uses Supabase for catalog, listings, search, reports, notifications,
admin sessions and PIN hashes, authentication rate limits, audit logs, visits,
and anonymous device favorites. The frontend and Android app call Express; they
must not contain the Supabase secret or connect directly to Supabase.

Image and video upload routes keep a local copy and write to private
`darajati-images` and `darajati-videos` Storage buckets when Storage writes are
enabled. The existing `/uploads/...` URLs remain served through Express
authorization, with local files as fallback. Bucket SQL and Storage policy
checks are local migration files only; they have not been applied to Supabase.
Set `MEDIA_STORAGE_READ_ENABLED=false` and
`MEDIA_STORAGE_WRITE_ENABLED=false` for local-only media rollback.

The SQLite transfer plan excludes demo listings and dependent records, imports
administrative and analytics tables, and preserves IDs before synchronizing
sequences. `admin_users` is retained as a legacy credential table; current
Express authentication uses the server-only PIN hash in `admin_settings`.
Existing device favorites are imported per installation on its first successful
server synchronization. Do not run SQL or the transfer script against a live
project until schema, Storage policies, backups, and the cutover plan have been
reviewed and approved separately.
