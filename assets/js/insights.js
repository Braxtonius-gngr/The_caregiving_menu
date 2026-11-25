/* Insights: the timing review, patterns in her own data, AI-drafted medicine schedules that
 * only take effect after an owner records a pharmacist's or doctor's approval (D-021), and
 * sourced answers about current guidance. */

var INSIGHT_DAYS = 14;
function lastCareDays(n) { var d = careToday(), out = []; for (var i = n - 1; i >= 0; i--) out.push(shiftDay(d, -i)); return out; }
function activeMeds(pid) { var day = careToday(); return medsOf(pid).filter(function (m) { return Logic.medActive(m, day); }).sort(function (a, b) { return (a.title || '').localeCompare(b.title || ''); }); }
function labelTextOf(m) { var f = m.fields || {}; return [f.instructions, f.with_food ? f.with_food + '.' : '', f.when, f.label_how, f.label_patients, f.label_warn].filter(Boolean).join('\n'); }
function minutesBetween(a, b) { var p = function (t) { var m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; }; var x = p(a), y = p(b); return x == null || y == null ? null : y - x; }
function fmtOffset(min) { if (min == null) return ''; var a = Math.abs(min), h = Math.floor(a / 60), m = a % 60; return (min >= 0 ? '+' : '-') + (h ? h + 'h ' : '') + m + 'm'; }

