/* Boot, data loading, and the write actions shared across screens. */
function loadAll() {
  return Promise.all([
    DB.all('ingredients'), DB.all('recipes'), DB.all('recipe_ingredients'), DB.all('recipe_variations'),
    DB.all('pantry_items'), DB.all('diet_profiles'), DB.all('profile_rules'), DB.all('diary_entries'),
    DB.all('shopping_list'), DB.all('usage_log')
  ]).then(function (r) {
    State.ingredients = r[0]; State.recipes = r[1]; State.lines = r[2]; State.variations = r[3];
    State.pantry = r[4].filter(function (p) { return p.qty > 0; }); State.profiles = r[5]; State.rules = r[6];
    State.diary = r[7]; State.shopping = r[8]; State.usage = r[9];
    if (State.activeProfile && !State.profiles.some(function (p) { return p.id === State.activeProfile; })) State.activeProfile = null;
    rebuildIndexes();
  });
}

var CATEGORY_HINTS = {
  produce: /onion|garlic|tomato|potato|carrot|celery|lettuce|spinach|pepper|apple|banana|lemon|lime|berry|herb|parsley|cilantro|basil|broccoli|squash|zucchini|cabbage|kale|mushroom|ginger|avocado|cucumber|corn|pea|bean sprout/,
  dairy: /milk|butter|cheese|yogurt|cream|egg|sour cream/,
  meat: /chicken|beef|pork|turkey|sausage|bacon|ham|fish|salmon|tuna|shrimp|lamb/,
  spice: /salt|pepper flake|paprika|cumin|oregano|thyme|cinnamon|nutmeg|chili powder|garlic powder|onion powder|bay leaf|seasoning|vanilla/,
  frozen: /frozen|ice cream/,
  bakery: /bread|bun|roll|tortilla|bagel/,
  drink: /juice|coffee|tea|soda|water/
};
function guessCategory(name) {
  var n = name.toLowerCase();
  if (/black pepper/.test(n)) return 'spice';
  for (var k in CATEGORY_HINTS) if (CATEGORY_HINTS[k].test(n)) return k;
  return 'pantry';
}

// Find or create the canonical ingredient. Creating adds the raw name as an alias source.
function ensureIngredient(name, nutrition, upc) {
  var found = Logic.ingredientMatch(name, State.ingredients);
  if (found) return Promise.resolve(found);
  var clean = name.trim().toLowerCase();
  var rec = Object.assign({ name: clean, aliases: [], category: guessCategory(clean), upc: upc || null, nutrition_source: nutrition ? 'off' : null }, nutrition || {});
  return DB.put('ingredients', rec).then(function (r) { State.ingredients.push(r); S.ingById[r.id] = r; return r; });
}

function addToPantry(ingredientId, qty, unit, location, event, extra) {
  var existing = (S.pantryByIng[ingredientId] || []).find(function (p) { return (p.unit || '') === (unit || '') && p.location === location; });
  var rec = existing || { ingredient_id: ingredientId, qty: 0, unit: unit, location: location || 'pantry' };
  rec.qty = (rec.qty || 0) + (qty || 0);
  if (extra) { if (extra.expires_on) rec.expires_on = extra.expires_on; if (extra.par_qty != null) rec.par_qty = extra.par_qty; }
  var open = State.shopping.filter(function (s) { return s.ingredient_id === ingredientId && !s.done; });
  return DB.put('pantry_items', rec).then(function (r) {
    if (!existing) { State.pantry.push(r); (S.pantryByIng[ingredientId] = S.pantryByIng[ingredientId] || []).push(r); }
    var writes = [DB.put('usage_log', { ingredient_id: ingredientId, qty: qty, unit: unit, event: event || 'bought', at: new Date().toISOString() })];
    if (event === 'bought') open.forEach(function (s) { s.done = true; writes.push(DB.put('shopping_list', s)); });
    return Promise.all(writes).then(function () { return r; });
  });
}

// Replaces the recipe's ingredient lines with the parsed ones.
function saveRecipeWithLines(rec, parsed) {
  return DB.put('recipes', rec).then(function (saved) {
    var old = State.lines.filter(function (l) { return l.recipe_id === saved.id; });
    return Promise.all(old.map(function (l) { return DB.remove('recipe_ingredients', l.id); })).then(function () {
      var chain = Promise.resolve();
      parsed.forEach(function (p, pos) {
        if (!p.name) return;
        var optional = /optional/i.test(p.prep || '') || /optional/i.test(p.name);
        chain = chain.then(function () { return ensureIngredient(p.name.replace(/\(?optional\)?/i, '').trim()); }).then(function (ing) {
          return DB.put('recipe_ingredients', { recipe_id: saved.id, ingredient_id: ing.id, qty: p.qty, unit: p.unit, prep_note: (p.prep || '').replace(/\(?optional\)?/i, '').trim(), optional: optional, pos: pos });
        });
      });
      return chain.then(function () { return saved; });
    });
  });
}

