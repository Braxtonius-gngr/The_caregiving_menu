/* Screens. Each render* reads from the in-memory State snapshot (loaded by app.js) and writes HTML. */
var State = { ingredients: [], recipes: [], lines: [], variations: [], pantry: [], profiles: [], rules: [], diary: [], shopping: [], usage: [], activeProfile: null, filters: {}, q: '' };
var S = {}; // derived indexes, rebuilt by rebuildIndexes()

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function fmtQty(q, u) { if (q == null) return ''; var n = Math.round(q * 100) / 100; return n + (u ? ' ' + u : ''); }
function todayISO() { return new Date().toISOString().slice(0, 10); }

function rebuildIndexes() {
  S.ingById = {}; State.ingredients.forEach(function (i) { S.ingById[i.id] = i; });
  S.pantryByIng = {}; State.pantry.forEach(function (p) { (S.pantryByIng[p.ingredient_id] = S.pantryByIng[p.ingredient_id] || []).push(p); });
  S.linesByRecipe = {}; State.lines.forEach(function (l) { (S.linesByRecipe[l.recipe_id] = S.linesByRecipe[l.recipe_id] || []).push(l); });
  Object.keys(S.linesByRecipe).forEach(function (k) { S.linesByRecipe[k].sort(function (a, b) { return (a.pos || 0) - (b.pos || 0); }); });
  S.usageByIng = {}; State.usage.forEach(function (u) { (S.usageByIng[u.ingredient_id] = S.usageByIng[u.ingredient_id] || []).push(u); });
  S.rulesByProfile = {}; State.rules.forEach(function (r) { (S.rulesByProfile[r.profile_id] = S.rulesByProfile[r.profile_id] || []).push(r); });
  S.recipeInfo = {};
  State.recipes.forEach(function (r) {
    var lines = S.linesByRecipe[r.id] || [];
    var cov = Logic.coverage(lines, S.pantryByIng);
    var nut = Logic.recipeNutrition(r, lines, S.ingById);
    var fits = {};
    State.profiles.forEach(function (p) { fits[p.id] = Logic.fitForProfile(lines, nut.perServing, S.rulesByProfile[p.id], S.ingById); });
    S.recipeInfo[r.id] = { cov: cov, nut: nut, fits: fits };
  });
}

function toast(msg) { var t = document.getElementById('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._h); t._h = setTimeout(function () { t.classList.add('hidden'); }, 2200); }
function openSheet(html) { document.getElementById('sheetBody').innerHTML = html; document.getElementById('sheet').classList.remove('hidden'); }
function closeSheet() { if (window.Scanner) Scanner.stop(); document.getElementById('sheet').classList.add('hidden'); }

var TITLES = { home: 'Home', recipes: 'Recipes', scan: 'Add', pantry: 'Pantry', diary: 'Diary', settings: 'Settings', recipe: 'Recipe' };
var currentScreen = 'home';
function showScreen(name, arg) {
  currentScreen = name;
  document.getElementById('screenTitle').textContent = TITLES[name] || name;
  document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === name); });
  var fn = { home: renderHome, recipes: renderRecipes, scan: renderScan, pantry: renderPantry, diary: renderDiary, settings: renderSettings, recipe: renderRecipe }[name];
  document.getElementById('screen').innerHTML = fn ? fn(arg) : '';
  window.scrollTo(0, 0);
}
function refresh() { rebuildIndexes(); showScreen(currentScreen, S.lastArg); }

/* ---------- shared bits ---------- */
function profileBadge(recipeId) {
  var p = State.activeProfile ? State.profiles.find(function (x) { return x.id === State.activeProfile; }) : null;
  if (!p) return '';
  var f = S.recipeInfo[recipeId].fits[p.id];
  var sym = { ok: '&#10003;', warn: '&#9888;', bad: '&#10007;' }[f.level];
  return '<span class="badge ' + f.level + '" title="' + esc(f.reasons.join('; ')) + '">' + sym + ' ' + esc(p.person_name) + '</span>';
}
function recipeCard(r) {
  var info = S.recipeInfo[r.id];
  var miss = info.cov.missing.slice(0, 3).map(function (l) { return esc((S.ingById[l.ingredient_id] || {}).name || '?'); }).join(', ');
  return '<div class="card tappable row" onclick="showScreen(\'recipe\',\'' + r.id + '\')">' +
    '<div class="ring" style="--pct:' + info.cov.pct + '"><span>' + info.cov.pct + '%</span></div>' +
    '<div class="grow"><h3>' + esc(r.title) + '</h3>' +
    '<div class="muted">' + (r.cuisine ? esc(r.cuisine) + ' · ' : '') + (info.nut.perServing.kcal ? '~' + info.nut.perServing.kcal + ' kcal/serving · ' : '') + info.cov.have + '/' + info.cov.total + ' on hand' + (miss ? ' · need ' + miss : '') + '</div>' +
    '<div class="chips" style="margin:4px 0 0">' + profileBadge(r.id) + (r.meal_type || []).map(function (m) { return '<span class="badge">' + esc(m) + '</span>'; }).join('') + '</div>' +
    '</div></div>';
}
function dvTiles(totals, targets) {
  var keys = ['kcal', 'sodium_mg', 'fiber_g', 'protein_g', 'sugar_g', 'potassium_mg'];
  var labels = { kcal: 'kcal', sodium_mg: 'sodium', fiber_g: 'fiber', protein_g: 'protein', sugar_g: 'sugar', potassium_mg: 'potassium' };
  return '<div class="dv">' + keys.map(function (k) {
    var tgt = (targets && targets[k]) || Logic.DV[k];
    var pct = Math.round(100 * (totals[k] || 0) / tgt);
    return '<div class="tile"><span class="muted">' + labels[k] + '</span><b>' + Math.round(totals[k] || 0) + '</b><span class="muted">' + pct + '% of ' + tgt + '</span><div class="bar"><i class="' + (pct > 100 ? 'over' : '') + '" style="width:' + Math.min(100, pct) + '%"></i></div></div>';
  }).join('') + '</div>';
}
function profileSwitcher() {
  if (!State.profiles.length) return '';
  return '<div class="chips"><span class="chip ' + (!State.activeProfile ? 'on' : '') + '" onclick="setProfile(null)">Everyone</span>' +
    State.profiles.map(function (p) { return '<span class="chip ' + (State.activeProfile === p.id ? 'on' : '') + '" onclick="setProfile(\'' + p.id + '\')">' + esc(p.person_name) + '</span>'; }).join('') + '</div>';
}
function setProfile(id) { State.activeProfile = id; DB.meta('active_profile', id); refresh(); }

