/* Catch me up: a shift handoff. Everything logged for her since you last caught up (or a
 * window you pick), with who logged it, straight from the saved entries. An optional
 * "Say it in a few lines" asks the AI to put those same facts in plain words; it is told to
 * add nothing, and it never sees anyone's name. */

var HANDOFF_KEY = 'tcm-handoff-seen'; // per device: when this phone last tapped "Got it"

function handoffSeen() { try { return localStorage.getItem(HANDOFF_KEY); } catch (e) { return null; } }
function handoffWindow(arg) {
  var now = new Date(), hrs = arg && arg.hours, seen = handoffSeen();
  if (hrs) return { since: new Date(now - hrs * 3600000).toISOString(), until: now.toISOString(), label: 'Last ' + (hrs >= 24 ? (hrs / 24) + ' day' + (hrs > 24 ? 's' : '') : hrs + ' hours') };
  if (seen && seen < now.toISOString()) {
    var h = Math.max(1, Math.round((now - new Date(seen)) / 3600000));
    if (h <= 24 * 7) return { since: seen, until: now.toISOString(), label: 'Since you last caught up (' + localDay(seen) + ' ' + localTime(seen) + ')', fromSeen: true };
  }
  return { since: new Date(now - 12 * 3600000).toISOString(), until: now.toISOString(), label: 'Last 12 hours' };
}
function handoffWho(x) { var u = x.user_id || x.edited_by; return u ? whoName(u) : 'this phone'; }
function handoffTime(t) { return localDay(t) === localDay(new Date().toISOString()) ? localTime(t) : localDay(t).slice(5) + ' ' + localTime(t); }

