/* Today: one screen that pulls the day together (what needs attention, meds now, fluid so far,
 * vitals, what's coming up, meal thoughts), plus the Daily meds screen and the How-to guide.
 * Flags only repeat what the family or the care team set; the app never makes up advice. */

function todayPid(arg) {
  if (arg && arg.pid !== undefined) return arg.pid;
  if (State.activeProfile) return State.activeProfile;
  var cared = State.profiles.find(function (p) { return p.care_settings && Object.keys(p.care_settings).length; });
  return (cared || State.profiles[0] || {}).id || null;
}
// Hours into the current care day, so 1 am after a 6 am day start reads as 25.
function careHourNow() { var h = new Date().getHours() + new Date().getMinutes() / 60; return h < dayStart() ? h + 24 : h; }
function pidArg(pid) { return pid ? '\'' + pid + '\'' : 'null'; }
function medsOf(pid) { return recordsOf(pid, ['medication']); }
function dosesOf(pid) { return recordsOf(pid, ['dose']); }
function slotName(slot) { var s = MED_SLOTS.find(function (x) { return x[0] === slot; }); return s ? s[1] : slot; }
function helpLink(topic, text) { return '<button class="linkish" onclick="showScreen(\'help\',{topic:\'' + topic + '\'})">' + (text || 'How?') + '</button>'; }

function renderHome(arg) {
  var pid = todayPid(arg), day = careToday(), prof = State.profiles.find(function (p) { return p.id === pid; });
  var html = profileSwitcher();
  if (!prof) return html + welcomeCard();
  var entries = fluidEntriesFor(pid, day), plan = Logic.medPlan(medsOf(pid), dosesOf(pid), day, careHourNow());
  var flags = attentionItems(pid, day, entries, plan);
  html += '<div class="row between"><span class="muted">' + esc(prof.person_name) + ' · ' + esc(dayLabel(day)) + '</span><span><button class="btn sm writer-only" onclick="snapIt(' + pidArg(pid) + ')">&#128247; Snap it</button> <button class="btn sm writer-only" onclick="sayIt(' + pidArg(pid) + ')">&#127908; Say it</button> <button class="btn sm ghost writer-only" onclick="scribeIt(' + pidArg(pid) + ')">&#127897; Scribe</button></span></div>';
  html += eraseBanner() + gettingStarted(pid);
  html += catchUpRow(pid);
  if (flags.length) html += '<div class="card attention" role="alert"><h3>&#9888; Needs attention</h3>' + flags.map(function (f) { return '<div class="list-item"><div class="grow">' + f.text + '</div>' + (f.action || '') + '</div>'; }).join('') + '</div>';
  html += todayChecks(pid);
  html += todayMeds(pid, day, plan);
  html += todayExercises(pid);
  html += fluidCardFor(pid, entries, day);
  html += todayVitals(pid, day);
  html += todayComing(pid, day);
  html += todayInsights(pid);
  html += todayMeals(pid, prof, entries);
  return html;
}

/* ---------- needs attention ---------- */
function catchUpRow(pid) {
  var seen = handoffSeen(), since = seen ? Math.round((Date.now() - new Date(seen)) / 3600000) : null;
  return '<div class="btn-row"><button class="btn sm ghost" onclick="showScreen(\'handoff\',{pid:' + pidArg(pid) + '})">&#128075; Catch me up</button><button class="btn sm ghost" onclick="showScreen(\'ask\',{pid:' + pidArg(pid) + '})">&#128172; Ask her file</button><span class="muted">' + (seen ? (since < 1 ? 'caught up just now' : 'last caught up ' + (since < 48 ? since + ' h' : Math.round(since / 24) + ' days') + ' ago') : 'what happened while you were away') + '</span></div>';
}
function attentionItems(pid, day, entries, plan) {
  var cs = careSettingsOf(pid), out = [], b = Logic.fluidBalance(entries), limit = +cs.fluid_limit_ml || 0;
  var call = cs.care_phone ? ' <a class="btn sm" href="tel:' + esc(cs.care_phone_e164 || cs.care_phone.replace(/[^\d+]/g, '')) + '">Call</a>' : '';
  if (limit && b.inMl > limit) out.push({ text: 'Fluid in is <b>' + shortOz(b.inMl) + '</b>, over her ' + shortOz(limit) + ' limit' + (cs.fluid_limit_source ? ' (' + esc(cs.fluid_limit_source) + ')' : '') + '.' });
  b.flags.forEach(function (f) { out.push({ text: esc(localTime(f.entry.eaten_at) + ' ' + (OUTPUT_TYPES[f.entry.output_type] || 'output').toLowerCase() + ': ' + f.reasons.join(', ')) + '. Worth a call to the care team if this is new or getting worse.', action: call }); });
  rhythmFlags(pid, day).forEach(function (m) { out.push({ text: 'The monitor showed <b>' + esc(rhythmName(m.rhythm)) + '</b> at ' + esc(localTime(m.taken_at)) + (m.pulse != null ? ' (pulse ' + esc(m.pulse) + ')' : '') + '. Tell the care team, especially if it is new. Chest pain, fainting or trouble breathing: call 911.', action: call }); });
  var w = Logic.weightChange(State.measurements || [], pid, day, dayStart());
  Logic.weightFlags(w, cs).forEach(function (t) { out.push({ text: 'Weight ' + esc(t) + (cs.alert_source ? ' (alert level: ' + esc(cs.alert_source) + ')' : '') + '.', action: call }); });
  var weighsDaily = Logic.standardWeights(State.measurements || [], pid, dayStart()).some(function (x) { return x.day >= shiftDay(day, -7); });
  if (!w && weighsDaily && careHourNow() >= 10) out.push({ text: 'No morning weight yet today.', action: '<button class="btn sm writer-only" onclick="logWeight()">Log weight</button>' });
  plan.filter(function (p) { return p.state === 'overdue'; }).forEach(function (p) { out.push({ text: '<b>' + esc(p.med.title) + '</b> ' + esc(slotName(p.slot).toLowerCase()) + ' dose not marked yet.', action: '<button class="btn sm writer-only" onclick="giveDose(\'' + p.med.id + '\',\'' + p.slot + '\',' + pidArg(pid) + ')">Given</button>' }); });
  Logic.upcoming(medsOf(pid), day, 3, localDay).forEach(function (u) { out.push({ text: esc(u.title) + ' ' + (u.inDays === 0 ? 'today' : u.inDays === 1 ? 'tomorrow' : 'in ' + u.inDays + ' days') + '.' }); });
  return out;
}