/* ---------- Home ---------- */
function renderHome() {
  var cookNow = State.recipes.filter(function (r) { return S.recipeInfo[r.id].cov.pct === 100 && S.recipeInfo[r.id].cov.total > 0; }).sort(function (a, b) { return (a.last_cooked_on || '') < (b.last_cooked_on || '') ? -1 : 1; });
  var oneTrip = State.recipes.filter(function (r) { var c = S.recipeInfo[r.id].cov; return c.pct >= 80 && c.pct < 100; });
  var expiring = Logic.expiringSoon(State.pantry, 4);
  var expIds = {}; expiring.forEach(function (p) { expIds[p.ingredient_id] = true; });
  var useUp = State.recipes.filter(function (r) { return (S.linesByRecipe[r.id] || []).some(function (l) { return expIds[l.ingredient_id]; }); });
  var restock = Logic.restockSuggestions(State.pantry, S.usageByIng, S.ingById);
  var todays = State.diary.filter(function (e) { return e.eaten_at.slice(0, 10) === todayISO() && (!State.activeProfile || e.for_profile_id === State.activeProfile); });
  var prof = State.profiles.find(function (p) { return p.id === State.activeProfile; });
  var html = profileSwitcher();
  html += '<h2>Today so far</h2>' + dvTiles(Logic.dayTotals(todays), prof && prof.daily_targets);
  if (!State.recipes.length) html += '<div class="card"><h3>Welcome</h3><p class="muted">Add a recipe and a few pantry items and this screen fills in with what you can cook tonight. Try <b>Settings &rarr; Load sample data</b> to see it working.</p></div>';
  html += '<h2>Cook tonight</h2>' + (cookNow.length ? cookNow.slice(0, 6).map(recipeCard).join('') : '<div class="empty">Nothing fully covered yet.</div>');
  html += '<h2>One trip away</h2>' + (oneTrip.length ? oneTrip.slice(0, 6).map(recipeCard).join('') : '<div class="empty">No near-misses.</div>');
  if (useUp.length) html += '<h2>Use it up</h2><p class="muted">' + expiring.map(function (p) { return esc(S.ingById[p.ingredient_id].name) + ' (' + p.expires_on + ')'; }).join(', ') + '</p>' + useUp.slice(0, 4).map(recipeCard).join('');
  if (restock.length) html += '<h2>Restock</h2>' + restock.map(function (s) { return '<div class="list-item"><div class="grow"><b>' + esc(S.ingById[s.ingredient_id].name) + '</b><div class="muted">' + esc(s.why) + '</div></div><button class="btn sm" onclick="addToList(\'' + s.ingredient_id + '\',\'low_stock\')">+ list</button></div>'; }).join('');
  var open = State.shopping.filter(function (s) { return !s.done; });
  if (open.length) html += '<h2>Shopping list (' + open.length + ')</h2>' + renderShoppingList(open);
  return html;
}
function renderShoppingList(items) {
  var byCat = {};
  items.forEach(function (s) { var cat = (S.ingById[s.ingredient_id] || {}).category || 'other'; (byCat[cat] = byCat[cat] || []).push(s); });
  return Object.keys(byCat).sort().map(function (cat) {
    return '<div class="card"><h3>' + esc(cat) + '</h3>' + byCat[cat].map(function (s) {
      return '<div class="list-item"><input type="checkbox" style="width:auto" onchange="toggleShop(\'' + s.id + '\')"><div class="grow">' + esc((S.ingById[s.ingredient_id] || {}).name) + ' <span class="muted">' + fmtQty(s.qty, s.unit) + ' · ' + esc(s.reason || '') + '</span></div></div>';
    }).join('') + '</div>';
  }).join('');
}

/* ---------- Recipes ---------- */
var FACETS = { fit: ['can cook now', 'one trip away', 'expiring'], meal: ['breakfast', 'lunch', 'dinner', 'snack', 'dessert'], cat: ['produce', 'dairy', 'meat', 'pantry', 'spice', 'frozen', 'bakery', 'drink'] };
function toggleFilter(k, v) { State.filters[k] = State.filters[k] === v ? null : v; refresh(); }
function matchesQuery(r, q) {
  if (!q) return true;
  var hay = [r.title, r.cuisine, r.notes, (r.meal_type || []).join(' ')].concat((S.linesByRecipe[r.id] || []).map(function (l) { return (S.ingById[l.ingredient_id] || {}).name; })).join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).every(function (t) { return hay.indexOf(t) > -1; });
}
function filteredRecipes() {
  var f = State.filters, q = State.q;
  var expIds = {}; Logic.expiringSoon(State.pantry, 4).forEach(function (p) { expIds[p.ingredient_id] = true; });
  return State.recipes.filter(function (r) {
    var info = S.recipeInfo[r.id];
    if (!matchesQuery(r, q)) return false;
    if (f.fit === 'can cook now' && info.cov.pct < 100) return false;
    if (f.fit === 'one trip away' && (info.cov.pct < 80 || info.cov.pct === 100)) return false;
    if (f.fit === 'expiring' && !(S.linesByRecipe[r.id] || []).some(function (l) { return expIds[l.ingredient_id]; })) return false;
    if (f.meal && (r.meal_type || []).indexOf(f.meal) < 0) return false;
    if (f.cat && !(S.linesByRecipe[r.id] || []).some(function (l) { return (S.ingById[l.ingredient_id] || {}).category === f.cat; })) return false;
    if (f.profileOk && State.activeProfile && info.fits[State.activeProfile].level !== 'ok') return false;
    return true;
  }).sort(function (a, b) { return S.recipeInfo[b.id].cov.pct - S.recipeInfo[a.id].cov.pct; });
}
function renderRecipes() {
  var list = filteredRecipes();
  var chips = function (k, vals) { return vals.map(function (v) { return '<span class="chip ' + (State.filters[k] === v ? 'on' : '') + '" onclick="toggleFilter(\'' + k + '\',\'' + v + '\')">' + esc(v) + '</span>'; }).join(''); };
  var buyHint = '';
  if (State.q && !list.length) {
    var ing = Logic.ingredientMatch(State.q, State.ingredients);
    if (ing) { var n = State.recipes.filter(function (r) { return (S.linesByRecipe[r.id] || []).some(function (l) { return l.ingredient_id === ing.id; }); }).length; buyHint = '<div class="note">' + n + ' recipe' + (n === 1 ? '' : 's') + ' use ' + esc(ing.name) + '. <button class="btn sm" onclick="addToList(\'' + ing.id + '\',\'manual\')">Add to list</button></div>'; }
  }
  return '<div class="search"><input placeholder="Search recipes, ingredients, cuisine" value="' + esc(State.q) + '" oninput="State.q=this.value;refreshList()"></div>' +
    profileSwitcher() +
    '<div class="chips">' + chips('fit', FACETS.fit) + (State.activeProfile ? '<span class="chip ' + (State.filters.profileOk ? 'on' : '') + '" onclick="State.filters.profileOk=!State.filters.profileOk;refresh()">&#10003; fits profile</span>' : '') + '</div>' +
    '<div class="chips">' + chips('meal', FACETS.meal) + '</div><div class="chips">' + chips('cat', FACETS.cat) + '</div>' +
    '<div class="btn-row"><button class="btn" onclick="editRecipe()">+ New recipe</button></div>' +
    '<div id="recipeList">' + (list.length ? list.map(recipeCard).join('') : '<div class="empty">No matches.</div>' + buyHint) + '</div>';
}
function refreshList() { var el = document.getElementById('recipeList'); if (el) { var list = filteredRecipes(); el.innerHTML = list.length ? list.map(recipeCard).join('') : '<div class="empty">No matches.</div>'; } }

