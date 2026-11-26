/* Deployment config. Leave SUPABASE_URL empty to run fully local (IndexedDB only).
 * Values here are public (anon key is meant for browsers); RLS protects the data. */
// The app's own Supabase project since 2026-11-25. Devices and links still pointing at the old
// shared project (MOVED_FROM) are switched here automatically (see Sync.config).
var TCM_CONFIG = {
  MOVED_FROM: ['qyphdwcjzhgobsfpeonh.supabase.co'],
  SUPABASE_URL: 'https://qhfjbdtakeagwtnhqmzk.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFoZmpiZHRha2VhZ3d0bmhxbXprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU1ODIxODEsImV4cCI6MjExMTE1ODE4MX0.hZzN0s470duHbheNvJT1QY0Oj1L7PdrVgPt1buYuJ9w',
  GOOGLE_SIGNIN: false, // turn on once the Google provider is set up in Supabase
  TURNSTILE_SITE_KEY: '', // Cloudflare Turnstile (public site key); empty = no bot check yet
  APP_VERSION: '0.12.0'
};
