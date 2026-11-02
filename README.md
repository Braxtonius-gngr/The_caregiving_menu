# The Caregiving Menu

A phone-first kitchen app for one household. It keeps your recipes and pantry in one place, tells you what you can cook right now, nudges you to restock the things you use most, and keeps a food diary with rough nutrition. Diet profiles (for example, Memaw's) flag dishes that need a tweak and suggest swaps to bring to her doctor.

It is a build-free static PWA: open `index.html` from any static host (GitHub Pages works) and add it to your home screen. Everything works offline on the device. Cloud sync and AI scanning switch on once Supabase is configured.

The full design lives in [docs/design.md](docs/design.md).

## What works today

| Area | Offline | With cloud |
|---|---|---|
| Recipes: add, edit, search, filter by fit / meal / grocery type | yes | synced |
| "Cook tonight", "One trip away", "Use it up" | yes | |
| "I cooked this" subtracts from the pantry | yes | |
| Shopping list grouped by aisle; checking an item adds it to the pantry | yes | |
| Restock suggestions from par levels and recent usage | yes | |
| Diet profiles, rules, starter packs, ✓ ⚠ ✕ badges | yes | |
| Food diary with photos and daily-value bars, weekly digest | yes | |
| Paste a recipe as text | basic parser | Claude parses it |
| Recipe photo, receipt photo, recipe URL | | Claude parses it |
| Barcode lookup (type the UPC for now) | | Open Food Facts |
| Ingredient nutrition lookup | | USDA FoodData Central |
| Variations and diet swaps | | Claude |

Try it without any setup: **Settings → Load sample data**.

## Turning on the cloud (about 15 minutes)

1. Create a free project at supabase.com.
2. In the SQL editor, run `supabase/migrations/0001_init.sql`. It creates the tables, row-level security, invite codes and a private photo bucket.
3. Install the Supabase CLI, then deploy the functions and set the secrets:

   ```sh
   supabase link --project-ref YOUR_REF
   supabase functions deploy brain
   supabase functions deploy lookup --no-verify-jwt
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   supabase secrets set USDA_API_KEY=...        # free at fdc.nal.usda.gov; optional
   ```

4. Put your project URL and anon key into `assets/js/config.js`. The anon key is meant to be public; row-level security protects the data.
5. In Supabase Auth settings, add your site URL (for example your GitHub Pages URL) to the redirect allow-list.
6. Open the app, go to Settings, and sign in with the emailed link. Family members sign in on their own devices and join with your household invite code.

The AI function uses Claude Opus 5.5 by default (`CLAUDE_MODEL` secret overrides it) and turns on Anthropic's server-side fallback, so a request a safety filter declines is retried on a recommended model instead of failing. Only signed-in household members can call it.

## Development

No build step and nothing to install for the app. Serve the folder with any static server:

```sh
python3 -m http.server 8000
npm test   # syntax, references, inline handlers, and logic unit tests
```

See [AGENTS.md](AGENTS.md) for conventions.

## A note on health features

Diet rules, badges, starter packs and swap suggestions are decision support built on public guidelines (AHA, ADA, NKF) and rough nutrition estimates. They are not medical advice. Each rule records its source so you can tell "starter pack" from "her doctor said".