function renderRecipe(id) {
  S.lastArg = id;
  var r = State.recipes.find(function (x) { return x.id === id; });
  if (!r) return '<div class="empty">Recipe not found.</div>';
  var info = S.recipeInfo[id], lines = S.linesByRecipe[id] || [];
  var vars = State.variations.filter(function (v) { return v.recipe_id === id; });
  var fitHtml = '';
  State.profiles.forEach(function (p) { var f = info.fits[p.id]; if (f.reasons.length) fitHtml += '<div class="note"><b>' + esc(p.person_name) + ':</b> ' + esc(f.reasons.join('; ')) + ' <button class="btn sm ghost" onclick="askSwaps(\'' + id + '\',\'' + p.id + '\')">Suggest swaps</button></div>'; });
  return '<div class="card"><div class="row between"><h2 style="margin:0">' + esc(r.title) + '</h2><div class="ring" style="--pct:' + info.cov.pct + '"><span>' + info.cov.pct + '%</span></div></div>' +
    '<div class="muted">' + [r.cuisine, r.servings ? r.servings + ' servings' : '', (r.prep_min || r.cook_min) ? ((r.prep_min || 0) + (r.cook_min || 0)) + ' min' : '', r.times_cooked ? 'cooked ' + r.times_cooked + 'x' : ''].filter(Boolean).map(esc).join(' · ') + '</div>' +
    '<div class="chips">' + profileBadge(id) + '</div>' + fitHtml +
    '<div class="btn-row"><button class="btn" onclick="cookedThis(\'' + id + '\')">I cooked this</button><button class="btn ghost" onclick="logFromRecipe(\'' + id + '\')">I ate this</button><button class="btn ghost" onclick="addMissingToList(\'' + id + '\')">Add missing to list</button><button class="btn ghost" onclick="editRecipe(\'' + id + '\')">Edit</button></div></div>' +
    '<h2>Ingredients</h2><div class="card">' + (lines.length ? lines.map(function (l) {
      var ing = S.ingById[l.ingredient_id] || {}; var have = !info.cov.missing.some(function (m) { return m.id === l.id; });
      return '<div class="ing-line ' + (have ? 'have' : '') + '"><div>' + (have || l.optional ? '<span class="have-mark">&#10003;</span>' : '<span class="need-mark">&#9675;</span>') + ' ' + esc(fmtQty(l.qty, l.unit)) + ' <b>' + esc(ing.name || '?') + '</b>' + (l.prep_note ? ' <span class="muted">' + esc(l.prep_note) + '</span>' : '') + (l.optional ? ' <span class="badge">optional</span>' : '') + '</div><span class="muted">' + esc(ing.category || '') + '</span></div>';
    }).join('') : '<div class="empty">No ingredients yet.</div>') + '</div>' +
    '<h2>Steps</h2><div class="card">' + ((r.steps || []).length ? '<ol class="steps">' + r.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' : '<div class="empty">No steps yet.</div>') + '</div>' +
    (r.notes ? '<h2>Notes</h2><div class="card">' + esc(r.notes).replace(/\n/g, '<br>') + '</div>' : '') +
    '<h2>Nutrition per serving <span class="muted">(' + info.nut.knownLines + '/' + info.nut.totalLines + ' lines have data)</span></h2>' + dvTiles(info.nut.perServing) +
    '<h2>Variations</h2><div class="chips">' + ['lighter', 'faster', 'use what I have', 'different cuisine', 'leftover remix'].map(function (a) { return '<span class="chip" onclick="askVariation(\'' + id + '\',\'' + a + '\')">' + a + '</span>'; }).join('') + '</div>' +
    (vars.length ? vars.map(function (v) { return '<div class="card"><h3>' + esc(v.title) + ' <span class="badge">' + esc(v.kind) + '</span></h3><div class="muted">' + esc((v.body && v.body.summary) || '') + '</div>' + ((v.body && v.body.changes) || []).map(function (c) { return '<div>&bull; ' + esc(c) + '</div>'; }).join('') + '</div>'; }).join('') : '<div class="empty">None saved. Pick an angle above.</div>');
}

function editRecipe(id) {
  var r = id ? State.recipes.find(function (x) { return x.id === id; }) : { title: '', servings: 4, steps: [], meal_type: [] };
  var lines = id ? (S.linesByRecipe[id] || []).map(function (l) { return fmtQty(l.qty, l.unit) + ' ' + ((S.ingById[l.ingredient_id] || {}).name || '') + (l.prep_note ? ', ' + l.prep_note : ''); }).join('\n') : '';
  openSheet('<h2 style="margin-top:0">' + (id ? 'Edit' : 'New') + ' recipe</h2>' +
    '<label>Title</label><input id="fTitle" value="' + esc(r.title) + '">' +
    '<div class="row"><div class="grow"><label>Servings</label><input id="fServ" type="number" value="' + (r.servings || 4) + '"></div><div class="grow"><label>Cuisine</label><input id="fCuis" value="' + esc(r.cuisine || '') + '"></div></div>' +
    '<div class="row"><div class="grow"><label>Prep min</label><input id="fPrep" type="number" value="' + (r.prep_min || '') + '"></div><div class="grow"><label>Cook min</label><input id="fCook" type="number" value="' + (r.cook_min || '') + '"></div></div>' +
    '<label>Meal type</label><div class="chips">' + FACETS.meal.map(function (m) { return '<span class="chip meal-chip ' + ((r.meal_type || []).indexOf(m) > -1 ? 'on' : '') + '" data-v="' + m + '" onclick="this.classList.toggle(\'on\')">' + m + '</span>'; }).join('') + '</div>' +
    '<label>Ingredients, one per line ("2 cups flour, sifted")</label><textarea id="fIng" rows="7">' + esc(lines) + '</textarea>' +
    '<label>Steps, one per line</label><textarea id="fSteps" rows="6">' + esc((r.steps || []).join('\n')) + '</textarea>' +
    '<label>Notes</label><textarea id="fNotes" rows="3">' + esc(r.notes || '') + '</textarea>' +
    '<div class="btn-row"><button class="btn" onclick="saveRecipeForm(' + (id ? '\'' + id + '\'' : 'null') + ')">Save</button><button class="btn ghost" onclick="closeSheet()">Cancel</button>' + (id ? '<button class="btn danger" onclick="deleteRecipe(\'' + id + '\')">Delete</button>' : '') + '</div>');
}
function saveRecipeForm(id) {
  var v = function (i) { return document.getElementById(i).value; };
  var rec = id ? State.recipes.find(function (x) { return x.id === id; }) : { source_type: 'manual', times_cooked: 0 };
  rec.title = v('fTitle').trim(); if (!rec.title) return toast('Title required');
  rec.servings = +v('fServ') || 1; rec.cuisine = v('fCuis').trim(); rec.prep_min = +v('fPrep') || null; rec.cook_min = +v('fCook') || null;
  rec.meal_type = [].map.call(document.querySelectorAll('.meal-chip.on'), function (c) { return c.dataset.v; });
  rec.steps = v('fSteps').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  rec.notes = v('fNotes').trim();
  var lineTexts = v('fIng').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  saveRecipeWithLines(rec, lineTexts.map(Units.parseLine)).then(function (saved) { closeSheet(); toast('Saved'); return loadAll().then(function () { showScreen('recipe', saved.id); }); });
}
function deleteRecipe(id) {
  if (!confirm('Delete this recipe?')) return;
  Promise.all((S.linesByRecipe[id] || []).map(function (l) { return DB.remove('recipe_ingredients', l.id); })).then(function () { return DB.remove('recipes', id); }).then(function () { closeSheet(); return loadAll(); }).then(function () { showScreen('recipes'); });
}

/* ---------- Add / Scan ---------- */
function renderScan() {
  var cloud = Sync.enabled();
  return '<p class="muted">' + (cloud ? 'Photos and links are parsed in the cloud; the result always lands on a review screen first.' : 'Cloud not configured, so photo/receipt/link parsing is off. Barcodes, manual and paste entry still work.') + '</p>' +
    '<div class="grid-big">' +
    '<div class="big-btn" onclick="scanPhoto(\'recipe\')"><span class="ico">&#128247;</span>Recipe photo<div class="muted">card, cookbook, handwriting</div></div>' +
    '<div class="big-btn" onclick="scanPhoto(\'receipt\')"><span class="ico">&#129534;</span>Receipt<div class="muted">adds to pantry</div></div>' +
    '<div class="big-btn" onclick="scanBarcode()"><span class="ico">&#9646;&#9646;&#9646;</span>Barcode<div class="muted">packaged item</div></div>' +
    '<div class="big-btn" onclick="pasteRecipe()"><span class="ico">&#128279;</span>Link / paste<div class="muted">URL or text</div></div>' +
    '</div>' +
    '<h2>Manual</h2><div class="btn-row"><button class="btn ghost" onclick="editRecipe()">Type a recipe</button><button class="btn ghost" onclick="editPantryItem()">Add pantry item</button><button class="btn ghost" onclick="logFood()">Log a meal</button></div>' +
    '<input id="scanFile" type="file" accept="image/*" capture="environment" class="hidden" onchange="onScanFile(this)">';
}
var scanKind = 'recipe';
function scanPhoto(kind) { scanKind = kind; if (!Sync.enabled()) return toast('Configure Supabase first (Settings)'); document.getElementById('scanFile').click(); }
function onScanFile(input) {
  var file = input.files[0]; if (!file) return;
  toast('Reading photo...');
  downscale(file, 1600).then(function (dataUrl) {
    return Sync.brain(scanKind === 'receipt' ? 'parse_receipt' : 'parse_recipe', { image: dataUrl, ingredients: State.ingredients.map(function (i) { return i.name; }) });
  }).then(function (res) { scanKind === 'receipt' ? reviewPantry((res.items || []).filter(function (i) { return i.is_food !== false; }), 'receipt') : reviewRecipe(res, 'photo'); })
    .catch(function (e) { toast('Scan failed: ' + e.message); });
  input.value = '';
}
function downscale(file, max) {
  return new Promise(function (resolve) {
    var img = new Image(); var url = URL.createObjectURL(file);
    img.onload = function () { var s = Math.min(1, max / Math.max(img.width, img.height)); var c = document.createElement('canvas'); c.width = img.width * s; c.height = img.height * s; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.82)); };
    img.src = url;
  });
}
function scanBarcode() {
  openSheet('<h2 style="margin-top:0">Scan a barcode</h2>' +
    '<div class="scan-view"><video id="scanVideo" playsinline muted></video><div class="scan-guide"></div></div>' +
    '<canvas id="scanCanvas" class="hidden"></canvas>' +
    '<p class="muted" id="scanMsg">Point the camera at the barcode and hold steady.</p>' +
    '<label>Or type the number</label><div class="row"><input id="scanManual" inputmode="numeric" class="grow" placeholder="012345678905"><button class="btn sm" onclick="onBarcode(document.getElementById(\'scanManual\').value.trim())">Look up</button></div>' +
    '<div class="btn-row"><button class="btn ghost" onclick="closeSheet()">Done</button></div>');
  Scanner.start(document.getElementById('scanVideo'), document.getElementById('scanCanvas'), onBarcode, function (e) {
    var m = document.getElementById('scanMsg'); if (m) m.textContent = e.message;
    var v = document.querySelector('.scan-view'); if (v) v.classList.add('hidden');
  });
}
// Local match first (works offline), then the cloud lookup, then Open Food Facts directly.
// codes: normalised candidates from Scanner.candidates, best first.
function lookupBarcode(codes) {
  var known = State.ingredients.find(function (i) { return i.upc && codes.indexOf(i.upc) > -1; });
  if (known) return Promise.resolve({ name: known.name, known: true, code: known.upc });
  var tryCode = function (i) {
    if (i >= codes.length) return Promise.resolve({ name: null, code: codes[0] });
    return remoteLookup(codes[i]).catch(function () { return { name: null }; }).then(function (res) {
      return res && res.name ? Object.assign(res, { code: codes[i] }) : tryCode(i + 1);
    });
  };
  return tryCode(0);
}
function remoteLookup(code) {
  var viaCloud = Sync.enabled() ? Sync.lookup('barcode', code) : Promise.reject(new Error('no cloud'));
  return viaCloud.catch(function () {
    return fetch('https://world.openfoodfacts.org/api/v2/product/' + encodeURIComponent(code) + '.json?fields=product_name,nutriments').then(function (r) { return r.json(); }).then(function (d) {
      if (d.status !== 1) return { name: null };
      var n = d.product.nutriments || {};
      var mg = function (g) { return g != null ? Math.round(g * 1000) : null; };
      return { name: (d.product.product_name || '').toLowerCase(), nutrition: { kcal_100g: n['energy-kcal_100g'], protein_g: n.proteins_100g, carbs_g: n.carbohydrates_100g, fat_g: n.fat_100g, fiber_g: n.fiber_100g, sodium_mg: mg(n.sodium_100g), sugar_g: n.sugars_100g, potassium_mg: mg(n.potassium_100g) } };
    });
  });
}
function onBarcode(text, format) {
  if (!text) return;
  var codes = Scanner.candidates(text, format);
  if (!codes.length) return toast('That number does not look like a barcode');
  Scanner.stop();
  var m = document.getElementById('scanMsg'); if (m) m.textContent = 'Found ' + codes[0] + ', looking it up...';
  lookupBarcode(codes).catch(function () { return { name: null, code: codes[0] }; }).then(function (res) {
    if (!res.name) toast('Not in the product database. Name it once and it will be remembered.');
    reviewPantry([{ name: res.name || '', qty: 1, unit: 'each', nutrition: res.nutrition, upc: res.code, raw: 'barcode ' + res.code + (res.known ? ' (seen before)' : '') }], 'barcode');
  });
}
function pasteRecipe() {
  openSheet('<h2 style="margin-top:0">Link or paste</h2><label>Recipe URL or full text</label><textarea id="fPaste" rows="8" placeholder="https://... or paste the recipe text"></textarea><div class="btn-row"><button class="btn" onclick="submitPaste()">Parse</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div><p class="muted">Offline fallback: first line becomes the title, lines that start with a number become ingredients, the rest become steps.</p>');
}
function submitPaste() {
  var text = document.getElementById('fPaste').value.trim(); if (!text) return;
  closeSheet();
  if (Sync.enabled()) {
    toast('Parsing...');
    var isUrl = /^https?:\/\//i.test(text);
    Sync.brain('parse_recipe', isUrl ? { url: text } : { text: text }).then(function (res) { reviewRecipe(res, isUrl ? 'url' : 'paste'); }).catch(function (e) { toast(e.message); reviewRecipe(localParse(text), 'paste'); });
  } else reviewRecipe(localParse(text), 'paste');
}
function localParse(text) {
  var ls = text.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  var title = ls.shift() || 'Untitled';
  var ing = [], steps = [];
  ls.forEach(function (l) { (/^[\d½¼¾]/.test(l) ? ing : steps).push(l); });
  return { title: title, servings: 4, ingredients: ing.map(Units.parseLine), steps: steps.map(function (s) { return s.replace(/^\d+[.)]\s*/, ''); }), confidence: 0.4 };
}
function reviewRecipe(draft, source) {
  var lines = (draft.ingredients || []).map(function (l) { return fmtQty(l.qty, l.unit) + ' ' + (l.name || '') + (l.prep ? ', ' + l.prep : ''); }).join('\n');
  S.pendingDraft = Object.assign({ source_type: source }, draft);
  editRecipe();
  document.getElementById('fTitle').value = draft.title || '';
  document.getElementById('fServ').value = draft.servings || 4;
  document.getElementById('fCuis').value = draft.cuisine || '';
  document.getElementById('fIng').value = lines;
  document.getElementById('fSteps').value = (draft.steps || []).join('\n');
  document.getElementById('fNotes').value = draft.notes || '';
  var h = document.querySelector('#sheetBody h2'); h.innerHTML = 'Review scan <span class="badge ' + ((draft.confidence || 0) > 0.7 ? 'ok' : 'warn') + '">' + Math.round((draft.confidence || 0.5) * 100) + '% confident</span>';
}
function reviewPantry(items, source) {
  S.pendingPantry = items;
  openSheet('<h2 style="margin-top:0">Review ' + source + '</h2>' + items.map(function (it, i) {
    var m = Logic.ingredientMatch(it.name, State.ingredients);
    return '<div class="card"><div class="row"><input class="grow" id="rp-name-' + i + '" value="' + esc(m ? m.name : it.name) + '"><input id="rp-qty-' + i + '" type="number" step="any" style="width:70px" value="' + (it.qty || 1) + '"><input id="rp-unit-' + i + '" style="width:70px" value="' + esc(it.unit || '') + '"></div><div class="muted">' + (m ? 'matched ' + esc(m.name) : 'new ingredient') + (it.raw ? ' · from "' + esc(it.raw) + '"' : '') + '</div></div>';
  }).join('') + '<div class="btn-row"><button class="btn" onclick="commitPantryReview()">Add ' + (items.length > 1 ? 'all ' : '') + 'to pantry</button>' + (source === 'barcode' ? '<button class="btn ghost" onclick="commitPantryReview(true)">Add &amp; scan next</button>' : '') + '<button class="btn ghost" onclick="closeSheet()">Cancel</button></div>');
}
function commitPantryReview(scanNext) {
  var items = S.pendingPantry || [];
  var chain = Promise.resolve();
  var named = items.filter(function (it, i) { return document.getElementById('rp-name-' + i).value.trim(); });
  if (!named.length) return toast('Give it a name first');
  items.forEach(function (it, i) {
    var name = document.getElementById('rp-name-' + i).value.trim(), qty = +document.getElementById('rp-qty-' + i).value || 0, unit = document.getElementById('rp-unit-' + i).value.trim();
    if (!name) return; // blank line = skip it
    chain = chain.then(function () { return ensureIngredient(name, it.nutrition, it.upc); }).then(function (ing) {
      // Remember the barcode on whichever ingredient the user picked, so the next scan is instant.
      var save = it.upc && !ing.upc ? DB.put('ingredients', Object.assign(ing, { upc: it.upc })) : Promise.resolve();
      return save.then(function () { return addToPantry(ing.id, qty, unit, guessLocation(ing), 'bought'); });
    });
  });
  chain.then(function () { toast('Pantry updated'); return loadAll(); }).then(function () {
    if (scanNext) { refresh(); scanBarcode(); } else { closeSheet(); showScreen('pantry'); }
  });
}
function guessLocation(ing) {
  if (/frozen/.test(ing.name || '') || ing.category === 'frozen') return 'freezer';
  return ing.category === 'dairy' || ing.category === 'meat' ? 'fridge' : 'pantry';
}