function renderHandoff(arg) {
  var pid = (arg && arg.pid !== undefined ? arg.pid : null) || S.handoffPid || State.activeProfile || (State.profiles[0] && State.profiles[0].id) || null;
  S.handoffPid = pid; S.handoffArg = arg || {};
  var prof = State.profiles.find(function (p) { return p.id === pid; }) || { person_name: '' };
  var w = handoffWindow(arg), h = Logic.handoff({ diary: State.diary, measurements: State.measurements, records: State.records }, pid, w.since, w.until);
  S.handoffData = { w: w, h: h, name: prof.person_name };
  var li = function (t, who, html) { return '<li><span class="muted">' + esc(t) + '</span> ' + html + (who ? ' <span class="muted">· ' + esc(who) + '</span>' : '') + '</li>'; };
  var section = function (title, inner) { return inner ? '<div class="card"><h3>' + title + '</h3>' + inner + '</div>' : ''; };
  var pick = function (hrs, label) { return '<button class="chip' + ((arg && arg.hours) === hrs ? ' on' : '') + '" onclick="showScreen(\'handoff\',{pid:' + (pid ? '\'' + pid + '\'' : 'null') + ',hours:' + hrs + '})">' + label + '</button>'; };
  var m = h.meds, fl = h.fluids;
  var html = '<div class="card"><h3>&#128075; Catch me up' + (prof.person_name ? ': ' + esc(prof.person_name) : '') + '</h3>' +
    '<p class="muted">' + esc(w.label) + '. Everything here comes straight from what was logged, with who logged it.</p>' +
    '<div class="chips">' + '<button class="chip' + (!(arg && arg.hours) ? ' on' : '') + '" onclick="showScreen(\'handoff\',{pid:' + (pid ? '\'' + pid + '\'' : 'null') + '})">Since last time</button>' + pick(8, '8 hours') + pick(24, '1 day') + pick(72, '3 days') + '</div>' +
    '<div class="btn-row"><button class="btn" onclick="handoffDone()">&#10003; Got it</button>' + (h.empty ? '' : '<button class="btn ghost" onclick="handoffSay()">Say it in a few lines</button><button class="btn ghost" onclick="copyText(handoffText(), \'Copied\')">Copy</button>') + '</div>' +
    '<div id="handoffSay" aria-live="polite"></div></div>';
  if (h.empty && !h.checks.length) return html + '<p class="muted">Nothing was logged for her in this time.</p>';
  var day = careToday(), att = attentionItems(pid, day, fluidEntriesFor(pid, day), Logic.medPlan(medsOf(pid), dosesOf(pid), day, careHourNow()));
  html += att.length ? '<div class="card attention"><h3>&#9888; Needs attention now</h3><ul>' + att.map(function (f) { return '<li>' + f.text + '</li>'; }).join('') + '</ul></div>' : '';
  html += section('&#128138; Medicines',
    (m.given.length || m.skipped.length || m.refused.length) ? '<ul>' +
      m.given.map(function (r) { return li(handoffTime(r.occurred_at), handoffWho(r), '&#10003; ' + esc(r.title) + ' given'); }).join('') +
      m.refused.map(function (r) { return li(handoffTime(r.occurred_at), handoffWho(r), '<b class="flag-text">' + esc(r.title) + ' refused</b>' + ((r.fields || {}).note ? ': ' + esc(r.fields.note) : '')); }).join('') +
      m.skipped.map(function (r) { return li(handoffTime(r.occurred_at), handoffWho(r), '<b>' + esc(r.title) + ' skipped</b>' + ((r.fields || {}).note ? ': ' + esc(r.fields.note) : '')); }).join('') + '</ul>'
      : '<p class="muted">No doses marked in this time.</p>');
  html += section('&#128167; In and out', (fl.drinks || fl.outputs || h.meals.length) ?
    '<p>In: <b>' + shortOz(fl.inMl) + '</b> (' + fl.drinks + ' drink' + (fl.drinks === 1 ? '' : 's') + ') &middot; Out: <b>' + shortOz(fl.outMl) + '</b> (' + fl.outputs + ')' + (h.meals.length ? ' &middot; ' + h.meals.length + ' meal' + (h.meals.length === 1 ? '' : 's') + ' or snack' + (h.meals.length === 1 ? '' : 's') : '') + '</p>' +
    (fl.flags.length ? '<ul>' + fl.flags.map(function (f) { return li(handoffTime(f.entry.eaten_at), handoffWho(f.entry), '<b class="flag-text">' + esc((OUTPUT_TYPES[f.entry.output_type] || 'Output') + ': ' + f.reasons.join(', ')) + '</b>'); }).join('') + '</ul>' : '') : '');
  html += section('&#10084;&#65039; Readings', (h.vitals.length || h.weights.length) ? '<ul>' +
    h.vitals.map(function (v) { var name = (VITALS[v.kind] || [v.kind])[0]; return li(handoffTime(v.taken_at), handoffWho(v), esc(name) + ' <b>' + esc(v.value) + (v.value2 != null ? '/' + esc(v.value2) : '') + '</b>' + (v.pulse != null ? ', pulse ' + esc(v.pulse) : '') + (v.rhythm ? ' <b class="flag-text">' + esc(rhythmName(v.rhythm)) + '</b>' : '')); }).join('') +
    h.weights.map(function (v) { return li(handoffTime(v.taken_at), handoffWho(v), 'Weight <b>' + esc(v.value) + ' ' + esc(v.unit || '') + '</b>'); }).join('') + '</ul>' : '');
  html += section('&#129658; Visits', h.visits.map(function (v) {
    var f = v.fields || {};
    return '<div class="tappable" onclick="editRecord(\'' + v.id + '\')"><b>' + esc(v.title) + '</b> <span class="muted">' + esc(handoffTime(v.occurred_at)) + '</span>' +
      [['said', 'Said'], ['changed', 'Changed'], ['meds_changed', 'Medicines'], ['tests', 'Tests']].map(function (k) { return f[k[0]] ? '<div><span class="muted">' + k[1] + ':</span> <span class="prewrap">' + esc(f[k[0]]) + '</span></div>' : ''; }).join('') + '</div>';
  }).join('<hr>'));
  html += section('&#129336; Exercises', h.exercises && h.exercises.length ? '<ul>' + h.exercises.map(function (x) { return li(handoffTime(x.occurred_at), handoffWho(x), ((x.fields || {}).status === 'skipped' ? 'Skipped: ' : '&#10003; ') + esc(x.title)); }).join('') + '</ul>' : '');
  html += section('&#128221; Updates', h.updates.length ? '<ul>' + h.updates.map(function (u) { return li(handoffTime(u.occurred_at), handoffWho(u), esc((u.title ? u.title + ': ' : '') + ((u.fields || {}).text || ''))); }).join('') + '</ul>' : '');
  html += section('&#9989; Still to do', h.todo.length ? '<ul>' + h.todo.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '');
  html += section('&#10067; To double-check', h.checks.length ? '<ul>' + h.checks.map(function (r) { return '<li class="tappable" onclick="editRecord(\'' + r.id + '\')"><b>' + esc(r.title) + '</b>: ' + esc(checkLine(r)) + '</li>'; }).join('') + '</ul>' : '');
  html += section('&#128193; Added or changed in her file', h.changed.length ? '<ul>' + h.changed.map(function (r) { return li(handoffTime(r.updated_at), handoffWho(r), '<span class="tappable" onclick="editRecord(\'' + r.id + '\')">' + esc((RECORD_KINDS[r.kind] || {}).label || r.kind) + ': ' + esc(r.title) + '</span>'); }).join('') + '</ul>' : '');
  return html;
}
function handoffDone() {
  try { localStorage.setItem(HANDOFF_KEY, new Date().toISOString()); } catch (e) { /* blocked */ }
  toast('Caught up. Next time starts from now.'); showScreen('home');
}
// Plain facts, no names: used for Copy and as the only input to the AI summary.
function handoffText(noNames) {
  var D = S.handoffData; if (!D) return '';
  var h = D.h, who = function (x) { return noNames ? '' : ' (' + handoffWho(x) + ')'; }, L = [];
  L.push((noNames ? 'Her' : D.name) + ': ' + D.w.label);
  h.meds.given.forEach(function (r) { L.push(handoffTime(r.occurred_at) + ' ' + r.title + ' given' + who(r)); });
  h.meds.refused.forEach(function (r) { L.push(handoffTime(r.occurred_at) + ' ' + r.title + ' REFUSED' + ((r.fields || {}).note ? ': ' + r.fields.note : '') + who(r)); });
  h.meds.skipped.forEach(function (r) { L.push(handoffTime(r.occurred_at) + ' ' + r.title + ' skipped' + ((r.fields || {}).note ? ': ' + r.fields.note : '') + who(r)); });
  L.push('Fluids in ' + shortOz(h.fluids.inMl) + ' (' + h.fluids.drinks + ' drinks), out ' + shortOz(h.fluids.outMl) + ' (' + h.fluids.outputs + '); meals ' + h.meals.length);
  h.fluids.flags.forEach(function (f) { L.push(handoffTime(f.entry.eaten_at) + ' output flag: ' + f.reasons.join(', ')); });
  h.vitals.forEach(function (v) { L.push(handoffTime(v.taken_at) + ' ' + ((VITALS[v.kind] || [v.kind])[0]) + ' ' + v.value + (v.value2 != null ? '/' + v.value2 : '') + (v.pulse != null ? ' pulse ' + v.pulse : '') + (v.rhythm ? ' ' + rhythmName(v.rhythm) : '')); });
  h.weights.forEach(function (v) { L.push(handoffTime(v.taken_at) + ' weight ' + v.value + ' ' + (v.unit || '')); });
  h.visits.forEach(function (v) { var f = v.fields || {}; L.push('Visit: ' + (noNames ? 'care visit' : v.title) + '. ' + [f.said, f.changed, f.meds_changed, f.tests].filter(Boolean).join(' / ')); });
  (h.exercises || []).forEach(function (x) { L.push(handoffTime(x.occurred_at) + ' exercise ' + ((x.fields || {}).status === 'skipped' ? 'skipped' : 'done') + ': ' + x.title); });
  h.updates.forEach(function (u) { L.push('Update: ' + ((u.fields || {}).text || '')); });
  h.todo.forEach(function (t) { L.push('To do: ' + t); });
  h.checks.forEach(function (r) { L.push('To double-check: ' + r.title + ': ' + checkLine(r)); });
  return L.join('\n');
}
function handoffSay() {
  var out = document.getElementById('handoffSay'); if (!out) return;
  if (!Sync.enabled()) return toast('Turn on sync in Settings to use the AI summary');
  out.innerHTML = '<p>Writing a short handoff...</p>';
  Sync.brain('handoff', { facts: handoffText(true).slice(0, 12000) }).then(function (d) {
    var o = document.getElementById('handoffSay'); if (!o) return;
    o.innerHTML = '<div class="card ok-note"><p>' + esc(d.summary || '') + '</p>' +
      (d.watch && d.watch.length ? '<p><b>Keep an eye on:</b></p><ul>' + d.watch.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
      (d.to_do && d.to_do.length ? '<p><b>Still to do:</b></p><ul>' + d.to_do.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
      '<p class="muted">Written by AI from the entries below; check the details there.</p></div>';
  }).catch(function (e) { var o = document.getElementById('handoffSay'); if (o) o.innerHTML = '<p class="flag-text">Could not write it: ' + esc(e.message) + '</p>'; });
}
