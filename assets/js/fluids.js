/* Fluid balance and daily weight: outputs, the In/Out card, fluid in food, weights,
 * the In & Out sheet, and the care day. The math lives in logic.js (tested). */

/* ---------- care day ---------- */
// The family's day runs from day_start_hour (default 6 am) to the same hour next day.
function dayStart() { return State.dayStart == null ? 6 : State.dayStart; }
function careDayOf(iso) { return Logic.careDay(iso, dayStart()); }
function careToday() { return careDayOf(new Date().toISOString()); }
function dayLabel(day) {
  var today = careToday();
  if (day === today) return 'Today';
  if (day === shiftDay(today, -1)) return 'Yesterday';
  return new Date(day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function dayStartLabel(h) { h = h == null ? dayStart() : h; return (h % 12 || 12) + (h < 12 ? ' am' : ' pm'); }

/* ---------- amounts in any unit ---------- */
var UNIT_LABEL = { oz: 'oz', ml: 'mL', g: 'g', cup: 'cup' };
function fluidUnit() { return Logic.FLUID_UNITS.indexOf(State.fluidUnit) >= 0 ? State.fluidUnit : 'oz'; }
function amountText(ml) {
  ml = Math.round(ml || 0);
  var oz = Logic.fromMl(ml, 'oz');
  return (Math.round(oz * 10) / 10) + ' oz (' + ml + ' mL)';
}
function shortOz(ml) { return Math.round(Logic.fromMl(ml || 0, 'oz')) + ' oz'; }
// A number box with a unit picker. Chips are in the chosen unit's everyday sizes.
function amountField(id, label, ml, chips) {
  var u = fluidUnit(), v = ml > 0 ? Math.round(Logic.fromMl(ml, u) * 10) / 10 : '';
  return '<label for="' + id + '">' + label + '</label><div class="row"><input id="' + id + '" class="grow" type="number" inputmode="decimal" step="any" min="0" value="' + v + '" oninput="this.dataset.typed=1">' +
    '<select id="' + id + 'U" class="unit-select" aria-label="Unit" onchange="switchAmountUnit(\'' + id + '\', this)" data-unit="' + u + '">' +
    Logic.FLUID_UNITS.map(function (k) { return '<option value="' + k + '"' + (k === u ? ' selected' : '') + '>' + UNIT_LABEL[k] + '</option>'; }).join('') + '</select></div>' +
    (chips ? '<div class="chips">' + chips.map(function (oz) { return '<span class="chip" onclick="setAmountOz(\'' + id + '\',' + oz + ')">' + oz + ' oz</span>'; }).join('') + '</div>' : '') +
    '<div class="muted" id="' + id + 'Hint"></div>';
}
// Changing the unit converts the number already typed, so the amount stays the same.
function switchAmountUnit(id, sel) {
  var input = document.getElementById(id), from = sel.dataset.unit, to = sel.value;
  if (input.value !== '') input.value = Math.round(Logic.fromMl(Logic.toMl(+input.value, from), to) * 10) / 10;
  sel.dataset.unit = to; State.fluidUnit = to; DB.meta('fluid_unit', to);
  if (to === 'g') document.getElementById(id + 'Hint').textContent = 'Grams count as mL (true for water, broth and most drinks).';
  else document.getElementById(id + 'Hint').textContent = '';
}
function setAmountOz(id, oz) {
  var sel = document.getElementById(id + 'U');
  document.getElementById(id).value = Math.round(Logic.fromMl(Logic.toMl(oz, 'oz'), sel.value) * 10) / 10;
}
function readAmountMl(id) {
  var input = document.getElementById(id), sel = document.getElementById(id + 'U');
  if (!input || input.value === '') return null;
  return Math.round(Logic.toMl(+input.value, sel ? sel.value : 'oz'));
}

/* ---------- the Fluid balance card ---------- */
function careSettingsOf(pid) { var p = State.profiles.find(function (x) { return x.id === pid; }); return (p && p.care_settings) || {}; }
function fluidCard(entries, day) {
  // One card per person with fluid logged that day (or the person on screen).
  var pids = State.activeProfile ? [State.activeProfile] : uniq(entries.filter(function (e) { return Logic.fluidIn(e) > 0 || e.entry_kind === 'output'; }).map(function (e) { return e.for_profile_id || null; }));
  if (State.activeProfile == null && !pids.length) return '';
  return pids.map(function (pid) { return fluidCardFor(pid, entries.filter(function (e) { return (e.for_profile_id || null) === pid; }), day); }).join('');
}
function uniq(xs) { return xs.filter(function (x, i) { return xs.indexOf(x) === i; }); }
function fluidCardFor(pid, entries, day) {
  var b = Logic.fluidBalance(entries), cs = careSettingsOf(pid);
  var prof = State.profiles.find(function (p) { return p.id === pid; });
  var w = Logic.weightChange(State.measurements || [], pid, day, dayStart());
  var wFlags = Logic.weightFlags(w, cs);
  var limit = +cs.fluid_limit_ml || 0, pct = limit ? Math.min(100, Math.round(b.inMl / limit * 100)) : 0;
  var flags = b.flags.map(function (f) { return localTime(f.entry.eaten_at) + ' ' + (OUTPUT_TYPES[f.entry.output_type] || 'output').toLowerCase() + ': ' + f.reasons.join(', '); }).concat(wFlags.map(function (x) { return 'weight ' + x; }));
  return '<div class="card fluid-card">' +
    '<div class="row between"><b>&#128167; Fluid balance' + (prof ? ' · ' + esc(prof.person_name) : '') + '</b><span class="muted">' + dayStartLabel() + ' to ' + dayStartLabel() + '</span></div>' +
    '<div class="fluid-nums"><div><span class="muted">In</span><b>' + shortOz(b.inMl) + '</b>' + (b.foodMl ? '<span class="muted">' + shortOz(b.foodMl) + ' from food</span>' : '') + '</div>' +
    '<div><span class="muted">Out</span><b>' + shortOz(b.outMl) + '</b></div>' +
    '<div><span class="muted">Difference</span><b>' + (b.netMl >= 0 ? '+' : '&minus;') + shortOz(Math.abs(b.netMl)) + '</b><span class="muted">' + (b.netMl >= 0 ? 'more in' : 'more out') + '</span></div></div>' +
    (limit ? '<div class="bar' + (b.inMl > limit ? ' over' : '') + '" role="img" aria-label="' + pct + '% of the daily fluid limit"><span style="width:' + pct + '%"></span></div><div class="muted">' + shortOz(b.inMl) + ' of ' + shortOz(limit) + ' limit' + (cs.fluid_limit_source ? ' (' + esc(cs.fluid_limit_source) + ')' : '') + '</div>' : '') +
    (w ? '<div class="muted">Morning weight ' + localTime(w.m.taken_at) + ': <b>' + (Math.round(w.lb * 10) / 10) + ' lb</b>' + (w.sincePrev != null ? ' (' + (w.sincePrev >= 0 ? '+' : '') + w.sincePrev.toFixed(1) + ' since ' + (w.prevDays === 1 ? 'yesterday' : w.prevDays + ' days ago') + ')' : '') + '</div>' : '') +
    (flags.length ? '<div class="note flag" role="alert"><b>Worth a call to the care team if this is new or getting worse:</b><br>' + flags.map(esc).join('<br>') + (cs.care_phone ? '<br><a href="tel:' + esc(cs.care_phone_e164 || cs.care_phone.replace(/[^\d+]/g, '')) + '">Call ' + esc(cs.care_phone) + '</a>' : '') + '</div>' : '') +
    '<div class="btn-row"><button class="btn sm ghost" onclick="showScreen(\'fluids\',{day:\'' + day + '\',pid:' + (pid ? '\'' + pid + '\'' : 'null') + '})">In &amp; Out sheet</button></div></div>';
}

/* ---------- outputs ---------- */
var OUTPUT_TYPES = { urine: 'Urine', vomit: 'Vomit', stool: 'Stool', drain: 'Drain', none: 'Tried, couldn\'t go', other: 'Other' };
var OUTPUT_COLORS = [['pale', 'Pale', '#f3f0c4'], ['yellow', 'Yellow', '#f1df5a'], ['dark_yellow', 'Dark yellow', '#d9a91c'], ['amber', 'Amber', '#c27a12'], ['pink_red', 'Pink / red', '#c8323a'], ['cola', 'Cola / brown', '#5a2d16']];
function colorName(k) { var c = OUTPUT_COLORS.find(function (x) { return x[0] === k; }); return c ? c[1].toLowerCase() : ''; }
function outputLine(e) {
  var amt = Logic.fluidOut(e);
  return (OUTPUT_TYPES[e.output_type] || 'Output') + (amt ? ' · ' + amountText(amt) : '') + (e.output_color ? ' · ' + colorName(e.output_color) : '') + (e.clots ? ' · clots' : '') + (e.eaten_note ? ' · ' + esc(e.eaten_note) : '');
}
function logOutput(id) {
  var e = id ? State.diary.find(function (x) { return x.id === id; }) : null;
  return DB.meta('last_eater').then(function (last) {
    var who = e ? e.for_profile_id : (State.activeProfile || (State.profiles.some(function (p) { return p.id === last; }) ? last : ''));
    var when = e ? e.eaten_at : new Date().toISOString(), type = e ? e.output_type : 'urine';
    S.outputPhoto = undefined;
    openSheet('<h2 style="margin-top:0">' + (e ? 'Output' : 'Log output') + '</h2>' +
      '<label for="oWho">Whose?</label><select id="oWho"><option value="">Me</option>' + State.profiles.map(function (p) { return '<option value="' + p.id + '"' + (who === p.id ? ' selected' : '') + '>' + esc(p.person_name) + '</option>'; }).join('') + '</select>' +
      '<label for="oWhen">When</label><input id="oWhen" type="datetime-local" value="' + localDay(when) + 'T' + localTime(when) + '">' +
      '<label>What</label><div class="chips" role="radiogroup" id="oType">' + Object.keys(OUTPUT_TYPES).map(function (k) { return '<button type="button" role="radio" aria-checked="' + (k === type) + '" class="chip' + (k === type ? ' on' : '') + '" data-v="' + k + '" onclick="pickChip(\'oType\', this)">' + OUTPUT_TYPES[k] + '</button>'; }).join('') + '</div>' +
      amountField('oAmt', 'Amount (read the hat or container at eye level)', e ? Logic.fluidOut(e) : null, [2, 4, 8, 12, 16]) +
      '<label>Color</label><div class="chips" role="radiogroup" id="oColor">' + OUTPUT_COLORS.map(function (c) { var on = e && e.output_color === c[0]; return '<button type="button" role="radio" aria-checked="' + !!on + '" class="chip swatch' + (on ? ' on' : '') + '" data-v="' + c[0] + '" onclick="pickChip(\'oColor\', this, true)"><i style="background:' + c[2] + '"></i>' + c[1] + '</button>'; }).join('') + '</div>' +
      '<label class="check"><input id="oClots" type="checkbox"' + (e && e.clots ? ' checked' : '') + '> Clots</label>' +
      '<label for="oNote">Note</label><input id="oNote" placeholder="cloudy, strong smell, burning..." value="' + esc(e ? e.eaten_note || '' : '') + '">' +
      '<label>Photo</label><div class="btn-row" style="margin-top:0"><button type="button" class="btn ghost sm" onclick="document.getElementById(\'oCam\').click()">&#128247; Take photo</button><button type="button" class="btn ghost sm" onclick="document.getElementById(\'oLib\').click()">&#128444; Choose photo</button></div>' +
      '<input id="oCam" type="file" accept="image/*" capture="environment" class="hidden" onchange="pickOutputPhoto(this)"><input id="oLib" type="file" accept="image/*" class="hidden" onchange="pickOutputPhoto(this)">' +
      '<img id="oPrev" class="photo-thumb hidden" alt="Output photo preview">' +
      '<p class="muted">No calories or sodium are counted for outputs.</p>' +
      (e && Sync.enabled() ? extraPhotosSection(e.id) : '') +
      '<div class="btn-row"><button class="btn" onclick="saveOutput(' + (e ? '\'' + e.id + '\'' : '') + ')">' + (e ? 'Save' : 'Log output') + '</button><button class="btn ghost" onclick="closeSheet()">Cancel</button>' + (e ? '<button class="btn ghost" onclick="showHistory(\'diary_entries\',\'' + e.id + '\')">History</button>' : '') + (e ? '<button class="btn danger" onclick="closeSheet();deleteDiaryEntry(\'' + e.id + '\')">Delete</button>' : '') + '</div>');
    if (e && (e.photo_data || e.photo_path)) Sync.photoSrc(e).then(function (src) { var img = document.getElementById('oPrev'); if (src && img && S.outputPhoto === undefined) { img.src = src; img.classList.remove('hidden'); } });
  });
}
// A chip group that works like radio buttons; `toggle` lets the one picked be un-picked.
function pickChip(groupId, btn, toggle) {
  var was = btn.classList.contains('on');
  document.querySelectorAll('#' + groupId + ' .chip').forEach(function (c) { c.classList.remove('on'); c.setAttribute('aria-checked', 'false'); });
  if (!(toggle && was)) { btn.classList.add('on'); btn.setAttribute('aria-checked', 'true'); }
}
function chipValue(groupId) { var on = document.querySelector('#' + groupId + ' .chip.on'); return on ? on.dataset.v : null; }
function pickOutputPhoto(input) {
  var f = input.files[0]; if (!f) return;
  var other = document.getElementById(input.id === 'oCam' ? 'oLib' : 'oCam'); if (other) other.value = '';
  var img = document.getElementById('oPrev'); img.src = URL.createObjectURL(f); img.classList.remove('hidden');
  S.outputPhoto = downscale(f, 1280).catch(function () { toast('That photo could not be opened'); return undefined; });
}
function saveOutput(id) {
  var type = chipValue('oType') || 'urine', ml = readAmountMl('oAmt');
  if (type !== 'none' && !(ml > 0)) return toast('How much? Type the amount, or pick "Tried, couldn\'t go".');
  var when = new Date(document.getElementById('oWhen').value);
  var fields = {
    entry_kind: 'output', output_type: type, volume_ml: type === 'none' ? 0 : ml, portion_mult: 1,
    output_color: chipValue('oColor'), clots: document.getElementById('oClots').checked,
    eaten_note: document.getElementById('oNote').value.trim() || null,
    eaten_at: (isNaN(when) ? new Date() : when).toISOString(), for_profile_id: document.getElementById('oWho').value || null,
    free_text: OUTPUT_TYPES[type], recipe_id: null, estimate_source: 'output', confidence: null
  };
  Logic.NUTRIENTS.forEach(function (k) { fields[k] = 0; });
  var pickedPhoto = S.outputPhoto;
  Promise.resolve(pickedPhoto).then(function (photo) {
    var write = id
      ? DB.update('diary_entries', id, function (cur) {
          if (!cur || cur.deleted) return null;
          Object.assign(cur, fields);
          if (photo) { if (cur.photo_path) Sync.removePhoto(cur.photo_path); cur.photo_path = null; cur.photo_data = photo; }
          return cur;
        })
      : DB.put('diary_entries', Object.assign(fields, photo ? { photo_data: photo } : {}));
    return write.then(function (saved) {
      DB.meta('last_eater', fields.for_profile_id || '');
      closeSheet(); toast(saved ? (id ? 'Saved' : 'Output logged') : 'This entry was deleted elsewhere');
      State.day = careDayOf(fields.eaten_at);
      return loadAll().then(function () { showScreen('diary'); if (photo && Sync.enabled()) syncNow(); });
    });
  }).catch(function (err) { toast('Could not save: ' + err.message); });
}
// A drink that was really output (a hat reading logged as "oz drunk"): keep the amount,
// make it urine, and clear the estimated calories and sodium.
function convertToOutput(id) {
  if (!confirm('Change this to output (urine)? The amount stays; calories and sodium are cleared.')) return;
  DB.update('diary_entries', id, function (cur) {
    if (!cur || cur.deleted) return null;
    cur.volume_ml = Math.round(Logic.fluidIn(cur)); cur.portion_mult = 1;
    cur.entry_kind = 'output'; cur.output_type = 'urine'; cur.estimate_source = 'output'; cur.confidence = null;
    Logic.NUTRIENTS.forEach(function (k) { cur[k] = 0; });
    return cur;
  }).then(function (saved) { closeSheet(); toast(saved ? 'Changed to output' : 'This entry was deleted elsewhere'); return loadAll(); }).then(function () { showScreen('diary'); });
}

/* ---------- weight ---------- */
function logWeight() {
  return DB.meta('last_eater').then(function (last) {
    var who = State.activeProfile || (State.profiles.some(function (p) { return p.id === last; }) ? last : '');
    var now = new Date(), unit = State.weightUnit || 'lb';
    openSheet('<h2 style="margin-top:0">Log weight</h2>' +
      '<label for="wWho">Whose?</label><select id="wWho"><option value="">Me</option>' + State.profiles.map(function (p) { return '<option value="' + p.id + '"' + (who === p.id ? ' selected' : '') + '>' + esc(p.person_name) + '</option>'; }).join('') + '</select>' +
      '<label for="wWhen">When</label><input id="wWhen" type="datetime-local" value="' + localDay(now.toISOString()) + 'T' + localTime(now.toISOString()) + '">' +
      '<label for="wVal">Weight</label><div class="row"><input id="wVal" class="grow" type="number" inputmode="decimal" step="0.1" min="0"><select id="wUnit" class="unit-select" aria-label="Unit"><option value="lb"' + (unit === 'lb' ? ' selected' : '') + '>lb</option><option value="kg"' + (unit === 'kg' ? ' selected' : '') + '>kg</option></select></div>' +
      '<label class="check"><input id="wStd" type="checkbox"' + (now.getHours() < 11 ? ' checked' : '') + '> Morning, after peeing, before eating or drinking</label>' +
      '<p class="muted">Only these morning weights are compared from day to day, so a weight after breakfast never looks like a jump. Same scale, similar clothes.</p>' +
      '<label for="wNote">Note</label><input id="wNote" placeholder="new scale, wearing shoes...">' +
      '<div class="btn-row"><button class="btn" onclick="saveWeight()">Log weight</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>');
    setTimeout(function () { var el = document.getElementById('wVal'); if (el) el.focus(); }, 50);
  });
}
function saveWeight() {
  var val = +document.getElementById('wVal').value, unit = document.getElementById('wUnit').value;
  if (!(val > 0)) return toast('Type the weight first');
  var when = new Date(document.getElementById('wWhen').value);
  var m = { kind: 'weight', value: val, value2: null, unit: unit, taken_at: (isNaN(when) ? new Date() : when).toISOString(),
    standard: document.getElementById('wStd').checked, note: document.getElementById('wNote').value.trim() || null,
    for_profile_id: document.getElementById('wWho').value || null };
  State.weightUnit = unit; DB.meta('weight_unit', unit);
  DB.put('measurements', m).then(function () { closeSheet(); toast('Weight logged'); State.day = careDayOf(m.taken_at); return loadAll(); }).then(function () { showScreen('diary'); })
    .catch(function (err) { toast('Could not save: ' + err.message); });
}
function deleteMeasurement(id) {
  if (!confirm('Delete this weight? It goes to Deleted for 30 days.')) return;
  DB.remove('measurements', id).then(loadAll).then(function () { refresh(); toast('Deleted', 'Undo', function () { restoreFromTrash('measurements', id); }); });
}

/* ---------- limits and alerts on a person's profile ---------- */
function careSettingsFields(p) {
  var cs = (p && p.care_settings) || {};
  var ozVal = function (ml) { return ml ? Math.round(Logic.fromMl(ml, 'oz')) : ''; };
  return '<h3>Fluid and weight</h3><p class="muted">Leave blank until the care team gives you numbers. Nothing here is a default.</p>' +
    '<div class="row"><div class="grow"><label for="csLimit">Fluid limit per day (oz)</label><input id="csLimit" type="number" min="0" step="any" value="' + ozVal(cs.fluid_limit_ml) + '"></div>' +
    '<div class="grow"><label for="csLimitSrc">Set by</label><input id="csLimitSrc" placeholder="Dr. Lee, 2026-11-25" value="' + esc(cs.fluid_limit_source || '') + '"></div></div>' +
    '<div class="row"><div class="grow"><label for="csDay">Weight gain alert, 1 day (lb)</label><input id="csDay" type="number" min="0" step="0.1" value="' + (cs.weight_alert_day_lb || '') + '"></div>' +
    '<div class="grow"><label for="csWeek">Weight gain alert, 1 week (lb)</label><input id="csWeek" type="number" min="0" step="0.1" value="' + (cs.weight_alert_week_lb || '') + '"></div></div>' +
    '<button type="button" class="linkish" onclick="document.getElementById(\'csDay\').value=3;document.getElementById(\'csWeek\').value=5;document.getElementById(\'csAlertSrc\').value=\'common heart-failure guidance, confirm with care team\'">Use common heart-failure guidance (3 lb a day, 5 lb a week). Confirm with the care team.</button>' +
    '<label for="csAlertSrc">Alert levels set by</label><input id="csAlertSrc" value="' + esc(cs.alert_source || '') + '">' +
    '<label for="csPhone">Care team phone (shown with warnings)</label><div class="row"><input id="csPhone" class="grow" type="tel" autocomplete="off" value="' + esc(cs.care_phone || '') + '" oninput="S.phoneCheck=null;document.getElementById(\'csPhoneHint\').textContent=\'\'">' +
    '<button type="button" class="btn sm ghost" onclick="checkPhoneField(\'csPhone\')">Check number</button></div>' +
    '<div class="muted" id="csPhoneHint" aria-live="polite">' + (cs.care_phone_type ? esc(phoneTypeText(cs.care_phone_type, cs.care_phone_carrier)) : '') + '</div>';
}
function readCareSettings(prev) {
  var cs = Object.assign({}, prev || {});
  var num = function (id) { var v = document.getElementById(id).value; return v === '' ? null : +v; };
  var txt = function (id) { return document.getElementById(id).value.trim() || null; };
  var oz = num('csLimit');
  cs.fluid_limit_ml = oz ? Math.round(Logic.toMl(oz, 'oz')) : null; cs.fluid_limit_source = txt('csLimitSrc');
  cs.weight_alert_day_lb = num('csDay'); cs.weight_alert_week_lb = num('csWeek'); cs.alert_source = txt('csAlertSrc');
  var typed = txt('csPhone');
  if (typed !== (prev || {}).care_phone) { delete cs.care_phone_e164; delete cs.care_phone_type; delete cs.care_phone_carrier; }
  var chk = S.phoneCheck;
  if (chk && chk.id === 'csPhone' && chk.res.valid) { typed = chk.res.national || typed; cs.care_phone_e164 = chk.res.e164; cs.care_phone_type = chk.res.line_type; cs.care_phone_carrier = chk.res.carrier; }
  cs.care_phone = typed;
  Object.keys(cs).forEach(function (k) { if (cs[k] == null) delete cs[k]; });
  return cs;
}

/* ---------- In & Out sheet ---------- */
function fluidEntriesFor(pid, day) {
  return State.diary.filter(function (e) { return (e.for_profile_id || null) === (pid || null) && careDayOf(e.eaten_at) === day; })
    .sort(function (a, b) { return a.eaten_at < b.eaten_at ? -1 : 1; });
}
function renderFluids(arg) {
  arg = arg || {};
  var pid = arg.pid !== undefined ? arg.pid : (State.activeProfile || null), day = arg.day || careToday();
  var prof = State.profiles.find(function (p) { return p.id === pid; });
  var entries = fluidEntriesFor(pid, day), b = Logic.fluidBalance(entries);
  var rows = entries.filter(function (e) { return Logic.fluidIn(e) > 0 || e.entry_kind === 'output'; }).map(function (e) {
    var name = esc(e.entry_kind === 'output' ? (OUTPUT_TYPES[e.output_type] || 'Output') + (e.output_color ? ', ' + colorName(e.output_color) : '') + (e.clots ? ', clots' : '') : (e.free_text || 'Meal'));
    var amt = e.entry_kind === 'output' ? Logic.fluidOut(e) : Logic.fluidIn(e);
    return '<tr' + (Logic.outputFlags(e).length ? ' class="flag-row"' : '') + '><td>' + esc(localTime(e.eaten_at)) + '</td><td>' + (e.entry_kind === 'output' ? '' : name + '<br><b>' + shortOz(amt) + '</b>') + '</td><td>' + (e.entry_kind === 'output' ? name + '<br><b>' + shortOz(amt) + '</b>' : '') + '</td></tr>';
  }).join('');
  var nav = function (n) { return 'showScreen(\'fluids\',{day:\'' + shiftDay(day, n) + '\',pid:' + (pid ? '\'' + pid + '\'' : 'null') + '})'; };
  var week = lastDays(pid, day, 7);
  return '<div class="row between"><button class="btn ghost sm" aria-label="Day before" onclick="' + nav(-1) + '">&larr;</button><b>' + esc(dayLabel(day)) + '</b><button class="btn ghost sm" aria-label="Day after" onclick="' + nav(1) + '">&rarr;</button></div>' +
    '<div class="chips">' + [{ id: null, person_name: 'Me' }].concat(State.profiles).map(function (p) { return '<span class="chip' + ((p.id || null) === (pid || null) ? ' on' : '') + '" onclick="showScreen(\'fluids\',{day:\'' + day + '\',pid:' + (p.id ? '\'' + p.id + '\'' : 'null') + '})">' + esc(p.person_name) + '</span>'; }).join('') + '</div>' +
    '<p class="muted">' + esc(prof ? prof.person_name : 'Me') + ' · ' + dayStartLabel() + ' to ' + dayStartLabel() + ' the next day</p>' +
    '<table class="io-table"><thead><tr><th>Time</th><th>In</th><th>Out</th></tr></thead><tbody>' + (rows || '<tr><td colspan="3" class="muted">Nothing logged.</td></tr>') + '</tbody>' +
    '<tfoot><tr><th>Total</th><th>' + shortOz(b.inMl) + '</th><th>' + shortOz(b.outMl) + '</th></tr><tr><th>Difference</th><th colspan="2">' + (b.netMl >= 0 ? '+' : '&minus;') + amountText(Math.abs(b.netMl)) + (b.netMl >= 0 ? ' more in' : ' more out') + '</th></tr></tfoot></table>' +
    '<h2>Last 7 days</h2><table class="io-table"><thead><tr><th>Day</th><th>In</th><th>Out</th><th>Diff</th><th>Weight</th></tr></thead><tbody>' +
    week.map(function (d) { return '<tr><td>' + esc(dayLabel(d.day)) + '</td><td>' + (d.any ? shortOz(d.b.inMl) : '–') + '</td><td>' + (d.any ? shortOz(d.b.outMl) : '–') + '</td><td>' + (d.any ? (d.b.netMl >= 0 ? '+' : '&minus;') + shortOz(Math.abs(d.b.netMl)) : '–') + '</td><td>' + (d.lb ? (Math.round(d.lb * 10) / 10) : '–') + '</td></tr>'; }).join('') + '</tbody></table>' +
    weightTrend(week) + weightList(pid) +
    '<p class="note">Home measurements, not a medical record. Bring them to the care team.</p>' +
    '<div class="btn-row"><button class="btn" onclick="shareFluids(\'' + day + '\',' + (pid ? '\'' + pid + '\'' : 'null') + ')">Share</button><button class="btn ghost" onclick="showScreen(\'diary\')">Back to diary</button></div>';
}
function lastDays(pid, day, n) {
  var ws = Logic.standardWeights(State.measurements || [], pid, dayStart()), byDay = {};
  ws.forEach(function (w) { byDay[w.day] = w.lb; });
  var out = [];
  for (var i = 0; i < n; i++) {
    var d = shiftDay(day, -i), es = fluidEntriesFor(pid, d);
    out.push({ day: d, b: Logic.fluidBalance(es), any: es.some(function (e) { return Logic.fluidIn(e) > 0 || e.entry_kind === 'output'; }), lb: byDay[d] || null });
  }
  return out;
}
// A small line of the morning weights, oldest on the left.
function weightTrend(week) {
  var pts = week.slice().reverse().map(function (d, i) { return { i: i, lb: d.lb }; }).filter(function (p) { return p.lb; });
  if (pts.length < 2) return '';
  var lo = Math.min.apply(null, pts.map(function (p) { return p.lb; })), hi = Math.max.apply(null, pts.map(function (p) { return p.lb; }));
  var span = Math.max(1, hi - lo), W = 300, H = 70;
  var xy = pts.map(function (p) { return [10 + p.i * (W - 20) / 6, H - 10 - (p.lb - lo) / span * (H - 20)]; });
  return '<figure class="trend"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Morning weight over 7 days, from ' + pts[0].lb.toFixed(1) + ' to ' + pts[pts.length - 1].lb.toFixed(1) + ' lb">' +
    '<polyline fill="none" stroke="currentColor" stroke-width="2" points="' + xy.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '"/>' +
    xy.map(function (p) { return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3" fill="currentColor"/>'; }).join('') + '</svg>' +
    '<figcaption class="muted">Morning weight, ' + lo.toFixed(1) + '–' + hi.toFixed(1) + ' lb</figcaption></figure>';
}
function weightList(pid) {
  var ms = (State.measurements || []).filter(function (m) { return m.kind === 'weight' && (m.for_profile_id || null) === (pid || null); })
    .sort(function (a, b) { return a.taken_at < b.taken_at ? 1 : -1; }).slice(0, 10);
  if (!ms.length) return '';
  return '<h2>Recent weights</h2>' + ms.map(function (m) {
    return '<div class="list-item"><div class="grow"><b>' + m.value + ' ' + esc(m.unit || 'lb') + '</b> <span class="muted">' + esc(localDay(m.taken_at) + ' ' + localTime(m.taken_at)) + (m.standard ? ' · morning' : '') + (m.note ? ' · ' + esc(m.note) : '') + loggedBy(m) + '</span></div>' +
      '<button class="icon-btn writer-only" aria-label="Delete weight" onclick="deleteMeasurement(\'' + m.id + '\')">&times;</button></div>';
  }).join('');
}
function fluidsText(pid, day, n) {
  var prof = State.profiles.find(function (p) { return p.id === pid; }), name = prof ? prof.person_name : 'Me';
  var L = [name + ': fluid in and out' + (n > 1 ? ', last ' + n + ' days to ' + day : ', ' + new Date(day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })) + ' (day starts ' + dayStartLabel() + ')'];
  if (n === 1) {
    fluidEntriesFor(pid, day).forEach(function (e) {
      if (e.entry_kind === 'output') L.push(localTime(e.eaten_at) + '  OUT ' + outputLine(e).replace(/&#39;/g, '\''));
      else if (Logic.fluidIn(e) > 0) L.push(localTime(e.eaten_at) + '  IN  ' + (e.free_text || 'Meal') + ' · ' + amountText(Logic.fluidIn(e)));
    });
  }
  lastDays(pid, day, n).forEach(function (d) {
    if (!d.any && !d.lb) return;
    L.push((n > 1 ? d.day + ': ' : 'Total: ') + 'in ' + shortOz(d.b.inMl) + ', out ' + shortOz(d.b.outMl) + ', difference ' + (d.b.netMl >= 0 ? '+' : '-') + shortOz(Math.abs(d.b.netMl)) + (d.lb ? ', morning weight ' + d.lb.toFixed(1) + ' lb' : ''));
  });
  var cs = careSettingsOf(pid);
  if (cs.fluid_limit_ml) L.push('Fluid limit: ' + shortOz(cs.fluid_limit_ml) + ' a day' + (cs.fluid_limit_source ? ' (' + cs.fluid_limit_source + ')' : ''));
  L.push('Home measurements, not a medical record.');
  return L.join('\n');
}
function shareFluids(day, pid) {
  var text = fluidsText(pid, day, 1) + '\n\n' + fluidsText(pid, day, 7);
  if (navigator.share) return navigator.share({ title: 'Fluid in and out', text: text }).catch(function () {});
  copyText(text, 'Copied');
}

/* ---------- family day start (owners) ---------- */
function dayStartPicker(owner) {
  var h = dayStart();
  if (!owner) return '<p class="muted">The family\'s day starts at ' + dayStartLabel(h) + '.</p>';
  return '<label for="dayStartSel">The family\'s day starts at</label><select id="dayStartSel" onchange="saveDayStart(+this.value)">' +
    Array.apply(null, Array(24)).map(function (_, i) { return '<option value="' + i + '"' + (i === h ? ' selected' : '') + '>' + dayStartLabel(i) + (i === 0 ? ' (midnight)' : '') + '</option>'; }).join('') +
    '</select><p class="muted">Entries before this hour count toward the day before, so a late-night drink lands on the right day.</p>';
}
function saveDayStart(h) {
  Sync.setDayStart(h).then(function () { State.dayStart = h; return DB.meta('day_start_hour', h); }).then(function () { toast('Day now starts at ' + dayStartLabel(h)); })
    .catch(function (e) { toast(e.message); renderFamilyBox(); });
}

/* ---------- checking a phone number (Twilio Lookup, through the lookup cloud function) ---------- */
var LINE_TYPE_TEXT = { mobile: 'mobile', landline: 'landline', fixedVoip: 'internet phone (fixed)', nonFixedVoip: 'internet phone', voip: 'internet phone', 'toll-free': 'toll-free', personal: 'personal', pager: 'pager', unknown: 'type unknown' };
function phoneTypeText(type, carrier) { return '✓ ' + (LINE_TYPE_TEXT[type] || type || 'checked') + (carrier ? ' · ' + carrier : ''); }
// Confirms the number is real, puts it in standard form and says whether it's a mobile or
// a landline. Without the cloud or Twilio keys it only checks the digit count.
function checkPhoneField(id) {
  var input = document.getElementById(id), hint = document.getElementById(id + 'Hint'), v = input.value.trim();
  var digits = v.replace(/[^\d]/g, '');
  if (!v) { hint.textContent = 'Type a number first.'; return; }
  if (!Sync.enabled()) { hint.textContent = digits.length === 10 || (digits.length === 11 && digits[0] === '1') ? 'Looks like a US number (connect to the cloud to check it properly).' : 'That does not look like a US number. Check the digits.'; return; }
  hint.textContent = 'Checking...';
  Sync.lookup('phone', v).then(function (res) {
    if (!document.getElementById(id)) return;
    if (!res || res.available === false) { hint.textContent = 'Number checking is not set up yet (it needs Twilio keys in the cloud). The number is saved as typed.'; return; }
    S.phoneCheck = { id: id, res: res };
    if (!res.valid) { hint.textContent = '⚠ ' + (res.error || 'This number does not look valid. Check the digits.'); return; }
    if (res.national) input.value = res.national;
    hint.textContent = phoneTypeText(res.line_type, res.carrier) + (res.line_type === 'landline' ? ' (it can take calls, not texts)' : '');
  }).catch(function (e) { hint.textContent = 'Could not check: ' + e.message; });
}
