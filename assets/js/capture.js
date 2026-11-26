/* The center + button: one place to log anything about her, from any screen. Food tools
 * (recipe photos, receipts, groceries, barcodes, links) live in Kitchen -> Add.
 * Also the daily therapy checklist on Today: tap Done each time she does an exercise. */

function capturePid() {
  var p = State.activeProfile && State.profiles.find(function (x) { return x.id === State.activeProfile; });
  return p ? p.id : (State.profiles[0] && State.profiles[0].id) || null;
}
function openCapture() {
  var pid = capturePid(), a = pid ? '\'' + pid + '\'' : 'null';
  var prof = State.profiles.find(function (p) { return p.id === pid; });
  var tile = function (ico, label, sub, js) { return '<button class="cap-tile" onclick="' + js + '">' + iconDot(ico) + '<b>' + label + '</b>' + (sub ? '<span class="muted">' + sub + '</span>' : '') + '</button>'; };
  openSheet('<h2 style="margin-top:0" data-nosnap>Log something' + (prof ? ' for ' + esc(prof.person_name) : '') + '</h2>' +
    '<div class="cap-grid">' +
    tile('camera', 'Snap it', 'any screen, bottle or paper', 'snapIt(' + a + ')') +
    tile('mic', 'Say it', 'talk, it makes the entries', 'sayIt(' + a + ')') +
    tile('cup', 'Drink', '', 'logDrink()') +
    tile('output', 'Output', 'urine, stool, drain', 'logOutput()') +
    tile('vitals', 'BP &amp; vitals', '', 'logVital(' + a + ',\'blood_pressure\')') +
    tile('scale', 'Weight', '', 'logWeight()') +
    tile('pill', 'Medicines', 'mark doses', 'closeSheet();showScreen(\'meds\',{pid:' + a + '})') +
    tile('meal', 'Meal', '', 'logFood()') +
    tile('exercise', 'Exercise', 'from her therapy list', 'closeSheet();showScreen(\'home\')') +
    tile('note', 'Visit notes', 'Scribe', 'scribeIt(' + a + ')') +
    tile('update', 'Note or update', 'for the family', 'editRecord(null,\'update\',' + a + ')') +
    tile('doc', 'Paper or document', '', 'snapIt(' + a + ')') +
    '</div><p class="muted">Recipes, receipts and groceries are in <a href="#" onclick="event.preventDefault();closeSheet();showScreen(\'kitchen\',{tab:\'add\'})">Kitchen &rarr; Add</a>.</p>' +
    '<div class="btn-row"><button class="btn ghost" onclick="closeSheet()">Close</button></div>');
}

/* ---------- Therapy on Today: scheduled workouts ----------
 * Each exercise can be given workout times (fields.slots: morning, noon, evening, bedtime) and days
 * (fields.days: mon..sun, empty = every day) in "Make a schedule". Today shows one line per workout
 * due today ("Morning workout · 9 exercises · 3 done · Start"); Start walks through it one exercise
 * at a time. Each Done is a record of kind 'exercise_log' with the exercise and the workout. */
