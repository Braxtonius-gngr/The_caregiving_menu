/* Deployment config. Leave SUPABASE_URL empty to run fully local (IndexedDB only).
 * Values here are public (the publishable key is meant for browsers); RLS protects the data.
 * Built in so a fresh install (including an iPhone home-screen app, which can't see what a
 * setup link saved in Safari) is already connected. New sign-ups are closed on the project:
 * family accounts are added in Supabase (Authentication > Users > Add user). */
var TCM_CONFIG = {
  SUPABASE_URL: 'https://qyphdwcjzhgobsfpeonh.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_rUjzqD7lWCbZ8_mFR28UJA_UkfKYaHv',
  APP_VERSION: '0.1.0'
};