/* ---------- Pantry ---------- */
function renderPantry() {
  var q = (State.pq || '').toLowerCase();
  var items = State.pantry.filter(function (p) { return !q || ((S.ingById[p.ingredient_id] || {}).name || '').toLowerCase().indexOf(q) > -1; });
  var byLoc = {}; items.forEach(function (p) { (byLoc[p.location || 'pantry'] = byLoc[p.location || 'pantry'] || []).push(p); });
  var expiring = Logic.expiringSoon(State.pantry, 4);
  return '<div class="search"><input placeholder="Search pantry" value="' + esc(State.pq || '') + '" oninput="State.pq=this.value;refresh()"></div>' +
    '<div class="btn-row"><button class="btn" onclick="editPantryItem()">+ Add item</button><button class="btn ghost" onclick="showScreen(\'scan\')">Scan receipt</button></div>' +
    (expiring.length ? '<div class="note">Expiring soon: ' + expiring.map(function (p) { return esc(S.ingById[p.ingredient_id].name); }).join(', ') + '</div>' : '') +
    (items.length ? ['fridge', 'freezer', 'pantry', 'counter'].filter(function (l) { return byLoc[l]; }).map(function (loc) {
      return '<h2>' + loc + ' (' + byLoc[loc].length + ')</h2><div class="card">' + byLoc[loc].sort(function (a, b) { return S.ingById[a.ingredient_id].name.localeCompare(S.ingById[b.ingredient_id].name); }).map(function (p) {
        var ing = S.ingById[p.ingredient_id] || {};
        return '<div class="list-item"><div class="grow" onclick="editPantryItem(\'' + p.id + '\')"><b>' + esc(ing.name) + '</b> <span class="muted">' + esc(ing.category || '') + (p.expires_on ? ' · exp ' + p.expires_on : '') + (p.par_qty != null ? ' · par ' + p.par_qty : '') + '</span></div><div class="qty-ctl"><button onclick="bumpQty(\'' + p.id + '\',-1)">&minus;</button><span>' + fmtQty(p.qty, p.unit) + '</span><button onclick="bumpQty(\'' + p.id + '\',1)">+</button></div></div>';
      }).join('') + '</div>';
    }).join('') : '<div class="empty">Pantry is empty. Add items or scan a receipt.</div>');
}
function bumpQty(id, d) {
  var p = State.pantry.find(function (x) { return x.id === id; }); if (!p) return;
  var step = Units.kind(p.unit) === 'count' ? 1 : (Units.kind(p.unit) === 'mass' ? 100 : 50);
  if (Units.toBase(1, p.unit).qty > 200) step = 1;
  p.qty = Math.max(0, (p.qty || 0) + d * step);
  DB.put('pantry_items', p).then(function () { if (p.qty === 0) return DB.put('usage_log', { ingredient_id: p.ingredient_id, qty: 0, unit: p.unit, event: 'discarded', at: new Date().toISOString() }); }).then(refresh);
}
function editPantryItem(id) {
  var p = id ? State.pantry.find(function (x) { return x.id === id; }) : { qty: 1, unit: '', location: 'pantry' };
  var name = id ? (S.ingById[p.ingredient_id] || {}).name : '';
  openSheet('<h2 style="margin-top:0">' + (id ? 'Edit' : 'Add') + ' pantry item</h2>' +
    '<label>Ingredient</label><input id="pName" list="ingList" value="' + esc(name) + '"' + (id ? ' disabled' : '') + '><datalist id="ingList">' + State.ingredients.map(function (i) { return '<option value="' + esc(i.name) + '">'; }).join('') + '</datalist>' +
    '<div class="row"><div class="grow"><label>Qty</label><input id="pQty" type="number" step="any" value="' + p.qty + '"></div><div class="grow"><label>Unit</label><input id="pUnit" value="' + esc(p.unit || '') + '" placeholder="g, cups, each"></div></div>' +
    '<div class="row"><div class="grow"><label>Location</label><select id="pLoc">' + ['fridge', 'freezer', 'pantry', 'counter'].map(function (l) { return '<option ' + (p.location === l ? 'selected' : '') + '>' + l + '</option>'; }).join('') + '</select></div><div class="grow"><label>Expires</label><input id="pExp" type="date" value="' + (p.expires_on || '') + '"></div></div>' +
    '<label>Restock when below (par), optional</label><input id="pPar" type="number" step="any" value="' + (p.par_qty != null ? p.par_qty : '') + '">' +
    '<div class="btn-row"><button class="btn" onclick="savePantryForm(' + (id ? '\'' + id + '\'' : 'null') + ')">Save</button><button class="btn ghost" onclick="closeSheet()">Cancel</button>' + (id ? '<button class="btn danger" onclick="DB.remove(\'pantry_items\',\'' + id + '\').then(function(){closeSheet();return loadAll();}).then(refresh)">Remove</button>' : '') + '</div>');
}
function savePantryForm(id) {
  var v = function (i) { return document.getElementById(i).value; };
  var fields = { qty: +v('pQty') || 0, unit: v('pUnit').trim(), location: v('pLoc'), expires_on: v('pExp') || null, par_qty: v('pPar') === '' ? null : +v('pPar') };
  var p = id ? State.pantry.find(function (x) { return x.id === id; }) : null;
  var done = function () { closeSheet(); toast('Saved'); return loadAll().then(refresh); };
  if (p) { Object.assign(p, fields); return DB.put('pantry_items', p).then(done); }
  var name = v('pName').trim(); if (!name) return toast('Name required');
  ensureIngredient(name).then(function (ing) { return addToPantry(ing.id, fields.qty, fields.unit, fields.location, 'bought', fields); }).then(done);
}

