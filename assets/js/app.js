/* Boot, data loading, and the write actions shared across screens. */
function loadAll() {
  return Promise.all([
    DB.all('ingredients'), DB.all('recipes'), DB.all('recipe_ingredients'), DB.all('recipe_variations'),
    DB.all('pantry_items'), DB.all('diet_profiles'), DB.all('profile_rules'), DB.all('diary_entries'),
    DB.all('shopping_list'), DB.all('usage_log'), DB.meta('aisle_order'), DB.meta('my_role'), DB.meta('family_members'), DB.all('measurements'),
    DB.meta('day_start_hour'), DB.meta('fluid_unit'), DB.meta('weight_unit'), DB.allRaw('diary_entries'), DB.allRaw('measurements'), DB.allRaw('entry_photos'), DB.meta('pending_members'), DB.allRaw('records')
  ]).then(function (r) {
    State.records = r[21].filter(function (x) { return !x.deleted; });
    State.trash = r[17].filter(function (x) { return x.deleted; }).map(function (x) { x._store = 'diary_entries'; return x; })
      .concat(r[18].filter(function (x) { return x.deleted; }).map(function (x) { x._store = 'measurements'; return x; }))
      .concat(r[21].filter(function (x) { return x.deleted; }).map(function (x) { x._store = 'records'; return x; }));
    State.allEntryPhotos = r[19];
    State.entryPhotos = r[19].filter(function (p) { return !p.deleted; });
    State.pendingMembers = r[20] || [];
    State.measurements = r[13]; State.dayStart = r[14] == null ? 6 : r[14]; State.fluidUnit = r[15] || 'oz'; State.weightUnit = r[16] || 'lb';
    State.aisleOrder = r[10] || [];
    applyRole(r[11]);
    State.memberNames = r[12] || {}; State.memberCount = Object.keys(State.memberNames).length;
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
  var here = (S.pantryByIng[ingredientId] || []).filter(function (p) { return p.location === location; });
  // A unitless purchase ("2 carrots") is a count. It may top up a record kept in a count
  // unit such as "each", but never one kept in grams or cups.
  if (!unit) { var countRec = here.find(function (p) { return Units.kind(p.unit) === 'count'; }); if (countRec) unit = countRec.unit || ''; }
  var existing = here.find(function (p) { return (p.unit || '') === (unit || ''); });
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
  r.times_cooked = (r.times_cooked || 0) + 1; r.last_cooked_on = localDay(now);
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
// Settings: the family's AI balance this month (a meter, no prices) and who used what.
var AI_FEATURE = { read_photo: 'Snap it', fill_form: 'Fill from a photo', read_vitals: 'Snap it', quick_log: 'Say it', scribe: 'Scribe', ask_file: 'Ask her file', handoff: 'Catch me up',
  estimate_plate: 'Meal estimates', parse_recipe: 'Kitchen', parse_receipt: 'Kitchen', pantry_photo: 'Kitchen', variations: 'Kitchen', diet_swaps: 'Kitchen', canonicalize: 'Kitchen', meal_ideas: 'Kitchen',
  appointment_summary: 'Visit summary', schedule_draft: 'Medicine timing', guidance: 'Current guidance' };
function renderAiUse() {
  var el = document.getElementById('aiUse'); if (!el || !Sync.enabled()) return;
  var c = Sync.getClient(); if (!c) return;
  Sync.householdId().then(function (hid) {
    if (!hid) return;
    var start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    return Promise.all([c.from('ai_usage').select('cost_cents, feature, user_id').eq('household_id', hid).gte('created_at', start.toISOString()),
      c.from('households').select('ai_allowance_cents').eq('id', hid).single()]).then(function (r) {
      el = document.getElementById('aiUse'); if (r[0].error || !el) return;
      var rows = r[0].data || [], spent = rows.reduce(function (t, x) { return t + Number(x.cost_cents); }, 0), allow = r[1].data ? r[1].data.ai_allowance_cents : null;
      // One request = one thing a person did (a Snap it can take two AI calls); count calls per feature.
      var by = {};
      rows.forEach(function (x) { var who = x.user_id || 'x', f = AI_FEATURE[x.feature] || 'Other'; by[who] = by[who] || { n: 0, f: {} }; by[who].n++; by[who].f[f] = (by[who].f[f] || 0) + 1; });
      var meter = allow == null ? '<p><b>No monthly limit</b> for your family.</p>'
        : (function () { var pct = Math.min(100, Math.round(100 * spent / allow)); return '<p><b>' + pct + '%</b> of this month&rsquo;s AI used' + (pct >= 100 ? ': AI features are paused until the 1st. Typing by hand still works.' : '') + '</p><div class="bar"><i class="' + (pct >= 90 ? 'over' : '') + '" style="width:' + pct + '%"></i></div>'; })();
      var people = Object.keys(by).sort(function (a, b) { return by[b].n - by[a].n; }).map(function (u) {
        var f = by[u].f;
        return '<li><b>' + esc(u === 'x' ? 'Someone' : whoName(u)) + '</b>: ' + Object.keys(f).sort(function (a, b) { return f[b] - f[a]; }).map(function (k) { return esc(k) + ' ' + f[k]; }).join(', ') + '</li>';
      });
      el.innerHTML = meter + (people.length ? '<p class="muted">Used this month by:</p><ul class="ai-who">' + people.join('') + '</ul>' : '<p class="muted">No AI used yet this month.</p>') +
        '<p class="muted">Snap it, Say it, Scribe and questions use AI. Typing things in by hand never counts.</p>';
    });
  }).catch(function () {});
}
function renderAuthBox() {
  var box = document.getElementById('authBox'); if (!box) return;
  Sync.session().then(function (s) {
    box.innerHTML = s ? '<p>Signed in as <b>' + esc(s.user.email) + '</b></p><p id="syncError" class="note' + (lastSyncError ? '' : ' hidden') + '">' + (lastSyncError ? 'Last sync failed: ' + esc(lastSyncError) : '') + '</p>' +
        '<div class="btn-row"><button class="btn sm" onclick="syncNow()">Sync now</button><button class="btn sm ghost" onclick="Sync.signOut().then(function(){renderSettingsAgain()})">Sign out</button></div>' +
        '<details><summary class="muted">Have an invite code instead of a link?</summary><div class="row"><input id="joinCode" placeholder="Invite code" class="grow" autocomplete="off"><button class="btn sm" onclick="joinWithCode()">Join</button></div></details>'
      : signInBlock('s');
    var fam = document.getElementById('familyBox');
    if (fam) { if (s) renderFamilyBox(); else fam.innerHTML = '<p class="muted">Sign in above to see and invite your family.</p>'; }
  });
}
function joinWithCode() {
  var code = document.getElementById('joinCode').value.trim();
  if (!code) return toast('Paste the code first');
  Sync.joinHousehold(code).then(syncNow).then(function () { toast('Joined'); renderSettingsAgain(); askMyName(); }).catch(function (e) { toast(e.message); });
}

/* ---------- family: roles, invite links, names ---------- */
var ROLE_INFO = {
  owner: ['Owner', 'manage the family, invites and settings'],
  caregiver: ['Caregiver', 'can log and edit entries'],
  viewer: ['Viewer', 'can read everything but not change anything']
};
function memberLabel(m) { return m.display_name || (m.email ? m.email.split('@')[0] : 'Someone'); }
function renderFamilyBox() {
  var box = document.getElementById('familyBox'); if (!box) return;
  Promise.all([Sync.members(), Sync.householdName()]).then(function (r) {
    var people = r[0] || [], name = r[1], me = people.find(function (m) { return m.is_me; }) || {}, owner = me.role === 'owner';
    var mine = ROLE_INFO[me.role] || ['member', ''];
    cacheMembers(people);
    box.innerHTML = '<div class="row between"><h3 style="margin:0">' + esc(name) + '</h3>' + (owner ? '<button class="btn sm ghost" onclick="renameFamily()">Rename</button>' : '') + '</div>' +
      '<p class="muted">You are ' + (me.role === 'owner' ? 'an' : 'a') + ' <b>' + esc(mine[0].toLowerCase()) + '</b>: you ' + esc(mine[1]) + '.</p>' +
      dayStartPicker(owner) +
      '<label for="myName">Your name (shown on what you log)</label><div class="row"><input id="myName" class="grow" maxlength="40" value="' + esc(me.display_name || '') + '" placeholder="e.g. Mom, Brax"><button class="btn sm" onclick="saveMyName()">Save</button></div>' +
      pendingSection(people.filter(function (m) { return m.approved === false; }), owner) +
      '<h3>People (' + people.filter(function (m) { return m.approved !== false; }).length + ')</h3>' + people.filter(function (m) { return m.approved !== false; }).map(function (m) {
        var info = ROLE_INFO[m.role] || [m.role, ''], label = memberLabel(m);
        var controls = owner && !m.is_me
          ? '<select class="role-select" aria-label="Role for ' + esc(label) + '" onchange="changeRole(\'' + m.user_id + '\', this.value)">' + ['owner', 'caregiver', 'viewer'].map(function (k) { return '<option value="' + k + '"' + (k === m.role ? ' selected' : '') + '>' + ROLE_INFO[k][0] + '</option>'; }).join('') + '</select>' +
            '<button class="icon-btn" aria-label="Remove ' + esc(label) + '" onclick="removePerson(\'' + m.user_id + '\')">&times;</button>'
          : '<span class="badge' + (m.role === 'owner' ? ' ok' : m.role === 'caregiver' ? ' warn' : '') + '">' + esc(info[0]) + '</span>';
        return '<div class="list-item"><div class="grow"><b>' + esc(label) + '</b>' + (m.is_me ? ' <span class="muted">(you)</span>' : '') + '<div class="muted">' + esc(m.email || '') + '</div></div>' + controls + '</div>';
      }).join('') +
      (owner
        ? '<h3>Invite family</h3><p class="muted">A link works for whoever opens it and signs in, so send it only to the person you mean. You can change anyone\'s role later.</p>' +
          '<div class="btn-row"><button class="btn sm" onclick="shareInvite(\'caregiver\')">Invite a caregiver (can log)</button><button class="btn sm ghost" onclick="shareInvite(\'viewer\')">Invite a viewer (read only)</button></div>' +
          '<p><button class="linkish" onclick="resetInvites()">Cancel all invite links sent so far</button></p><p><button class="linkish" onclick="showRecentChanges()">Recent changes</button></p>'
        : '<p class="muted">Ask an owner to invite others.</p>' + (me.role ? '<p><button class="linkish" onclick="leaveFamily()">Leave this family</button></p>' : ''));
  }).catch(function (e) {
    if (State.role === 'pending') { box.innerHTML = '<p><b>Waiting for approval.</b> An owner of the family needs to approve you before you can see or add anything.</p>' + '<label for="myName">Your name (so they know who is asking)</label><div class="row"><input id="myName" class="grow" maxlength="40" placeholder="e.g. Mom"><button class="btn sm" onclick="saveMyName()">Save</button></div>'; return; }
    var msg = (e && e.message) || String(e);
    box.innerHTML = '<p class="muted">Couldn\'t load the family: ' + esc(msg) + '</p>' +
      (/function|schema cache|does not exist/i.test(msg) ? '<p class="muted">The cloud needs the family update (database migration 0010) first.</p>' : '');
  });
}
function pendingSection(list, owner) {
  if (!list.length || !owner) return '';
  return '<h3>Waiting for approval (' + list.length + ')</h3>' + list.map(function (m) {
    return '<div class="list-item"><div class="grow"><b>' + esc(memberLabel(m)) + '</b><div class="muted">' + esc(m.email || '') + ' · asked to join as ' + esc((ROLE_INFO[m.role] || [m.role])[0].toLowerCase()) + '</div></div>' +
      '<select class="role-select" id="ap-' + m.user_id + '" aria-label="Role for ' + esc(memberLabel(m)) + '">' + ['caregiver', 'viewer', 'owner'].map(function (k) { return '<option value="' + k + '"' + (k === m.role ? ' selected' : '') + '>' + ROLE_INFO[k][0] + '</option>'; }).join('') + '</select>' +
      '<button class="btn sm" onclick="approvePerson(\'' + m.user_id + '\')">Approve</button><button class="icon-btn" aria-label="Turn down ' + esc(memberLabel(m)) + '" onclick="denyPerson(\'' + m.user_id + '\')">&times;</button></div>';
  }).join('');
}
function approvePerson(uid) {
  var role = document.getElementById('ap-' + uid).value;
  Sync.approveMember(uid, role).then(function () { toast('Approved'); renderFamilyBox(); }).catch(function (e) { toast(e.message); });
}
function denyPerson(uid) {
  if (!confirm('Turn down this request? They will not see anything. You can invite them again later.')) return;
  Sync.removeMember(uid).then(function () { toast('Turned down'); renderFamilyBox(); }).catch(function (e) { toast(e.message); });
}
function cacheMembers(people) {
  var names = {};
  (people || []).forEach(function (m) { names[m.user_id] = memberLabel(m); });
  var approved = (people || []).filter(function (m) { return m.approved !== false; });
  State.memberNames = names; State.memberCount = approved.length;
  State.pendingMembers = (people || []).filter(function (m) { return m.approved === false; }).map(function (m) { return memberLabel(m); });
  return Promise.all([DB.meta('family_members', names), DB.meta('pending_members', State.pendingMembers)]);
}
function saveMyName() {
  var v = document.getElementById('myName').value.trim();
  if (!v) return toast('Type a name first');
  Sync.setMyName(v).then(function () { toast('Saved'); renderFamilyBox(); }).catch(function (e) { toast(e.message); });
}
function askMyName() {
  openSheet('<h2 style="margin-top:0">Welcome to the family</h2><p>What should everyone call you? It shows next to the things you log.</p>' +
    '<input id="welcomeName" maxlength="40" placeholder="e.g. Mom, Brax" autocomplete="name"><div class="btn-row"><button class="btn" onclick="saveWelcomeName()">Save</button><button class="btn ghost" onclick="closeSheet()">Later</button></div>');
  setTimeout(function () { var el = document.getElementById('welcomeName'); if (el) el.focus(); }, 50);
}
function saveWelcomeName() {
  var v = document.getElementById('welcomeName').value.trim();
  if (!v) return toast('Type a name first');
  Sync.setMyName(v).then(function () { closeSheet(); toast('Thanks, ' + v); return Sync.members().then(cacheMembers); }).then(refresh).catch(function (e) { toast(e.message); });
}
function renameFamily() {
  var v = prompt('Name this family (everyone sees it):', '');
  if (v == null || !v.trim()) return;
  Sync.setHouseholdName(v).then(function () { toast('Renamed'); renderFamilyBox(); }).catch(function (e) { toast(e.message); });
}
function changeRole(uid, role) {
  var msg = role === 'owner' ? 'Make them an owner? Owners can invite and remove people and change roles.'
    : role === 'viewer' ? 'Make them a viewer? They can read everything but not add or change anything.'
    : 'Make them a caregiver? They can log and edit entries.';
  if (!confirm(msg)) { renderFamilyBox(); return; }
  Sync.setMemberRole(uid, role).then(function () { toast('Role changed'); renderFamilyBox(); }).catch(function (e) { toast(e.message); renderFamilyBox(); });
}
function removePerson(uid) {
  var label = (State.memberNames || {})[uid] || 'this person';
  if (!confirm('Remove ' + label + ' from the family? They lose access straight away. Their past entries stay.')) return;
  Sync.removeMember(uid).then(function () { toast('Removed'); renderFamilyBox(); }).catch(function (e) { toast(e.message); });
}
function leaveFamily() {
  if (!confirm('Leave this family? Its diary stops syncing to this device. An owner can invite you back.')) return;
  Sync.session().then(function (s) { return Sync.removeMember(s.user.id); }).then(function () {
    return Promise.all([DB.meta('household_id', null), DB.meta('last_pull', null), DB.meta('my_role', null), DB.meta('family_members', null)]);
  }).then(function () { toast('You left the family'); location.reload(); }).catch(function (e) { toast(e.message); });
}
function shareInvite(role) {
  Promise.all([Sync.inviteLinks(), Sync.householdName()]).then(function (r) {
    var code = r[0][role]; if (!code) throw new Error('No link for that role');
    var text = 'Join "' + r[1] + '" on The Caregiving Menu' + (role === 'viewer' ? ' (view only)' : '') + '. Open this link on your phone, then sign in with your email:\n' + Sync.setupLink(code);
    if (navigator.share) return navigator.share({ title: 'Join ' + r[1], text: text }).catch(function () {});
    copyText(text, 'Invite copied. Paste it into a text to the person you mean.');
  }).catch(function (e) { toast(e.message); });
}
function resetInvites() {
  if (!confirm('Cancel every invite link sent so far? People already in the family stay. Anyone who hasn\'t joined yet needs a new link.')) return;
  Sync.resetInviteLinks().then(function () { toast('Old links cancelled. New ones are ready.'); }).catch(function (e) { toast(e.message); });
}
// Viewers get a read-only app on their device; the server enforces the same rule.
function applyRole(role) {
  State.role = role || null;
  DB.setReadOnly(role === 'viewer' || role === 'pending');
  document.body.classList.toggle('role-viewer', role === 'viewer' || role === 'pending');
}
function renderSettingsAgain() { showScreen('settings'); }
// Background sync: once per page, whenever the cloud is (or becomes) configured.
var autoSyncStarted = false;
function startAutoSync() {
  if (autoSyncStarted || !Sync.enabled()) return;
  autoSyncStarted = true;
  syncNow();
  window.addEventListener('online', syncNow);
  setInterval(syncNow, 5 * 60 * 1000);
}
var lastSyncError = null;
function syncNow() {
  var dot = document.getElementById('syncDot');
  var justJoined = false;
  return Sync.joinPendingInvite().then(function (joined) { if (joined) { justJoined = true; toast('You joined the family'); } }, function (e) { toast('Could not join: ' + e.message); })
    .then(function () { return Sync.run(); }).then(function (r) {
    dot.classList.toggle('on', r.signedIn); dot.title = r.signedIn ? 'Synced' : 'Local only';
    if (State.signedIn !== r.signedIn) { State.signedIn = r.signedIn; if (!State.profiles.length && currentScreen === 'home') refresh(); }
    if (!r.signedIn) return;
    var roleBefore = State.role;
    return Promise.all([Sync.members().then(cacheMembers, function () {}), Sync.refreshDayStart()]).then(function () {
      if (justJoined) askMyName();
      purgeOldTrashPhotos().catch(function () {});
      return DB.meta('my_role').then(function (role) {
        if (r.pulled || r.photos || role !== roleBefore || justJoined) return loadAll().then(bgRefresh);
      });
    });
  }).then(function () { lastSyncError = null; }, function (e) {
    // Keep the error visible: a sync that keeps failing must never look like it worked.
    lastSyncError = (e && e.message) || String(e);
    dot.classList.remove('on'); dot.classList.add('err'); dot.title = 'Sync error: ' + lastSyncError;
    var el = document.getElementById('syncError'); if (el) { el.textContent = 'Last sync failed: ' + lastSyncError; el.classList.remove('hidden'); }
  }).then(function () { if (!lastSyncError) dot.classList.remove('err'); });
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
    var soon = localDay(new Date(Date.now() + 2 * 864e5).toISOString());
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
// Shared from another app. POST shares (with an optional photo) arrive via the service
// worker as ?share=1; older GET shares carry ?url= or ?text= directly.
function handleShareTarget() {
  var p = new URLSearchParams(location.search);
  if (p.get('share') === '1') {
    history.replaceState(null, '', location.pathname);
    if (!('caches' in window)) return;
    var base = new URL('./', location.href).href;
    return caches.open('tcm-share').then(function (c) {
      return Promise.all([c.match(base + '__share/meta'), c.match(base + '__share/image')]).then(function (r) {
        var done = function () { return Promise.all([c.delete(base + '__share/meta'), c.delete(base + '__share/image')]); };
        return Promise.all([r[0] ? r[0].json() : null, r[1] ? r[1].blob() : null]).then(function (v) { return done().then(function () { return v; }); });
      });
    }).then(function (v) {
      var meta = v[0] || {}, image = v[1];
      if (image) return askSharedPhoto(image);
      openSharedText([meta.url, meta.text, meta.title].filter(Boolean).join('\n').trim());
    }).catch(function () {});
  }
  var shared = p.get('url') || p.get('text');
  if (!shared) return;
  history.replaceState(null, '', location.pathname);
  openSharedText(shared);
}
function openSharedText(text) {
  if (!text) return;
  // A shared page usually puts its URL last in the text; prefer the URL if there is one.
  var urlMatch = text.match(/https?:\/\/\S+/);
  showScreen('scan'); pasteRecipe();
  document.getElementById('fPaste').value = urlMatch ? urlMatch[0] : text;
  if (Sync.enabled()) submitPaste(); // straight to the review screen
}
function askSharedPhoto(blob) {
  S.sharedPhoto = blob;
  showScreen('scan');
  var cloud = Sync.enabled();
  openSheet('<h2 style="margin-top:0">What is this photo?</h2><img class="photo-hero" alt="" src="' + URL.createObjectURL(blob) + '">' +
    '<div class="btn-row"><button class="btn" onclick="logFoodWithSharedPhoto()">A meal for the diary</button>' +
    '<button class="btn ghost" ' + (cloud ? '' : 'disabled ') + 'onclick="scanImage(\'recipe\', S.sharedPhoto)">A recipe</button>' +
    '<button class="btn ghost" ' + (cloud ? '' : 'disabled ') + 'onclick="scanImage(\'receipt\', S.sharedPhoto)">A receipt</button>' +
    '<button class="btn ghost" ' + (cloud ? '' : 'disabled ') + 'onclick="readGroceryPhotos([S.sharedPhoto])">Groceries for the pantry</button></div>' +
    (cloud ? '' : '<p class="muted">Reading recipes and receipts needs the cloud set up. The diary works offline.</p>'));
}
function logFoodWithSharedPhoto() { logFood(); } // logFood shows S.sharedPhoto as the preview

var _origShowScreen = showScreen;
showScreen = function (name, arg) { if (State.simple && simpleProfile()) name = 'simple'; S.lastArg = arg; _origShowScreen(name, arg); if (name === 'settings') { renderAuthBox(); renderAiUse(); } hydratePhotos(); };

document.addEventListener('DOMContentLoaded', function () {
  try { if (Sync.applySetupLink()) setTimeout(function () { toast(Sync.pendingInvite() ? 'Cloud connected. Sign in (Settings) to join your household.' : 'Cloud connected. Sign in in Settings.'); }, 400); }
  catch (e) { setTimeout(function () { toast('That setup link did not work: ' + e.message); }, 400); }
  Promise.all([DB.meta('active_profile'), DB.meta('simple_mode')]).then(function (m) { State.activeProfile = m[0]; State.simple = m[1]; return loadAll(); }).then(function () {
    applySimpleChrome();
    showScreen('home');
    handleShareTarget();
    startAutoSync();
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
});