/* ---------- timing review ---------- */
function timingData(pid) {
  var days = lastCareDays(INSIGHT_DAYS), doses = dosesOf(pid), cs = careSettingsOf(pid);
  var meals = Logic.mealTimes(State.diary, pid, days, dayStart());
  var meds = activeMeds(pid).map(function (m) {
    return { med: m, cues: Logic.labelCues(labelTextOf(m)), slots: Logic.medSlots(m).filter(function (s) { return s !== 'prn'; }).map(function (s) { return { slot: s, t: Logic.doseTiming(m, doses, s, days, dayStart()) }; }) };
  });
  return { days: days, meals: meals, wake: cs.wake_time || null, bed: cs.bed_time || null, meds: meds };
}
// Questions where her real day and the label don't seem to line up. Plain comparisons only.
function timingQuestions(d) {
  var qs = [], bf = d.meals.breakfast && d.meals.breakfast.typical;
  d.meds.forEach(function (x) {
    var name = x.med.title, has = function (c) { return x.cues.some(function (k) { return k.cue === c; }); };
    x.slots.forEach(function (s) {
      var actual = s.t.typical || s.t.scheduled, when = slotName(s.slot).toLowerCase();
      if (has('empty_stomach') && bf && s.slot === 'morning') { var gap = minutesBetween(actual, bf); if (gap != null && gap < 30) qs.push(name + ': label says empty stomach / before eating, but the ' + when + ' dose is usually at ' + actual + ' and breakfast about ' + bf + '. Should it move earlier?'); }
      if (has('with_food') && !Object.keys(d.meals).some(function (k) { var mt = d.meals[k]; var g = mt ? minutesBetween(actual, mt.typical) : null; return g != null && Math.abs(g) <= 45; })) qs.push(name + ': label says take with food, but the ' + when + ' dose (usually ' + actual + ') is not near a usual meal time. Should it move to a meal?');
      if (has('bedtime') && s.slot !== 'bedtime' && s.slot !== 'evening') qs.push(name + ': label mentions evening or bedtime, but it is given in the ' + when + '. Is that intended?');
      if (has('morning') && (s.slot === 'evening' || s.slot === 'bedtime')) qs.push(name + ': label suggests earlier in the day, but it is given in the ' + when + '. Is that intended?');
      if (s.t.late >= 3) qs.push(name + ' (' + when + '): given 2+ hours late on ' + s.t.late + ' of the last ' + INSIGHT_DAYS + ' days. Would a different set time fit her day better?');
      if (s.t.skipped + s.t.unmarked >= 4) qs.push(name + ' (' + when + '): not given or not marked on ' + (s.t.skipped + s.t.unmarked) + ' days. Is the ' + when + ' dose hard to fit in?');
    });
    if (has('separate')) qs.push(name + ': label says to keep it apart from some other medicines or foods: "' + x.cues.filter(function (k) { return k.cue === 'separate'; })[0].sentence + '". Are her other doses spaced far enough?');
  });
  return qs;
}
function renderTiming(arg) {
  var pid = filePid(arg || {}), d = timingData(pid), qs = timingQuestions(d);
  var mt = function (k, label) { var x = d.meals[k]; return '<div class="vital"><span class="muted">' + label + '</span><b>' + (x ? esc(x.typical) : '&mdash;') + '</b>' + (x ? '<span class="muted">' + x.n + ' meals</span>' : '') + '</div>'; };
  var html = '<p class="muted">Last ' + INSIGHT_DAYS + ' days. Typical = the middle time; late = 2+ hours after the set time.</p>' +
    '<div class="card"><h3>Her day</h3><div class="vitals">' + '<div class="vital"><span class="muted">Wakes</span><b>' + esc(d.wake || '—') + '</b></div>' + mt('breakfast', 'Breakfast') + mt('lunch', 'Lunch') + mt('dinner', 'Dinner') + '<div class="vital"><span class="muted">Bed</span><b>' + esc(d.bed || '—') + '</b></div></div>' +
    (!d.wake || !d.bed ? '<p class="muted">Add her usual wake-up and bedtime in Settings &rarr; Diet profiles &rarr; Edit.</p>' : '') + '</div>';
  if (!d.meds.length) html += '<p class="muted">No medicines yet. Add them in File &rarr; Summary.</p>';
  html += d.meds.map(function (x) {
    return '<div class="card"><div class="row between"><b>' + esc(x.med.title) + '</b><span class="muted">' + esc((x.med.fields || {}).dose || '') + '</span></div>' +
      (x.slots.length ? '<table class="io-table"><tr><th></th><th>Set</th><th>Typical</th><th>Range</th><th>Late</th><th>Not given</th></tr>' + x.slots.map(function (s) {
        var t = s.t;
        return '<tr><td>' + esc(slotName(s.slot)) + '</td><td>' + esc(t.scheduled) + '</td><td>' + (t.typical ? esc(t.typical) + ' <span class="muted">' + esc(fmtOffset(t.offsetMin)) + '</span>' : '&mdash;') + '</td><td>' + (t.earliest ? esc(t.earliest + '–' + t.latest) : '') + '</td><td>' + t.late + '</td><td>' + (t.skipped + t.unmarked) + '</td></tr>';
      }).join('') + '</table>' : '<p class="muted">Only when needed.</p>') +
      (x.cues.length ? '<div class="muted"><b>Label timing:</b> ' + x.cues.map(function (c) { return esc(c.label); }).join(' · ') + '</div>' : '<div class="muted">No timing rules found in the saved label text. Open the medicine and tap "Fill from the FDA label".</div>') + '</div>';
  }).join('');
  html += '<h2>Questions for the pharmacist</h2>' + (qs.length ? '<ol class="q-list">' + qs.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ol>' : '<p class="muted">Nothing stands out yet. These come from comparing her real times with the label text and her meals.</p>');
  html += '<div class="btn-row"><button class="btn" onclick="showScreen(\'plans\',{pid:' + pidArg(pid) + '})">Schedule drafts</button><button class="btn ghost" onclick="printTiming(' + pidArg(pid) + ')">Print for the pharmacist</button></div>';
  return html;
}

/* ---------- patterns ---------- */
function patternsFor(pid) {
  return Logic.patterns({ measurements: State.measurements || [], meds: medsOf(pid), doses: dosesOf(pid), diary: State.diary }, pid, lastCareDays(28), dayStart());
}
function renderPatterns(arg) {
  var pid = filePid(arg || {}), ps = patternsFor(pid);
  return '<p class="muted">Plain math on her own logs from the last 28 days. A pattern is a reason to ask, not proof of a cause. It needs enough days on both sides before it shows a number.</p>' +
    ps.map(function (p) { return '<div class="card' + (p.enough ? '' : ' faded') + '"><b>' + esc(p.title) + '</b><p>' + esc(p.text) + '</p>' + (p.enough ? '<div class="muted">Based on ' + p.n + ' days or readings.</div>' : '') + '</div>'; }).join('') +
    '<p class="muted">The more days have meds marked, morning weights, BP and meals logged, the more this can show.</p>';
}
function todayInsights(pid) {
  var ps = patternsFor(pid).filter(function (p) { return p.enough; }), drafts = recordsOf(pid, ['plan']).filter(function (r) { return (r.fields || {}).status === 'draft'; });
  return '<div class="card"><div class="row between"><h3>&#128200; Insights</h3><button class="btn sm ghost" onclick="showScreen(\'patterns\',{pid:' + pidArg(pid) + '})">Patterns</button></div>' +
    (drafts.length ? '<div class="note">A medicine schedule draft is waiting for her pharmacist or doctor to approve. <button class="linkish" onclick="showScreen(\'plans\',{pid:' + pidArg(pid) + '})">Open</button></div>' : '') +
    (ps.length ? ps.slice(0, 2).map(function (p) { return '<div class="list-item"><div class="grow"><b>' + esc(p.title) + '</b><div class="muted">' + esc(p.text) + '</div></div></div>'; }).join('') : '<p class="muted">Patterns show here once there are enough days logged.</p>') +
    '<div class="btn-row"><button class="btn sm ghost" onclick="showScreen(\'timing\',{pid:' + pidArg(pid) + '})">Timing review</button><button class="btn sm ghost" onclick="askGuidance(' + pidArg(pid) + ')">Ask about current guidance</button></div></div>';
}

/* ---------- AI-drafted schedules ---------- */
function conditionsOf(pid) { return recordsOf(pid, ['condition']).map(function (r) { return r.title; }); }
function latestLab(pid, name) { var rs = recordsOf(pid, ['lab']).filter(function (r) { return (r.title || '').toLowerCase() === name.toLowerCase(); }).sort(byDateDesc); return rs[0] ? { value: rs[0].fields.value, unit: rs[0].fields.unit, date: localDay(rs[0].occurred_at) } : null; }
function draftContext(pid) {
  var d = timingData(pid), refs = {};
  var meds = d.meds.map(function (x, i) {
    var f = x.med.fields || {}; refs['m' + (i + 1)] = x.med.id;
    return { ref: 'm' + (i + 1), name: x.med.title, dose: f.dose || null, purpose: f.purpose || null, with_food: f.with_food || null,
      slots: x.slots.map(function (s) { return { slot: s.slot, set_time: s.t.scheduled, typical_given: s.t.typical, late_days: s.t.late, not_given_days: s.t.skipped + s.t.unmarked }; }),
      as_needed: Logic.medSlots(x.med).indexOf('prn') >= 0, label_timing_text: labelTextOf(x.med).slice(0, 1500) };
  });
  var age = null; // ages are not stored; conditions carry the context
  return { refs: refs, context: {
    meds: meds, conditions: conditionsOf(pid), age: age,
    day: { wake: d.wake, bed: d.bed, breakfast: d.meals.breakfast && d.meals.breakfast.typical, lunch: d.meals.lunch && d.meals.lunch.typical, dinner: d.meals.dinner && d.meals.dinner.typical },
    labs: { eGFR: latestLab(pid, 'eGFR'), potassium: latestLab(pid, 'Potassium'), creatinine: latestLab(pid, 'Creatinine'), a1c: latestLab(pid, 'A1c') },
    patterns: patternsFor(pid).filter(function (p) { return p.enough; }).map(function (p) { return p.title + ': ' + p.text; }),
    timing_questions: timingQuestions(d)
  } };
}
/* ---------- questions for the pharmacist (P-007, design step-c3) ----------
 * One sheet per visit (records kind 'plan', fields.sheet = 2). The app and the AI only suggest
 * questions; the family records who answered and what they said. A medicine's time changes only
 * when an owner taps Update the medicine on an answer, and its note names who said so. */
var QSHEET_ROLES = ['Pharmacist', 'Doctor', 'Nurse practitioner', 'Physician assistant'];
var QSHEET_SLOTS = ['morning', 'noon', 'evening', 'bedtime'];
function qsheetOf(id) { return (State.records || []).find(function (r) { return r.id === id; }); }
function qsheetSave(rec) { return DB.put('records', rec).then(loadAll).then(function () { if (Sync.enabled()) syncNow(); }); }
function qsheetStart(pid) {
  var qs = timingQuestions(timingData(pid)).map(function (q) { return { text: q, why: 'From Timing review: her real dose times compared with the label, her meals and sleep.', from: 'review', med_id: null, sources: [] }; });
  DB.put('records', { kind: 'plan', for_profile_id: pid, title: 'Questions for the pharmacist', occurred_at: new Date().toISOString(), fields: { sheet: 2, status: 'to_ask', questions: qs } })
    .then(function (rec) { return loadAll().then(function () { if (Sync.enabled()) syncNow(); showScreen('plan', { id: rec.id }); }); })
    .catch(function (e) { toast(e.message); });
}
function qsheetResearch(id) {
  if (!Sync.enabled()) return toast('Turn on sync in Settings first');
  var rec = qsheetOf(id); if (!rec) return;
  var pid = rec.for_profile_id; if (!activeMeds(pid).length) return toast('Add her medicines first');
  var c = draftContext(pid), box = document.getElementById('qsStatus');
  if (box) box.innerHTML = '<p class="muted">Searching current trusted sources for questions to ask. This can take a minute or two...</p>';
  Sync.brain('timing_questions', { context: c.context }).then(function (d) {
    var src = d.source_list || [];
    var add = (d.questions || []).map(function (q) {
      return { text: q.text, why: q.why, from: 'research', med_id: c.refs[q.med_ref] || null, sources: (q.sources || []).map(function (n) { return src[n - 1]; }).filter(Boolean) };
    });
    var cur = qsheetOf(id); cur.fields = Object.assign({}, cur.fields, { questions: (cur.fields.questions || []).concat(add) });
    return qsheetSave(cur).then(function () { refresh(); toast(add.length + ' question(s) added'); });
  }).catch(function (e) { if (box) box.innerHTML = '<p class="muted">Could not find questions: ' + esc(e.message) + '</p>'; else toast(e.message); });
}
function qsheetAddOwn(id) {
  var rec = qsheetOf(id); if (!rec) return;
  openSheet('<h2 style="margin-top:0" data-nosnap>Add a question</h2><label for="qsOwn">Your question</label><textarea id="qsOwn" rows="3" maxlength="500" placeholder="Can her water pill be given earlier so she isn’t up at night?"></textarea>' +
    '<label for="qsMed">About which medicine (optional)</label><select id="qsMed"><option value="">Several or none</option>' + activeMeds(rec.for_profile_id).map(function (m) { return '<option value="' + m.id + '">' + esc(m.title) + '</option>'; }).join('') + '</select>' +
    '<div class="btn-row"><button class="btn" onclick="qsheetAddOwnSave(\'' + id + '\')">Add</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>');
}
function qsheetAddOwnSave(id) {
  var text = document.getElementById('qsOwn').value.trim(); if (!text) return toast('Type the question first');
  var cur = qsheetOf(id), med = document.getElementById('qsMed').value || null;
  cur.fields = Object.assign({}, cur.fields, { questions: (cur.fields.questions || []).concat([{ text: text, why: '', from: 'family', med_id: med, sources: [] }]) });
  qsheetSave(cur).then(function () { closeSheet(); refresh(); });
}
function qsheetRemove(id, i) {
  if (!confirm('Remove this question from the sheet?')) return;
  var cur = qsheetOf(id), qs = (cur.fields.questions || []).slice(); qs.splice(i, 1);
  cur.fields = Object.assign({}, cur.fields, { questions: qs });
  qsheetSave(cur).then(refresh);
}
// Saves who answered and every answer typed on the screen.
function qsheetAnswers(id, quiet) {
  var cur = qsheetOf(id); if (!cur) return Promise.resolve();
  var f = Object.assign({}, cur.fields), v = function (k) { var el = document.getElementById(k); return el ? el.value.trim() : ''; };
  f.answered_by = v('qsWho') || null; f.answerer_role = v('qsRole') || null; f.answered_on = v('qsDate') || null;
  f.questions = (f.questions || []).map(function (q, i) {
    var n = Object.assign({}, q); n.answer = v('qa-' + i) || null;
    var med = v('qc-med-' + i);
    n.change = med ? { med_id: med, slot: v('qc-slot-' + i), time: v('qc-time-' + i) } : (q.applied_on ? q.change : null);
    return n;
  });
  f.status = f.answered_by && f.questions.some(function (q) { return q.answer; }) ? 'answered' : 'to_ask';
  cur.fields = f;
  return qsheetSave(cur).then(function () { if (!quiet) { toast('Saved'); refresh(); } });
}
function qsheetChange(i) { var el = document.getElementById('qc-' + i); if (el) el.classList.toggle('hidden'); }
// Owner only: write the time the professional gave onto the medicine. History keeps the old one.
function qsheetApply(id, i) {
  qsheetAnswers(id, true).then(function () {
    var cur = qsheetOf(id), f = cur.fields, q = f.questions[i], ch = q && q.change;
    if (!f.answered_by) return toast('First type who answered (their name), then tap again.');
    if (!ch || !ch.med_id || QSHEET_SLOTS.indexOf(ch.slot) < 0 || !/^\d{1,2}:\d{2}$/.test(ch.time || '')) return toast('Pick the medicine, the dose and the new time first.');
    var who = f.answered_by + (f.answerer_role ? ' (' + f.answerer_role.toLowerCase() + ')' : ''), day = f.answered_on || careToday();
    if (!confirm('Change ' + medTitle(ch.med_id) + ', ' + slotName(ch.slot).toLowerCase() + ' dose, to ' + ch.time + '? The note will say ' + who + ' said so on ' + day + '.')) return;
    return DB.update('records', ch.med_id, function (m) {
      if (!m || m.deleted) return null;
      var mf = Object.assign({}, m.fields), slots = Logic.medSlots(m);
      if (slots.indexOf(ch.slot) < 0) slots.push(ch.slot);
      mf.slots = slots.join(','); mf.slot_times = Object.assign({}, mf.slot_times || {}); mf.slot_times[ch.slot] = ch.time;
      mf.timing_source = 'Changed ' + day + ': ' + who + ' said so, from the question sheet';
      m.fields = mf; return m;
    }).then(function () {
      var again = qsheetOf(id); again.fields.questions[i].applied_on = day;
      return qsheetSave(again);
    }).then(function () { refresh(); toast(medTitle(ch.med_id) + ' updated. History keeps the old time.'); });
  }).catch(function (e) { toast('Could not save: ' + e.message); });
}
function renderPlans(arg) {
  var pid = filePid(arg || {}), all = recordsOf(pid, ['plan']).sort(byDateDesc);
  var sheets = all.filter(function (p) { return (p.fields || {}).sheet === 2; }), old = all.filter(function (p) { return (p.fields || {}).sheet !== 2; });
  return '<p class="muted">Questions to take to her pharmacist or doctor about when her medicines are given. The app only suggests questions; they decide. A time changes only when you write down who said so.</p>' +
    '<div class="btn-row writer-only"><button class="btn" onclick="qsheetStart(' + pidArg(pid) + ')">Start a question sheet</button><button class="btn ghost" onclick="showScreen(\'timing\',{pid:' + pidArg(pid) + '})">Timing review</button></div>' +
    (sheets.length ? sheets.map(function (p) { var f = p.fields || {}; return '<div class="card tappable" onclick="showScreen(\'plan\',{id:\'' + p.id + '\'})"><b>' + esc(fmtWhen(p.occurred_at, true)) + '</b> <span class="badge ' + (f.status === 'answered' ? 'ok' : 'warn') + '">' + (f.status === 'answered' ? 'Answered' : 'To ask') + '</span><div class="muted">' + (f.questions || []).length + ' question(s)' + (f.answered_by ? ' · answered by ' + esc(f.answered_by) : '') + '</div></div>'; }).join('') : '<p class="muted">No question sheets yet.</p>') +
    (old.length ? '<h3>Older timing drafts</h3>' + old.map(function (p) { var f = p.fields || {}; return '<div class="card tappable" onclick="showScreen(\'plan\',{id:\'' + p.id + '\'})"><b>' + esc(fmtWhen(p.occurred_at, true)) + '</b> <span class="badge">' + esc(f.status === 'approved' ? 'Approved' : f.status === 'declined' ? 'Not approved' : 'Not acted on') + '</span></div>'; }).join('') : '');
}
function medTitle(id) { var m = (State.records || []).find(function (r) { return r.id === id; }); return m ? m.title : 'Medicine'; }
function sourceLinks(nums, list) { return (nums || []).map(function (n) { var s = (list || [])[n - 1]; return s ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">[' + n + ']</a>' : ''; }).join(' '); }
function qsheetSources(list) { return (list || []).map(function (s, n) { return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener" title="' + esc(s.title || '') + '">[' + (n + 1) + ']</a>'; }).join(' '); }
function renderPlan(arg) {
  var p = (State.records || []).find(function (r) { return r.id === (arg && arg.id); }); if (!p) return '<p class="muted">Sheet not found.</p>';
  return (p.fields || {}).sheet === 2 ? renderQSheet(p) : renderOldDraft(p);
}
function renderQSheet(p) {
  var f = p.fields || {}, owner = State.role === 'owner' || State.role == null, meds = activeMeds(p.for_profile_id);
  var from = { review: 'Timing review', research: 'Researched', family: 'Family' };
  return '<p class="muted">' + esc(fmtWhen(p.occurred_at, true)) + ' · ' + (f.status === 'answered' ? 'Answered' : 'To ask') + '</p>' +
    '<div class="btn-row writer-only"><button class="btn sm" onclick="qsheetResearch(\'' + p.id + '\')">Add researched questions</button><button class="btn sm ghost" onclick="qsheetAddOwn(\'' + p.id + '\')">Add my own question</button><button class="btn sm ghost" onclick="qsheetPrint(\'' + p.id + '\')">Print for the visit</button></div><div id="qsStatus" aria-live="polite"></div>' +
    ((f.questions || []).length ? '' : '<p class="muted">No questions yet. Nothing stood out in Timing review; add researched questions or your own.</p>') +
    (f.questions || []).map(function (q, i) {
      var c = q.change || {};
      return '<div class="card"><div class="row between"><b>' + (i + 1) + '. ' + esc(q.text) + '</b><span class="badge">' + esc(from[q.from] || q.from) + '</span></div>' +
        (q.why ? '<div class="muted">' + esc(q.why) + ' ' + qsheetSources(q.sources) + '</div>' : '') +
        '<label for="qa-' + i + '">What they said</label><textarea id="qa-' + i + '" rows="2">' + esc(q.answer || '') + '</textarea>' +
        (q.applied_on ? '<div class="ok-note">' + esc(medTitle(c.med_id)) + ', ' + esc(slotName(c.slot).toLowerCase()) + ' dose changed to ' + esc(c.time) + ' on ' + esc(q.applied_on) + '.</div>'
          : '<div class="writer-only"><button class="linkish" onclick="qsheetChange(' + i + ')">They said to change the time</button>' +
            '<div id="qc-' + i + '" class="' + (c.med_id ? '' : 'hidden') + '"><div class="row"><select id="qc-med-' + i + '" aria-label="Medicine"><option value="">Medicine</option>' + meds.map(function (m) { return '<option value="' + m.id + '"' + (m.id === (c.med_id || q.med_id) && c.med_id ? ' selected' : '') + '>' + esc(m.title) + '</option>'; }).join('') + '</select>' +
            '<select id="qc-slot-' + i + '" aria-label="Which dose">' + QSHEET_SLOTS.map(function (s) { return '<option value="' + s + '"' + (s === c.slot ? ' selected' : '') + '>' + esc(slotName(s)) + '</option>'; }).join('') + '</select>' +
            '<input id="qc-time-' + i + '" type="time" aria-label="New time" value="' + esc(c.time || '') + '"></div>' +
            (owner ? '<div class="btn-row"><button class="btn sm" onclick="qsheetApply(\'' + p.id + '\',' + i + ')">Update the medicine</button></div>' : '<p class="muted">An owner updates the medicine.</p>') + '</div></div>') +
        '<p><button class="linkish writer-only" onclick="qsheetRemove(\'' + p.id + '\',' + i + ')">Remove question</button></p></div>';
    }).join('') +
    '<h3>Who answered</h3><div class="card"><label for="qsWho">Name</label><input id="qsWho" value="' + esc(f.answered_by || '') + '" placeholder="e.g. Dr. Lee">' +
    '<label for="qsRole">Role</label><select id="qsRole">' + QSHEET_ROLES.map(function (r) { return '<option' + (r === f.answerer_role ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select>' +
    '<label for="qsDate">Date</label><input id="qsDate" type="date" value="' + esc(f.answered_on || careToday()) + '">' +
    '<div class="btn-row writer-only"><button class="btn" onclick="qsheetAnswers(\'' + p.id + '\')">Save answers</button><button class="btn ghost" onclick="showHistory(\'records\',\'' + p.id + '\')">History</button></div></div>' +
    '<p class="muted">Questions only. Her pharmacist or doctor decides; nothing here is advice.</p>';
}
function renderOldDraft(p) {
  var f = p.fields || {};
  return '<p class="muted">' + esc(fmtWhen(p.occurred_at, true)) + ' · an older timing draft, kept for the record. New visits use question sheets.</p>' +
    (f.status === 'approved' ? '<div class="note ok-note"><b>Approved</b> by ' + esc(f.approved_by || '') + (f.approver_role ? ' (' + esc(f.approver_role) + ')' : '') + ' on ' + esc(f.approved_on || '') + (f.approval_note ? '. ' + esc(f.approval_note) : '') + '.</div>'
      : f.status === 'declined' ? '<div class="note">Not approved' + (f.approval_note ? ': ' + esc(f.approval_note) : '') + '.</div>' : '<div class="note">Not acted on. Nothing changed.</div>') +
    '<p>' + esc(f.summary || '') + '</p>' +
    (f.items || []).map(function (it) {
      return '<div class="card faded"><b>' + esc(medTitle(it.med_id)) + '</b><div>' + esc(slotName(it.slot)) + ' ' + esc(it.current_time) + (it.change ? ' &rarr; ' + esc(slotName(it.proposed_slot)) + ' ' + esc(it.proposed_time) : '') + '</div><p class="muted">' + esc(it.reason) + ' ' + sourceLinks(it.sources, f.sources) + '</p></div>';
    }).join('') +
    ((f.questions || []).length ? '<h3>Questions it listed</h3><ol class="q-list">' + f.questions.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>' : '') +
    '<div class="btn-row"><button class="btn ghost" onclick="printPlan(\'' + p.id + '\')">Print</button><button class="btn ghost" onclick="showHistory(\'records\',\'' + p.id + '\')">History</button></div>';
}
function qsheetPrint(id) {
  var p = qsheetOf(id); if (!p) return;
  var f = p.fields || {}, prof = State.profiles.find(function (x) { return x.id === p.for_profile_id; }) || {};
  var meds = activeMeds(p.for_profile_id).map(function (m) { var mf = m.fields || {}; return '<li><b>' + esc(m.title) + '</b> ' + esc([mf.dose, slotsText(m)].filter(Boolean).join(', ')) + '</li>'; }).join('');
  printHtml('<h2>Questions for the pharmacist: ' + esc(prof.person_name || '') + '</h2><p class="muted">Prepared ' + esc(careToday()) + ' by the family. Questions only; you decide.</p>' +
    '<h3>Her medicines and when they are given now</h3><ul>' + meds + '</ul><h3>Questions</h3><ol>' +
    (f.questions || []).map(function (q) { return '<li><b>' + esc(q.text) + '</b>' + (q.why ? '<br><span class="muted">' + esc(q.why) + '</span>' : '') + '<br>Answer: ______________________________________________</li>'; }).join('') +
    '</ol><p>Answered by: ____________________ Role: ____________ Date: __________</p>');
}
function printHtml(html) {
  var holder = document.getElementById('printArea');
  if (!holder) { holder = document.createElement('div'); holder.id = 'printArea'; document.body.appendChild(holder); }
  holder.innerHTML = html; document.body.classList.add('printing');
  setTimeout(function () { window.print(); setTimeout(function () { document.body.classList.remove('printing'); }, 500); }, 50);
}
function printTiming(pid) { var prof = State.profiles.find(function (p) { return p.id === pid; }) || {}; printHtml('<h2>Medicine timing review: ' + esc(prof.person_name || '') + '</h2><p class="muted">Prepared ' + esc(careToday()) + ' by the family from home records.</p>' + renderTiming({ pid: pid }).replace(/<div class="btn-row">[\s\S]*$/, '')); }
function printPlan(id) { var p = (State.records || []).find(function (r) { return r.id === id; }); var prof = State.profiles.find(function (x) { return x.id === (p && p.for_profile_id); }) || {}; printHtml('<h2>Proposed medicine timing: ' + esc(prof.person_name || '') + '</h2>' + renderPlan({ id: id }).replace(/<div class="btn-row">[\s\S]*$/, '') + '<p><b>Pharmacist / doctor:</b> ______________________ <b>Date:</b> __________ <b>Approved changes:</b> ______________________</p>'); }

/* ---------- ask about current guidance ---------- */
function askGuidance(pid) {
  openSheet('<h2 style="margin-top:0">Ask about current guidance</h2><p class="muted">Searches trusted health sources (FDA, NIH, kidney, diabetes and heart societies) and answers with links and dates. Her name is never sent.</p>' +
    '<label for="gQ">Question</label><textarea id="gQ" rows="3" placeholder="What potassium foods to limit at stage 4 kidney disease? When is the best time of day to take furosemide?"></textarea>' +
    '<div class="btn-row"><button class="btn" onclick="runGuidance(' + pidArg(pid) + ')">Ask</button><button class="btn ghost" onclick="closeSheet()">Close</button></div><div id="gOut" aria-live="polite"></div>');
}
function runGuidance(pid) {
  var q = document.getElementById('gQ').value.trim(), out = document.getElementById('gOut'); if (!q) return toast('Type a question');
  if (!Sync.enabled()) return toast('Turn on sync in Settings first');
  out.innerHTML = '<p class="muted">Searching and reading sources...</p>';
  Sync.brain('guidance', { question: q, context: { conditions: conditionsOf(pid), medicines: activeMeds(pid).map(function (m) { return m.title; }), eGFR: latestLab(pid, 'eGFR') } }).then(function (d) {
    S.lastGuidance = { q: q, d: d };
    out.innerHTML = '<div class="card"><p>' + esc(d.answer) + ' ' + sourceLinks(d.sources, d.source_list) + '</p>' +
      ((d.key_points || []).length ? '<ul>' + d.key_points.map(function (k) { return '<li>' + esc(k.point) + ' ' + sourceLinks(k.sources, d.source_list) + '</li>'; }).join('') + '</ul>' : '') +
      ((d.questions_for_care_team || []).length ? '<b>Ask her care team</b><ol class="q-list">' + d.questions_for_care_team.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>' : '') +
      ((d.source_list || []).length ? '<details><summary class="muted">Sources (' + d.source_list.length + ')</summary><ol class="src-list">' + d.source_list.map(function (s) { return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a>' + (s.age ? ' <span class="muted">' + esc(s.age) + '</span>' : '') + '</li>'; }).join('') + '</ol></details>' : '') +
      '<p class="muted">' + esc(d.caveat || '') + '</p><div class="btn-row writer-only"><button class="btn sm ghost" onclick="saveGuidance(' + pidArg(pid) + ')">Save to her file</button></div>' + aiWrongLink('guidance') + '</div>';
  }).catch(function (e) { out.innerHTML = '<p class="muted">Could not get an answer: ' + esc(e.message) + '</p>'; });
}
function saveGuidance(pid) {
  var g = S.lastGuidance; if (!g) return;
  var text = g.d.answer + '\n\n' + (g.d.key_points || []).map(function (k) { return '- ' + k.point; }).join('\n') + '\n\nAsk the care team:\n' + (g.d.questions_for_care_team || []).map(function (x) { return '- ' + x; }).join('\n') + '\n\nSources:\n' + (g.d.source_list || []).map(function (s, i) { return '[' + (i + 1) + '] ' + s.title + ' ' + s.url; }).join('\n');
  DB.put('records', { kind: 'update', for_profile_id: pid, title: 'Guidance: ' + g.q.slice(0, 80), occurred_at: new Date().toISOString(), fields: { text: text } })
    .then(loadAll).then(function () { toast('Saved to File → Updates'); if (Sync.enabled()) syncNow(); });
}
