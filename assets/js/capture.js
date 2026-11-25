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
  var tile = function (icon, label, sub, js) { return '<button class="cap-tile" onclick="' + js + '"><span class="cap-ico">' + icon + '</span><b>' + label + '</b>' + (sub ? '<span class="muted">' + sub + '</span>' : '') + '</button>'; };
  openSheet('<h2 style="margin-top:0" data-nosnap>Log something' + (prof ? ' for ' + esc(prof.person_name) : '') + '</h2>' +
    '<div class="cap-grid">' +
    tile('&#128247;', 'Snap it', 'any screen, bottle or paper', 'snapIt(' + a + ')') +
    tile('&#127908;', 'Say it', 'talk, it makes the entries', 'sayIt(' + a + ')') +
    tile('&#129380;', 'Drink', '', 'logDrink()') +
    tile('&#128701;', 'Output', 'urine, stool, drain', 'logOutput()') +
    tile('&#10084;&#65039;', 'BP &amp; vitals', '', 'logVital(' + a + ',\'blood_pressure\')') +
    tile('&#9878;&#65039;', 'Weight', '', 'logWeight()') +
    tile('&#128138;', 'Medicines', 'mark doses', 'closeSheet();showScreen(\'meds\',{pid:' + a + '})') +
    tile('&#127869;', 'Meal', '', 'logFood()') +
    tile('&#129336;', 'Exercise', 'from her therapy list', 'closeSheet();showScreen(\'home\')') +
    tile('&#127897;', 'Visit notes', 'Scribe', 'scribeIt(' + a + ')') +
    tile('&#128221;', 'Note or update', 'for the family', 'editRecord(null,\'update\',' + a + ')') +
    tile('&#128196;', 'Paper or document', '', 'snapIt(' + a + ')') +
    '</div><p class="muted">Recipes, receipts and groceries are in <a href="#" onclick="event.preventDefault();closeSheet();showScreen(\'kitchen\',{tab:\'add\'})">Kitchen &rarr; Add</a>.</p>' +
    '<div class="btn-row"><button class="btn ghost" onclick="closeSheet()">Close</button></div>');
}

/* ---------- Therapy checklist on Today ---------- */
function exerciseLogsToday(pid, exId) {
  var day = careToday();
  return (State.records || []).filter(function (r) { return !r.deleted && r.kind === 'exercise_log' && (r.for_profile_id || null) === (pid || null) && (r.fields || {}).exercise_id === exId && careDayOf(r.occurred_at) === day; })
    .sort(function (a, b) { return a.occurred_at < b.occurred_at ? -1 : 1; });
}
function todayExercises(pid) {
  var ex = recordsOf(pid, ['exercise']).filter(function (r) { return (r.fields || {}).active !== 'No'; }).sort(function (a, b) { return (a.title || '').localeCompare(b.title || ''); });
  if (!ex.length) return '';
  var a = pid ? '\'' + pid + '\'' : 'null', done = 0, total = 0;
  var rows = ex.map(function (r) {
    var f = r.fields || {}, target = Logic.exerciseTarget(f.how_often), logs = exerciseLogsToday(pid, r.id), n = logs.length;
    total += target || 1; done += Math.min(n, target || 1);
    var met = target && n >= target;
    return '<div class="list-item"><div class="grow tappable" onclick="editRecord(\'' + r.id + '\')"><b>' + (met ? '&#10003; ' : '') + esc(r.title) + '</b>' +
      '<div class="muted">' + esc([f.how, f.how_often].filter(Boolean).join(' · ')) + '</div>' +
      '<div class="muted">' + (target ? n + ' of ' + target + ' today' : n + ' today') + (n ? ' · last ' + esc(localTime(logs[n - 1].occurred_at)) : '') + '</div></div>' +
      '<button class="btn sm' + (met ? ' ghost' : '') + ' writer-only" onclick="exerciseDone(\'' + r.id + '\',' + a + ')">&#10003; Done</button></div>';
  }).join('');
  return '<div class="card"><div class="row between"><h3>&#129336; Exercises</h3><span class="muted">' + done + ' of ' + total + ' today</span></div>' + rows +
    '<p class="muted">From her therapy sheet (File &rarr; Therapy). Stop and call the therapist if she has pain, dizziness or shortness of breath.</p></div>';
}
function exerciseDone(exId, pid) {
  var ex = (State.records || []).find(function (r) { return r.id === exId; }); if (!ex) return;
  DB.put('records', { kind: 'exercise_log', for_profile_id: pid, title: ex.title, occurred_at: new Date().toISOString(), fields: { exercise_id: exId } })
    .then(function (rec) { return loadAll().then(function () { refresh(); if (Sync.enabled()) syncNow(); toast(ex.title + ': done', 'Undo', function () { DB.remove('records', rec.id).then(loadAll).then(refresh); }); }); })
    .catch(function (e) { toast('Could not save: ' + e.message); });
}