/* ---------- Diary ---------- */
function renderDiary() {
  var day = State.day || todayISO();
  var entries = State.diary.filter(function (e) { return e.eaten_at.slice(0, 10) === day && (!State.activeProfile || e.for_profile_id === State.activeProfile); }).sort(function (a, b) { return a.eaten_at < b.eaten_at ? -1 : 1; });
  var prof = State.profiles.find(function (p) { return p.id === State.activeProfile; });
  var shift = function (n) { var d = new Date(day); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  return '<div class="row between"><button class="btn ghost sm" onclick="State.day=\'' + shift(-1) + '\';refresh()">&larr;</button><b>' + (day === todayISO() ? 'Today' : day) + '</b><button class="btn ghost sm" onclick="State.day=\'' + shift(1) + '\';refresh()">&rarr;</button></div>' +
    profileSwitcher() + dvTiles(Logic.dayTotals(entries), prof && prof.daily_targets) +
    '<div class="btn-row"><button class="btn" onclick="logFood()">+ Log a meal</button></div>' +
    (entries.length ? entries.map(function (e) {
      var r = e.recipe_id ? State.recipes.find(function (x) { return x.id === e.recipe_id; }) : null;
      var who = State.profiles.find(function (p) { return p.id === e.for_profile_id; });
      return '<div class="card row">' + photoThumb(e) + '<div class="grow"><b>' + esc(r ? r.title : e.free_text) + '</b> <span class="muted">' + e.eaten_at.slice(11, 16) + (who ? ' · ' + esc(who.person_name) : '') + (e.portion_mult !== 1 ? ' · ' + e.portion_mult + 'x' : '') + '</span><div class="muted">' + Math.round((e.kcal || 0) * (e.portion_mult || 1)) + ' kcal · ' + Math.round((e.sodium_mg || 0) * (e.portion_mult || 1)) + ' mg sodium' + (e.estimate_source ? ' · ' + esc(e.estimate_source) : '') + photoStatus(e) + '</div></div><button class="icon-btn" aria-label="Delete entry" onclick="deleteDiaryEntry(\'' + e.id + '\')">&times;</button></div>';
    }).join('') : '<div class="empty">Nothing logged.</div>') +
    (prof ? '<h2>Notes for ' + esc(prof.person_name) + '\'s next appointment</h2><div class="card"><textarea id="profNotes" rows="4" placeholder="Questions to ask, patterns you noticed...">' + esc(prof.notes || '') + '</textarea><div class="btn-row"><button class="btn sm" onclick="saveProfileNotes(\'' + prof.id + '\')">Save notes</button><button class="btn sm ghost" onclick="weeklyDigest(\'' + prof.id + '\')">Weekly digest</button></div></div>' : '');
}
function logFood() {
  openSheet('<h2 style="margin-top:0">Log a meal</h2>' +
    '<label>Recipe (or leave blank and describe below)</label><select id="lRecipe"><option value="">—</option>' + State.recipes.map(function (r) { return '<option value="' + r.id + '">' + esc(r.title) + '</option>'; }).join('') + '</select>' +
    '<label>Or describe it</label><input id="lText" placeholder="two eggs and toast">' +
    '<div class="row"><div class="grow"><label>Portion</label><select id="lPort"><option value="0.5">½</option><option value="1" selected>1</option><option value="1.5">1½</option><option value="2">2</option></select></div><div class="grow"><label>Who</label><select id="lWho"><option value="">me</option>' + State.profiles.map(function (p) { return '<option value="' + p.id + '" ' + (State.activeProfile === p.id ? 'selected' : '') + '>' + esc(p.person_name) + '</option>'; }).join('') + '</select></div></div>' +
    '<label>Photo (optional)</label><input id="lPhoto" type="file" accept="image/*" capture="environment">' +
    '<div class="row"><div class="grow"><label>kcal (if known)</label><input id="lKcal" type="number"></div><div class="grow"><label>sodium mg</label><input id="lNa" type="number"></div></div>' +
    '<div class="btn-row"><button class="btn" onclick="saveLog()">Log</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>');
}
function logFromRecipe(id) { logFood(); document.getElementById('lRecipe').value = id; }
function saveLog() {
  var v = function (i) { return document.getElementById(i).value; };
  var rid = v('lRecipe'), text = v('lText').trim(), port = +v('lPort'), who = v('lWho') || null;
  var e = { eaten_at: new Date().toISOString(), recipe_id: rid || null, free_text: text, portion_mult: port, for_profile_id: who, estimate_source: 'manual' };
  if (rid) { var per = S.recipeInfo[rid].nut.perServing; Logic.NUTRIENTS.forEach(function (k) { e[k] = per[k]; }); e.estimate_source = 'recipe'; }
  if (v('lKcal')) { e.kcal = +v('lKcal'); e.estimate_source = 'manual'; }
  if (v('lNa')) e.sodium_mg = +v('lNa');
  var file = document.getElementById('lPhoto').files[0];
  var p = file ? downscale(file, 1280).then(function (d) { e.photo_data = d; }) : Promise.resolve();
  p.then(function () {
    if (!rid && text && Sync.enabled() && !v('lKcal')) {
      return Sync.brain('estimate_plate', { text: text, image: e.photo_data || null }).then(function (res) { Logic.NUTRIENTS.forEach(function (k) { if (res[k] != null) e[k] = res[k]; }); e.estimate_source = 'estimate'; e.confidence = res.confidence; }).catch(function () {});
    }
  }).then(function () {
    var writes = [DB.put('diary_entries', e)];
    if (rid) (S.linesByRecipe[rid] || []).forEach(function (l) { writes.push(DB.put('usage_log', { ingredient_id: l.ingredient_id, qty: 1, unit: l.unit, event: 'logged', at: e.eaten_at })); });
    return Promise.all(writes);
  }).then(function () { closeSheet(); toast('Logged'); return loadAll(); }).then(function () {
    showScreen('diary');
    if (e.photo_data && Sync.enabled()) syncNow().then(function () { return loadAll(); }).then(function () { if (currentScreen === 'diary') refresh(); });
  });
}

/* ---------- diary photos ---------- */
function photoThumb(e) {
  if (!e.photo_data && !e.photo_path) return '';
  // A real button so the full view is reachable by keyboard and announced as a control.
  return '<button type="button" class="photo-btn" aria-label="View meal photo" onclick="viewPhoto(\'' + e.id + '\')"><img class="photo-thumb" alt="" data-photo="' + e.id + '"' + (e.photo_data ? ' src="' + e.photo_data + '"' : '') + '></button>';
}
function photoStatus(e) {
  if (!Sync.enabled() || (!e.photo_data && !e.photo_path)) return '';
  return e.photo_path ? ' · &#9729; photo saved' : ' · photo uploads on next sync';
}
// Fill in thumbnails that only exist in the cloud. Called after the diary renders.
function hydratePhotos() {
  document.querySelectorAll('img[data-photo]:not([src])').forEach(function (img) {
    var e = State.diary.find(function (x) { return x.id === img.dataset.photo; });
    if (!e) return;
    Sync.photoSrc(e).then(function (src) { if (src && img.isConnected) img.src = src; });
  });
}
function viewPhoto(id) {
  var e = State.diary.find(function (x) { return x.id === id; });
  if (!e) return;
  var r = e.recipe_id ? State.recipes.find(function (x) { return x.id === e.recipe_id; }) : null;
  openSheet('<h2 style="margin-top:0">' + esc(r ? r.title : e.free_text || 'Meal') + '</h2><p class="muted">' + e.eaten_at.slice(0, 10) + ' ' + e.eaten_at.slice(11, 16) + '</p><img id="bigPhoto" class="photo-big" alt="Meal photo"><div class="btn-row"><button class="btn ghost" onclick="closeSheet()">Close</button></div>');
  Sync.photoSrc(e).then(function (src) { var el = document.getElementById('bigPhoto'); if (el && src) el.src = src; else if (el) el.replaceWith(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Photo is in the cloud. Sign in or reconnect to see it.' })); });
}
function deleteDiaryEntry(id) {
  var e = State.diary.find(function (x) { return x.id === id; });
  if (!e || !confirm('Delete this diary entry' + (e.photo_data || e.photo_path ? ' and its photo' : '') + '?')) return;
  var path = e.photo_path;
  e.photo_data = null;
  DB.put('diary_entries', e, { silent: true }).then(function () { return DB.remove('diary_entries', id); }).then(function () { return Sync.removePhoto(path); }).then(loadAll).then(refresh);
}
function saveProfileNotes(id) { var p = State.profiles.find(function (x) { return x.id === id; }); p.notes = document.getElementById('profNotes').value; DB.put('diet_profiles', p).then(function () { toast('Saved'); }); }
function weeklyDigest(pid) {
  var since = Date.now() - 7 * 864e5;
  var entries = State.diary.filter(function (e) { return e.for_profile_id === pid && new Date(e.eaten_at).getTime() >= since; });
  var t = Logic.dayTotals(entries); var days = Math.max(1, new Set(entries.map(function (e) { return e.eaten_at.slice(0, 10); })).size);
  var prof = State.profiles.find(function (x) { return x.id === pid; });
  var rules = S.rulesByProfile[pid] || [];
  var hits = [];
  State.recipes.forEach(function (r) { var f = S.recipeInfo[r.id].fits[pid]; if (f.level !== 'ok' && entries.some(function (e) { return e.recipe_id === r.id; })) hits.push(r.title + ': ' + f.reasons.join('; ')); });
  var good = State.recipes.filter(function (r) { return S.recipeInfo[r.id].fits[pid].level === 'ok' && r.times_cooked; }).sort(function (a, b) { return b.times_cooked - a.times_cooked; }).slice(0, 3);
  openSheet('<h2 style="margin-top:0">Last 7 days · ' + esc(prof.person_name) + '</h2><p class="muted">' + entries.length + ' entries over ' + days + ' day' + (days > 1 ? 's' : '') + '. Daily averages:</p>' + dvTiles({ kcal: t.kcal / days, sodium_mg: t.sodium_mg / days, fiber_g: t.fiber_g / days, protein_g: t.protein_g / days, sugar_g: t.sugar_g / days, potassium_mg: t.potassium_mg / days }, prof.daily_targets) +
    '<h3 style="margin-top:14px">Rules hit</h3>' + (hits.length ? hits.map(function (h) { return '<div class="note">' + esc(h) + '</div>'; }).join('') : '<p class="muted">' + (rules.length ? 'None.' : 'No rules set up yet.') + '</p>') +
    '<h3 style="margin-top:14px">Dishes that already fit</h3>' + (good.length ? good.map(function (r) { return '<div>&bull; ' + esc(r.title) + '</div>'; }).join('') : '<p class="muted">Cook a few things first.</p>') +
    '<p class="note" style="margin-top:14px">This is a summary of what was logged, not medical advice. Bring it to her doctor or dietitian.</p><div class="btn-row"><button class="btn ghost" onclick="closeSheet()">Close</button></div>');
}

/* ---------- Settings ---------- */
function renderSettings() {
  var cloud = Sync.enabled();
  return '<h2>Cloud sync</h2><div class="card">' + (cloud ? '<div id="authBox">Checking...</div>' : '<p class="muted">Not configured. Put your Supabase URL and anon key in <code>assets/js/config.js</code>, apply <code>supabase/migrations</code>, deploy the two Edge Functions. Until then everything stays on this device.</p>') + '</div>' +
    '<h2>Diet profiles</h2>' + State.profiles.map(function (p) {
      var rules = S.rulesByProfile[p.id] || [];
      return '<div class="card"><div class="row between"><h3>' + esc(p.person_name) + '</h3><button class="btn sm ghost" onclick="editProfile(\'' + p.id + '\')">Edit</button></div><div class="muted">' + (Object.keys(p.daily_targets || {}).length ? Object.keys(p.daily_targets).map(function (k) { return k.replace('_', ' ') + ' ≤ ' + p.daily_targets[k]; }).join(', ') : 'no daily targets') + '</div>' +
        (rules.length ? rules.map(function (r) { return '<div class="list-item"><span class="badge ' + (r.severity === 'hard' ? 'bad' : 'warn') + '">' + r.severity + '</span><div class="grow">' + esc(describeRule(r)) + (r.source ? ' <span class="muted">— ' + esc(r.source) + '</span>' : '') + '</div><button class="icon-btn" onclick="DB.remove(\'profile_rules\',\'' + r.id + '\').then(loadAll).then(refresh)">&times;</button></div>'; }).join('') : '<p class="muted">No rules yet.</p>') +
        '<div class="btn-row"><button class="btn sm" onclick="addRule(\'' + p.id + '\')">+ Rule</button><button class="btn sm ghost" onclick="starterPacks(\'' + p.id + '\')">Starter packs</button></div></div>';
    }).join('') + '<div class="btn-row"><button class="btn" onclick="editProfile()">+ Add person</button></div>' +
    '<h2>Ingredients (' + State.ingredients.length + ')</h2><div class="card"><p class="muted">Canonical names that recipes and pantry share. Nutrition is per 100 g.</p><div class="btn-row"><button class="btn sm ghost" onclick="listIngredients()">Browse / edit</button></div></div>' +
    '<h2>Data</h2><div class="card"><div class="btn-row"><button class="btn ghost" onclick="exportJSON()">Export JSON</button><button class="btn ghost" onclick="loadSample()">Load sample data</button><button class="btn danger" onclick="if(confirm(\'Erase everything on this device?\'))DB.wipe().then(function(){location.reload()})">Erase local data</button></div><p class="muted">v' + TCM_CONFIG.APP_VERSION + '</p></div>';
}
function describeRule(r) {
  if (r.kind === 'avoid_ingredient') return 'Avoid ' + ((S.ingById[r.ingredient_id] || {}).name || '?') + (r.reason ? ' · ' + r.reason : '');
  if (r.kind === 'limit_nutrient') return (r.nutrient || '').replace('_', ' ') + ' ≤ ' + r.max_per_serving + ' per serving' + (r.reason ? ' · ' + r.reason : '');
  return r.kind + (r.reason ? ' · ' + r.reason : '');
}
function editProfile(id) {
  var p = id ? State.profiles.find(function (x) { return x.id === id; }) : { person_name: '', daily_targets: {} };
  var t = p.daily_targets || {};
  openSheet('<h2 style="margin-top:0">' + (id ? 'Edit' : 'Add') + ' person</h2><label>Name</label><input id="prName" value="' + esc(p.person_name) + '">' +
    '<p class="muted">Daily targets (blank = FDA default). These drive the % bars.</p>' +
    ['kcal', 'sodium_mg', 'sugar_g', 'fiber_g', 'protein_g', 'potassium_mg'].map(function (k) { return '<label>' + k.replace('_', ' ') + ' <span class="muted">(default ' + Logic.DV[k] + ')</span></label><input id="pr-' + k + '" type="number" value="' + (t[k] != null ? t[k] : '') + '">'; }).join('') +
    '<div class="btn-row"><button class="btn" onclick="saveProfile(' + (id ? '\'' + id + '\'' : 'null') + ')">Save</button><button class="btn ghost" onclick="closeSheet()">Cancel</button>' + (id ? '<button class="btn danger" onclick="DB.remove(\'diet_profiles\',\'' + id + '\').then(function(){closeSheet();return loadAll();}).then(refresh)">Remove</button>' : '') + '</div>');
}
function saveProfile(id) {
  var p = id ? State.profiles.find(function (x) { return x.id === id; }) : { notes: '' };
  p.person_name = document.getElementById('prName').value.trim(); if (!p.person_name) return toast('Name required');
  p.daily_targets = {};
  ['kcal', 'sodium_mg', 'sugar_g', 'fiber_g', 'protein_g', 'potassium_mg'].forEach(function (k) { var v = document.getElementById('pr-' + k).value; if (v !== '') p.daily_targets[k] = +v; });
  DB.put('diet_profiles', p).then(function () { closeSheet(); return loadAll(); }).then(refresh);
}
function addRule(pid) {
  openSheet('<h2 style="margin-top:0">Add rule</h2><label>Kind</label><select id="rKind" onchange="document.getElementById(\'rIng\').parentNode.classList.toggle(\'hidden\',this.value!==\'avoid_ingredient\');document.getElementById(\'rNut\').parentNode.classList.toggle(\'hidden\',this.value!==\'limit_nutrient\')"><option value="avoid_ingredient">Avoid an ingredient</option><option value="limit_nutrient">Limit a nutrient per serving</option></select>' +
    '<div><label>Ingredient</label><input id="rIng" list="ingList2"><datalist id="ingList2">' + State.ingredients.map(function (i) { return '<option value="' + esc(i.name) + '">'; }).join('') + '</datalist></div>' +
    '<div class="hidden"><label>Nutrient</label><select id="rNut">' + Logic.NUTRIENTS.map(function (n) { return '<option value="' + n + '">' + n.replace('_', ' ') + '</option>'; }).join('') + '</select><label>Max per serving</label><input id="rMax" type="number"></div>' +
    '<label>Severity</label><select id="rSev"><option value="soft">Watch (amber)</option><option value="hard">Avoid (red)</option></select>' +
    '<label>Reason</label><input id="rWhy" placeholder="e.g. blood pressure"><label>Source</label><input id="rSrc" placeholder="Dr. Patel, Oct 2026">' +
    '<div class="btn-row"><button class="btn" onclick="saveRule(\'' + pid + '\')">Save</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>');
}
function saveRule(pid) {
  var v = function (i) { return document.getElementById(i).value; };
  var r = { profile_id: pid, kind: v('rKind'), severity: v('rSev'), reason: v('rWhy').trim(), source: v('rSrc').trim() };
  var p = Promise.resolve();
  if (r.kind === 'avoid_ingredient') { if (!v('rIng').trim()) return toast('Pick an ingredient'); p = ensureIngredient(v('rIng').trim()).then(function (ing) { r.ingredient_id = ing.id; }); }
  else { r.nutrient = v('rNut'); r.max_per_serving = +v('rMax'); if (!r.max_per_serving) return toast('Enter a max'); }
  p.then(function () { return DB.put('profile_rules', r); }).then(function () { closeSheet(); return loadAll(); }).then(refresh);
}
var PACKS = {
  'Heart-healthy (AHA)': { targets: { sodium_mg: 2300 }, rules: [{ kind: 'limit_nutrient', nutrient: 'sodium_mg', max_per_serving: 700, severity: 'soft', reason: 'AHA: under 2300 mg/day, ideally 1500' }, { kind: 'limit_nutrient', nutrient: 'fat_g', max_per_serving: 25, severity: 'soft', reason: 'watch saturated fat' }] },
  'Low sodium (1500)': { targets: { sodium_mg: 1500 }, rules: [{ kind: 'limit_nutrient', nutrient: 'sodium_mg', max_per_serving: 500, severity: 'hard', reason: 'AHA ideal limit 1500 mg/day' }] },
  'Prediabetes (ADA)': { targets: { sugar_g: 25 }, rules: [{ kind: 'limit_nutrient', nutrient: 'sugar_g', max_per_serving: 12, severity: 'soft', reason: 'ADA: limit added sugars' }, { kind: 'limit_nutrient', nutrient: 'carbs_g', max_per_serving: 60, severity: 'soft', reason: 'carbs per meal' }] },
  'Kidney-aware (NKF)': { targets: { potassium_mg: 2500, sodium_mg: 2000 }, rules: [{ kind: 'limit_nutrient', nutrient: 'potassium_mg', max_per_serving: 700, severity: 'soft', reason: 'NKF: discuss potassium with nephrologist' }, { kind: 'limit_nutrient', nutrient: 'sodium_mg', max_per_serving: 600, severity: 'soft', reason: 'NKF sodium guidance' }] }
};
function starterPacks(pid) {
  openSheet('<h2 style="margin-top:0">Starter packs</h2><p class="muted">Pre-filled, editable rule sets based on public guidelines. They are a starting point for a conversation with her doctor, not a prescription.</p>' +
    Object.keys(PACKS).map(function (n) { return '<div class="card row between"><div><b>' + esc(n) + '</b><div class="muted">' + PACKS[n].rules.map(function (r) { return r.nutrient.replace('_', ' ') + ' ≤ ' + r.max_per_serving; }).join(', ') + '</div></div><button class="btn sm" onclick="applyPack(\'' + pid + '\',\'' + esc(n) + '\')">Apply</button></div>'; }).join('') +
    '<div class="btn-row"><button class="btn ghost" onclick="closeSheet()">Close</button></div>');
}
function applyPack(pid, name) {
  var pack = PACKS[name]; var p = State.profiles.find(function (x) { return x.id === pid; });
  p.daily_targets = Object.assign({}, p.daily_targets || {}, pack.targets);
  Promise.all([DB.put('diet_profiles', p)].concat(pack.rules.map(function (r) { return DB.put('profile_rules', Object.assign({ profile_id: pid, source: 'starter pack: ' + name }, r)); }))).then(function () { closeSheet(); toast('Applied'); return loadAll(); }).then(refresh);
}
function listIngredients() {
  openSheet('<h2 style="margin-top:0">Ingredients</h2>' + State.ingredients.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (i) {
    return '<div class="list-item"><div class="grow"><b>' + esc(i.name) + '</b> <span class="muted">' + esc(i.category || '') + (i.kcal_100g != null ? ' · ' + i.kcal_100g + ' kcal/100g · ' + (i.sodium_mg || 0) + ' mg Na' : ' · no nutrition') + '</span></div><button class="btn sm ghost" onclick="editIngredient(\'' + i.id + '\')">Edit</button></div>';
  }).join('') + '<div class="btn-row"><button class="btn ghost" onclick="closeSheet()">Close</button></div>');
}
function editIngredient(id) {
  var i = S.ingById[id];
  var f = ['kcal_100g', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sodium_mg', 'sugar_g', 'potassium_mg'];
  openSheet('<h2 style="margin-top:0">' + esc(i.name) + '</h2><label>Name</label><input id="iName" value="' + esc(i.name) + '"><label>Aliases (comma separated)</label><input id="iAlias" value="' + esc((i.aliases || []).join(', ')) + '"><label>Category</label><select id="iCat">' + FACETS.cat.concat(['other']).map(function (c) { return '<option ' + (i.category === c ? 'selected' : '') + '>' + c + '</option>'; }).join('') + '</select>' +
    '<p class="muted">Per 100 g</p>' + f.map(function (k) { return '<label>' + k.replace('_', ' ') + '</label><input id="i-' + k + '" type="number" step="any" value="' + (i[k] != null ? i[k] : '') + '">'; }).join('') +
    (Sync.enabled() ? '<div class="btn-row"><button class="btn ghost sm" onclick="fetchNutrition(\'' + id + '\')">Look up nutrition (USDA)</button></div>' : '') +
    '<div class="btn-row"><button class="btn" onclick="saveIngredient(\'' + id + '\')">Save</button><button class="btn ghost" onclick="listIngredients()">Back</button></div>');
}
function saveIngredient(id) {
  var i = S.ingById[id]; var v = function (k) { return document.getElementById(k).value; };
  i.name = v('iName').trim(); i.aliases = v('iAlias').split(',').map(function (s) { return s.trim(); }).filter(Boolean); i.category = v('iCat');
  ['kcal_100g', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sodium_mg', 'sugar_g', 'potassium_mg'].forEach(function (k) { var x = v('i-' + k); i[k] = x === '' ? null : +x; });
  if (i.kcal_100g != null && !i.nutrition_source) i.nutrition_source = 'manual';
  DB.put('ingredients', i).then(function () { closeSheet(); toast('Saved'); return loadAll(); }).then(refresh);
}
function fetchNutrition(id) {
  var i = S.ingById[id]; toast('Looking up...');
  Sync.lookup('usda', i.name).then(function (res) { if (!res || res.kcal_100g == null) return toast('No match'); ['kcal_100g', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sodium_mg', 'sugar_g', 'potassium_mg'].forEach(function (k) { if (res[k] != null) document.getElementById('i-' + k).value = res[k]; }); i.nutrition_source = 'usda'; toast('Filled from USDA: ' + res.description); }).catch(function (e) { toast(e.message); });
}
function exportJSON() {
  var out = { exported_at: new Date().toISOString(), version: TCM_CONFIG.APP_VERSION };
  ['ingredients', 'recipes', 'lines', 'variations', 'pantry', 'profiles', 'rules', 'diary', 'shopping', 'usage'].forEach(function (k) { out[k] = State[k]; });
  var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'caregiving-menu-' + todayISO() + '.json'; a.click();
}

/* ---------- AI helpers (cloud only) ---------- */
function askVariation(id, angle) {
  if (!Sync.enabled()) return toast('Variations need the cloud brain. Configure Supabase in Settings.');
  var r = State.recipes.find(function (x) { return x.id === id; });
  toast('Thinking...');
  Sync.brain('variations', { recipe: recipePayload(id), angle: angle, pantry: State.pantry.map(function (p) { return (S.ingById[p.ingredient_id] || {}).name; }).filter(Boolean) }).then(function (res) {
    openSheet('<h2 style="margin-top:0">' + esc(angle) + ' takes on ' + esc(r.title) + '</h2>' + (res.options || []).map(function (o, i) { S['opt' + i] = o; return '<div class="card"><h3>' + esc(o.title) + '</h3><div class="muted">' + esc(o.summary || '') + '</div>' + (o.changes || []).map(function (c) { return '<div>&bull; ' + esc(c) + '</div>'; }).join('') + '<div class="btn-row"><button class="btn sm" onclick="keepVariation(\'' + id + '\',' + i + ',\'switch_up\',null)">Keep</button></div></div>'; }).join('') + '<div class="btn-row"><button class="btn ghost" onclick="closeSheet()">Close</button></div>');
  }).catch(function (e) { toast(e.message); });
}
function askSwaps(id, pid) {
  if (!Sync.enabled()) return toast('Swaps need the cloud brain. Configure Supabase in Settings.');
  var p = State.profiles.find(function (x) { return x.id === pid; });
  toast('Thinking...');
  Sync.brain('diet_swaps', { recipe: recipePayload(id), profile: { name: p.person_name, targets: p.daily_targets, rules: (S.rulesByProfile[pid] || []).map(describeRule) } }).then(function (res) {
    openSheet('<h2 style="margin-top:0">Swaps for ' + esc(p.person_name) + '</h2>' + (res.options || []).map(function (o, i) { S['opt' + i] = o; return '<div class="card"><h3>' + esc(o.title) + '</h3><div class="muted">' + esc(o.summary || '') + '</div>' + (o.changes || []).map(function (c) { return '<div>&bull; ' + esc(c) + '</div>'; }).join('') + '<div class="btn-row"><button class="btn sm" onclick="keepVariation(\'' + id + '\',' + i + ',\'diet_swap\',\'' + pid + '\')">Keep as her version</button></div></div>'; }).join('') + '<p class="note">Suggestions only. Confirm anything medical with her care team.</p><div class="btn-row"><button class="btn ghost" onclick="closeSheet()">Close</button></div>');
  }).catch(function (e) { toast(e.message); });
}
function keepVariation(id, i, kind, pid) {
  var o = S['opt' + i];
  DB.put('recipe_variations', { recipe_id: id, title: o.title, kind: kind, body: o, for_profile_id: pid, created_by: 'claude' }).then(function () { closeSheet(); toast('Saved'); return loadAll(); }).then(function () { showScreen('recipe', id); });
}
function recipePayload(id) {
  var r = State.recipes.find(function (x) { return x.id === id; });
  return { title: r.title, servings: r.servings, cuisine: r.cuisine, steps: r.steps, ingredients: (S.linesByRecipe[id] || []).map(function (l) { return { qty: l.qty, unit: l.unit, name: (S.ingById[l.ingredient_id] || {}).name, prep: l.prep_note, optional: l.optional }; }), nutrition: S.recipeInfo[id].nut.perServing };
}
