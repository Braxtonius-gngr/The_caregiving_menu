/* Screens. Each render* reads from the in-memory State snapshot (loaded by app.js) and writes HTML. */
var State = { ingredients: [], recipes: [], lines: [], variations: [], pantry: [], profiles: [], rules: [], diary: [], shopping: [], usage: [], activeProfile: null, filters: {}, q: '' };
var S = {}; // derived indexes, rebuilt by rebuildIndexes()

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
function fmtQty(q, u) { if (q == null) return ''; var n = Math.round(q * 100) / 100; return (isFinite(n) ? n : '') + (u ? ' ' + esc(u) : ''); }
// Dates and times on screen are the device's local time; timestamps are stored in UTC.
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function localDay(iso) { var d = iso ? new Date(iso) : new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function localTime(iso) { var d = new Date(iso); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function todayISO() { return localDay(); }
function shiftDay(day, n) { var d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() + n); return localDay(d.toISOString()); }

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

// toast(msg) or toast(msg, actionLabel, actionFn) for a short "Undo"-style action.
function toast(msg, actionLabel, actionFn) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  if (actionLabel) {
    var b = document.createElement('button'); b.className = 'toast-action'; b.textContent = actionLabel;
    b.onclick = function () { t.classList.add('hidden'); actionFn(); };
    t.appendChild(b);
  }
  t.classList.remove('hidden'); clearTimeout(t._h);
  t._h = setTimeout(function () { t.classList.add('hidden'); }, actionLabel ? 6000 : 2200);
}
function openSheet(html) { document.getElementById('sheetBody').innerHTML = html; document.getElementById('sheet').classList.remove('hidden'); }
var scanSession = 0; // bumped when the scanner opens or a sheet closes; late lookups compare against it
function closeSheet() { scanSession++; S.sharedPhoto = null; if (window.Scanner) Scanner.stop(); document.getElementById('sheet').classList.add('hidden'); }

var TITLES = { simple: '', home: 'Home', recipes: 'Recipes', scan: 'Add', pantry: 'Pantry', diary: 'Diary', settings: 'Settings', recipe: 'Recipe' };
var currentScreen = 'home';
function showScreen(name, arg) {
  currentScreen = name;
  document.getElementById('screenTitle').textContent = TITLES[name] || name;
  document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === name); });
  var fn = { simple: renderSimple, home: renderHome, recipes: renderRecipes, scan: renderScan, pantry: renderPantry, diary: renderDiary, settings: renderSettings, recipe: renderRecipe }[name];
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
    (r.photo_data || r.photo_path ? '<img class="photo-thumb" alt="" data-photo="' + r.id + '" data-store="recipes"' + (r.photo_data ? ' src=\"' + esc(r.photo_data) + '\"' : '') + '>' : '') +
    '<div class="grow"><h3>' + esc(r.title) + '</h3>' +
    '<div class="muted">' + (r.cuisine ? esc(r.cuisine) + ' · ' : '') + (info.nut.perServing.kcal ? '~' + info.nut.perServing.kcal + ' kcal/serving · ' : '') + info.cov.have + '/' + info.cov.total + ' on hand' + (miss ? ' · need ' + miss : '') + '</div>' +
    '<div class="chips" style="margin:4px 0 0">' + (r.review_flag ? '<span class="badge warn">&#9888; check</span>' : '') + profileBadge(r.id) + (r.meal_type || []).map(function (m) { return '<span class="badge">' + esc(m) + '</span>'; }).join('') + '</div>' +
    '</div><div class="ring" style="--pct:' + info.cov.pct + '" title="' + info.cov.pct + '% of ingredients on hand"><span>' + info.cov.pct + '%</span></div></div>';
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
  var todays = State.diary.filter(function (e) { return localDay(e.eaten_at) === todayISO() && (!State.activeProfile || e.for_profile_id === State.activeProfile); });
  var prof = State.profiles.find(function (p) { return p.id === State.activeProfile; });
  var html = profileSwitcher();
  html += '<h2>Today so far</h2>' + dvTiles(Logic.dayTotals(todays), prof && prof.daily_targets);
  if (!State.recipes.length) html += '<div class="card"><h3>Welcome</h3><p class="muted">Add a recipe and a few pantry items and this screen fills in with what you can cook tonight. Try <b>Settings &rarr; Load sample data</b> to see it working.</p></div>';
  html += '<h2>Cook tonight</h2>' + (cookNow.length ? cookNow.slice(0, 6).map(recipeCard).join('') : '<div class="empty">Nothing fully covered yet.</div>');
  html += '<h2>One trip away</h2>' + (oneTrip.length ? oneTrip.slice(0, 6).map(recipeCard).join('') : '<div class="empty">No near-misses.</div>');
  if (useUp.length) html += '<h2>Use it up</h2><p class="muted">' + expiring.map(function (p) { return esc(S.ingById[p.ingredient_id].name) + ' (' + esc(p.expires_on) + ')'; }).join(', ') + '</p>' + useUp.slice(0, 4).map(recipeCard).join('');
  if (restock.length) html += '<h2>Restock</h2>' + restock.map(function (s) { return '<div class="list-item"><div class="grow"><b>' + esc(S.ingById[s.ingredient_id].name) + '</b><div class="muted">' + esc(s.why) + '</div></div><button class="btn sm" onclick="addToList(\'' + s.ingredient_id + '\',\'low_stock\')">+ list</button></div>'; }).join('');
  var open = State.shopping.filter(function (s) { return !s.done; });
  if (open.length) html += '<h2>Shopping list (' + open.length + ')</h2>' + renderShoppingList(open);
  return html;
}
// Walk-the-store order. Each device keeps its own (stores differ); the default suits most US groceries.
var DEFAULT_AISLES = ['produce', 'bakery', 'meat', 'dairy', 'pantry', 'spice', 'frozen', 'drink', 'other'];
function aisleOrder() {
  var saved = State.aisleOrder || [];
  return saved.concat(DEFAULT_AISLES.filter(function (a) { return saved.indexOf(a) < 0; }));
}
function shoppingByAisle(items) {
  var byCat = {};
  items.forEach(function (s) { var cat = (S.ingById[s.ingredient_id] || {}).category || 'other'; (byCat[cat] = byCat[cat] || []).push(s); });
  return aisleOrder().filter(function (a) { return byCat[a]; }).map(function (a) { return { aisle: a, items: byCat[a] }; })
    .concat(Object.keys(byCat).filter(function (c) { return aisleOrder().indexOf(c) < 0; }).map(function (c) { return { aisle: c, items: byCat[c] }; }));
}
function renderShoppingList(items) {
  return shoppingByAisle(items).map(function (g) {
    return '<div class="card"><h3>' + esc(g.aisle) + '</h3>' + g.items.map(function (s) {
      return '<label class="list-item"><input type="checkbox" style="width:auto" onchange="toggleShop(\'' + s.id + '\')"><div class="grow">' + esc((S.ingById[s.ingredient_id] || {}).name) + ' <span class="muted">' + fmtQty(s.qty, s.unit) + ' · ' + esc((s.reason || '').replace(/_/g, ' ')) + '</span></div></label>';
    }).join('') + '</div>';
  }).join('') + '<div class="btn-row"><button class="btn ghost sm" onclick="shareShoppingList()">Share list</button></div>';
}
function shoppingListText() {
  return 'Shopping list\n' + shoppingByAisle(State.shopping.filter(function (s) { return !s.done; })).map(function (g) {
    return '\n' + g.aisle.toUpperCase() + '\n' + g.items.map(function (s) { return '- ' + (S.ingById[s.ingredient_id] || {}).name + (s.qty ? ' (' + fmtQty(s.qty, s.unit) + ')' : ''); }).join('\n');
  }).join('\n');
}
// Hand the list to texts, notes or email; fall back to the clipboard.
function shareShoppingList() {
  var text = shoppingListText();
  if (navigator.share) return navigator.share({ title: 'Shopping list', text: text }).catch(function () {});
  copyText(text, 'List copied');
}
function copyText(text, msg) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { toast(msg || 'Copied'); }, function () { toast('Could not copy'); });
  toast('Copy is not available here');
}
function moveAisle(aisle, dir) {
  var order = aisleOrder(), i = order.indexOf(aisle), j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  order.splice(i, 1); order.splice(j, 0, aisle);
  State.aisleOrder = order;
  DB.meta('aisle_order', order).then(refresh);
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
    if (f.review && !r.review_flag) return false;
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
    reviewBanner() +
    '<div class="btn-row"><button class="btn" onclick="editRecipe()">+ New recipe</button></div>' +
    '<div id="recipeList">' + (list.length ? list.map(recipeCard).join('') : '<div class="empty">No matches.</div>' + buyHint) + '</div>';
}
function reviewBanner() {
  var n = State.recipes.filter(function (r) { return r.review_flag; }).length;
  if (!n && !State.filters.review) return '';
  return '<div class="note">' + (n ? n + ' imported recipe' + (n === 1 ? '' : 's') + ' flagged to check. ' : 'Nothing left to check. ') +
    '<button class="btn sm' + (State.filters.review ? '' : ' ghost') + '" onclick="State.filters.review=!State.filters.review;refresh()">' + (State.filters.review ? 'Show all' : 'Show flagged') + '</button></div>';
}
function refreshList() { var el = document.getElementById('recipeList'); if (el) { var list = filteredRecipes(); el.innerHTML = list.length ? list.map(recipeCard).join('') : '<div class="empty">No matches.</div>'; hydratePhotos(); } }