/* ---------- meds now ---------- */
var DOSE_TEXT = { given: '&#10003; given', skipped: 'skipped', refused: 'refused', due: 'due now', overdue: 'overdue', later: 'later' };
function doseRow(p, pid) {
  var f = p.med.fields || {}, d = p.dose;
  var amt = d && d.fields.amount && d.fields.amount !== f.dose ? ' · <b>' + esc(d.fields.amount) + '</b>' : '';
  var by = d ? ' ' + esc(localTime(d.occurred_at || d.updated_at)) + amt + (d.edited_by || d.user_id ? ' by ' + esc(whoName(d.edited_by || d.user_id)) : '') : (p.time ? ' · ' + esc(p.time) : '');
  return '<div class="list-item dose-' + p.state + '"><div class="grow tappable" onclick="aboutMed(\'' + p.med.id + '\')"><b>' + esc(p.med.title) + '</b> <span class="muted">' + esc([f.dose, f.with_food && f.with_food !== 'Either' ? f.with_food.toLowerCase() : ''].filter(Boolean).join(' · ')) + '</span>' +
    '<div class="muted"><span class="dose-state">' + DOSE_TEXT[p.state] + '</span>' + by + (d && d.fields.note ? ' · ' + esc(d.fields.note) : '') + (f.label_boxed ? ' · <span class="flag-text">boxed warning</span>' : '') + '</div></div>' +
    (d ? '<button class="btn sm ghost writer-only" onclick="editDose(\'' + d.id + '\')">Edit</button><button class="btn sm ghost writer-only" onclick="undoDose(\'' + d.id + '\')">Undo</button>'
      : '<button class="btn sm writer-only" onclick="giveDose(\'' + p.med.id + '\',\'' + p.slot + '\',' + pidArg(pid) + ')">Given</button><button class="btn sm ghost writer-only" onclick="skipDose(\'' + p.med.id + '\',\'' + p.slot + '\',' + pidArg(pid) + ')">Not given</button>') + '</div>';
}
function todayMeds(pid, day, plan) {
  var meds = medsOf(pid).filter(function (m) { return Logic.medActive(m, day); });
  if (!meds.length) return '<div class="card"><div class="row between"><h3>&#128138; Meds</h3><button class="btn sm ghost" onclick="showScreen(\'meds\',{pid:' + pidArg(pid) + '})">Set up</button></div><p class="muted">Add her medicines in File &rarr; Summary and pick when each is given. ' + helpLink('meds') + '</p></div>';
  // Show what's due or overdue and the next slot coming; the rest is on the meds screen.
  var open = plan.filter(function (p) { return p.state === 'due' || p.state === 'overdue'; });
  var next = plan.filter(function (p) { return p.state === 'later'; });
  var nextHour = next.length ? next[0].hour : null;
  var show = open.concat(next.filter(function (p) { return p.hour === nextHour && !open.length; }));
  var done = plan.filter(function (p) { return p.dose; }).length;
  return '<div class="card"><div class="row between"><h3>&#128138; Meds</h3><span class="muted">' + done + ' of ' + plan.length + ' marked today</span></div>' +
    (show.length ? (open.length ? '' : '<div class="muted">Next: ' + esc(slotName(show[0].slot).toLowerCase()) + '</div>') + scrollList(show.map(function (p) { return doseRow(p, pid); }), 4)
      : '<p class="muted">' + (plan.length ? 'Nothing due right now.' : 'No scheduled doses today.') + '</p>') +
    '<div class="btn-row"><button class="btn sm ghost" onclick="showScreen(\'meds\',{pid:' + pidArg(pid) + '})">All meds today</button></div></div>';
}
// opts: { at: ISO time given (default now), amount: what was given (default the usual dose) }
function saveDose(medId, slot, pid, status, note, opts) {
  opts = opts || {};
  var med = (State.records || []).find(function (r) { return r.id === medId; }); if (!med) return Promise.resolve();
  var now = opts.at || new Date().toISOString(), day = careDayOf(now), old = Logic.doseFor(dosesOf(pid), medId, day, slot === 'prn' ? '__none' : slot);
  var fields = { med_id: medId, day: day, slot: slot, status: status, note: note || null, amount: status === 'given' ? (opts.amount || (med.fields || {}).dose || null) : null };
  var write = old ? DB.update('records', old.id, function (cur) { if (!cur) return null; cur.fields = fields; cur.occurred_at = now; cur.deleted = false; return cur; })
    : DB.put('records', { kind: 'dose', for_profile_id: pid, title: med.title, occurred_at: now, fields: fields });
  return write.then(function (saved) {
    return loadAll().then(function () { refresh(); if (Sync.enabled()) syncNow(); toast(med.title + ': ' + status, 'Undo', function () { undoDose(saved.id); }); });
  }).catch(function (e) { toast('Could not save: ' + e.message); });
}
function giveDose(medId, slot, pid) { return saveDose(medId, slot, pid, 'given'); }
function skipDose(medId, slot, pid) {
  var med = (State.records || []).find(function (r) { return r.id === medId; }); if (!med) return;
  openSheet('<h2 style="margin-top:0">' + esc(med.title) + ' not given</h2><p class="muted">' + esc(slotName(slot)) + ' dose</p>' +
    '<div class="chips" id="skipWhy"><button type="button" class="chip on" data-v="skipped" onclick="pickChip(\'skipWhy\',this)">Skipped</button><button type="button" class="chip" data-v="refused" onclick="pickChip(\'skipWhy\',this)">She refused</button></div>' +
    '<label for="skipNote">Why (optional)</label><input id="skipNote" placeholder="asleep, doctor said hold it, out of pills...">' +
    '<p class="note">Missed a dose? Check the label or call the pharmacy before giving it late or doubling up.</p>' +
    '<div class="btn-row"><button class="btn" onclick="closeSheet();saveDose(\'' + medId + '\',\'' + slot + '\',' + pidArg(pid) + ',chipValue(\'skipWhy\')||\'skipped\',document.getElementById(\'skipNote\').value.trim())">Save</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>');
}
// Given at another time, or a different amount (half a tablet, a sliding-scale insulin dose...).
function doseSheet(medId, slot, pid, doseId) {
  var med = (State.records || []).find(function (r) { return r.id === medId; }); if (!med) return;
  var d = doseId ? (State.records || []).find(function (r) { return r.id === doseId; }) : null, f = (d && d.fields) || {};
  var at = d ? (d.occurred_at || d.updated_at) : new Date().toISOString(), status = f.status || 'given';
  openSheet('<h2 style="margin-top:0">' + esc(med.title) + '</h2><p class="muted">' + esc(slot === 'prn' ? 'Only when needed' : slotName(slot) + ' dose') + ((med.fields || {}).dose ? ' · usual dose ' + esc(med.fields.dose) : '') + '</p>' +
    '<div class="chips" id="dsStatus">' + [['given', 'Given'], ['skipped', 'Skipped'], ['refused', 'She refused']].map(function (s) { return '<button type="button" class="chip' + (s[0] === status ? ' on' : '') + '" data-v="' + s[0] + '" onclick="pickChip(\'dsStatus\',this)">' + s[1] + '</button>'; }).join('') + '</div>' +
    '<label for="dsAt">Time given</label><input id="dsAt" type="datetime-local" value="' + localDay(at) + 'T' + localTime(at) + '">' +
    '<label for="dsAmt">Amount given</label><input id="dsAmt" value="' + esc(f.amount || (med.fields || {}).dose || '') + '" placeholder="40 mg, half a tablet, 6 units...">' +
    '<label for="dsNote">Note</label><input id="dsNote" value="' + esc(f.note || '') + '" placeholder="with breakfast, crushed in applesauce...">' +
    '<div class="btn-row"><button class="btn" onclick="saveDoseSheet(\'' + medId + '\',\'' + slot + '\',' + pidArg(pid) + ',' + (d ? '\'' + d.id + '\'' : 'null') + ')">Save</button><button class="btn ghost" onclick="closeSheet()">Cancel</button>' +
    (d ? '<button class="btn ghost" onclick="showHistory(\'records\',\'' + d.id + '\')">History</button>' : '') + '</div>');
}
function editDose(id) { var d = (State.records || []).find(function (r) { return r.id === id; }); if (d) doseSheet(d.fields.med_id, d.fields.slot, d.for_profile_id || null, id); }
function saveDoseSheet(medId, slot, pid, doseId) {
  var when = new Date(document.getElementById('dsAt').value), at = (isNaN(when) ? new Date() : when).toISOString();
  var status = chipValue('dsStatus') || 'given', amount = document.getElementById('dsAmt').value.trim(), note = document.getElementById('dsNote').value.trim() || null;
  closeSheet();
  if (!doseId) return saveDose(medId, slot, pid, status, note, { at: at, amount: amount });
  var med = (State.records || []).find(function (r) { return r.id === medId; }) || {};
  DB.update('records', doseId, function (cur) {
    if (!cur) return null;
    cur.fields = Object.assign({}, cur.fields, { status: status, note: note, amount: status === 'given' ? (amount || (med.fields || {}).dose || null) : null, day: careDayOf(at) });
    cur.occurred_at = at; return cur;
  }).then(loadAll).then(function () { refresh(); if (Sync.enabled()) syncNow(); toast('Saved'); }).catch(function (e) { toast('Could not save: ' + e.message); });
}
// Undo removes the dose mark entirely (it goes to Deleted, so History still shows it).
function undoDose(id) {
  DB.remove('records', id).then(loadAll).then(function () { refresh(); if (Sync.enabled()) syncNow(); toast('Dose mark removed'); });
}
var MED_PROMPTS = [
  'New medicine, or a dose change? Ask the pharmacist to check it against her kidney function and her other medicines.',
  'Missed a dose? Check the label or call the pharmacy before giving it late or doubling up.',
  'Bring this list (or the printout) to every visit and the pharmacy.'
];
function aboutMed(id) {
  var m = (State.records || []).find(function (r) { return r.id === id; }); if (!m) return;
  var f = m.fields || {}, sec = function (label, v, cls) { return v ? '<h3>' + label + '</h3><p class="prewrap' + (cls ? ' ' + cls : '') + '">' + esc(v) + '</p>' : ''; };
  openSheet('<h2 style="margin-top:0">' + esc(m.title) + '</h2><p class="muted">' + esc([f.dose, slotsText(m), f.with_food, f.purpose].filter(Boolean).join(' · ')) + '</p>' +
    sec('From her doctor or pharmacist', f.instructions) +
    sec('Boxed warning', f.label_boxed, 'flag-text') + sec('How to take it', f.label_how) + sec('Side effects to watch for', f.label_side) + sec('Warnings', f.label_warn) + sec('For patients and families', f.label_patients) + sec('Older adults', f.label_older) +
    (f.label_source ? '<p class="muted">Label text from <a href="' + esc(f.label_source) + '" target="_blank" rel="noopener">the FDA</a>' + (f.label_date ? ' (' + esc(f.label_date) + ')' : '') + ', as saved by the family. It may have been edited.</p>' : (f.label_how || f.label_side ? '' : '<p class="muted">No label information saved. Open Edit and tap "Fill from the FDA label".</p>')) +
    '<div class="note">' + MED_PROMPTS.map(esc).join('<br>') + '</div>' +
    '<div class="btn-row"><button class="btn ghost writer-only" onclick="editRecord(\'' + m.id + '\')">Edit</button><button class="btn ghost" onclick="closeSheet()">Close</button></div>');
}