function cookedThis(id) {
  var r = State.recipes.find(function (x) { return x.id === id; });
  var lines = S.linesByRecipe[id] || [];
  var now = new Date().toISOString();
  var writes = [];
  lines.forEach(function (l) {
    var items = S.pantryByIng[l.ingredient_id] || [];
    var p = items.find(function (it) { return Units.covers(it.qty, it.unit, l.qty, l.unit); }) || items[0];
    if (p && l.qty != null) { p.qty = Units.subtract(p.qty, p.unit, l.qty, l.unit); writes.push(DB.put('pantry_items', p)); }
    writes.push(DB.put('usage_log', { ingredient_id: l.ingredient_id, qty: l.qty || 1, unit: l.unit, event: 'cooked', at: now }));
  });
  r.times_cooked = (r.times_cooked || 0) + 1; r.last_cooked_on = now.slice(0, 10);
  writes.push(DB.put('recipes', r));
  Promise.all(writes).then(loadAll).then(function () {
    refresh();
    openSheet('<h2 style="margin-top:0">Nice. Pantry updated.</h2><p class="muted">Used ingredients were subtracted. Log it to the diary too?</p><div class="btn-row"><button class="btn" onclick="logFromRecipe(\'' + id + '\')">Log a portion</button><button class="btn ghost" onclick="closeSheet()">No thanks</button></div>');
  });
}

function addToList(ingredientId, reason, qty, unit, recipeId) {
  if (State.shopping.some(function (s) { return s.ingredient_id === ingredientId && !s.done; })) return toast('Already on the list');
  return DB.put('shopping_list', { ingredient_id: ingredientId, qty: qty || null, unit: unit || '', reason: reason, recipe_id: recipeId || null, done: false }).then(loadAll).then(function () { toast('Added to list'); refresh(); });
}
function addMissingToList(id) {
  var miss = S.recipeInfo[id].cov.missing;
  if (!miss.length) return toast('You have everything');
  var chain = Promise.resolve();
  miss.forEach(function (l) {
    if (State.shopping.some(function (s) { return s.ingredient_id === l.ingredient_id && !s.done; })) return;
    chain = chain.then(function () { return DB.put('shopping_list', { ingredient_id: l.ingredient_id, qty: l.qty, unit: l.unit, reason: 'missing_for_recipe', recipe_id: id, done: false }); });
  });
  chain.then(loadAll).then(function () { toast(miss.length + ' added to list'); refresh(); });
}
function toggleShop(id) {
  var s = State.shopping.find(function (x) { return x.id === id; });
  s.done = true;
  DB.put('shopping_list', s).then(function () { return addToPantry(s.ingredient_id, s.qty || 1, s.unit || '', guessLocation(S.ingById[s.ingredient_id] || {}), 'bought'); }).then(loadAll).then(function () { toast('Bought, added to pantry'); refresh(); });
}

/* ---------- auth box in Settings ---------- */
function renderAuthBox() {
  var box = document.getElementById('authBox'); if (!box) return;
  Sync.session().then(function (s) {
    if (s) Sync.inviteCode().then(function (c) { var el = document.getElementById('inviteCode'); if (el) el.textContent = c; }).catch(function () {});
    box.innerHTML = s ? '<p>Signed in as <b>' + esc(s.user.email) + '</b></p><p class="muted">Household invite code: <b id="inviteCode">...</b>. Family members sign in, then enter it below to share this kitchen.</p><div class="row"><input id="joinCode" placeholder="Join with a code" class="grow"><button class="btn sm" onclick="Sync.joinHousehold(document.getElementById(\'joinCode\').value.trim()).then(syncNow).then(function(){toast(\'Joined\');renderSettingsAgain()}).catch(function(e){toast(e.message)})">Join</button></div><div class="btn-row"><button class="btn sm" onclick="syncNow()">Sync now</button><button class="btn sm ghost" onclick="Sync.signOut().then(function(){renderSettingsAgain()})">Sign out</button></div>'
      : '<label>Email for a sign-in link</label><input id="authEmail" type="email"><div class="btn-row"><button class="btn sm" onclick="Sync.signIn(document.getElementById(\'authEmail\').value).then(function(){toast(\'Check your email\')}).catch(function(e){toast(e.message)})">Send link</button></div>';
  });
}
function renderSettingsAgain() { showScreen('settings'); }
function syncNow() {
  var dot = document.getElementById('syncDot');
  return Sync.run().then(function (r) {
    dot.classList.toggle('on', r.signedIn); dot.title = r.signedIn ? 'Synced' : 'Local only';
    if (r.pulled || r.photos) return loadAll().then(refresh);
  }).catch(function (e) { dot.classList.remove('on'); dot.title = 'Sync error: ' + e.message; });
}

