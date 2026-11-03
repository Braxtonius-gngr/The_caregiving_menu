# Live tests

These run the app and the cloud functions against a **real Supabase stack**: auth,
PostgREST, row-level security and Storage. `npm test` in the repo root does not need any of
this; it runs the fast checks and unit tests.

## Against a local stack (Docker)

```sh
npx supabase start          # from the repo root; applies supabase/migrations
cd tests && npm install
npm run live                # the app: sync, photos, sharing, privacy, setup links, restore
npm run functions           # brain + lookup on Deno (needs Deno installed)
```

If Docker cannot reach `public.ecr.aws`, prefix `supabase start` with
`SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`.

## Against a hosted project

Use a throwaway project, never the one with your family's data: the tests create users.

```sh
API_URL=https://<ref>.supabase.co ANON_KEY=... SERVICE_ROLE_KEY=... npm run live
```

`functions.test.js` replaces Claude, Open Food Facts and USDA with fakes (see `harness.ts`),
so it never spends API credit. It checks the exact request each mode would send to Claude.
