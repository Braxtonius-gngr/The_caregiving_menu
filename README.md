# The Caregiving Menu

A phone-first kitchen app for one household. It keeps your recipes and pantry in one place, tells you what you can cook right now, nudges you to restock the things you use most, and keeps a food diary with rough nutrition. Diet profiles (for example, Memaw's) flag dishes that need a tweak and suggest swaps to bring to her doctor.

It is a build-free static PWA: open `index.html` from any static host (GitHub Pages works) and add it to your home screen. Everything works offline on the device. Cloud sync and AI scanning switch on once Supabase is configured.

The full design lives in [docs/design.md](docs/design.md).

## What works today

| Area | Offline | With cloud |
|---|---|---|
| Recipes: add, edit, search, filter by fit / meal / grocery type | yes | synced |
| Recipe photos (kept from a scanned card, or added by hand) | kept on the device | uploaded to the private bucket and shared across devices |
| "Cook tonight", "One trip away", "Use it up" | yes | |
| "I cooked this" subtracts from the pantry | yes | |
| Shopping list in your store's aisle order (set in Settings), shareable to texts or notes; checking an item adds it to the pantry | yes | |
| Restock suggestions from par levels and recent usage | yes | |
| Diet profiles, rules, starter packs, ✓ ⚠ ✕ badges | yes | |
| Food diary with daily-value bars: log for whoever is eating (add people on the spot), set when they ate, take or pick a photo | yes | synced |
| Calorie estimate from typed ingredients and amounts (when they are all in the pantry with nutrition) | yes | otherwise Claude estimates from ingredients, portion size and photo |
| Appointment summary for a person over 7, 14 or 30 days, to share or copy | plain summary | Claude drafts a brief with questions to ask |
| Simple view: a large-text screen for one person, locked on their device | yes | |
| Share to the app from other Android apps: links, text, or a photo of a recipe, receipt or meal | links prefill; meal photos log to the diary | links and recipe/receipt photos are read by Claude |
| Diary photos | kept on the device | uploaded to a private bucket, visible on every household device, and cached for offline viewing |
| Paste a recipe as text | basic parser | Claude parses it |
| Recipe photo, receipt photo, recipe URL | | Claude parses it |
| Groceries photo (fridge, shelf, bags; live or up to 6 saved) adds items to the pantry after review | | Claude lists the items |
| Batch import of saved recipe photos: cut-off pages are matched and read together, unsure results are flagged to check | | Claude parses it |
| Camera barcode scanning, with "Add & scan next" for unpacking groceries | scans offline; looks up new products on Open Food Facts when online | lookup runs through the cloud function |
| Ingredient nutrition lookup | | USDA FoodData Central |
| Variations and diet swaps | | Claude |

Try it without any setup: **Settings → Load sample data**.

## Turning on the cloud (about 15 minutes)

1. Create a free project at supabase.com, and run `npx supabase login` once on your computer.
2. From this folder, run:

   ```sh
   scripts/setup-supabase.sh <project-ref>
   ```

   It creates the tables, privacy rules and photo bucket, deploys the two cloud functions, and stores your Anthropic key (and optional free USDA key) as project secrets. Add `--dry-run` to see the steps first.
3. In the Supabase dashboard, under Authentication > URL Configuration, set the Site URL to where the app lives and add it to the Redirect URLs.
4. Open the app, go to **Settings > Cloud sync**, paste the project URL and the anon (public) key, then sign in with the emailed link.
5. Still in Settings, tap **Copy setup link for another device** and send it to family. Opening it on their phone connects the app, and once they sign in it joins your household. No codes to type.

The anon key is meant to be public; row-level security keeps each household's data private. The AI function uses Claude Opus 5.5 (`CLAUDE_MODEL` overrides it) with Anthropic's server-side refusal fallback, and only signed-in household members can call it.

## Publishing the app (GitHub Pages)

`.github/workflows/pages.yml` publishes the app on every push to `main`. Turn it on once under the repo's **Settings > Pages > Source: GitHub Actions**. The app then lives at `https://<you>.github.io/<repo>/`. Use that address for the Site URL in step 3 above.

## Backups

**Settings > Export JSON** saves everything, photos included, to one file. **Restore from backup** merges a file back in. A backup from another household is restored under fresh ids, so it never collides with that household's data.

## Setting up a device for the person you care for

1. Open the app on their phone or tablet and add it to the home screen.
2. Sign in with your household (Settings), so it shares your recipes and diary.
3. In Settings, under their profile, tap **Simple view on this device**.

The device then opens straight to their large-text screen: today's key numbers in plain words, dishes that fit their rules with a one-tap "I ate this" (with Undo), and "I ate something else". **Exit simple view** at the bottom asks for confirmation before showing the full app again.

## Development

No build step and nothing to install for the app. Serve the folder with any static server:

```sh
python3 -m http.server 8000
npm test   # syntax, references, inline handlers, and logic unit tests
```

The same `npm test`, plus a type-check of the cloud functions, runs on every pull request (`.github/workflows/test.yml`). Tests against a real Supabase stack live in [tests/](tests/README.md).

See [AGENTS.md](AGENTS.md) for conventions.

## A note on health features

Diet rules, badges, starter packs and swap suggestions are decision support built on public guidelines (AHA, ADA, NKF) and rough nutrition estimates. They are not medical advice. Each rule records its source so you can tell "starter pack" from "her doctor said".
