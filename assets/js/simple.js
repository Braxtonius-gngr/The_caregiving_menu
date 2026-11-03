/* Simple view: a large-text, single-person screen for the person being cared for.
 * It replaces the tabs on this device until a caregiver exits it from the footer. */
function simpleProfile() { return State.profiles.find(function (p) { return p.id === State.simple; }); }

function enableSimple(pid) {
  State.simple = pid;
  DB.meta('simple_mode', pid).then(function () { applySimpleChrome(); showScreen('simple'); });
}
function exitSimple() {
  if (!confirm('Leave the simple view on this device?')) return;
  State.simple = null;
  DB.meta('simple_mode', null).then(function () { applySimpleChrome(); showScreen('home'); });
}
function applySimpleChrome() { document.body.classList.toggle('simple', !!simpleProfile()); }

// Nutrients this person has a target or rule for; kcal and sodium when nothing is set yet.
function simpleNutrients(p) {
  var keys = Object.keys(p.daily_targets || {});
  (S.rulesByProfile[p.id] || []).forEach(function (r) { if (r.kind === 'limit_nutrient' && keys.indexOf(r.nutrient) < 0) keys.push(r.nutrient); });
  if (!keys.length) keys = ['kcal', 'sodium_mg'];
  return keys.filter(function (k) { return Logic.DV[k]; }).slice(0, 3);
}
var SIMPLE_LABEL = { kcal: 'Calories', sodium_mg: 'Salt (sodium)', sugar_g: 'Sugar', fiber_g: 'Fiber', protein_g: 'Protein', potassium_mg: 'Potassium', carbs_g: 'Carbs', fat_g: 'Fat' };
var SIMPLE_UNIT = { kcal: '', sodium_mg: ' mg', potassium_mg: ' mg' };

function renderSimple() {
  var p = simpleProfile();
  if (!p) { State.simple = null; applySimpleChrome(); return renderHome(); }
  document.getElementById('screenTitle').textContent = p.person_name;
  var day = todayISO(), hour = new Date().getHours();
  var greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  var eaten = State.diary.filter(function (e) { return e.for_profile_id === p.id && e.eaten_at.slice(0, 10) === day; }).sort(function (a, b) { return a.eaten_at < b.eaten_at ? -1 : 1; });
  var totals = Logic.dayTotals(eaten);
  var bars = simpleNutrients(p).map(function (k) {
    var tgt = (p.daily_targets || {})[k] || Logic.DV[k], val = Math.round(totals[k] || 0), pct = Math.round(100 * val / tgt);
    // Fiber and protein are things to reach; the rest are things to stay under.
    var goal = k === 'fiber_g' || k === 'protein_g';
    var words = goal ? (pct >= 100 ? 'reached for today' : pct >= 60 ? 'nearly there' : 'more would be good')
      : (pct > 100 ? 'over for today' : pct >= 70 ? 'getting close' : 'plenty of room');
    var tone = goal ? (pct >= 60 ? 'ok' : 'warn') : (pct > 100 ? 'bad' : pct >= 70 ? 'warn' : 'ok');
    return '<div class="simple-meter"><div class="row between"><b>' + SIMPLE_LABEL[k] + '</b><span class="badge ' + tone + '">' + words + '</span></div>' +
      '<div class="simple-bar" role="progressbar" aria-label="' + SIMPLE_LABEL[k] + '" aria-valuenow="' + val + '" aria-valuemax="' + tgt + '"><i class="' + tone + '" style="width:' + Math.min(100, pct) + '%"></i></div>' +
      '<div class="muted">' + val + ' of ' + tgt + (SIMPLE_UNIT[k] !== undefined ? SIMPLE_UNIT[k] : ' g') + '</div></div>';
  }).join('');

  var choices = State.recipes.filter(function (r) { return S.recipeInfo[r.id].fits[p.id].level === 'ok'; })
    .sort(function (a, b) { return (S.recipeInfo[b.id].cov.pct === 100) - (S.recipeInfo[a.id].cov.pct === 100) || (b.times_cooked || 0) - (a.times_cooked || 0); })
    .slice(0, 8);
  var keyNut = simpleNutrients(p)[0];

  return '<div class="simple-wrap">' +
    '<p class="simple-greet">' + greet + ', ' + esc(p.person_name) + '</p>' +
    '<h2>Today</h2><div class="card">' + bars + '</div>' +
    '<h2>Good choices</h2>' + (choices.length ? choices.map(function (r) {
      var per = S.recipeInfo[r.id].nut.perServing, ready = S.recipeInfo[r.id].cov.pct === 100;
      return '<div class="card simple-choice">' + (r.photo_data || r.photo_path ? '<img class="photo-thumb" alt="" data-photo="' + r.id + '" data-store="recipes"' + (r.photo_data ? ' src=\"' + esc(r.photo_data) + '\"' : '') + '>' : '') +
        '<div class="grow"><b>' + esc(r.title) + '</b><div class="muted">' + (ready ? 'Ready to make · ' : '') + (per[keyNut] != null ? per[keyNut] + (SIMPLE_UNIT[keyNut] !== undefined ? SIMPLE_UNIT[keyNut] : ' g') + ' ' + SIMPLE_LABEL[keyNut].toLowerCase() : '') + '</div></div>' +
        '<button class="btn simple-btn" onclick="simpleAte(\'' + r.id + '\')">I ate this</button></div>';
    }).join('') : '<div class="empty">No dishes are marked as a good fit yet.</div>') +
    '<button class="btn ghost simple-btn simple-wide" onclick="simpleOther()">I ate something else</button>' +
    '<h2>Today I ate</h2>' + (eaten.length ? '<div class="card">' + eaten.map(function (e) {
      var r = e.recipe_id && State.recipes.find(function (x) { return x.id === e.recipe_id; });
      return '<div class="list-item">' + photoThumb(e) + '<div class="grow"><b>' + esc(r ? r.title : e.free_text || 'Meal') + '</b><div class="muted">' + e.eaten_at.slice(11, 16) + '</div></div>' +
        '<button class="btn ghost sm" aria-label="Remove this entry" onclick="deleteDiaryEntry(\'' + e.id + '\')">Remove</button></div>';
    }).join('') + '</div>' : '<div class="empty">Nothing yet today.</div>') +
    '<p class="simple-footer"><button class="linkish" onclick="exitSimple()">Exit simple view</button></p></div>';
}