function renderRecipe(id) {
  S.lastArg = id;
  var r = State.recipes.find(function (x) { return x.id === id; });
  if (!r) return '<div class="empty">Recipe not found.</div>';
  var info = S.recipeInfo[id], lines = S.linesByRecipe[id] || [];
  var vars = State.variations.filter(function (v) { return v.recipe_id === id; });
  var fitHtml = '';
  if (r.review_flag) fitHtml += '<div class="note"><b>Check this import:</b> ' + esc(r.review_flag) + ' <button class="btn sm" onclick="clearReviewFlag(\'' + id + '\')">Looks good</button> <button class="btn sm ghost" onclick="editRecipe(\'' + id + '\')">Fix it</button></div>';
  State.profiles.forEach(function (p) { var f = info.fits[p.id]; if (f.reasons.length) fitHtml += '<div class="note"><b>' + esc(p.person_name) + ':</b> ' + esc(f.reasons.join('; ')) + ' <button class="btn sm ghost" onclick="askSwaps(\'' + id + '\',\'' + p.id + '\')">Suggest swaps</button></div>'; });
  return (r.photo_data || r.photo_path ? '<img class="photo-hero" alt="Photo of ' + esc(r.title) + '" data-photo="' + r.id + '" data-store="recipes"' + (r.photo_data ? ' src=\"' + esc(r.photo_data) + '\"' : '') + '>' : '') +
    '<div class="card"><div class="row between"><h2 style="margin:0">' + esc(r.title) + '</h2><div class="ring" style="--pct:' + info.cov.pct + '"><span>' + info.cov.pct + '%</span></div></div>' +
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
  S.pendingDraft = null; S.pendingPhoto = null;
  var r = id ? State.recipes.find(function (x) { return x.id === id; }) : { title: '', servings: 4, steps: [], meal_type: [] };
  var hasPhoto = !!(r.photo_data || r.photo_path);
  var lines = id ? (S.linesByRecipe[id] || []).map(function (l) { return fmtQty(l.qty, l.unit) + ' ' + ((S.ingById[l.ingredient_id] || {}).name || '') + (l.prep_note ? ', ' + l.prep_note : ''); }).join('\n') : '';
  openSheet('<h2 style="margin-top:0">' + (id ? 'Edit' : 'New') + ' recipe</h2>' +
    '<label>Title</label><input id="fTitle" value="' + esc(r.title) + '">' +
    '<div class="row"><div class="grow"><label>Servings</label><input id="fServ" type="number" value="' + (r.servings || 4) + '"></div><div class="grow"><label>Cuisine</label><input id="fCuis" value="' + esc(r.cuisine || '') + '"></div></div>' +
    '<div class="row"><div class="grow"><label>Prep min</label><input id="fPrep" type="number" value="' + (r.prep_min || '') + '"></div><div class="grow"><label>Cook min</label><input id="fCook" type="number" value="' + (r.cook_min || '') + '"></div></div>' +
    '<label>Meal type</label><div class="chips">' + FACETS.meal.map(function (m) { return '<span class="chip meal-chip ' + ((r.meal_type || []).indexOf(m) > -1 ? 'on' : '') + '" data-v="' + m + '" onclick="this.classList.toggle(\'on\')">' + m + '</span>'; }).join('') + '</div>' +
    '<label>Ingredients, one per line ("2 cups flour, sifted")</label><textarea id="fIng" rows="7">' + esc(lines) + '</textarea>' +
    '<label>Steps, one per line</label><textarea id="fSteps" rows="6">' + esc((r.steps || []).join('\n')) + '</textarea>' +
    '<label>Notes</label><textarea id="fNotes" rows="3">' + esc(r.notes || '') + '</textarea>' +
    '<label>Photo</label><div class="row">' + '<img id="fPhotoPrev" class="photo-thumb' + (hasPhoto ? '' : ' hidden') + '" alt=""' + (r.photo_data ? ' src=\"' + esc(r.photo_data) + '\"' : '') + '>' +
    '<input id="fPhoto" type="file" accept="image/*" class="grow" onchange="previewRecipePhoto(this)"></div>' +
    (hasPhoto ? '<label class="row" style="color:inherit"><input id="fPhotoRemove" type="checkbox" style="width:auto"> Remove photo</label>' : '') +
    '<p class="muted hidden" id="fPhotoNote">The scanned photo will be kept with this recipe.</p>' +
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
  if (id) rec.review_flag = null; // editing an imported recipe counts as checking it
  if (!id && S.pendingDraft) { rec.source_type = S.pendingDraft.source_type || 'manual'; if (S.pendingDraft.source_ref) rec.source_ref = S.pendingDraft.source_ref; }
  var lineTexts = v('fIng').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  var file = document.getElementById('fPhoto').files[0];
  var remove = document.getElementById('fPhotoRemove') && document.getElementById('fPhotoRemove').checked;
  var photo = file ? downscale(file, 1280) : Promise.resolve(remove ? null : S.pendingPhoto);
  photo.then(function (dataUrl) {
    if (dataUrl || remove) {
      // Replacing or removing: the old cloud copy is queued for deletion; a new one uploads on sync.
      if (rec.photo_path) Sync.removePhoto(rec.photo_path);
      rec.photo_path = null; rec.photo_data = dataUrl || null;
    }
    return saveRecipeWithLines(rec, lineTexts.map(Units.parseLine));
  }).then(function (saved) {
    closeSheet(); toast('Saved');
    if (Sync.enabled() && saved.photo_data && !saved.photo_path) syncNow();
    return loadAll().then(function () { showScreen('recipe', saved.id); });
  });
}
function previewRecipePhoto(input) {
  var f = input.files[0], img = document.getElementById('fPhotoPrev');
  if (!f || !img) return;
  img.src = URL.createObjectURL(f); img.classList.remove('hidden');
}
function deleteRecipe(id) {
  if (!confirm('Delete this recipe?')) return;
  Sync.removeRecordPhotos('recipes', id);
  Promise.all((S.linesByRecipe[id] || []).map(function (l) { return DB.remove('recipe_ingredients', l.id); })).then(function () { return DB.remove('recipes', id); }).then(function () { closeSheet(); return loadAll(); }).then(function () { showScreen('recipes'); });
}

/* ---------- Add / Scan ---------- */
function renderScan() {
  var cloud = Sync.enabled();
  return '<p class="muted">' + (cloud ? 'Photos and links are parsed in the cloud; the result always lands on a review screen first.' : 'Cloud not configured, so photo/receipt/link parsing is off. Barcodes, manual and paste entry still work.') + '</p>' +
    '<div class="grid-big">' +
    '<div class="big-btn" onclick="scanPhoto(\'recipe\')"><span class="ico">&#128247;</span>Recipe photo<div class="muted">card, cookbook, handwriting</div></div>' +
    '<div class="big-btn" onclick="scanPhoto(\'receipt\')"><span class="ico">&#129534;</span>Receipt<div class="muted">adds to pantry</div></div>' +
    '<div class="big-btn" onclick="scanGroceries(false)"><span class="ico">&#129387;</span>Groceries photo<div class="muted">fridge, shelf, bags: adds to pantry</div></div>' +
    '<div class="big-btn" onclick="scanGroceries(true)"><span class="ico">&#128444;</span>Groceries from saved photos<div class="muted">up to 6 at once</div></div>' +
    '<div class="big-btn" onclick="scanBarcode()"><span class="ico">&#9646;&#9646;&#9646;</span>Barcode<div class="muted">packaged item</div></div>' +
    '<div class="big-btn" onclick="pasteRecipe()"><span class="ico">&#128279;</span>Link / paste<div class="muted">URL or text</div></div>' +
    '</div>' +
    '<div class="btn-row"><button class="btn ghost" onclick="scanPhoto(\'recipe\', true)">&#128444; Recipe from saved photo</button><button class="btn ghost" onclick="scanPhoto(\'receipt\', true)">&#128444; Receipt from saved photo</button><button class="btn ghost" onclick="batchImportRecipes()">&#128218; Batch import recipes</button></div>' +
    '<h2>Manual</h2><div class="btn-row"><button class="btn ghost" onclick="editRecipe()">Type a recipe</button><button class="btn ghost" onclick="editPantryItem()">Add pantry item</button><button class="btn ghost" onclick="logFood()">Log a meal</button></div>' +
    '<input id="scanFile" type="file" accept="image/*" capture="environment" class="hidden" onchange="onScanFile(this)">' +
    '<input id="scanLibrary" type="file" accept="image/*" class="hidden" onchange="onScanFile(this)">' +
    '<input id="scanBatch" type="file" accept="image/*" multiple class="hidden" onchange="onBatchFiles(this)">' + groceryInputs();
}
var scanKind = 'recipe';
// fromLibrary opens the saved-photos picker; otherwise the camera opens directly.
function scanPhoto(kind, fromLibrary) { scanKind = kind; if (!Sync.enabled()) return toast('Configure Supabase first (Settings)'); document.getElementById(fromLibrary ? 'scanLibrary' : 'scanFile').click(); }
function onScanFile(input) {
  var file = input.files[0]; if (!file) return;
  scanImage(scanKind, file);
  input.value = '';
}
// Recipe or receipt photo (from the camera, a file, or a share) -> cloud parse -> review screen.
function scanImage(kind, fileOrBlob) {
  closeSheet(); toast('Reading photo...');
  var shot;
  downscale(fileOrBlob, 1600).then(function (dataUrl) {
    shot = dataUrl;
    return Sync.brain(kind === 'receipt' ? 'parse_receipt' : 'parse_recipe', { image: dataUrl, ingredients: State.ingredients.map(function (i) { return i.name; }) });
  }).then(function (res) { kind === 'receipt' ? reviewPantry((res.items || []).filter(function (i) { return i.is_food !== false; }), 'receipt') : reviewRecipe(res, 'photo', shot); })
    .catch(function (e) { toast('Scan failed: ' + e.message); });
}
function downscale(file, max) {
  return new Promise(function (resolve, reject) {
    var img = new Image(); var url = URL.createObjectURL(file);
    img.onload = function () { var s = Math.min(1, max / Math.max(img.width, img.height)); var c = document.createElement('canvas'); c.width = img.width * s; c.height = img.height * s; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.82)); };
    img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('This photo could not be opened.')); };
    img.src = url;
  });
}
/* ---------- Pantry from photos ---------- */
// Photos of food on hand (live or saved, up to 6) -> the cloud lists the items -> the usual pantry review.
function groceryInputs() {
  return '<input id="groceryCam" type="file" accept="image/*" capture="environment" class="hidden" onchange="onGroceryFiles(this)">' +
    '<input id="groceryLib" type="file" accept="image/*" multiple class="hidden" onchange="onGroceryFiles(this)">';
}
function scanGroceries(fromLibrary) {
  if (!Sync.enabled()) return toast('Configure Supabase first (Settings)');
  document.getElementById(fromLibrary ? 'groceryLib' : 'groceryCam').click();
}
function onGroceryFiles(input) {
  var files = [].slice.call(input.files || []); input.value = '';
  if (!files.length) return;
  if (files.length > 6) { toast('Using the first 6 photos'); files = files.slice(0, 6); }
  readGroceryPhotos(files);
}
function readGroceryPhotos(files) {
  closeSheet(); toast('Looking at ' + (files.length === 1 ? 'the photo' : files.length + ' photos') + '...');
  Promise.all(files.map(function (f) { return downscale(f, 1600); })).then(function (images) {
    return Sync.brain('pantry_photo', { images: images, ingredients: State.ingredients.map(function (i) { return i.name; }) });
  }).then(function (res) {
    var items = (res.items || []).filter(function (i) { return i.is_food !== false; });
    if (!items.length) return toast('No food items found in that photo.');
    reviewPantry(items, 'photo');
  }).catch(function (e) { toast('Could not read the photo: ' + e.message); });
}