var WK_SLOTS = [['morning', 'Morning'], ['noon', 'Midday'], ['evening', 'Evening'], ['bedtime', 'Bedtime']];
var WK_DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
function wkToday() { return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(careToday() + 'T12:00:00').getDay()]; }
function wkActive(pid) { return recordsOf(pid, ['exercise']).filter(function (r) { return (r.fields || {}).active !== 'No'; }).sort(function (a, b) { return (a.title || '').localeCompare(b.title || ''); }); }
function wkSlots(r) { return String((r.fields || {}).slots || '').split(',').filter(Boolean); }
function wkOnDay(r, day) { var d = String((r.fields || {}).days || ''); return !d || d.split(',').indexOf(day) >= 0; }
function wkGroup(pid, slot) { var day = wkToday(); return wkActive(pid).filter(function (r) { return wkSlots(r).indexOf(slot) >= 0 && wkOnDay(r, day); }); }
function wkLogsToday(pid) {
  var day = careToday();
  return (State.records || []).filter(function (r) { return !r.deleted && r.kind === 'exercise_log' && (r.fields || {}).exercise_id && (r.for_profile_id || null) === (pid || null) && careDayOf(r.occurred_at) === day; });
}
function wkDoneIds(pid, slot) {
  var ids = {}; wkLogsToday(pid).forEach(function (l) { var f = l.fields || {}; if ((f.slot || '') === slot && f.status !== 'skipped') ids[f.exercise_id] = true; }); return ids;
}
function todayExercises(pid) {
  var ex = wkActive(pid); if (!ex.length) return '';
  var a = pid ? '\'' + pid + '\'' : 'null';
  var rows = WK_SLOTS.map(function (s) {
    var g = wkGroup(pid, s[0]); if (!g.length) return '';
    var done = wkDoneIds(pid, s[0]), n = g.filter(function (r) { return done[r.id]; }).length, all = n >= g.length;
    return '<div class="list-item"><div class="grow"><b>' + (all ? '&#10003; ' : '') + s[1] + ' workout</b><div class="muted">' + g.length + ' exercise' + (g.length === 1 ? '' : 's') + ' &middot; ' + n + ' done</div>' +
      '<details class="wk-list"><summary class="muted">See the list</summary><ul>' + g.map(function (r) { return '<li>' + (done[r.id] ? '&#10003; ' : '') + esc(r.title) + '</li>'; }).join('') + '</ul></details></div>' +
      '<button class="btn sm' + (all ? ' ghost' : '') + ' writer-only" onclick="startWorkout(' + a + ',\'' + s[0] + '\')">' + (all ? 'Again' : n ? '&#9654; Continue' : '&#9654; Start') + '</button></div>';
  }).filter(Boolean);
  var unscheduled = ex.filter(function (r) { return !wkSlots(r).length; }).length;
  return '<div class="card"><div class="row between"><h3>' + icon('exercise') + ' Exercises</h3><button class="btn sm ghost writer-only" onclick="openWorkoutSchedule(' + a + ')">' + (rows.length || unscheduled < ex.length ? 'Edit schedule' : 'Make a schedule') + '</button></div>' +
    (rows.length ? scrollList(rows, 3) : (ex.some(function (r) { return wkSlots(r).length; }) ? '<p class="muted">No workout scheduled today.</p>' : '<p>' + ex.length + ' exercise' + (ex.length === 1 ? '' : 's') + ' from her therapy sheet. <b>Make a schedule</b> to group them into workouts (morning, evening...) on the days she does them.</p>')) +
    (rows.length && unscheduled ? '<p class="muted">' + unscheduled + ' exercise' + (unscheduled === 1 ? ' is' : 's are') + ' not in the schedule.</p>' : '') + '</div>';
}