/* ---------- sample data ---------- */
function loadSample() {
  var ings = [
    ['yellow onion', 'produce', 40, 1.1, 9.3, 0.1, 1.7, 4, 4.2, 146], ['garlic', 'produce', 149, 6.4, 33, 0.5, 2.1, 17, 1, 401],
    ['chicken thigh', 'meat', 177, 24, 0, 8.4, 0, 95, 0, 240], ['low-sodium chicken broth', 'pantry', 6, 0.6, 0.4, 0.2, 0, 60, 0.2, 30],
    ['carrot', 'produce', 41, 0.9, 9.6, 0.2, 2.8, 69, 4.7, 320], ['celery', 'produce', 16, 0.7, 3, 0.2, 1.6, 80, 1.3, 260],
    ['egg noodles', 'pantry', 384, 14, 71, 4.4, 3.3, 21, 1, 223], ['olive oil', 'pantry', 884, 0, 0, 100, 0, 2, 0, 1],
    ['salt', 'spice', 0, 0, 0, 0, 0, 38758, 0, 8], ['black pepper', 'spice', 251, 10, 64, 3.3, 25, 20, 0.6, 1329],
    ['rolled oats', 'pantry', 379, 13, 68, 6.5, 10, 6, 1, 362], ['milk', 'dairy', 61, 3.2, 4.8, 3.3, 0, 43, 5, 132],
    ['banana', 'produce', 89, 1.1, 23, 0.3, 2.6, 1, 12, 358], ['cinnamon', 'spice', 247, 4, 81, 1.2, 53, 10, 2.2, 431],
    ['soy sauce', 'pantry', 53, 8, 4.9, 0.6, 0.8, 5493, 0.4, 435], ['rice', 'pantry', 365, 7.1, 80, 0.7, 1.3, 5, 0.1, 115],
    ['broccoli', 'produce', 34, 2.8, 6.6, 0.4, 2.6, 33, 1.7, 316], ['ginger', 'produce', 80, 1.8, 18, 0.8, 2, 13, 1.7, 415],
    ['egg', 'dairy', 143, 12.6, 0.7, 9.5, 0, 142, 0.4, 138], ['butter', 'dairy', 717, 0.9, 0.1, 81, 0, 11, 0.1, 24],
    ['bread', 'bakery', 265, 9, 49, 3.2, 2.7, 491, 5, 115], ['honey', 'pantry', 304, 0.3, 82, 0, 0.2, 4, 82, 52]
  ];
  var cols = ['kcal_100g', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sodium_mg', 'sugar_g', 'potassium_mg'];
  var byName = {};
  var chain = Promise.all(ings.map(function (row) {
    var rec = { name: row[0], category: row[1], aliases: [], nutrition_source: 'usda' };
    cols.forEach(function (c, i) { rec[c] = row[i + 2]; });
    var existing = State.ingredients.find(function (x) { return x.name === row[0]; });
    if (existing) { byName[row[0]] = existing; return null; }
    return DB.put('ingredients', rec).then(function (r) { byName[row[0]] = r; });
  })).then(function () { return loadAll(); });
  var recipes = [
    { title: "Memaw's chicken noodle soup", servings: 6, cuisine: 'American', meal_type: ['lunch', 'dinner'], prep_min: 15, cook_min: 40, notes: 'Her Sunday recipe. Use low-sodium broth.',
      lines: '1.5 lb chicken thigh\n8 cups low-sodium chicken broth\n1 yellow onion, diced\n3 carrot, sliced\n2 celery, sliced\n2 cloves garlic, minced\n6 oz egg noodles\n1 tbsp olive oil\n1 tsp salt\n0.5 tsp black pepper',
      steps: ['Brown chicken in oil, set aside.', 'Soften onion, carrot, celery and garlic.', 'Add broth and chicken, simmer 25 minutes.', 'Shred chicken, add noodles, cook 8 minutes.', 'Season and serve.'] },
    { title: 'Banana cinnamon oatmeal', servings: 1, cuisine: 'American', meal_type: ['breakfast'], prep_min: 2, cook_min: 5,
      lines: '0.5 cup rolled oats\n1 cup milk\n1 banana, sliced\n0.5 tsp cinnamon\n1 tsp honey, optional',
      steps: ['Simmer oats in milk 5 minutes.', 'Top with banana, cinnamon and honey.'] },
    { title: 'Ginger broccoli fried rice', servings: 3, cuisine: 'Chinese', meal_type: ['dinner'], prep_min: 10, cook_min: 12,
      lines: '1 cup rice, cooked the day before\n2 cups broccoli\n2 egg\n1 tbsp ginger, minced\n2 cloves garlic\n3 tbsp soy sauce\n1 tbsp olive oil',
      steps: ['Scramble eggs, set aside.', 'Stir-fry ginger, garlic, broccoli.', 'Add rice, soy sauce, eggs. Toss hot.'] },
    { title: 'Buttered toast and eggs', servings: 1, cuisine: 'American', meal_type: ['breakfast'], prep_min: 2, cook_min: 5,
      lines: '2 egg\n2 slice bread\n1 tbsp butter\n1 pinch salt',
      steps: ['Toast bread, butter it.', 'Fry or scramble eggs.'] }
  ];
  var pantry = [['yellow onion', 3, 'each', 'counter'], ['garlic', 10, 'cloves', 'counter'], ['chicken thigh', 2, 'lb', 'fridge', 2], ['low-sodium chicken broth', 8, 'cups', 'pantry'],
    ['carrot', 6, 'each', 'fridge'], ['celery', 4, 'each', 'fridge', 3], ['egg noodles', 12, 'oz', 'pantry'], ['olive oil', 500, 'ml', 'pantry'], ['salt', 500, 'g', 'pantry'], ['black pepper', 50, 'g', 'pantry'],
    ['rolled oats', 4, 'cups', 'pantry'], ['milk', 2, 'cups', 'fridge', 1], ['cinnamon', 30, 'g', 'pantry'], ['egg', 3, 'each', 'fridge'], ['rice', 2, 'cups', 'pantry'], ['soy sauce', 250, 'ml', 'pantry'], ['butter', 200, 'g', 'fridge'], ['bread', 6, 'slice', 'pantry']];
  chain.then(function () {
    var c = Promise.resolve();
    recipes.forEach(function (r) {
      if (State.recipes.some(function (x) { return x.title === r.title; })) return;
      var rec = { title: r.title, servings: r.servings, cuisine: r.cuisine, meal_type: r.meal_type, prep_min: r.prep_min, cook_min: r.cook_min, notes: r.notes || '', steps: r.steps, source_type: 'manual', times_cooked: 0 };
      c = c.then(function () { return saveRecipeWithLines(rec, r.lines.split('\n').map(Units.parseLine)); });
    });
    return c;
  }).then(function () {
    var soon = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
    return Promise.all(pantry.map(function (p) {
      var ing = byName[p[0]]; if (!ing || (S.pantryByIng[ing.id] || []).length) return null;
      return DB.put('pantry_items', { ingredient_id: ing.id, qty: p[1], unit: p[2], location: p[3], par_qty: p[4] != null ? p[4] : null, expires_on: p[0] === 'milk' || p[0] === 'celery' ? soon : null });
    }));
  }).then(function () {
    if (State.profiles.some(function (p) { return p.person_name === 'Memaw'; })) return null;
    return DB.put('diet_profiles', { person_name: 'Memaw', notes: 'Not on restrictions yet. Watching sodium ahead of next cardiology visit.', daily_targets: {} });
  }).then(function () {
    // a few weeks of fake usage for restock suggestions
    var now = Date.now(), writes = [];
    ['egg', 'milk', 'bread', 'banana'].forEach(function (n, j) {
      var ing = byName[n]; if (!ing) return;
      for (var i = 0; i < 5 + j; i++) writes.push(DB.put('usage_log', { ingredient_id: ing.id, qty: 1, unit: 'each', event: 'cooked', at: new Date(now - i * 3 * 864e5).toISOString() }));
    });
    return Promise.all(writes);
  }).then(loadAll).then(function () { toast('Sample data loaded'); showScreen('home'); });
}

/* ---------- boot ---------- */
function handleShareTarget() {
  var p = new URLSearchParams(location.search);
  var shared = p.get('url') || p.get('text');
  if (!shared) return;
  history.replaceState(null, '', location.pathname);
  showScreen('scan'); pasteRecipe(); document.getElementById('fPaste').value = shared;
}

var _origShowScreen = showScreen;
showScreen = function (name, arg) { S.lastArg = arg; _origShowScreen(name, arg); if (name === 'settings') renderAuthBox(); if (name === 'diary') hydratePhotos(); };

document.addEventListener('DOMContentLoaded', function () {
  DB.meta('active_profile').then(function (p) { State.activeProfile = p; return loadAll(); }).then(function () {
    showScreen('home');
    handleShareTarget();
    if (Sync.enabled()) { syncNow(); window.addEventListener('online', syncNow); setInterval(syncNow, 5 * 60 * 1000); }
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
});