/* ---------- Batch recipe import ---------- */
// Many saved photos at once. Each photo is read on its own; pages that look cut off are
// matched up (Logic.stitchPages) and re-read together; every recipe is saved straight
// away, and anything the reader was unsure about gets review_flag for a later look.
var BATCH_MAX = 20, BATCH_PAGES_MAX = 6; // the brain reads at most 6 photos in one call
var batchRunning = false; // one import at a time, so progress and summaries never mix
function batchImportRecipes() {
  if (!Sync.enabled()) return toast('Configure Supabase first (Settings)');
  if (batchRunning) return toast('An import is still running. Wait for it to finish first.');
  document.getElementById('scanBatch').click();
}
function onBatchFiles(input) {
  var files = [].slice.call(input.files || []); input.value = '';
  if (!files.length) return;
  if (files.length > BATCH_MAX) { toast('Importing the first ' + BATCH_MAX + ' photos'); files = files.slice(0, BATCH_MAX); }
  runRecipeBatch(files);
}
// The batch panel's element, only while that panel is still the open sheet.
function batchEl(id) {
  var sheet = document.getElementById('sheet'), el = document.getElementById(id);
  return el && sheet && !sheet.classList.contains('hidden') ? el : null;
}
// Capture order is the best guess at page order (a page and the next are usually shot
// back to back). Use each photo's EXIF capture time when every photo has one; file dates
// can be reset by saving or downloading, so they are only the fallback.
function orderByCapture(files) {
  return Promise.all(files.map(function (f) {
    return f.slice(0, 131072).arrayBuffer().then(Logic.exifTakenAt, function () { return null; });
  })).then(function (taken) {
    var exif = taken.every(function (t) { return t != null; });
    var key = files.map(function (f, i) { return exif ? taken[i] : f.lastModified; });
    return files.map(function (f, i) { return i; })
      .sort(function (a, b) { return (key[a] - key[b]) || files[a].name.localeCompare(files[b].name); })
      .map(function (i) { return files[i]; });
  });
}
function runRecipeBatch(files) {
  batchRunning = true;
  var total = files.length;
  openSheet('<h2 style="margin-top:0">Importing ' + total + ' photo' + (total === 1 ? '' : 's') + '</h2>' +
    '<p id="batchMsg">Getting the photos in order...</p><progress id="batchBar" max="' + total + '" value="0" style="width:100%"></progress>' +
    '<p class="muted">Recipes save as they finish. You can close this; the import keeps going while the app is open.</p>');
  orderByCapture(files).then(function (sorted) { readBatch(sorted); }, function (e) { batchRunning = false; toast('Import stopped: ' + e.message); });
}
function readBatch(files) {
  var total = files.length, known = State.ingredients.map(function (i) { return i.name; });
  var shots = [], reads = [], done = 0, next = 0;
  function say(text) { var m = batchEl('batchMsg'), b = batchEl('batchBar'); if (m) m.textContent = text; if (b) b.value = done; }
  function readOne(i) {
    return downscale(files[i], 1600).then(function (d) { shots[i] = d; return Sync.brain('parse_recipe', { image: d, batch: true, ingredients: known }); })
      .then(function (r) { reads[i] = r; }, function (e) { reads[i] = { error: e.message }; })
      .then(function () { done++; say('Read ' + done + ' of ' + total + '...'); });
  }
  function worker() { if (next >= total) return Promise.resolve(); var i = next++; return readOne(i).then(worker); }
  Promise.all([worker(), worker()]).then(function () {
    var failed = 0, empty = 0, firstError = '';
    // Skipped photos keep their place, so pages on either side of one never look adjacent.
    var pages = reads.map(function (r) {
      if (r.error) { failed++; firstError = firstError || r.error; return { skip: true }; }
      if (!r.title && !(r.ingredients || []).length && !(r.steps || []).length) { empty++; return { skip: true }; }
      return { starts_mid: !!r.starts_mid_recipe, ends_incomplete: !!r.ends_incomplete };
    });
    var groups = Logic.stitchPages(pages);
    var saved = 0, flagged = 0, chain = Promise.resolve();
    say('Saving ' + groups.length + ' recipe' + (groups.length === 1 ? '' : 's') + '...');
    groups.forEach(function (g) {
      var idx = g.pages;
      chain = chain.then(function () {
        if (idx.length === 1) return { draft: reads[idx[0]], incomplete: !g.complete };
        if (idx.length > BATCH_PAGES_MAX) return { draft: joinDrafts(idx.map(function (i) { return reads[i]; })), incomplete: !g.complete };
        // Several pages: read them together so steps split across a page break join up.
        return Sync.brain('parse_recipe', { images: idx.map(function (i) { return shots[i]; }), batch: true, ingredients: known })
          .then(function (d) { return { draft: d, incomplete: d.starts_mid_recipe || d.ends_incomplete }; },
            function () { return { draft: joinDrafts(idx.map(function (i) { return reads[i]; })), incomplete: !g.complete }; });
      }).then(function (res) {
        var flag = batchFlag(res.draft, idx.length, res.incomplete);
        return saveBatchRecipe(res.draft, shots[idx[0]], flag).then(function () { saved++; if (flag) flagged++; });
      }).catch(function (e) { failed++; firstError = firstError || ('saving failed: ' + e.message); });
    });
    return chain.then(function () {
      var parts = ['Saved ' + saved + ' recipe' + (saved === 1 ? '' : 's')];
      if (flagged) parts.push(flagged + ' flagged to check');
      if (empty) parts.push(empty + ' photo' + (empty === 1 ? '' : 's') + ' had no recipe');
      if (failed) parts.push(failed + ' failed (' + firstError + ')');
      done = total; say(parts.join(', ') + '.');
      return loadAll().then(function () {
        var m = batchEl('batchMsg');
        if (m) m.insertAdjacentHTML('afterend', '<div class="btn-row"><button class="btn" onclick="closeSheet();State.filters.review=' + (flagged ? 'true' : 'false') + ';showScreen(\'recipes\')">' + (flagged ? 'Review flagged' : 'See recipes') + '</button><button class="btn ghost" onclick="closeSheet()">Done</button></div>');
        else toast(parts.join(', '));
        if (Sync.enabled()) syncNow();
      });
    });
  }).then(function () { batchRunning = false; }, function (e) { batchRunning = false; toast('Import stopped: ' + e.message); });
}
// Fallback when the combined re-read fails: stack the single-page reads in order.
function joinDrafts(drafts) {
  return {
    title: (drafts.find(function (d) { return d.title; }) || {}).title || '',
    servings: drafts[0].servings, cuisine: drafts[0].cuisine, meal_type: drafts[0].meal_type, prep_min: drafts[0].prep_min, cook_min: drafts[0].cook_min,
    ingredients: [].concat.apply([], drafts.map(function (d) { return d.ingredients || []; })),
    steps: [].concat.apply([], drafts.map(function (d) { return d.steps || []; })),
    notes: drafts.map(function (d) { return d.notes; }).filter(Boolean).join('\n'),
    confidence: Math.min.apply(null, drafts.map(function (d) { return d.confidence || 0; })),
    issues: [].concat.apply([], drafts.map(function (d) { return d.issues || []; })).concat('pages joined without a combined read')
  };
}
// Why a batch recipe needs a person's look, or null when it read cleanly.
function batchFlag(d, pageCount, incomplete) { // keeps up to 4 reported issues
  var f = [];
  if (pageCount > 1) f.push('combined from ' + pageCount + ' photos');
  if (incomplete) f.push('may be missing a page');
  if ((d.confidence || 0) < 0.6) f.push('hard to read');
  if (!d.title) f.push('no title found');
  (d.issues || []).slice(-4).forEach(function (s) { if (s) f.push(String(s)); });
  return f.length ? f.join('; ').slice(0, 300) : null;
}
function saveBatchRecipe(d, shot, flag) {
  var rec = { title: d.title || 'Untitled recipe', servings: d.servings || 4, cuisine: d.cuisine || '', prep_min: d.prep_min || null, cook_min: d.cook_min || null,
    meal_type: d.meal_type || [], steps: d.steps || [], notes: d.notes || '', source_type: 'photo', times_cooked: 0, photo_data: shot || null, review_flag: flag };
  return saveRecipeWithLines(rec, (d.ingredients || []).map(function (l) { return { qty: l.qty, unit: l.unit || '', name: l.name, prep: (l.prep || '') + (l.optional ? ' (optional)' : '') }; }));
}
// Clears only the flag on the stored record, so a sync that landed meanwhile (a photo
// path, a deletion from another device) is never overwritten by the copy on screen.
function clearReviewFlag(id) {
  DB.update('recipes', id, function (cur) { if (!cur || cur.deleted) return null; cur.review_flag = null; return cur; })
    .then(loadAll).then(function () { toast('Marked as checked'); refresh(); });
}

