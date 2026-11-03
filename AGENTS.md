# AGENTS.md

Conventions for anyone (human or agent) changing this repo.

## Shape of the app

- **Build-free static PWA.** Deployed as-is, including under GitHub Pages subpaths, so keep every local URL relative. No bundler, no framework, nothing to `npm install` for the app.
- **Runtime dependencies:** `supabase-js` from a pinned CDN `<script>`, and ZXing (pinned) lazy-loaded by `scanner.js` only on browsers without a native `BarcodeDetector`. The service worker caches both. The app must keep working when either fails to load.
- **Classic scripts, global functions, inline `onclick` handlers.** Load order in `index.html` matters: `config → units → db → logic → sync → scanner → ui → simple → app`.
- **Two-space indentation, semicolons, `var`/function style** to match the existing files.

## Where things live

| File | Owns |
|---|---|
| `assets/js/units.js` | Unit conversion, ingredient-line parsing, name normalisation. Pure. |
| `assets/js/logic.js` | Coverage, nutrition, profile fit, restock math. Pure, unit-tested. |
| `assets/js/db.js` | IndexedDB stores and the sync outbox. |
| `assets/js/sync.js` | Supabase auth, push/pull, photo upload/download, Edge Function calls. |
| `assets/js/scanner.js` | Camera barcode scanning (native detector or ZXing). |
| `assets/js/ui.js` | Every screen and sheet. |
| `assets/js/simple.js` | The large-text simple view for one person, locked on a device. |
| `assets/js/app.js` | Boot, data loading, write actions, sample data. |
| `supabase/migrations` | Schema and RLS. Every synced table needs `id`, `household_id`, `updated_at`, `deleted`. |
| `supabase/functions/brain` | All Claude calls, one JSON schema per mode. |
| `supabase/functions/lookup` | Open Food Facts and USDA lookups. |

## Rules of thumb

- Local IndexedDB is the source of truth. Every write goes through `DB.put`, which queues it for sync. Deletes are soft (`deleted: true`).
- A new field on a synced record needs a matching column in a new migration, or the upsert fails.
- New script files must be added to the `SHELL` list in `sw.js`; `npm run check` enforces this.
- Keep AI behind the Edge Function. Never put an API key in the client.
- Health features are decision support. Keep the "bring this to her doctor" framing.

## Before finishing

Run `npm test`. It checks syntax, local references, that inline handlers resolve to globals, and runs the logic tests.
