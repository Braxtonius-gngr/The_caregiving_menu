# Pantry & Plate — design document

A phone-first, build-free PWA for one household. It turns photos, receipts,
barcodes and links into structured recipes and a live pantry, tells you what
you can cook right now, nudges restocks, offers variations, flags dishes
against a configurable diet profile (Memaw's), and keeps a photo food diary
with rough nutrition.

Working name only. Rename at will.

---

## 1. The one-sentence model

Everything in the app is one of five nouns:

| Noun | What it is | Where it comes from |
|---|---|---|
| **Ingredient** | A canonical thing ("yellow onion", "low-sodium soy sauce") with nutrition per 100 g and tags | Auto-created by intake, merged by you |
| **Recipe** | Title, steps, notes, photo, and a list of (ingredient, quantity, unit, optional) | Scanned card, URL, paste, or typed |
| **Pantry item** | An ingredient you currently have, with quantity, unit, location, expiry | Receipt scan, barcode, manual, or auto-decrement when you log a cooked dish |
| **Diet profile** | A named person + rules ("sodium ≤ 1500 mg/day", "avoid grapefruit", "soft textures") | You define; app suggests starter rule packs |
| **Diary entry** | A timestamp, what was eaten, optional photo, portion, estimated nutrition | Tap "I ate this" on a recipe, or snap a plate |

Every feature is a join between two of those. "What can I cook" is Recipe × Pantry.
"Restock" is Pantry × Diary history. "Memaw-safe" is Recipe × Diet profile.
"Daily values" is Diary × Diet profile. Keeping it to five nouns is what keeps
the search and the UI from sprawling.

---

## 2. Architecture

```
 phone / tablet / desktop browser
 ┌─────────────────────────────────────────────┐
 │  static PWA (vanilla JS, no build step)      │
 │  • IndexedDB cache = works offline           │
 │  • service worker = installable, cached UI   │
 │  • camera + file picker for scans            │
 │  • ZXing (CDN) for barcode decode on-device  │
 └───────────────┬─────────────────────────────┘
                 │ supabase-js (CDN)
 ┌───────────────▼─────────────────────────────┐
 │  Supabase project                           │
 │  • Auth (magic link, one household)         │
 │  • Postgres: the five nouns + join tables   │
 │  • Storage: recipe photos, receipt photos,  │
 │    diary photos (private bucket)            │
 │  • Edge Function  /brain  ──► Claude API    │
 │      modes: parse_recipe, parse_receipt,    │
 │             estimate_plate, variations,     │
 │             diet_swaps, canonicalize        │
 │  • Edge Function  /lookup ──► Open Food     │
 │      Facts (barcode) + USDA FoodData        │
 │      Central (generic nutrition)            │
 └─────────────────────────────────────────────┘
```

Why this split:

- **Static PWA**: same deploy story you already have (GitHub Pages, relative
  URLs). Nothing to install. Add to home screen on every device you carry.
- **Supabase**: you already use it. Auth, database, file storage, and a place
  to run server code, all in one free tier for a household.
- **Edge Function for Claude**: the API key never leaves the server. The
  function also enforces structured JSON output, so the client never has to
  parse prose.
- **Open Food Facts + USDA** as the nutrition floor: free, no key needed for
  OFF, a free key for USDA. Claude only estimates when those come up empty
  (homemade dishes, plate photos).

Runtime dependencies, all CDN `<script>` tags: supabase-js, ZXing-js (barcode).
Nothing else. Same conventions as Social-casino-bliss: classic scripts, two-space
indent, `npm run check` style syntax/reference checks.

---

## 3. Data model (Postgres, Row Level Security on `household_id`)

```
households        id, name
members           id, household_id, user_id, display_name

ingredients       id, household_id, name, aliases text[], category
                  (produce|dairy|meat|pantry|spice|frozen|bakery|drink|other),
                  default_unit, kcal_100g, protein_g, carbs_g, fat_g,
                  fiber_g, sodium_mg, sugar_g, potassium_mg,
                  nutrition_source (off|usda|claude|manual), upc

pantry_items      id, household_id, ingredient_id, qty, unit, location
                  (fridge|freezer|pantry|counter), opened_on, expires_on,
                  par_qty (restock threshold, nullable), updated_at

recipes           id, household_id, title, source_type
                  (photo|url|paste|manual), source_ref, servings,
                  prep_min, cook_min, cuisine, meal_type text[],
                  steps jsonb, notes, photo_path, rating, times_cooked,
                  last_cooked_on, kcal_per_serving (cached), fts tsvector

recipe_ingredients id, recipe_id, ingredient_id, qty, unit, prep_note,
                  optional bool, group_label ("sauce", "topping")

recipe_variations id, recipe_id, title, kind
                  (switch_up|diet_swap|leftover|seasonal), body jsonb
                  (diff against parent: swapped ingredients, changed steps),
                  for_profile_id (nullable), created_by (claude|member)

diet_profiles     id, household_id, person_name, notes,
                  daily_targets jsonb ({sodium_mg:1500, kcal:1800, ...})
profile_rules     id, profile_id, kind
                  (avoid_ingredient|limit_nutrient|texture|timing|interaction),
                  ingredient_id (nullable), nutrient, max_per_serving,
                  severity (hard|soft), reason, source
                  ("Dr. Patel 2026-10", "starter pack: low sodium")

diary_entries     id, household_id, member_id, for_profile_id (nullable),
                  eaten_at, recipe_id (nullable), free_text, portion_mult,
                  photo_path, kcal, protein_g, carbs_g, fat_g, sodium_mg,
                  fiber_g, sugar_g, estimate_source, confidence (0-1)

shopping_list     id, household_id, ingredient_id, qty, unit, reason
                  (missing_for_recipe|low_stock|manual), recipe_id, done

usage_log         id, household_id, ingredient_id, qty, unit, event
                  (cooked|logged|discarded|bought), at
intake_jobs       id, household_id, kind (photo|receipt|url|paste|barcode),
                  input_path_or_text, status, result jsonb, created_at
```

The `usage_log` is the quiet workhorse. Every cook, log, purchase and toss
writes a row. Restock suggestions and "most used" are just queries over it.

---

## 4. Intake: four inputs, one pipeline

All four scan types funnel into the same shape so the review screen is the
same screen every time.

```
 input ──► intake_job ──► /brain or /lookup ──► draft JSON ──► Review screen ──► commit
```

| Input | On-device step | Server step | Output |
|---|---|---|---|
| Recipe photo (card, cookbook page, handwritten) | Resize to ~1600 px, upload to Storage | Claude vision, mode `parse_recipe` | Draft Recipe + ingredient lines |
| Recipe URL | Fetch via Edge Function (CORS) | Try JSON-LD `Recipe` schema first (most sites have it, no AI needed). Fall back to Claude on the readable text | Draft Recipe |
| Pasted text / voice dictation | none | Claude `parse_recipe` | Draft Recipe |
| Receipt photo | Resize, upload | Claude vision, mode `parse_receipt`: returns line items with guessed ingredient, qty, unit, price | Draft Pantry additions |
| Barcode | ZXing decodes UPC in the browser | `/lookup` hits Open Food Facts for name + nutrition | Draft Pantry item (qty prompt) |

**Canonicalization** is the step that makes everything else work. Receipt says
"GV YEL ONION 3LB", recipe says "2 medium onions, diced". Both must resolve to
ingredient `yellow onion`. Approach:

1. Exact or alias match against your `ingredients` table (fast, local).
2. Else trigram similarity in Postgres (`pg_trgm`) above a threshold.
3. Else Claude `canonicalize` mode, given your existing ingredient list as
   context, returns either an existing id or a proposed new ingredient with
   category and a USDA search term.
4. Review screen shows the match with a one-tap "wrong, pick another".
   Corrections become aliases, so the same mistake never repeats.

**Review screen** (identical for all intake types): editable table of lines,
each with a confidence dot (green/amber/red from the model). Red lines are
pre-expanded. One "Save all" button. This is where the human stays in the
loop without it feeling like data entry.

---

## 5. Recipe × Pantry: "what can I cook right now"

For each recipe, compute on the client from the cached pantry:

```
coverage = (required ingredients in pantry with qty >= needed) / required
missing  = required ingredients not covered
nearly   = coverage >= 0.8
```

Unit conversion table lives client-side (cups↔ml, lb↔g, "1 medium onion" ≈
110 g, etc). Where qty is unknown ("some"), count as present if any exists.

Home screen sections, in order:

1. **Cook tonight**: coverage 100 %, sorted by least-recently-cooked.
2. **One trip away**: coverage ≥ 80 %, shows the 1–2 missing items with an
   "add to list" chip.
3. **Use it up**: recipes that consume pantry items expiring within 4 days.

Tapping "I cooked this" does three things: decrements pantry by recipe qty ×
servings-made, writes `usage_log` rows, and offers to create a diary entry.

---

## 6. Restock suggestions

Two signals, combined:

- **Par level**: if you set `par_qty` on a pantry item, suggest when below it.
  Good for staples you already know (eggs, coffee, Memaw's oatmeal).
- **Learned usage**: for every ingredient, compute uses-per-week over the last
  8 weeks with exponential decay (recent weeks weigh more). Projected days
  until out = current qty ÷ daily burn. Suggest when ≤ 5 days, or when qty is
  zero and the ingredient was used ≥ 3 times in the window.

Suggestions land in the shopping list with reason `low_stock` and a small
"why" line ("used 6× in 4 weeks, ~2 days left"). Dismissing a suggestion
snoozes it for 7 days. Accepting it, then scanning the receipt, closes the
loop automatically.

Shopping list is grouped by store aisle (the ingredient `category`) and can be
checked off offline in the store.

---

## 7. Variations and "switch it up"

On any recipe, a **Variations** tab with:

- **Saved variations** (yours or ones Claude made that you kept).
- **"Give me a take"** button with chips: *lighter*, *faster*, *use what I
  have*, *different cuisine*, *leftover remix*, *for Memaw*. Calls `/brain`
  mode `variations` with the recipe, current pantry summary, and the chosen
  angle. Returns 2–3 options, each as a diff (swap X for Y, change step 3,
  add Z), not a whole new recipe. Diffs are easier to read and cheaper to
  store.
- Keep / discard per option. Kept ones become `recipe_variations` rows and
  show up in search like recipes.

---

## 8. Diet profiles and Memaw mode

Memaw isn't on restrictions yet, so this is built as a **profile with rules
that start empty and a guidance layer**, not hardcoded medical logic.

**Profile setup**

- Name, optional notes ("sees cardiologist quarterly").
- Daily targets: leave blank or pick a starter pack. Starter packs are just
  pre-filled rule sets you can edit: *general heart-healthy* (sodium ≤ 2300 mg,
  saturated fat cap), *low sodium* (≤ 1500 mg), *prediabetes* (added sugar cap,
  carbs per meal), *soft / easy-chew*, *kidney-aware* (potassium, phosphorus).
  Each pack cites a public source (AHA, ADA, NKF) so you can read why.
- Rules can be `hard` (red banner, "avoid") or `soft` (amber, "watch").

**How it shows up everywhere**

- Recipe cards get a small profile badge: ✓ fine, ⚠ needs a swap, ✕ avoid.
  Computed client-side from `recipe_ingredients` × `profile_rules` × per-serving
  nutrition. No AI call needed for the badge.
- Tapping ⚠ opens the **Memaw swap sheet**: Claude mode `diet_swaps`, given
  the recipe and the active rules, proposes concrete changes ("replace soy
  sauce with low-sodium tamari and halve it; saves ~600 mg") with an estimated
  new nutrition line. Keep one and it's saved as a `diet_swap` variation tied
  to her profile, so next time the badge shows ✓ with a "(her version)" tag.
- Diary entries can be tagged `for_profile_id`, so her daily sodium / sugar /
  kcal rolls up separately from yours.

**Guidance layer** (the "moving towards it" part)

- A **Notes & questions** page on the profile: a running list the app helps
  you build before appointments ("Her sodium averaged 2800 mg/day this month;
  ask about a target"). Claude can draft the summary from the diary data.
- Weekly digest card: what she ate most, which rules were hit, three dishes
  that already comply and she liked.
- Always framed as "bring this to her doctor", never as diagnosis. Rules have
  a `source` field precisely so you can record "Dr. X said" vs "starter pack".

---

## 9. Food diary and nutrition estimates

**Logging paths, fastest first**

1. "I ate this" on a recipe → portion slider (½, 1, 1½, 2) → done. Nutrition
   comes from the recipe's cached per-serving numbers.
2. Snap a plate → Claude mode `estimate_plate` returns a list of guessed foods
   with portion and nutrition, plus a confidence. You can correct one line and
   the rest recompute.
3. Type it ("two eggs and toast") → same mode, text only.
4. Barcode on a packaged snack → OFF nutrition × servings.

**Nutrition sourcing order**: manual override → Open Food Facts (packaged) →
USDA FoodData Central (generic ingredients) → Claude estimate (flagged with a
confidence dot). Recipe per-serving numbers are summed from ingredients, so
scanning a recipe card gives you a kcal estimate immediately, with a badge
showing how many ingredient lines are estimated vs looked-up.

**Daily view**: per person, a stacked bar of kcal and a row of % Daily Value
chips (sodium, fiber, protein, added sugar, potassium, sat fat). Targets come
from the person's profile, or FDA defaults if none. The chips are the
"decision-making assist": at 4 pm you can see "sodium 70 % used, fiber 30 %"
and pick dinner accordingly. The home screen's *Cook tonight* list can sort by
"best fit for the rest of today".

Photos go to a private Storage bucket; the diary grid shows thumbnails, tap to
see the entry.

---

## 10. Search and browse

One search box, one index, three facet rails.

- **Index**: Postgres full-text (`fts` column) over recipe title, ingredient
  names, aliases, cuisine, notes, variation titles. Mirrored into IndexedDB
  with a simple token index so search works offline.
- **Facets** (chips under the box, multi-select):
  - *By grocery*: ingredient category, or a specific ingredient ("everything
    with chickpeas").
  - *By food*: cuisine, meal type, time (< 30 min), rating, "cooked recently".
  - *By fit*: can cook now, one trip away, ✓ for Memaw, uses expiring items.
- **Pantry view** has the same box, searching pantry items by name, location,
  expiring soon, low stock.
- Typing an ingredient you don't have shows "0 recipes you can make, 7 if you
  buy it", with an add-to-list chip. That's the "correspond dish ingredients
  versus current grocery" view inverted, and it's the most useful one.

---

## 11. Screens (bottom tab bar, five tabs)

| Tab | Content |
|---|---|
| **Home** | Cook tonight / One trip away / Use it up, plus today's DV chips per person |
| **Recipes** | Search + facets, grid of cards with coverage ring and profile badge; detail has Ingredients (with have/need marks), Steps, Variations, Nutrition, Notes |
| **Pantry** | By location, expiring soon rail, low stock rail, search; tap item to adjust qty with ± buttons |
| **Scan** (center, big) | Four buttons: Recipe photo, Receipt, Barcode, Link/Paste → Review screen |
| **Diary** | Day strip, entries with thumbnails, per-person toggle, weekly digest, profile notes |

Settings (gear): household members, diet profiles & rules, units (US/metric),
stores/aisles, export (CSV/JSON of everything, because it's your data).

Design language: large tap targets, one accent color per person (so Memaw's
badge and diary rows are always the same color), dark mode by default on
phones, light on tablet in the kitchen. Everything editable inline. No modal
pile-ups.

---

## 12. Build order

Each phase is usable on its own.

| Phase | Scope | Rough effort |
|---|---|---|
| **0. Skeleton** | Repo, PWA shell, Supabase schema + RLS, auth, IndexedDB sync, five tabs with real data, manual recipe/pantry entry, search | 1 week |
| **1. Intake** | `/brain` function with `parse_recipe` + `parse_receipt` + `canonicalize`, Review screen, URL import (JSON-LD first), barcode via ZXing + `/lookup` | 1 week |
| **2. Kitchen logic** | Coverage, Cook tonight / One trip / Use it up, "I cooked this" decrement, shopping list, restock suggestions | 3–4 days |
| **3. Diary + nutrition** | USDA lookup, recipe per-serving nutrition, diary entry paths incl. plate photo, DV chips | 4–5 days |
| **4. Profiles + variations** | Diet profiles, rules, starter packs, badges, `diet_swaps`, `variations` tab, weekly digest and appointment notes | 4–5 days |
| **5. Polish** | Offline hardening, photo compression, export, aisle ordering, share-to-app (Android share target for URLs) | ongoing |

Phases 0–2 alone already answer "what can I make and what do I need to buy",
which is the daily-use core.

---

## 13. Costs, for one household

- Supabase free tier: fine for years of this (500 MB DB, 1 GB storage; compress
  photos to ~200 KB).
- Open Food Facts: free. USDA FoodData Central: free API key.
- Claude via Edge Function: a recipe card scan with vision is roughly a few
  cents; receipts similar; text-only calls are fractions of a cent. A busy
  month of scanning and variations should land in low single-digit dollars.
  The function should cache by image hash so a re-scan is free.

---

## 14. Decisions I made that you can overrule

- **Vanilla JS, no framework**, matching your existing repo so the two
  projects feel the same to maintain. If you'd rather, the same design maps
  cleanly onto a tiny framework later; the data model doesn't change.
- **Diffs for variations**, not full recipe copies. Cheaper and clearer, but
  means the UI has to render "parent + diff".
- **Client-side coverage and badges**, server-side only for AI and lookups.
  Keeps the app snappy and offline-capable.
- **One household, multiple members, multiple profiles.** A member is a login;
  a profile is a person's diet. Memaw can be a profile without ever logging in.
- **No medical claims anywhere.** Rules carry a `source`; starter packs cite
  public guidelines; digests say "bring to her doctor".

## 15. Open questions, none blocking

1. Does Memaw cook from this too (bigger text, simpler Home tab as a mode)?
2. Which stores, so aisle ordering can be preset?
3. Should receipts also track price, for a "cost per serving" number later?
   The schema has a slot for it; the UI doesn't yet.