function scanBarcode() {
  scanSession++;
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
  var hit = null;
  var known = State.ingredients.find(function (i) {
    return [i.upc].concat(i.barcodes || []).some(function (b) { return codes.some(function (c) { if (Scanner.sameProduct(c, b)) { hit = c; return true; } }); });
  });
  if (known) return Promise.resolve({ name: known.name, known: true, code: hit });
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
  var mine = ++scanSession; // a newer lookup (or closing the sheet) supersedes this one
  var m = document.getElementById('scanMsg'); if (m) m.textContent = 'Found ' + codes[0] + ', looking it up...';
  lookupBarcode(codes).catch(function () { return { name: null, code: codes[0] }; }).then(function (res) {
    // The user closed the scanner (or opened another form) while this was in flight.
    if (mine !== scanSession || !document.getElementById('scanMsg')) return;
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
function reviewRecipe(draft, source, photoDataUrl) {
  var lines = (draft.ingredients || []).map(function (l) { return fmtQty(l.qty, l.unit) + ' ' + (l.name || '') + (l.prep ? ', ' + l.prep : ''); }).join('\n');
  editRecipe(); // resets pending state, so set it afterwards
  S.pendingDraft = Object.assign({ source_type: source }, draft);
  if (photoDataUrl) {
    S.pendingPhoto = photoDataUrl;
    var prev = document.getElementById('fPhotoPrev'); prev.src = photoDataUrl; prev.classList.remove('hidden');
    document.getElementById('fPhotoNote').classList.remove('hidden');
  }
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
      // Remember this barcode on the ingredient, even if it already has another (e.g. a second pack size).
      var known = it.upc && (Scanner.sameProduct(ing.upc, it.upc) || (ing.barcodes || []).some(function (b) { return Scanner.sameProduct(b, it.upc); }));
      var save = !it.upc || known ? Promise.resolve()
        : DB.put('ingredients', ing.upc ? Object.assign(ing, { barcodes: (ing.barcodes || []).concat(it.upc) }) : Object.assign(ing, { upc: it.upc }));
      return save.then(function () { return addToPantry(ing.id, qty, unit, guessLocation(ing), 'bought'); });
    });
  });
  chain.then(function () { toast('Pantry updated'); return loadAll(); }).then(function () {
    if (scanNext) { refresh(); scanBarcode(); } else { closeSheet(); showScreen('pantry'); }
  });
}
// Where a newly bought item goes: wherever this ingredient is already kept (so the
// existing record is topped up), else a default by category.
function guessLocation(ing) {
  var existing = (S.pantryByIng && S.pantryByIng[ing.id]) || [];
  if (existing.length) return existing[0].location || 'pantry';
  if (/frozen/.test(ing.name || '') || ing.category === 'frozen') return 'freezer';
  return ing.category === 'dairy' || ing.category === 'meat' || ing.category === 'produce' ? 'fridge' : 'pantry';
}