/* ---------- Daily meds screen ---------- */
function renderMeds(arg) {
  var pid = filePid(arg || {}), day = careToday(), meds = medsOf(pid), doses = dosesOf(pid);
  var plan = Logic.medPlan(meds, doses, day, careHourNow());
  var active = meds.filter(function (m) { return Logic.medActive(m, day); }).sort(function (a, b) { return (a.title || '').localeCompare(b.title || ''); });
  var prn = active.filter(function (m) { return Logic.medSlots(m).indexOf('prn') >= 0; });
  var html = '<div class="chips">' + State.profiles.map(function (p) { return '<span class="chip' + (p.id === pid ? ' on' : '') + '" onclick="S.filePid=\'' + p.id + '\';showScreen(\'meds\',{pid:\'' + p.id + '\'})">' + esc(p.person_name) + '</span>'; }).join('') + '</div>';
  html += '<div class="row between"><h2>' + esc(dayLabel(day)) + '</h2>' + addBtn('medication', pid) + '</div>';
  if (!active.length) html += '<p class="muted">No medicines yet. Add each one with its dose and when it is given; the app then lists what is due each day. ' + helpLink('meds') + '</p>';
  ['morning', 'noon', 'evening', 'bedtime'].forEach(function (slot) {
    var rows = plan.filter(function (p) { return p.slot === slot; });
    if (rows.length) html += '<h3>' + esc(slotName(slot)) + '</h3>' + rows.map(function (p) { return doseRow(p, pid); }).join('');
  });
  if (prn.length) html += '<h3>Only when needed</h3>' + prn.map(function (m) {
    var given = Logic.prnDoses(doses, m.id, day);
    return '<div class="list-item"><div class="grow tappable" onclick="aboutMed(\'' + m.id + '\')"><b>' + esc(m.title) + '</b> <span class="muted">' + esc((m.fields || {}).dose || '') + '</span><div class="muted">' + (given.length ? 'Given today: ' + given.map(function (d) { return '<span class="tappable" onclick="event.stopPropagation();editDose(\'' + d.id + '\')">' + esc(localTime(d.occurred_at) + (d.fields.amount ? ' (' + d.fields.amount + ')' : '')) + '</span>'; }).join(', ') : 'Not given today') + '</div></div><button class="btn sm writer-only" onclick="doseSheet(\'' + m.id + '\',\'prn\',' + pidArg(pid) + ')">Gave a dose</button></div>';
  }).join('');
  html += medWeek(pid, meds, doses, day);
  html += '<h2>Her medicines</h2>' + (active.length ? active.map(function (m) { var f = m.fields || {}; return recordCard(m, esc([f.dose, slotsText(m)].filter(Boolean).join(' · ')), esc([f.purpose, f.refill_on ? 'refill ' + f.refill_on : ''].filter(Boolean).join(' · '))); }).join('') : '');
  var stopped = meds.filter(function (m) { return !Logic.medActive(m, day); });
  if (stopped.length) html += '<details><summary class="muted">Stopped or not started (' + stopped.length + ')</summary>' + stopped.map(function (m) { return recordCard(m, esc([(m.fields || {}).start ? 'from ' + m.fields.start : '', (m.fields || {}).stop ? 'stopped ' + m.fields.stop : ''].filter(Boolean).join(' · '))); }).join('') + '</details>';
  html += '<div class="note">' + MED_PROMPTS.map(esc).join('<br>') + '</div>';
  html += '<div class="btn-row"><button class="btn ghost" onclick="showScreen(\'timing\',{pid:' + pidArg(pid) + '})">Timing review</button><button class="btn ghost" onclick="showScreen(\'plans\',{pid:' + pidArg(pid) + '})">Schedule drafts</button><button class="btn ghost" onclick="printExport(' + pidArg(pid) + ')">Print med list and file</button></div>';
  return html;
}
// Seven days, one row per scheduled dose: ✓ given, – skipped/refused, blank not marked.
function medWeek(pid, meds, doses, day) {
  var days = []; for (var i = 6; i >= 0; i--) days.push(shiftDay(day, -i));
  var rows = [];
  meds.forEach(function (m) { Logic.medSlots(m).filter(function (s) { return s !== 'prn'; }).forEach(function (slot) { if (days.some(function (d) { return Logic.medActive(m, d); })) rows.push({ m: m, slot: slot }); }); });
  if (!rows.length) return '';
  var cell = function (m, slot, d) {
    if (!Logic.medActive(m, d)) return '<td class="muted">·</td>';
    var x = Logic.doseFor(doses, m.id, d, slot);
    return '<td title="' + esc(x ? x.fields.status : 'not marked') + '">' + (!x ? '' : x.fields.status === 'given' ? '&#10003;' : '&ndash;') + '</td>';
  };
  return '<h2>Last 7 days</h2><div class="table-wrap"><table class="io-table med-week"><tr><th></th>' + days.map(function (d) { return '<th>' + esc(new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' })) + '</th>'; }).join('') + '</tr>' +
    rows.map(function (r) { return '<tr><td>' + esc(r.m.title) + ' <span class="muted">' + esc(slotName(r.slot).toLowerCase()) + '</span></td>' + days.map(function (d) { return cell(r.m, r.slot, d); }).join('') + '</tr>'; }).join('') +
    '</table></div><p class="muted">&#10003; given · &ndash; skipped or refused · blank: not marked</p>';
}

/* ---------- vitals ---------- */
var VITALS = { blood_pressure: ['Blood pressure', 'mmHg'], glucose: ['Blood sugar', 'mg/dL'], oxygen: ['Oxygen', '%'], temperature: ['Temperature', '°F'] };
function latestVital(pid, kind) {
  return (State.measurements || []).filter(function (m) { return !m.deleted && m.kind === kind && (m.for_profile_id || null) === (pid || null); })
    .sort(function (a, b) { return a.taken_at < b.taken_at ? 1 : -1; })[0] || null;
}
var RHYTHMS = [['regular', 'Regular'], ['irregular', 'Irregular heartbeat'], ['afib', 'AFib']];
function rhythmName(r) { var x = RHYTHMS.find(function (y) { return y[0] === r; }); return x ? x[1] : ''; }
function vitalText(m) { return m.kind === 'blood_pressure' ? m.value + '/' + (m.value2 == null ? '?' : m.value2) : String(m.value); }
function pulseText(m) { return [m.pulse != null ? 'pulse ' + m.pulse : '', m.rhythm && m.rhythm !== 'regular' ? rhythmName(m.rhythm) : ''].filter(Boolean).join(' · '); }
// Today's readings where the monitor showed AFib or an irregular heartbeat.
function rhythmFlags(pid, day) {
  return (State.measurements || []).filter(function (m) { return !m.deleted && (m.for_profile_id || null) === (pid || null) && (m.rhythm === 'afib' || m.rhythm === 'irregular') && careDayOf(m.taken_at) === day; })
    .sort(function (a, b) { return a.taken_at < b.taken_at ? -1 : 1; });
}
function todayVitals(pid, day) {
  var w = Logic.weightChange(State.measurements || [], pid, day, dayStart());
  var lastW = Logic.standardWeights(State.measurements || [], pid, dayStart())[0];
  var tile = function (label, val, sub) { return '<div class="vital"><span class="muted">' + label + '</span><b>' + val + '</b>' + (sub ? '<span class="muted">' + sub + '</span>' : '') + '</div>'; };
  var tiles = [tile('Morning weight', w ? (Math.round(w.lb * 10) / 10) + ' lb' : 'Not yet', w ? (w.sincePrev != null ? (w.sincePrev >= 0 ? '+' : '') + w.sincePrev.toFixed(1) + ' lb' : '') : lastW ? 'last ' + (Math.round(lastW.lb * 10) / 10) + ' lb, ' + esc(dayLabel(lastW.day).toLowerCase()) : '')];
  Object.keys(VITALS).forEach(function (k) {
    var m = latestVital(pid, k); if (!m) return;
    var age = careDayOf(m.taken_at) === day ? localTime(m.taken_at) : esc(localDay(m.taken_at));
    var pt = pulseText(m);
    tiles.push(tile(VITALS[k][0], esc(vitalText(m)) + ' <small>' + esc(m.unit || VITALS[k][1]) + '</small>', age + (pt ? '<br><span class="' + (m.rhythm === 'afib' || m.rhythm === 'irregular' ? 'flag-text' : '') + '">' + esc(pt) + '</span>' : '')));
  });
  return '<div class="card"><h3>&#10084; Vitals</h3><div class="vitals">' + tiles.join('') + '</div>' +
    '<div class="btn-row writer-only"><button class="btn sm" onclick="logWeight()">Log weight</button><button class="btn sm ghost" onclick="logVital(' + pidArg(pid) + ')">Log BP, sugar, oxygen...</button>' + (cuffSupported() ? '<button class="btn sm ghost" onclick="connectCuff(' + pidArg(pid) + ')">&#128246; Get readings from cuff</button>' : '') + '</div></div>';
}
function logVital(pid, kind) {
  kind = kind || 'blood_pressure';
  var now = new Date().toISOString();
  openSheet('<h2 style="margin-top:0">Log a reading</h2>' +
    '<div class="btn-row"><button type="button" class="btn sm ghost" onclick="snapIt(' + pidArg(pid) + ',\'vitals\')">&#128247; Snap the screen</button>' + (kind === 'blood_pressure' && cuffSupported() ? '<button type="button" class="btn sm ghost" onclick="connectCuff(' + pidArg(pid) + ')">&#128246; From the cuff (Bluetooth)</button>' : '') + '</div>' +
    '<label for="vKind">What</label><select id="vKind" onchange="logVital(' + pidArg(pid) + ',this.value)">' + Object.keys(VITALS).map(function (k) { return '<option value="' + k + '"' + (k === kind ? ' selected' : '') + '>' + VITALS[k][0] + '</option>'; }).join('') + '</select>' +
    (kind === 'blood_pressure' ? '<div class="row"><div class="grow"><label for="vVal">Top number</label><input id="vVal" type="number" inputmode="numeric"></div><div class="grow"><label for="vVal2">Bottom number</label><input id="vVal2" type="number" inputmode="numeric"></div></div>'
      : '<label for="vVal">' + VITALS[kind][0] + ' (' + VITALS[kind][1] + ')</label><input id="vVal" type="number" step="any" inputmode="decimal">') +
    (kind === 'blood_pressure' || kind === 'oxygen' ? '<label for="vPulse">Pulse (beats a minute)</label><input id="vPulse" type="number" inputmode="numeric">' +
      '<label>Heart rhythm, if the monitor shows it</label><div class="chips" id="vRhythm">' + RHYTHMS.map(function (r) { return '<button type="button" class="chip" data-v="' + r[0] + '" onclick="pickChip(\'vRhythm\',this,true)">' + r[1] + '</button>'; }).join('') + '</div>' +
      '<p class="muted">Many home cuffs show a heart symbol with waves, "IHB" or "AFib" when the beat was uneven. Tap what the screen showed; leave blank if it shows nothing.</p>' : '') +
    '<label for="vWhen">When</label><input id="vWhen" type="datetime-local" value="' + localDay(now) + 'T' + localTime(now) + '">' +
    '<label for="vNote">Note</label><input id="vNote" placeholder="before breakfast, left arm, after a nap...">' +
    '<div class="btn-row"><button class="btn" onclick="saveVital(' + pidArg(pid) + ',\'' + kind + '\')">Save</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>');
  setTimeout(function () { var el = document.getElementById('vVal'); if (el) el.focus(); }, 50);
}
function saveVital(pid, kind) {
  var v = document.getElementById('vVal').value, v2 = document.getElementById('vVal2'), pu = document.getElementById('vPulse');
  if (v === '') return toast('Type the reading first');
  var when = new Date(document.getElementById('vWhen').value);
  DB.put('measurements', { kind: kind, value: +v, value2: v2 && v2.value !== '' ? +v2.value : null, unit: VITALS[kind][1], taken_at: (isNaN(when) ? new Date() : when).toISOString(), standard: false, note: document.getElementById('vNote').value.trim() || null, for_profile_id: pid,
    pulse: pu && pu.value !== '' ? +pu.value : null, rhythm: document.getElementById('vRhythm') ? chipValue('vRhythm') : null })
    .then(function () { closeSheet(); toast('Saved'); return loadAll(); }).then(function () { refresh(); if (Sync.enabled()) syncNow(); })
    .catch(function (e) { toast('Could not save: ' + e.message); });
}

/* ---------- coming up ---------- */
var COMING_ICON = { visit: '&#128197;', event: '&#11088;', refill: '&#128138;' };
function todayComing(pid, day) {
  var list = Logic.upcoming(State.records.filter(function (r) { return (r.for_profile_id || null) === (pid || null); }), day, 14, localDay);
  var when = function (u) { return u.inDays === 0 ? 'Today' : u.inDays === 1 ? 'Tomorrow' : new Date(u.day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); };
  return '<div class="card"><div class="row between"><h3>Coming up</h3><button class="btn sm ghost writer-only" onclick="editRecord(null,\'event\',' + pidArg(pid) + ')">+ Important day</button></div>' +
    (list.length ? list.map(function (u) {
      return '<div class="list-item tappable" onclick="' + (u.kind === 'refill' ? 'aboutMed' : 'editRecord') + '(\'' + u.id + '\')"><span>' + COMING_ICON[u.kind] + '</span><div class="grow"><b>' + esc(when(u)) + '</b>' + (u.when ? ' ' + esc(localTime(u.when)) : '') + ' · ' + esc(u.title) + '</div>' + (u.inDays > 1 ? '<span class="muted">' + u.inDays + ' days</span>' : '') + '</div>';
    }).join('') : '<p class="muted">Nothing in the next 2 weeks. Visits go in File &rarr; Visits; lab draws, refills and birthdays go here as important days.</p>') + '</div>';
}

/* ---------- meal thoughts ---------- */
function mealIdeas(pid) {
  var rank = { ok: 0, warn: 1, bad: 2 };
  return State.recipes.map(function (r) {
    var info = S.recipeInfo[r.id], fit = pid && info.fits[pid] ? info.fits[pid] : { level: 'ok', reasons: [] };
    return { r: r, info: info, fit: fit, na: info.nut.perServing.sodium_mg == null ? 1e9 : info.nut.perServing.sodium_mg };
  }).filter(function (x) { return x.info.cov.total > 0 && x.info.cov.pct >= 80 && x.fit.level !== 'bad'; })
    .sort(function (a, b) { return rank[a.fit.level] - rank[b.fit.level] || b.info.cov.pct - a.info.cov.pct || a.na - b.na; }).slice(0, 3);
}
function fluidLeftMl(pid, entries) { var limit = +careSettingsOf(pid).fluid_limit_ml || 0; return limit ? limit - Logic.fluidBalance(entries).inMl : null; }
function todayMeals(pid, prof, entries) {
  var ideas = mealIdeas(pid), left = fluidLeftMl(pid, entries);
  return '<div class="card"><div class="row between"><h3>&#127869; Meal thoughts</h3><button class="btn sm ghost" onclick="showScreen(\'kitchen\',{tab:\'ideas\'})">Kitchen</button></div>' +
    (left != null ? '<div class="muted">Fluid left today: <b>' + (left > 0 ? shortOz(left) : 'none, at the limit') + '</b></div>' : '') +
    (ideas.length ? ideas.map(function (x) {
      var fl = Logic.suggestFluidMl(x.r.title), n = x.info.nut.perServing;
      return '<div class="list-item tappable" onclick="showScreen(\'recipe\',\'' + x.r.id + '\')"><div class="grow"><b>' + esc(x.r.title) + '</b><div class="muted">' + [n.sodium_mg != null ? Math.round(n.sodium_mg) + ' mg sodium' : '', n.kcal ? '~' + n.kcal + ' kcal' : '', x.info.cov.pct < 100 ? 'missing ' + (x.info.cov.total - x.info.cov.have) : 'all on hand', fl ? '+' + shortOz(fl) + ' fluid' : '', x.fit.level === 'warn' ? 'check: ' + x.fit.reasons[0] : ''].filter(Boolean).map(esc).join(' · ') + '</div></div></div>';
    }).join('') : '<p class="muted">No recipe fits with what is on hand yet. Add recipes and pantry items in Kitchen.</p>') +
    '<div id="aiIdeas"></div>' +
    (Sync.enabled() ? '<div class="btn-row"><button class="btn sm ghost" onclick="moreMealIdeas(' + pidArg(pid) + ')">More ideas (AI)</button></div>' : '') + '</div>';
}
function moreMealIdeas(pid) {
  var box = document.getElementById('aiIdeas'), prof = State.profiles.find(function (p) { return p.id === pid; }) || {};
  var day = careToday(), entries = fluidEntriesFor(pid, day), left = fluidLeftMl(pid, entries), h = new Date().getHours();
  box.innerHTML = '<p class="muted">Thinking...</p>';
  Sync.brain('meal_ideas', {
    meal: h < 10 ? 'breakfast' : h < 15 ? 'lunch' : h < 20 ? 'dinner' : 'a light snack',
    profile: { name: prof.person_name, rules: (S.rulesByProfile[pid] || []).map(describeRule), targets: prof.daily_targets || {} },
    fluid_left_oz: left == null ? null : Math.round(Logic.fromMl(left, 'oz')),
    today: entries.filter(function (e) { return e.entry_kind !== 'output'; }).map(function (e) { return e.free_text || ((State.recipes.find(function (r) { return r.id === e.recipe_id; }) || {}).title) || ''; }),
    pantry: State.pantry.map(function (p) { return (S.ingById[p.ingredient_id] || {}).name; }).filter(Boolean)
  }).then(function (d) {
    box.innerHTML = (d.ideas || []).map(function (i) { return '<div class="list-item"><div class="grow"><b>' + esc(i.name) + '</b><div class="muted">' + esc([i.why, i.sodium_mg != null ? '~' + i.sodium_mg + ' mg sodium' : '', i.fluid_oz ? '~' + i.fluid_oz + ' oz fluid' : ''].filter(Boolean).join(' · ')) + '</div></div></div>'; }).join('') +
      '<p class="muted">AI ideas to check against her diet plan. ' + esc(d.caveat || '') + '</p>';
  }).catch(function (e) { box.innerHTML = '<p class="muted">Could not get ideas: ' + esc(e.message) + '</p>'; });
}

/* ---------- How-to guide ---------- */
var HELP = [
  ['start', 'Getting started', ['Settings &rarr; Diet profiles: add the person you care for. Add her limits from the care team (fluid limit, weight alert) under Edit.', 'Settings &rarr; Family: invite family. You approve each person and pick what they can do.', 'Today is the home page: it shows what needs attention, meds, fluid, vitals, what is coming up, and meal ideas.']],
  ['drink', 'Log a drink', ['Tap <b>Add</b>, then <b>Log a drink</b>. Pick the amount (oz, mL, cups) and save.', 'Soup, Jell-O, ice cream and ice chips count as fluid too: when you log them as food, fill in the fluid box (the app suggests an amount).']],
  ['output', 'Log urine with the hat', ['Diary &rarr; <b>Log output</b>. Read the number on the hat at eye level, pick the colour, tick clots if you see any, and save.', 'Logged it as a drink by mistake? Open the entry and tap <b>This was output, not a drink</b>.', 'Pink, red, cola-coloured urine or clots show in <b>Needs attention</b>.']],
  ['weight', 'Morning weight', ['Every morning: after she pees, before she eats or drinks, same scale, similar clothes.', 'Today &rarr; Vitals &rarr; <b>Log weight</b>, keep the "Morning" box ticked. Only morning weights are compared day to day.']],
  ['meds', 'Give and record meds', ['First, add each medicine: File &rarr; Summary &rarr; <b>+ Medicine</b>. Type the dose, tap when it is given (morning, midday, evening, bedtime, or only when needed), and save.', 'Tap <b>Fill from the FDA label</b> to copy the official label (how to take it, side effects). Change any of it to what her doctor or pharmacist said; your words are what the app shows.', 'Each day, Today &rarr; Meds shows what is due. Tap <b>Given</b> after she takes it, or <b>Not given</b> with a reason. Everyone in the family sees who gave it and when.', 'Given at a different time, or a different amount (half a tablet, a sliding-scale dose)? Tap <b>Edit</b> on that row and change the time or amount. For "only when needed" medicines, <b>Gave a dose</b> asks for both.', 'If she takes a medicine at a set time, open the medicine, tap <b>Edit</b>, and type the time under each slot. It then shows as due an hour before and overdue two hours after.', 'Marked the wrong one? Tap <b>Undo</b> on that row.']],
  ['vitals', 'Blood pressure, pulse and AFib', ['Today &rarr; Vitals &rarr; <b>Log BP, sugar, oxygen...</b>. Type the top and bottom numbers and the pulse.', 'If the cuff shows a heart symbol with waves, "IHB" or "AFib", tap <b>Irregular heartbeat</b> or <b>AFib</b> to match what the screen showed. It then shows in <b>Needs attention</b> for the day.', 'The symbol on the cuff is a hint, not a diagnosis. Tell the care team, especially if it is new. Chest pain, fainting or trouble breathing: call 911.']],
  ['colors', 'What the colours mean', ['<b>Amber/red card</b> on Today: something to look at now, like a dose not marked or a weight gain over the alert level the care team set.', 'The app only flags limits the family or care team typed in. It does not give medical advice. When in doubt, call the care team.']],
  ['visit', 'After a visit', ['File &rarr; Visits &rarr; <b>+ Visit</b>: who, when, what they said, what changed, medicines changed, next appointment.', 'Save, then photograph the After Visit Summary (photos or PDFs attach under the visit).', 'Medicines changed? Update them in File &rarr; Summary the same day.']],
  ['days', 'Important days', ['Today &rarr; Coming up &rarr; <b>+ Important day</b> for lab draws, refills, birthdays. Pick "Every year" or "Every month" for repeats.', 'Refill dates typed on a medicine show up here too.']],
  ['family', 'Family and roles', ['<b>Owner</b>: everything, including approving family and deleting for good. <b>Caregiver</b>: log and edit. <b>Viewer</b>: sees everything, changes nothing.', 'New people wait for an owner to approve them in Settings &rarr; Family.']],
  ['undo', 'Undo a mistake', ['Deleting shows <b>Undo</b> for a few seconds. Deleted items also stay in Diary &rarr; Deleted for 30 days.', 'Every entry has <b>History</b>: who changed what, with <b>Restore this version</b>.']],
  ['timing', 'Timing review and schedule drafts', ['Meds &rarr; <b>Timing review</b> shows when each medicine is really given, what its label says about timing (empty stomach, with food, bedtime, keep apart), and her usual meals and sleep. It lists questions for the pharmacist.', '<b>Schedule drafts</b> &rarr; <b>Draft a schedule</b>: the app searches current trusted sources and proposes times with reasons and links. It never changes doses or which medicines.', 'Nothing changes until an owner taps <b>Record approval</b> with the pharmacist or doctor who said yes. Approved changes update the medicine times; History keeps the old ones.', '<b>Print for the pharmacist</b> gives them the review and draft on one page.']],
  ['patterns', 'Patterns and current guidance', ['Today &rarr; Insights and <b>Patterns</b> compare her own logs: BP after late evening doses, weight after salty days, urine out vs fluid in, BP and sugar by time of day, AFib readings.', 'A pattern only shows a number once there are enough days on both sides. It is a reason to ask, not proof.', '<b>Ask about current guidance</b> searches FDA, NIH, kidney, diabetes and heart sources and answers with links and dates. <b>Save to her file</b> keeps the answer under Updates.']],
  ['cuff', 'Readings from the BP cuff', ['<b>Bluetooth</b> (Chrome on Android): Today &rarr; Vitals &rarr; <b>Get readings from cuff</b>. Turn the cuff off; the first time, hold its Bluetooth button until <b>P</b> flashes, later press until <b>O</b> flashes. Tap <b>Search</b> and pick the cuff. Pick her user number (1 or 2) on the cuff.', 'The app shows the new readings (top, bottom, pulse, irregular heartbeat) and skips ones already saved. Untick any that are not hers, then <b>Save checked readings</b>.', 'Any phone: <b>Snap it</b> at the top of Today, or <b>Log BP...</b> &rarr; <b>Snap the screen</b>. The AI reads the numbers and the heart symbol into the form; check them and Save.', 'Won\'t connect? Open <b>Connection log</b>, tap <b>Copy log</b>, and send it to whoever set up the app.']],
  ['privacy', 'Privacy and terms (draft)', ['Your family&rsquo;s records are private to your family. Only people you invite can see them, and each family is kept separate from every other.', 'Photos, your words and saved notes are sent to our AI service (Anthropic) only to fill in forms and answer your questions; they are not used to train AI, and nothing is sold or shared for advertising. There are no ad or tracking scripts in the app.', 'You can ask for your family&rsquo;s data to be exported or deleted. The full privacy policy and terms are being reviewed by a lawyer and will replace this summary.', 'This app keeps records; it does not give medical advice. You must be 18 or older to use it.']],
  ['log', 'The + button: log anything', ['The big <b>+</b> at the bottom opens <b>Log something</b> from any screen: Snap it, Say it, a drink, output, blood pressure, weight, medicines, a meal, an exercise, visit notes, a note for the family, or a paper.', 'Recipes, receipts, groceries, barcodes and links are in <b>Kitchen &rarr; + Add</b>.']],
  ['therapy', 'Therapy exercises', ['Snap her therapy sheet (or add exercises in File &rarr; Therapy). Active exercises show on Today with how many times a day.', 'Tap <b>Make a schedule</b> on the Exercises card (or File &rarr; Therapy &rarr; Workout schedule) and tick Morning, Midday, Evening or Bedtime for each exercise, and the days she does them. Exercises at the same time become one workout.', 'Today then shows one line per workout (&ldquo;Morning workout &middot; 9 exercises &middot; 3 done&rdquo;). Tap <b>&#9654; Start</b> to go through it one exercise at a time with big <b>Done</b> and <b>Skip</b> buttons; Stop for now and Continue later.', 'Mark an exercise &ldquo;No longer doing&rdquo; in File &rarr; Therapy to take it off Today. Stop and call the therapist if she has pain, dizziness or shortness of breath.']],
  ['ask', 'Ask her file', ['Tap <b>&#128172; Ask her file</b> on Today or in File and ask in plain words: <i>&ldquo;When did we change her furosemide?&rdquo;</i> <i>&ldquo;What is the home health number?&rdquo;</i> <i>&ldquo;What did the nurse say last time?&rdquo;</i> <i>&ldquo;Has she refused any medicines this week?&rdquo;</i>', 'It answers only from what is saved in the app and lists the entries it used; tap one to open it. If the answer is not in her file, it says so instead of guessing.', 'It does not give medical advice. Questions like &ldquo;should she&rdquo; get what the file says plus questions to ask her care team. Her name and the family&rsquo;s names are not sent; care team names are.']],
  ['say', 'Say it: log by voice', ['Tap <b>&#127908; Say it</b> at the top of Today and talk, the way you would tell family: <i>&ldquo;She drank 8 ounces of water,&rdquo;</i> <i>&ldquo;gave her the morning pills,&rdquo;</i> <i>&ldquo;BP 142 over 80, pulse 70,&rdquo;</i> <i>&ldquo;urine 300, dark yellow,&rdquo;</i> <i>&ldquo;she ate half a sandwich at noon.&rdquo;</i> Several things at once is fine.', 'It shows each entry as a sentence to tick. Nothing saves until you tap <b>Save ticked</b>. Anything unclear (how much, which medicine) starts unticked with the reason; fix the words and tap Make entries again.', 'No microphone button? Tap the microphone on your keyboard, or just type.']],
  ['handoff', 'Catch me up (shift handoff)', ['Tap <b>&#128075; Catch me up</b> at the top of Today when you start your turn. It shows everything logged for her since you last caught up: medicines given, skipped or refused, drinks in and output, readings, visits and what was said, updates, what is still to do, and anything to double-check, each with who logged it.', 'Pick <b>8 hours</b>, <b>1 day</b> or <b>3 days</b> to look further back. Tap <b>Got it</b> when you have read it; next time starts from then (each phone keeps its own).', '<b>Say it in a few lines</b> asks the AI for a short plain-language handoff from the same entries. It adds nothing that was not logged and never sees anyone&rsquo;s name; the list below it is the record.']],
  ['scribe', 'Scribe: notes from a visit', ['Tap <b>&#127897; Scribe</b> on Today (or in File &rarr; Visits) when a nurse, doctor or therapist visits.', '<b>Tell it yourself:</b> type what happened, or tap the microphone on your keyboard and talk. Rough notes are fine.', 'Use <b>Anything to focus on</b> to steer it (&ldquo;focus on her swelling, skip the insurance talk&rdquo;). While it listens you can also talk to it directly: &ldquo;Scribe, note that she skipped lunch&rdquo; or &ldquo;remind me to call the pharmacy&rdquo; become notes and to-dos, not things the nurse said.', 'Ask the nurse to say numbers and medicine names out loud and clearly; speech-to-text mishears drug names, and the scribe lists anything it is unsure of.', '<b>Or let it listen:</b> tap <b>Listen to the visit</b> and set the phone face up near whoever is talking, with the app open. It writes down the words as it hears them; no sound is kept. Ask the nurse or doctor first: some states require everyone&rsquo;s OK to record. The phone&rsquo;s own speech service (Apple or Google) turns the sound into words.', 'Tap <b>Pull out the important parts</b>: it fills in the Visit form (what they said, what changed, medicine changes, tests, next appointment, questions) and lists to-dos and anything that may have been misheard. Check it, then Save. The full notes are kept with the visit.', 'Your notes are saved on the phone as you go, so closing the window by accident loses nothing. Tap Scribe again to carry on.']],
  ['medcheck', 'Compare her medicines', ['File &rarr; Summary &rarr; <b>Compare sources</b> lines up what each source says about each medicine: the medicine list, discharge papers, each bottle, and what was typed in.', 'Listed first: <b>strengths that do not match</b>, <b>possible duplicates</b> (the brand and generic saved as two medicines), medicines on a bottle but not on any list, and anything flagged.', 'Tap <b>Print for the pharmacist</b> for one page with every CHECK item and the questions to ask. Fix things in each medicine (Open), and they drop off the list.', 'This only compares what is saved; it does not give medical advice. Never change a dose without asking her doctor or pharmacist.']],
  ['snap', 'Snap it: read anything from a photo', ['Tap <b>&#128247; Snap it</b> at the top of Today and photograph a cuff, sugar meter, oxygen meter or thermometer screen, the scale, a pill bottle label, a lab report, an appointment card, a care team list or emergency plan, a list of her medicines, a therapy exercise sheet, or any paper worth keeping (insurance card, discharge papers).', 'A <b>medicine list</b> (even handwritten) becomes a checklist: every name is checked against the FDA list, and anything it is unsure of, or cannot find, starts unticked with the name editable. Nothing is added as a medicine until you tick it.', 'One medicine, many sources: if a bottle (or a list line) matches a medicine already saved, by name or by brand and generic (Lasix = furosemide), it is <b>added to that medicine</b> instead of making a second one. You see the saved info and the new one side by side, and every photo (bottle and list) is attached to that medicine.', 'Anything it is not sure of (a hard-to-read name, a number it could not read, a strength that differs between the list and the bottle) is saved with a <b>Please double-check</b> note. These show in <b>To double-check</b> on Today until someone opens them and taps <b>Checked, all good</b>.', 'More than one page? If a paper looks like it continues (Page 1 of 3, cut off) it asks for the next page first, and every result has <b>Add another page</b>. Up to 6 pages are read together.', 'Papers with no folder of their own go in <b>Documents &rarr; Misc</b>, with their own details (member ID, dates, levels) pulled out as boxes you can edit. Therapy exercise sheets fill <b>File &rarr; Therapy</b>.', 'The app works out what it is and fills in the right form: a reading, a weight, a new medicine, lab results (tick the ones to keep), a visit, or care team contacts (tick the ones to add) with the page kept under Documents. Nothing saves until you check it and tap Save.', 'If any number is not clear, it asks for <b>one more photo</b> and says why (glare, cut off, blurry) instead of guessing. Your earlier photo is kept so it can combine them. After three tries you can type it in.', 'Tips: fill the frame, tilt the phone to lose reflections, good light, hold still. New medicine, lab and visit forms also have a <b>From a photo</b> button.', '<b>Every other form</b> (drinks, output, weight, contacts, allergies, settings and more) has <b>&#128247; Fill from a photo</b> at the top: photograph a business card, a discharge paper, a measuring cup, a note from the doctor, and it fills the boxes it can read clearly (outlined in green). Same rule: unclear means it asks for another photo.']],
  ['kitchen', 'Kitchen', ['<b>Ideas</b>: what you can cook now, what is one trip away, what to use up, restock and the shopping list. <b>Recipes</b> and <b>Pantry</b> sit next to it.']]
];
function renderHelp(arg) {
  var topic = arg && arg.topic;
  setTimeout(function () { var el = topic && document.getElementById('help-' + topic); if (el) el.scrollIntoView({ block: 'start' }); }, 30);
  return '<p class="muted">Short how-tos for everyone helping. Button names are in <b>bold</b>.</p>' +
    HELP.map(function (h) { return '<details class="card help-card" id="help-' + h[0] + '"' + (!topic || topic === h[0] ? ' open' : '') + '><summary><b>' + h[1] + '</b></summary><ol>' + h[2].map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ol></details>'; }).join('');
}