// One tap: log a serving for this person, with a short window to undo.
function simpleAte(rid) {
  var p = simpleProfile(), per = S.recipeInfo[rid].nut.perServing;
  var e = { eaten_at: new Date().toISOString(), recipe_id: rid, free_text: '', portion_mult: 1, for_profile_id: p.id, estimate_source: 'recipe' };
  Logic.NUTRIENTS.forEach(function (k) { e[k] = per[k]; });
  var usage = (S.linesByRecipe[rid] || []).map(function (l) { return { ingredient_id: l.ingredient_id, qty: 1, unit: l.unit, event: 'logged', at: e.eaten_at }; });
  Promise.all([DB.put('diary_entries', e)].concat(usage.map(function (u) { return DB.put('usage_log', u); }))).then(loadAll).then(function () {
    refresh();
    // Undo takes back the usage rows too, so an accidental tap never feeds restock suggestions.
    toast('Saved. Enjoy!', 'Undo', function () {
      Promise.all([DB.remove('diary_entries', e.id)].concat(usage.map(function (u) { return DB.remove('usage_log', u.id); })))
        .then(loadAll).then(function () { refresh(); toast('Removed'); });
    });
  });
}

// "Something else": a few words and an optional photo, reusing the full logger's save.
function simpleOther() {
  var p = simpleProfile();
  openSheet('<h2 style="margin-top:0">What did you eat?</h2>' +
    '<input id="lText" class="simple-input" placeholder="For example: soup and crackers">' +
    '<label>Photo (optional)</label><input id="lPhoto" type="file" accept="image/*">' +
    '<input id="lRecipe" type="hidden" value=""><input id="lPort" type="hidden" value="1"><input id="lWho" type="hidden" value="' + p.id + '">' +
    '<input id="lKcal" type="hidden" value=""><input id="lNa" type="hidden" value="">' +
    '<div class="btn-row"><button class="btn simple-btn" onclick="if (document.getElementById(\'lText\').value.trim()) saveLog(); else toast(\'Type a few words first\')">Save</button><button class="btn ghost simple-btn" onclick="closeSheet()">Cancel</button></div>');
  setTimeout(function () { var i = document.getElementById('lText'); if (i) i.focus(); }, 50);
}