/* ---------- Pantry ---------- */
function renderPantry() {
  var q = (State.pq || '').toLowerCase();
  var items = State.pantry.filter(function (p) { return !q || ((S.ingById[p.ingredient_id] || {}).name || '').toLowerCase().indexOf(q) > -1; });
  var byLoc = {}; items.forEach(function (p) { (byLoc[p.location || 'pantry'] = byLoc[p.location || 'pantry'] || []).push(p); });
  var expiring = Logic.expiringSoon(State.pantry, 4);
  return '<div class="search"><input placeholder="Search pantry" value="' + esc(State.pq || '') + '" oninput="State.pq=this.value;refresh()"></div>' +
    '<div class="btn-row"><button class="btn" onclick="editPantryItem()">+ Add item</button><button class="btn ghost" onclick="scanGroceries(false)">&#128247; Photo of groceries</button><button class="btn ghost" onclick="scanGroceries(true)">&#128444; From saved photos</button><button class="btn ghost" onclick="showScreen(\'scan\')">Scan receipt</button></div>' + groceryInputs() +
    (expiring.length ? '<div class="note">Expiring soon: ' + expiring.map(function (p) { return esc(S.ingById[p.ingredient_id].name); }).join(', ') + '</div>' : '') +
    (items.length ? ['fridge', 'freezer', 'pantry', 'counter'].filter(function (l) { return byLoc[l]; }).map(function (loc) {
      return '<h2>' + loc + ' (' + byLoc[loc].length + ')</h2><div class="card">' + byLoc[loc].sort(function (a, b) { return S.ingById[a.ingredient_id].name.localeCompare(S.ingById[b.ingredient_id].name); }).map(function (p) {
        var ing = S.ingById[p.ingredient_id] || {};
        return '<div class="list-item"><div class="grow" onclick="editPantryItem(\'' + p.id + '\')"><b>' + esc(ing.name) + '</b> <span class="muted">' + esc(ing.category || '') + (p.expires_on ? ' · exp ' + esc(p.expires_on) : '') + (p.par_qty != null ? ' · par ' + esc(p.par_qty) : '') + '</span></div><div class="qty-ctl"><button onclick="bumpQty(\'' + p.id + '\',-1)">&minus;</button><span>' + fmtQty(p.qty, p.unit) + '</span><button onclick="bumpQty(\'' + p.id + '\',1)">+</button></div></div>';
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
  var entries = State.diary.filter(function (e) { return localDay(e.eaten_at) === day && (!State.activeProfile || e.for_profile_id === State.activeProfile); }).sort(function (a, b) { return a.eaten_at < b.eaten_at ? -1 : 1; });
  var prof = State.profiles.find(function (p) { return p.id === State.activeProfile; });
  var shift = function (n) { return shiftDay(day, n); };
  return '<div class="row between"><button class="btn ghost sm" onclick="State.day=\'' + shift(-1) + '\';refresh()">&larr;</button><b>' + (day === todayISO() ? 'Today' : day) + '</b><button class="btn ghost sm" onclick="State.day=\'' + shift(1) + '\';refresh()">&rarr;</button></div>' +
    profileSwitcher() + dvTiles(Logic.dayTotals(entries), prof && prof.daily_targets) +
    '<div class="btn-row"><button class="btn" onclick="logFood()">+ Log a meal</button></div>' +
    (entries.length ? entries.map(function (e) {
      var r = e.recipe_id ? State.recipes.find(function (x) { return x.id === e.recipe_id; }) : null;
      var who = State.profiles.find(function (p) { return p.id === e.for_profile_id; });
      return '<div class="card row">' + photoThumb(e) + '<div class="grow"><b>' + esc(r ? r.title : e.free_text) + '</b> <span class="muted">' + esc(localTime(e.eaten_at)) + (who ? ' · ' + esc(who.person_name) : '') + (e.portion_mult !== 1 ? ' · ' + esc(e.portion_mult) + 'x' : '') + '</span><div class="muted">' + Math.round((e.kcal || 0) * (e.portion_mult || 1)) + ' kcal · ' + Math.round((e.sodium_mg || 0) * (e.portion_mult || 1)) + ' mg sodium' + (e.estimate_source ? ' · ' + esc(e.estimate_source) : '') + photoStatus(e) + '</div></div><button class="icon-btn" aria-label="Delete entry" onclick="deleteDiaryEntry(\'' + e.id + '\')">&times;</button></div>';
    }).join('') : '<div class="empty">Nothing logged.</div>') +
    (prof ? '<h2>Notes for ' + esc(prof.person_name) + '\'s next appointment</h2><div class="card"><textarea id="profNotes" rows="4" placeholder="Questions to ask, patterns you noticed...">' + esc(prof.notes || '') + '</textarea><div class="btn-row"><button class="btn sm" onclick="saveProfileNotes(\'' + prof.id + '\')">Save notes</button><button class="btn sm ghost" onclick="weeklyDigest(\'' + prof.id + '\')">Weekly digest</button></div></div>' : '');
}
// Log a meal for whoever is eating it. The caregiver usually logs for someone else, so
// "who" defaults to the person on screen, then to whoever was logged for last.
function logFood() {
  DB.meta('last_eater').then(function (last) {
    var who = State.activeProfile || (State.profiles.some(function (p) { return p.id === last; }) ? last : '');
    var pad = function (d) { return localDay(d.toISOString()) + 'T' + localTime(d.toISOString()); };
    openSheet('<h2 style="margin-top:0">Log a meal</h2>' +
      '<label>Who is eating?</label><select id="lWho" onchange="if(this.value===\'__new\')addEaterInline(this)"><option value="">Me</option>' + State.profiles.map(function (p) { return '<option value="' + p.id + '" ' + (who === p.id ? 'selected' : '') + '>' + esc(p.person_name) + '</option>'; }).join('') + '<option value="__new">+ Someone new...</option></select>' +
      '<label>When</label><input id="lWhen" type="datetime-local" value="' + pad(new Date()) + '">' +
      '<label>Photo</label><div class="btn-row" style="margin-top:0"><button type="button" class="btn ghost sm" onclick="document.getElementById(\'lPhotoCam\').click()">&#128247; Take photo</button><button type="button" class="btn ghost sm" onclick="document.getElementById(\'lPhoto\').click()">&#128444; Choose photo</button></div>' +
      '<input id="lPhotoCam" type="file" accept="image/*" capture="environment" class="hidden" onchange="previewLogPhoto(this)"><input id="lPhoto" type="file" accept="image/*" class="hidden" onchange="previewLogPhoto(this)">' +
      '<img id="lPhotoPrev" class="photo-thumb hidden" alt="Meal photo preview">' +
      '<label>Recipe (if it was one of yours)</label><select id="lRecipe"><option value="">—</option>' + State.recipes.map(function (r) { return '<option value="' + r.id + '">' + esc(r.title) + '</option>'; }).join('') + '</select>' +
      '<label>Or describe it</label><input id="lText" placeholder="chili with garlic bread">' +
      '<label>What was in it, with amounts (optional, sharpens the estimate)</label><textarea id="lIng" rows="3" placeholder="1 cup chili&#10;1 slice garlic bread"></textarea>' +
      '<div class="row"><div class="grow"><label>Servings eaten</label><select id="lPort"><option value="0.5">½</option><option value="1" selected>1</option><option value="1.5">1½</option><option value="2">2</option></select></div><div class="grow"><label>Portion size (optional)</label><input id="lSize" placeholder="1 cup, half a plate"></div></div>' +
      '<details><summary class="muted">Know the numbers?</summary><div class="row"><div class="grow"><label>kcal</label><input id="lKcal" type="number"></div><div class="grow"><label>sodium mg</label><input id="lNa" type="number"></div></div></details>' +
      '<p class="muted">With no recipe or numbers, calories are estimated from the ingredients, portion and photo.</p>' +
      '<div class="btn-row"><button class="btn" onclick="saveLog()">Log</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>');
    if (S.sharedPhoto) showLogPreview(S.sharedPhoto);
  });
}
function previewLogPhoto(input) { if (input.files[0]) showLogPreview(input.files[0]); }
function showLogPreview(file) { var img = document.getElementById('lPhotoPrev'); if (img) { img.src = URL.createObjectURL(file); img.classList.remove('hidden'); } }
// Add a person to log meals for without leaving the log screen.
function addEaterInline(sel) {
  var name = (prompt('Who is eating? (name)') || '').trim();
  if (!name) { sel.value = ''; return; }
  DB.put('diet_profiles', { person_name: name, notes: '', daily_targets: {} }).then(function (p) {
    State.profiles.push(p);
    var opt = document.createElement('option'); opt.value = p.id; opt.textContent = name;
    sel.insertBefore(opt, sel.lastElementChild); sel.value = p.id;
    toast(name + ' added. Set their diet in Settings when you are ready.');
  });
}
function logFromRecipe(id) { logFood(); var wait = setInterval(function () { var el = document.getElementById('lRecipe'); if (el) { clearInterval(wait); el.value = id; } }, 30); setTimeout(function () { clearInterval(wait); }, 2000); }
// Totals for typed ingredient lines when every line matches a pantry ingredient with
// nutrition data; null when any line is unknown (the cloud estimate handles those).
function estimateFromLines(texts) {
  var lines = texts.map(Units.parseLine), ok = true;
  var mapped = lines.map(function (l) { var ing = Logic.ingredientMatch(l.name || '', State.ingredients); if (!ing || ing.kcal_100g == null || l.qty == null) ok = false; return { qty: l.qty, unit: l.unit, name: l.name, ingredient_id: ing && ing.id }; });
  if (!ok || !mapped.length) return null;
  return Logic.recipeNutrition({ servings: 1 }, mapped, S.ingById).perServing;
}
function saveLog() {
  var v = function (i) { var el = document.getElementById(i); return el ? el.value : ''; };
  var rid = v('lRecipe'), text = v('lText').trim(), port = +v('lPort') || 1, who = v('lWho') === '__new' ? '' : v('lWho');
  var ingLines = v('lIng').split('\n').map(function (x) { return x.trim(); }).filter(Boolean), size = v('lSize').trim();
  var when = v('lWhen') ? new Date(v('lWhen')) : new Date();
  if (isNaN(when)) when = new Date();
  var r = rid ? State.recipes.find(function (x) { return x.id === rid; }) : null;
  var e = { eaten_at: when.toISOString(), recipe_id: rid || null, free_text: text || (ingLines.length ? ingLines.join(', ') : (r ? '' : 'Meal')), portion_mult: port, for_profile_id: who || null, estimate_source: 'manual' };
  if (rid) { var per = S.recipeInfo[rid].nut.perServing; Logic.NUTRIENTS.forEach(function (k) { e[k] = per[k]; }); e.estimate_source = 'recipe'; }
  var manual = !!v('lKcal');
  if (manual) e.kcal = +v('lKcal');
  if (v('lNa')) e.sodium_mg = +v('lNa');
  var file = (document.getElementById('lPhotoCam').files[0]) || (document.getElementById('lPhoto').files[0]) || S.sharedPhoto;
  S.sharedPhoto = null;
  DB.meta('last_eater', who || '');
  var p = file ? downscale(file, 1280).then(function (d) { e.photo_data = d; }, function () { toast('That photo could not be opened; logging without it.'); }) : Promise.resolve();
  p.then(function () {
    if (rid || manual) return;
    var local = ingLines.length && !size ? estimateFromLines(ingLines) : null;
    if (local) { Logic.NUTRIENTS.forEach(function (k) { e[k] = local[k]; }); e.estimate_source = 'ingredients'; return; }
    if (!Sync.enabled() || !(text || ingLines.length || e.photo_data)) return;
    var desc = [text, ingLines.length ? 'Ingredients and amounts: ' + ingLines.join('; ') : '', size ? 'Portion size: ' + size : ''].filter(Boolean).join('\n');
    toast('Estimating calories...');
    return Sync.brain('estimate_plate', { text: desc, image: e.photo_data || null }).then(function (res) {
      Logic.NUTRIENTS.forEach(function (k) { if (res[k] != null) e[k] = res[k]; }); e.estimate_source = 'estimate'; e.confidence = res.confidence;
      if (!text && !ingLines.length && res.items && res.items.length) e.free_text = res.items.map(function (it) { return it.name; }).join(', ');
    }).catch(function (err) { toast('Logged without an estimate: ' + err.message); });
  }).then(function () {
    var writes = [DB.put('diary_entries', e)];
    if (rid) (S.linesByRecipe[rid] || []).forEach(function (l) { writes.push(DB.put('usage_log', { ingredient_id: l.ingredient_id, qty: 1, unit: l.unit, event: 'logged', at: e.eaten_at })); });
    return Promise.all(writes);
  }).then(function () { closeSheet(); toast('Logged'); State.day = localDay(e.eaten_at); return loadAll(); }).then(function () {
    showScreen('diary');
    if (e.photo_data && Sync.enabled()) syncNow().then(function () { return loadAll(); }).then(function () { if (currentScreen === 'diary') refresh(); });
  });
}

/* ---------- diary photos ---------- */
function photoThumb(e) {
  if (!e.photo_data && !e.photo_path) return '';
  // A real button so the full view is reachable by keyboard and announced as a control.
  return '<button type="button" class="photo-btn" aria-label="View meal photo" onclick="viewPhoto(\'' + e.id + '\')"><img class="photo-thumb" alt="" data-photo="' + e.id + '"' + (e.photo_data ? ' src=\"' + esc(e.photo_data) + '\"' : '') + '></button>';
}
function photoStatus(e) {
  if (!Sync.enabled() || (!e.photo_data && !e.photo_path)) return '';
  return e.photo_path ? ' · &#9729; photo saved' : ' · photo uploads on next sync';
}
// Fill in thumbnails that only exist in the cloud. Called after the diary renders.
// Fill in photos that only exist in the cloud. Runs after every screen render.
function hydratePhotos() {
  document.querySelectorAll('img[data-photo]:not([src])').forEach(function (img) {
    var store = img.dataset.store || 'diary_entries';
    var list = store === 'recipes' ? State.recipes : State.diary;
    var rec = list.find(function (x) { return x.id === img.dataset.photo; });
    if (!rec) return;
    Sync.photoSrc(rec, store).then(function (src) { if (src && img.isConnected) img.src = src; });
  });
}
function viewPhoto(id) {
  var e = State.diary.find(function (x) { return x.id === id; });
  if (!e) return;
  var r = e.recipe_id ? State.recipes.find(function (x) { return x.id === e.recipe_id; }) : null;
  openSheet('<h2 style="margin-top:0">' + esc(r ? r.title : e.free_text || 'Meal') + '</h2><p class="muted">' + localDay(e.eaten_at) + ' ' + localTime(e.eaten_at) + '</p><img id="bigPhoto" class="photo-big" alt="Meal photo"><div class="btn-row"><button class="btn ghost" onclick="closeSheet()">Close</button></div>');
  var el = document.getElementById('bigPhoto'); // this sheet's image; a later sheet makes a new one
  Sync.photoSrc(e).then(function (src) {
    if (!el.isConnected) return;
    if (src) el.src = src;
    else el.replaceWith(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Photo is in the cloud. Sign in or reconnect to see it.' }));
  });
}
function deleteDiaryEntry(id) {
  var e = State.diary.find(function (x) { return x.id === id; });
  if (!e || !confirm('Delete this diary entry' + (e.photo_data || e.photo_path ? ' and its photo' : '') + '?')) return;
  DB.update('diary_entries', id, function (cur) { if (!cur) return null; cur.deleted = true; cur.photo_data = null; return cur; })
    .then(function () { return Sync.removeRecordPhotos('diary_entries', id); }).then(loadAll).then(refresh);
}
function saveProfileNotes(id) { var p = State.profiles.find(function (x) { return x.id === id; }); p.notes = document.getElementById('profNotes').value; DB.put('diet_profiles', p).then(function () { toast('Saved'); }); }
// Everything the digest, the copyable summary and the Claude draft are built from.
function digestData(pid, span) {
  var since = Date.now() - span * 864e5;
  var prof = State.profiles.find(function (x) { return x.id === pid; });
  var entries = State.diary.filter(function (e) { return e.for_profile_id === pid && new Date(e.eaten_at).getTime() >= since; });
  var t = Logic.dayTotals(entries);
  var days = Math.max(1, new Set(entries.map(function (e) { return localDay(e.eaten_at); })).size);
  var avg = {}; Logic.NUTRIENTS.forEach(function (k) { avg[k] = Math.round(t[k] / days); });
  var counts = {};
  entries.forEach(function (e) { var r = e.recipe_id && State.recipes.find(function (x) { return x.id === e.recipe_id; }); var name = r ? r.title : (e.free_text || 'unnamed'); counts[name] = (counts[name] || 0) + 1; });
  var top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 6).map(function (n) { return { name: n, times: counts[n] }; });
  var hits = [];
  State.recipes.forEach(function (r) { var f = S.recipeInfo[r.id].fits[pid]; if (f.level !== 'ok' && entries.some(function (e) { return e.recipe_id === r.id; })) hits.push({ dish: r.title, reasons: f.reasons }); });
  var fits = State.recipes.filter(function (r) { return S.recipeInfo[r.id].fits[pid].level === 'ok'; }).sort(function (a, b) { return (b.times_cooked || 0) - (a.times_cooked || 0); }).slice(0, 5).map(function (r) { return r.title; });
  var targets = {}; Logic.NUTRIENTS.forEach(function (k) { targets[k] = (prof.daily_targets || {})[k] || Logic.DV[k]; });
  return { prof: prof, span: span, entries: entries.length, days: days, avg: avg, targets: targets, top: top, hits: hits, fits: fits, rules: (S.rulesByProfile[pid] || []).map(describeRule) };
}
var NUTRIENT_LABEL = { kcal: 'Calories', sodium_mg: 'Sodium (mg)', sugar_g: 'Sugar (g)', fiber_g: 'Fiber (g)', protein_g: 'Protein (g)', potassium_mg: 'Potassium (mg)', carbs_g: 'Carbs (g)', fat_g: 'Fat (g)' };
function digestText(d) {
  var L = [d.prof.person_name + ': food diary summary, last ' + d.span + ' days', plural(d.entries, 'meal') + ' logged on ' + plural(d.days, 'day') + '.', '', 'Daily averages (target):'];
  ['kcal', 'sodium_mg', 'sugar_g', 'fiber_g', 'protein_g', 'potassium_mg'].forEach(function (k) { L.push('- ' + NUTRIENT_LABEL[k] + ': ' + d.avg[k] + ' (' + d.targets[k] + ')'); });
  if (d.top.length) { L.push('', 'Eaten most:'); d.top.forEach(function (x) { L.push('- ' + x.name + ' x' + x.times); }); }
  if (d.hits.length) { L.push('', 'Dishes outside the current rules:'); d.hits.forEach(function (h) { L.push('- ' + h.dish + ': ' + h.reasons.join('; ')); }); }
  if (d.rules.length) { L.push('', 'Rules in the app:'); d.rules.forEach(function (r) { L.push('- ' + r); }); }
  if (d.prof.notes) L.push('', 'Caregiver notes:', d.prof.notes);
  L.push('', 'Estimates from a home food diary, not a medical record.');
  return L.join('\n');
}
function weeklyDigest(pid, span) {
  span = span || 7;
  var d = digestData(pid, span);
  d.token = (S.digestSeq = (S.digestSeq || 0) + 1);
  S.digest = d;
  openSheet('<h2 style="margin-top:0" id="digestSheet" data-token="' + d.token + '">' + esc(d.prof.person_name) + ' · last ' + span + ' days</h2>' +
    '<div class="chips">' + [7, 14, 30].map(function (n) { return '<span class="chip ' + (n === span ? 'on' : '') + '" onclick="weeklyDigest(\'' + pid + '\',' + n + ')">' + n + ' days</span>'; }).join('') + '</div>' +
    '<p class="muted">' + plural(d.entries, 'entry', 'entries') + ' over ' + plural(d.days, 'day') + '. Daily averages:</p>' + dvTiles(d.avg, d.prof.daily_targets) +
    '<h3 style="margin-top:14px">Rules hit</h3>' + (d.hits.length ? d.hits.map(function (h) { return '<div class="note">' + esc(h.dish + ': ' + h.reasons.join('; ')) + '</div>'; }).join('') : '<p class="muted">' + (d.rules.length ? 'None.' : 'No rules set up yet.') + '</p>') +
    '<h3 style="margin-top:14px">Dishes that already fit</h3>' + (d.fits.length ? d.fits.map(function (t) { return '<div>&bull; ' + esc(t) + '</div>'; }).join('') : '<p class="muted">Add a few recipes first.</p>') +
    '<p class="note" style="margin-top:14px">A summary of what was logged, not medical advice. Bring it to ' + esc(d.prof.person_name) + '\'s doctor or dietitian.</p>' +
    '<div class="btn-row"><button class="btn" onclick="shareDigest()">Share summary</button><button class="btn ghost" onclick="copyText(digestText(S.digest), \'Summary copied\')">Copy</button>' +
    (Sync.enabled() ? '<button class="btn ghost" onclick="draftAppointmentSummary()">Draft with Claude</button>' : '') +
    '<button class="btn ghost" onclick="closeSheet()">Close</button></div>');
}
function shareDigest() {
  var text = digestText(S.digest);
  if (navigator.share) return navigator.share({ title: S.digest.prof.person_name + ' food summary', text: text }).catch(function () {});
  copyText(text, 'Summary copied');
}
// Claude turns the numbers into a short brief with questions to bring to the appointment.
function draftAppointmentSummary() {
  var d = S.digest; toast('Drafting...');
  var token = S.summaryToken = (S.summaryToken || 0) + 1;
  var payload = { person: d.prof.person_name, span_days: d.span, meals_logged: d.entries, days_logged: d.days, daily_averages: d.avg, daily_targets: d.targets, eaten_most: d.top, rule_hits: d.hits, rules: d.rules, dishes_that_fit: d.fits, caregiver_notes: d.prof.notes || '' };
  Sync.brain('appointment_summary', { digest: payload }).then(function (res) {
    // A newer draft started, or the caregiver moved on to another digest: drop this one.
    var marker = document.getElementById('digestSheet');
    var open = marker && marker.dataset.token === String(d.token) && !document.getElementById('sheet').classList.contains('hidden');
    if (token !== S.summaryToken || S.digest !== d || !open) return;
    document.getElementById('toast').classList.add('hidden');
    S.summary = { res: res, d: d }; // actions below use this pair, never the current S.digest
    var list = function (title, items) { return items && items.length ? '<h3 style="margin-top:14px">' + title + '</h3>' + items.map(function (x) { return '<div>&bull; ' + esc(x) + '</div>'; }).join('') : ''; };
    openSheet('<h2 style="margin-top:0">For ' + esc(d.prof.person_name) + '\'s next appointment</h2><p>' + esc(res.headline) + '</p>' +
      list('Patterns', res.patterns) + list('Worth watching', res.watch_items) + list('Questions to ask', res.questions_for_clinician) + list('Foods that already fit', res.foods_that_fit) +
      '<p class="note" style="margin-top:14px">' + esc(res.caveats || 'Drafted from a home food diary. Not medical advice.') + '</p>' +
      '<div class="btn-row"><button class="btn" onclick="shareSummary()">Share</button><button class="btn ghost" onclick="addQuestionsToNotes()">Add questions to notes</button><button class="btn ghost" onclick="weeklyDigest(\'' + d.prof.id + '\',' + d.span + ')">Back</button></div>');
  }).catch(function (e) { toast(e.message); });
}
function summaryText(res, d) {
  var sec = function (t, xs) { return xs && xs.length ? '\n' + t + ':\n' + xs.map(function (x) { return '- ' + x; }).join('\n') : ''; };
  return d.prof.person_name + ', last ' + d.span + ' days\n' + res.headline + sec('Patterns', res.patterns) + sec('Worth watching', res.watch_items) + sec('Questions to ask', res.questions_for_clinician) + sec('Foods that already fit', res.foods_that_fit) + '\n\n' + (res.caveats || '');
}
function shareSummary() {
  var text = summaryText(S.summary.res, S.summary.d);
  if (navigator.share) return navigator.share({ title: 'Appointment notes', text: text }).catch(function () {});
  copyText(text, 'Copied');
}
function addQuestionsToNotes() {
  var pid = S.summary.d.prof.id, qs = S.summary.res.questions_for_clinician || [];
  if (!qs.length) return toast('No questions to add');
  var block = 'Questions (' + todayISO() + '):\n' + qs.map(function (q) { return '- ' + q; }).join('\n');
  // Append to the profile as it is now, not the copy from when the digest opened.
  DB.update('diet_profiles', pid, function (cur) {
    if (!cur || cur.deleted) return null;
    cur.notes = (cur.notes ? cur.notes + '\n\n' : '') + block; return cur;
  }).then(function (saved) { toast(saved ? 'Added to notes' : 'That profile no longer exists'); closeSheet(); return loadAll(); }).then(refresh);
}

/* ---------- Settings ---------- */
function renderSettings() {
  var cloud = Sync.enabled();
  return '<h2>Cloud sync</h2><div class="card">' + (cloud ? '<div id="authBox">Checking...</div>' + (Sync.config().source === 'device' ? '<p><button class="linkish" onclick="disconnectCloud()">Disconnect this device from the cloud</button></p>' : '')
    : Sync.configured() ? '<p class="muted">Cloud details are set, but the sync library did not load. Check the connection and reload.</p>'
    : '<p class="muted">Everything stays on this device until you connect your Supabase project. If someone sent you a setup link, just open it on this device instead.</p>' +
      '<label>Project URL</label><input id="cfgUrl" placeholder="https://abcd1234.supabase.co" autocomplete="off">' +
      '<label>Anon (public) key</label><input id="cfgKey" placeholder="eyJ..." autocomplete="off">' +
      '<div class="btn-row"><button class="btn sm" onclick="connectCloud()">Connect</button></div>') + '</div>' +
    '<h2>Diet profiles</h2>' + State.profiles.map(function (p) {
      var rules = S.rulesByProfile[p.id] || [];
      return '<div class="card"><div class="row between"><h3>' + esc(p.person_name) + '</h3><button class="btn sm ghost" onclick="editProfile(\'' + p.id + '\')">Edit</button></div><div class="muted">' + (Object.keys(p.daily_targets || {}).length ? Object.keys(p.daily_targets).map(function (k) { return esc(k.replace('_', ' ') + ' ≤ ' + p.daily_targets[k]); }).join(', ') : 'no daily targets') + '</div>' +
        (rules.length ? rules.map(function (r) { return '<div class="list-item"><span class="badge ' + (r.severity === 'hard' ? 'bad' : 'warn') + '">' + esc(r.severity) + '</span><div class="grow">' + esc(describeRule(r)) + (r.source ? ' <span class="muted">— ' + esc(r.source) + '</span>' : '') + '</div><button class="icon-btn" onclick="DB.remove(\'profile_rules\',\'' + r.id + '\').then(loadAll).then(refresh)">&times;</button></div>'; }).join('') : '<p class="muted">No rules yet.</p>') +
        '<div class="btn-row"><button class="btn sm" onclick="addRule(\'' + p.id + '\')">+ Rule</button><button class="btn sm ghost" onclick="starterPacks(\'' + p.id + '\')">Starter packs</button><button class="btn sm ghost" onclick="enableSimple(\'' + p.id + '\')">Simple view on this device</button></div></div>';
    }).join('') + '<div class="btn-row"><button class="btn" onclick="editProfile()">+ Add person</button></div>' +
    '<h2>Ingredients (' + State.ingredients.length + ')</h2><div class="card"><p class="muted">Canonical names that recipes and pantry share. Nutrition is per 100 g.</p><div class="btn-row"><button class="btn sm ghost" onclick="listIngredients()">Browse / edit</button></div></div>' +
    '<h2>Store aisle order</h2><div class="card"><p class="muted">The shopping list follows this order so you can walk the store once.</p>' + aisleOrder().map(function (a, i, all) {
      return '<div class="list-item"><div class="grow">' + esc(a) + '</div><button class="icon-btn" aria-label="Move ' + a + ' up" ' + (i === 0 ? 'disabled' : '') + ' onclick="moveAisle(\'' + a + '\',-1)">&uarr;</button><button class="icon-btn" aria-label="Move ' + a + ' down" ' + (i === all.length - 1 ? 'disabled' : '') + ' onclick="moveAisle(\'' + a + '\',1)">&darr;</button></div>';
    }).join('') + '</div>' +
    '<h2>Data</h2><div class="card"><div class="btn-row"><button class="btn ghost" onclick="exportJSON()">Export JSON</button><button class="btn ghost" onclick="document.getElementById(\'importFile\').click()">Restore from backup</button><input id="importFile" type="file" accept="application/json,.json" class="hidden" onchange="importJSON(this)"><button class="btn ghost" onclick="loadSample()">Load sample data</button><button class="btn danger" onclick="if(confirm(\'Erase everything on this device?\'))DB.wipe().then(function(){location.reload()})">Erase local data</button></div><p class="muted">v' + TCM_CONFIG.APP_VERSION + '</p></div>';
}
function connectCloud() {
  try { Sync.saveConfig(document.getElementById('cfgUrl').value, document.getElementById('cfgKey').value); }
  catch (e) { return toast(e.message); }
  toast('Connected. Sign in to start syncing.'); startAutoSync(); showScreen('settings');
}
function disconnectCloud() {
  if (!confirm('Disconnect this device? Data already on it stays here; it just stops syncing.')) return;
  Sync.clearConfig(); location.reload();
}
function copySetupLink() {
  Sync.inviteCode().then(function (code) {
    copyText(Sync.setupLink(code), 'Setup link copied. Anyone who signs in with it joins your household, so share it only with family.');
  }).catch(function (e) { toast(e.message); });
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
  openSheet('<h2 style="margin-top:0">Starter packs</h2><p class="muted">Pre-filled, editable rule sets based on public guidelines. They are a starting point for a conversation with a doctor or dietitian, not a prescription.</p>' +
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
// Backup keys (State names) -> IndexedDB stores.
// Fields that point at another record's id (rewired when a backup is re-keyed).
var BACKUP_REFS = ['recipe_id', 'ingredient_id', 'profile_id', 'for_profile_id'];
var PHOTO_BACKUP_KEYS = ['recipes', 'diary']; // only these tables have photo_path
// A backup file is untrusted input: every value is type-checked before it is stored,
// so nothing in it can reach the page as markup.
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var IMAGE_RE = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+\/]+=*$/;
var NUM_FIELDS = ['qty', 'par_qty', 'servings', 'prep_min', 'cook_min', 'rating', 'times_cooked', 'kcal_per_serving', 'kcal_100g', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sodium_mg', 'sugar_g', 'potassium_mg', 'density', 'kcal', 'portion_mult', 'confidence', 'max_per_serving', 'pos'];
var DATE_FIELDS = ['expires_on', 'opened_on', 'last_cooked_on'];
var TIME_FIELDS = ['eaten_at', 'at'];
function sanitizeBackupRecord(rec) {
  if (!rec || typeof rec !== 'object' || !UUID_RE.test(String(rec.id))) return null;
  var out = {};
  Object.keys(rec).forEach(function (k) {
    var v = rec[k];
    if (v === null || v === undefined) { out[k] = null; return; }
    if (BACKUP_REFS.indexOf(k) > -1) { out[k] = UUID_RE.test(String(v)) ? v : null; return; }
    if (NUM_FIELDS.indexOf(k) > -1) { var n = Number(v); out[k] = isFinite(n) ? n : null; return; }
    if (DATE_FIELDS.indexOf(k) > -1) { out[k] = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; return; }
    if (TIME_FIELDS.indexOf(k) > -1) { var t = new Date(v); out[k] = isNaN(t) ? null : t.toISOString(); return; }
    if (k === 'photo_data') { if (IMAGE_RE.test(v)) out[k] = v; return; }
    if (k === 'photo_path') { out[k] = /^[0-9a-f-]{36}\/(diary|recipes)\/[A-Za-z0-9._-]+$/.test(v) ? v : null; return; }
    if (k === 'severity') { out[k] = v === 'hard' ? 'hard' : 'soft'; return; }
    if (k === 'daily_targets') { // only known nutrients, only finite numbers
      out[k] = {};
      if (v && typeof v === 'object') Logic.NUTRIENTS.forEach(function (n) { var x = Number(v[n]); if (n in v && isFinite(x)) out[k][n] = x; });
      return;
    }
    if (typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number') { out[k] = v; return; }
    if (Array.isArray(v) || typeof v === 'object') { try { out[k] = JSON.parse(JSON.stringify(v)); } catch (e) {} } // steps, aliases, targets, body
  });
  if (TIME_FIELDS.some(function (f) { return f in rec && !out[f]; })) return null; // a diary/usage row needs its time
  return out;
}
var BACKUP_STORES = { ingredients: 'ingredients', recipes: 'recipes', lines: 'recipe_ingredients', variations: 'recipe_variations', pantry: 'pantry_items', profiles: 'diet_profiles', rules: 'profile_rules', diary: 'diary_entries', shopping: 'shopping_list', usage: 'usage_log' };
// Merge a backup into this device. Records with the same id are replaced; everything is
// queued for sync like a normal edit. Photos stored inside the backup upload again.
function importJSON(input) {
  var file = input.files[0]; input.value = '';
  if (!file) return;
  file.text().then(function (text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('That file is not a backup from this app.'); }
    var keys = Object.keys(BACKUP_STORES).filter(function (k) { return Array.isArray(data[k]); });
    if (!keys.length) throw new Error('That file is not a backup from this app.');
    var total = keys.reduce(function (n, k) { return n + data[k].length; }, 0);
    if (!confirm('Restore ' + total + ' records from ' + (data.exported_at || 'this backup').slice(0, 10) + '? Matching records on this device are replaced; nothing else is removed.')) return;
    return DB.meta('household_id').then(function (here) {
      // Ids are global. A backup from another household would collide with rows that
      // household still owns, so it gets fresh ids with every reference rewired. Older
      // backups do not say where they came from; with the cloud on, ask.
      var rekey = data.household_id ? data.household_id !== here
        : (Sync.enabled() && !!here && confirm('Did this backup come from a different household or account?\n\nOK: restore it as a fresh copy.\nCancel: it is from this household; merge it.'));
      var idMap = {};
      if (rekey) keys.forEach(function (k) { data[k].forEach(function (r) { if (r && UUID_RE.test(String(r.id))) idMap[r.id] = DB.uuid(); }); });
      var map = function (v) { return v && idMap[v] ? idMap[v] : v; };
      var writes = [];
      keys.forEach(function (k) {
        data[k].forEach(function (raw) {
          var rec = sanitizeBackupRecord(raw);
          if (!rec) return;
          delete rec.household_id; delete rec.fts; delete rec.updated_at;
          if (rekey) BACKUP_REFS.concat('id').forEach(function (f) { if (f in rec) rec[f] = map(rec[f]); });
          // A photo carried in the backup uploads again here; another household's stored
          // photo is not readable from this one, so that link is dropped.
          var store = BACKUP_STORES[k];
          if (PHOTO_BACKUP_KEYS.indexOf(k) > -1 && (rec.photo_data || rekey)) {
            // Same household: the photo uploads again under a new name, so the copies it
            // replaces (the backup's and this device's current one) are queued for removal.
            var old = rekey ? null : rec.photo_path;
            rec.photo_path = null;
            if (!rekey) {
              writes.push(DB.get(store, rec.id).then(function (local) {
                if (old) Sync.removePhoto(old);
                if (local && local.photo_path && local.photo_path !== old) Sync.removePhoto(local.photo_path);
                return DB.put(store, rec);
              }));
              return;
            }
          }
          writes.push(DB.put(store, rec));
        });
      });
      return Promise.all(writes);
    }).then(function (writes) { return loadAll().then(function () { return writes; }); }).then(function (writes) {
      toast('Restored ' + writes.length + ' records'); refresh();
      if (Sync.enabled()) syncNow();
    });
  }).catch(function (e) { toast(e.message); });
}
// The backup records which household it came from, so a restore elsewhere can re-key it.
// Photos this device has not downloaded yet are fetched first, so the backup is complete.
function buildBackup() {
  var missing = 0;
  var photoJobs = [['recipes', State.recipes], ['diary_entries', State.diary]].map(function (pair) {
    return Promise.all(pair[1].filter(function (r) { return r.photo_path && !r.photo_data; }).map(function (r) {
      return Sync.photoSrc(r, pair[0]).then(function (src) { if (!src) missing++; });
    }));
  });
  return Promise.all(photoJobs).then(function () { return DB.meta('household_id'); }).then(function (hid) {
    var out = { exported_at: new Date().toISOString(), version: TCM_CONFIG.APP_VERSION, household_id: hid || null, photos_missing: missing };
    Object.keys(BACKUP_STORES).forEach(function (k) { out[k] = State[k]; });
    return out;
  });
}
function exportJSON() {
  toast('Preparing backup...');
  buildBackup().then(function (out) {
    if (out.photos_missing) toast(out.photos_missing + ' photo(s) could not be downloaded and are not in this backup. Try again when online.');
    var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'caregiving-menu-' + todayISO() + '.json'; a.click();
  });
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
    openSheet('<h2 style="margin-top:0">Swaps for ' + esc(p.person_name) + '</h2>' + (res.options || []).map(function (o, i) { S['opt' + i] = o; return '<div class="card"><h3>' + esc(o.title) + '</h3><div class="muted">' + esc(o.summary || '') + '</div>' + (o.changes || []).map(function (c) { return '<div>&bull; ' + esc(c) + '</div>'; }).join('') + '<div class="btn-row"><button class="btn sm" onclick="keepVariation(\'' + id + '\',' + i + ',\'diet_swap\',\'' + pid + '\')">Keep as ' + esc(p.person_name) + '\'s version</button></div></div>'; }).join('') + '<p class="note">Suggestions only. Confirm anything medical with their care team.</p><div class="btn-row"><button class="btn ghost" onclick="closeSheet()">Close</button></div>');
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