/* Make a schedule: which workout each exercise belongs to, and on which days. */
function openWorkoutSchedule(pid) {
  var ex = wkActive(pid), a = pid ? '\'' + pid + '\'' : 'null';
  if (!ex.length) return toast('No exercises yet. Snap her therapy sheet or add them in File → Therapy.');
  var days = {}; ex.forEach(function (r) { String((r.fields || {}).days || '').split(',').filter(Boolean).forEach(function (d) { days[d] = true; }); });
  var anyDays = Object.keys(days).length;
  openSheet('<h2 style="margin-top:0">' + icon('exercise') + ' Workout schedule</h2>' +
    '<p class="muted">Tick when she does each exercise. Exercises ticked for the same time become one workout on Today.</p>' +
    '<label>Days</label><div class="chips" id="wkDays">' + WK_DAYS.map(function (d) { var on = !anyDays || days[d[0]]; return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-v="' + d[0] + '" aria-pressed="' + on + '" onclick="toggleChip(this)">' + d[1] + '</button>'; }).join('') + '</div>' +
    '<div class="btn-row"><button type="button" class="btn sm ghost" onclick="wkSetAll(\'morning\')">All in the morning</button><button type="button" class="btn sm ghost" onclick="wkSetAll(\'morning,evening\')">Morning and evening</button><button type="button" class="btn sm ghost" onclick="wkSetAll(\'\')">Clear</button></div>' +
    scrollList(ex.map(function (r) {
      var on = wkSlots(r), f = r.fields || {}, hint = Logic.exerciseTarget(f.how_often);
      return '<div class="wk-row"><b>' + esc(r.title) + '</b>' + (f.how_often ? ' <span class="muted">(' + esc(f.how_often) + ')</span>' : '') +
        '<div class="chips" data-ex="' + r.id + '">' + WK_SLOTS.map(function (s) { var sel = on.indexOf(s[0]) >= 0; return '<button type="button" class="chip' + (sel ? ' on' : '') + '" data-v="' + s[0] + '" aria-pressed="' + sel + '" onclick="toggleChip(this)">' + s[1] + '</button>'; }).join('') + '</div>' +
        (hint > 1 && on.length < hint ? '<div class="muted">The sheet says ' + hint + ' times a day.</div>' : '') + '</div>';
    }), 6, true) +
    '<div class="btn-row"><button class="btn" onclick="saveWorkoutSchedule(' + a + ')">Save schedule</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>');
}
function wkSetAll(slots) {
  var want = slots.split(',').filter(Boolean);
  Array.prototype.forEach.call(document.querySelectorAll('#sheetBody [data-ex] .chip'), function (c) { var on = want.indexOf(c.dataset.v) >= 0; c.classList.toggle('on', on); c.setAttribute('aria-pressed', on); });
}
function saveWorkoutSchedule(pid) {
  var days = Array.prototype.map.call(document.querySelectorAll('#wkDays .chip.on'), function (c) { return c.dataset.v; });
  if (!days.length) return toast('Pick at least one day');
  var dayStr = days.length === 7 ? '' : days.join(',');
  var rows = Array.prototype.map.call(document.querySelectorAll('#sheetBody [data-ex]'), function (box) {
    return { id: box.dataset.ex, slots: Array.prototype.map.call(box.querySelectorAll('.chip.on'), function (c) { return c.dataset.v; }).join(',') };
  });
  rows.reduce(function (p, x) {
    return p.then(function () { return DB.update('records', x.id, function (cur) { if (!cur || cur.deleted) return null; cur.fields = cur.fields || {}; cur.fields.slots = x.slots || null; cur.fields.days = dayStr || null; return cur; }); });
  }, Promise.resolve()).then(function () { closeSheet(); return loadAll(); })
    .then(function () { refresh(); if (Sync.enabled()) syncNow(); toast('Schedule saved'); })
    .catch(function (e) { toast('Could not save: ' + e.message); });
}

/* Start: one exercise at a time, big buttons. */
function startWorkout(pid, slot) {
  var g = wkGroup(pid, slot), done = wkDoneIds(pid, slot);
  var todo = g.filter(function (r) { return !done[r.id]; });
  S.workout = { pid: pid, slot: slot, list: (todo.length ? todo : g).map(function (r) { return r.id; }), i: 0, did: 0, skipped: 0 };
  wkShow();
}
function wkShow() {
  var w = S.workout; if (!w) return;
  var name = (WK_SLOTS.find(function (s) { return s[0] === w.slot; }) || ['', ''])[1];
  if (w.i >= w.list.length) {
    return openSheet('<h2 style="margin-top:0">' + icon('star') + ' ' + esc(name) + ' workout finished</h2><p>' + w.did + ' done' + (w.skipped ? ', ' + w.skipped + ' skipped' : '') + '. Nice work.</p>' +
      '<div class="btn-row"><button class="btn" onclick="closeSheet()">Close</button></div>');
  }
  var r = (State.records || []).find(function (x) { return x.id === w.list[w.i]; }) || {}, f = r.fields || {};
  openSheet('<p class="muted" style="margin-top:0">' + esc(name) + ' workout &middot; ' + (w.i + 1) + ' of ' + w.list.length + '</p>' +
    '<h2 class="wk-name">' + esc(r.title || '') + '</h2>' +
    (f.how ? '<p class="wk-how">' + esc(f.how) + '</p>' : '') +
    (f.notes ? '<p class="prewrap">' + esc(f.notes) + '</p>' : '') +
    '<div class="btn-row wk-btns"><button class="btn" onclick="wkStep(\'done\')">&#10003; Done</button><button class="btn ghost" onclick="wkStep(\'skipped\')">Skip</button></div>' +
    '<p class="muted">Stop and call the therapist if she has pain, dizziness or shortness of breath.</p>' +
    '<div class="btn-row"><button class="btn ghost sm" onclick="closeSheet()">Stop for now</button></div>');
}
function wkStep(status) {
  var w = S.workout; if (!w) return;
  var r = (State.records || []).find(function (x) { return x.id === w.list[w.i]; }); if (!r) { w.i++; return wkShow(); }
  if (status === 'skipped') w.skipped++; else w.did++;
  DB.put('records', { kind: 'exercise_log', for_profile_id: w.pid, title: r.title, occurred_at: new Date().toISOString(), fields: { exercise_id: r.id, slot: w.slot, status: status === 'done' ? 'done' : 'skipped' } })
    .then(function () { w.i++; return loadAll(); })
    .then(function () { wkShow(); if (Sync.enabled()) syncNow(); })
    .catch(function (e) { toast('Could not save: ' + e.message); });
}
// Closing the walk-through refreshes Today so the counts are right.
var _wkCloseSheet = closeSheet;
closeSheet = function () { var had = !!S.workout; _wkCloseSheet(); if (had) { S.workout = null; if (currentScreen === 'home') refresh(); } };
