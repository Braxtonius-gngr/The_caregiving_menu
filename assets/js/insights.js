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
  if (!ps.length && !drafts.length && !activeMeds(pid).length) return '';
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
function draftSchedule(pid) {
  if (!Sync.enabled()) return toast('Turn on sync in Settings first');
  if (!activeMeds(pid).length) return toast('Add her medicines first');
  var c = draftContext(pid), box = document.getElementById('draftStatus');
  if (box) box.innerHTML = '<p class="muted">Searching current sources and drafting. This can take a minute or two...</p>';
  Sync.brain('schedule_draft', { context: c.context }).then(function (d) {
    var items = (d.items || []).map(function (it) { return Object.assign({}, it, { med_id: c.refs[it.med_ref] || null }); }).filter(function (it) { return it.med_id; });
    return DB.put('records', { kind: 'plan', for_profile_id: pid, title: 'Medicine timing draft', occurred_at: new Date().toISOString(),
      fields: { status: 'draft', summary: d.summary, items: items, undecided: d.undecided || [], questions: d.questions_for_pharmacist || [], caveat: d.caveat, sources: d.source_list || [] } });
  }).then(function (saved) { return loadAll().then(function () { if (Sync.enabled()) syncNow(); showScreen('plan', { id: saved.id }); }); })
    .catch(function (e) { if (box) box.innerHTML = '<p class="muted">Could not draft: ' + esc(e.message) + '</p>'; else toast(e.message); });
}
function renderPlans(arg) {
  var pid = filePid(arg || {}), plans = recordsOf(pid, ['plan']).sort(byDateDesc);
  var label = { draft: 'Waiting for approval', approved: 'Approved', declined: 'Not approved' };
  return '<p class="muted">The app drafts medicine timing from her labels, her real dose times, meals and sleep, and current guidance, with sources. Nothing changes on Today until an owner records that her pharmacist or doctor approved it.</p>' +
    '<div class="btn-row writer-only"><button class="btn" onclick="draftSchedule(' + pidArg(pid) + ')">Draft a schedule</button><button class="btn ghost" onclick="showScreen(\'timing\',{pid:' + pidArg(pid) + '})">Timing review</button></div><div id="draftStatus" aria-live="polite"></div>' +
    (plans.length ? plans.map(function (p) { var f = p.fields || {}; return '<div class="card tappable" onclick="showScreen(\'plan\',{id:\'' + p.id + '\'})"><b>' + esc(fmtWhen(p.occurred_at, true)) + '</b> <span class="badge ' + (f.status === 'approved' ? 'ok' : f.status === 'declined' ? 'bad' : 'warn') + '">' + esc(label[f.status] || f.status) + '</span><div class="muted">' + esc((f.items || []).filter(function (i) { return i.change; }).length + ' change(s) proposed') + (f.approved_by ? ' · ' + esc(f.approved_by) : '') + '</div></div>'; }).join('') : '<p class="muted">No drafts yet.</p>');
}
function medTitle(id) { var m = (State.records || []).find(function (r) { return r.id === id; }); return m ? m.title : 'Medicine'; }
function sourceLinks(nums, list) { return (nums || []).map(function (n) { var s = (list || [])[n - 1]; return s ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">[' + n + ']</a>' : ''; }).join(' '); }
function renderPlan(arg) {
  var p = (State.records || []).find(function (r) { return r.id === (arg && arg.id); }); if (!p) return '<p class="muted">Draft not found.</p>';
  var f = p.fields || {}, owner = State.role === 'owner' || State.role == null;
  var html = '<p class="muted">' + esc(fmtWhen(p.occurred_at, true)) + '</p>' +
    (f.status === 'approved' ? '<div class="note ok-note"><b>Approved</b> by ' + esc(f.approved_by || '') + (f.approver_role ? ' (' + esc(f.approver_role) + ')' : '') + ' on ' + esc(f.approved_on || '') + (f.approval_note ? '. ' + esc(f.approval_note) : '') + '. Recorded by ' + esc(whoName(p.edited_by || p.user_id)) + '.</div>'
      : f.status === 'declined' ? '<div class="note">Not approved' + (f.approval_note ? ': ' + esc(f.approval_note) : '') + '.</div>'
      : '<div class="note"><b>Draft.</b> Nothing has changed. Take this to her pharmacist or doctor; an owner records their answer below.</div>') +
    '<p>' + esc(f.summary || '') + '</p>' +
    (f.items || []).map(function (it, i) {
      var accepted = (f.accepted || []).indexOf(i) >= 0;
      return '<div class="card' + (it.change ? '' : ' faded') + '"><div class="row between"><b>' + esc(medTitle(it.med_id)) + '</b><span class="badge">' + esc(it.confidence) + ' confidence</span></div>' +
        '<div>' + esc(slotName(it.slot)) + ' ' + esc(it.current_time) + (it.change ? ' &rarr; <b>' + esc(slotName(it.proposed_slot)) + ' ' + esc(it.proposed_time) + '</b>' : ' &middot; keep') + (accepted ? ' <span class="badge ok">applied</span>' : '') + '</div>' +
        '<p class="muted">' + esc(it.reason) + ' ' + sourceLinks(it.sources, f.sources) + '</p>' + (it.ask_pharmacist ? '<div class="muted"><b>Ask:</b> ' + esc(it.ask_pharmacist) + '</div>' : '') + '</div>';
    }).join('') +
    ((f.undecided || []).length ? '<h3>Left for her clinicians</h3><ul>' + f.undecided.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
    ((f.questions || []).length ? '<h3>Questions for the pharmacist</h3><ol class="q-list">' + f.questions.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>' : '') +
    ((f.sources || []).length ? '<h3>Sources</h3><ol class="src-list">' + f.sources.map(function (s) { return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a>' + (s.age ? ' <span class="muted">' + esc(s.age) + '</span>' : '') + '</li>'; }).join('') + '</ol>' : '') +
    '<p class="muted">' + esc(f.caveat || 'A draft for her pharmacist or doctor to approve.') + '</p>' +
    '<div class="btn-row"><button class="btn ghost" onclick="printPlan(\'' + p.id + '\')">Print for the pharmacist</button><button class="btn ghost" onclick="showHistory(\'records\',\'' + p.id + '\')">History</button>' +
    (f.status === 'draft' && owner ? '<button class="btn writer-only" onclick="approvePlan(\'' + p.id + '\')">Record approval</button>' : '') + '</div>' +
    (f.status === 'draft' && !owner ? '<p class="muted">Only an owner of the family can record an approval.</p>' : '');
  return html;
}
function approvePlan(id) {
  var p = (State.records || []).find(function (r) { return r.id === id; }); if (!p) return;
  var f = p.fields || {}, changes = (f.items || []).map(function (it, i) { return [it, i]; }).filter(function (x) { return x[0].change; });
  openSheet('<h2 style="margin-top:0">Record the approval</h2><p class="muted">Only record what her pharmacist or doctor actually said.</p>' +
    '<div class="chips" id="apStatus"><button type="button" class="chip on" data-v="approved" onclick="pickChip(\'apStatus\',this)">Approved</button><button type="button" class="chip" data-v="declined" onclick="pickChip(\'apStatus\',this)">Not approved</button></div>' +
    '<label for="apWho">Who approved it</label><input id="apWho" placeholder="Name">' +
    '<label for="apRole">Their role</label><select id="apRole"><option>Pharmacist</option><option>Doctor</option><option>Nurse practitioner</option><option>Physician assistant</option></select>' +
    '<label for="apDate">Date</label><input id="apDate" type="date" value="' + careToday() + '">' +
    (changes.length ? '<label>Changes they approved</label>' + changes.map(function (x) { return '<label class="check"><input type="checkbox" class="apItem" value="' + x[1] + '" checked> ' + esc(medTitle(x[0].med_id) + ': ' + slotName(x[0].slot) + ' ' + x[0].current_time + ' → ' + slotName(x[0].proposed_slot) + ' ' + x[0].proposed_time) + '</label>'; }).join('') : '<p class="muted">This draft proposes no changes.</p>') +
    '<label for="apNote">What they said</label><textarea id="apNote" rows="2" placeholder="OK except keep the water pill in the morning..."></textarea>' +
    '<div class="btn-row"><button class="btn" onclick="saveApproval(\'' + id + '\')">Save</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>');
}
function saveApproval(id) {
  var status = chipValue('apStatus') || 'approved', who = document.getElementById('apWho').value.trim();
  if (status === 'approved' && !who) return toast('Type who approved it');
  var accepted = status === 'approved' ? Array.prototype.map.call(document.querySelectorAll('.apItem:checked'), function (c) { return +c.value; }) : [];
  var p = (State.records || []).find(function (r) { return r.id === id; }), items = ((p && p.fields) || {}).items || [];
  var meta = { status: status, approved_by: who || null, approver_role: document.getElementById('apRole').value, approved_on: document.getElementById('apDate').value, approval_note: document.getElementById('apNote').value.trim() || null, accepted: accepted };
  DB.update('records', id, function (cur) { if (!cur) return null; cur.fields = Object.assign({}, cur.fields, meta); return cur; })
    .then(function () {
      // Write each accepted change onto its medicine; History keeps the old slots and times.
      return accepted.reduce(function (chain, i) {
        var it = items[i]; if (!it || !it.med_id) return chain;
        return chain.then(function () {
          return DB.update('records', it.med_id, function (m) {
            if (!m || m.deleted) return null;
            var f = Object.assign({}, m.fields), slots = Logic.medSlots(m).filter(function (s) { return s !== it.slot; });
            if (slots.indexOf(it.proposed_slot) < 0) slots.push(it.proposed_slot);
            var times = Object.assign({}, f.slot_times || {}); delete times[it.slot];
            if (it.proposed_slot !== 'prn' && /^\d{1,2}:\d{2}$/.test(it.proposed_time || '')) times[it.proposed_slot] = it.proposed_time;
            f.slots = slots.join(','); f.slot_times = times; f.timing_source = 'Plan approved ' + meta.approved_on + ' by ' + meta.approved_by;
            m.fields = f; return m;
          });
        });
      }, Promise.resolve());
    })
    .then(function () { closeSheet(); return loadAll(); }).then(function () { refresh(); if (Sync.enabled()) syncNow(); toast(status === 'approved' ? 'Approved. ' + accepted.length + ' change(s) applied.' : 'Recorded as not approved'); })
    .catch(function (e) { toast('Could not save: ' + e.message); });
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
      '<p class="muted">' + esc(d.caveat || '') + '</p><div class="btn-row writer-only"><button class="btn sm ghost" onclick="saveGuidance(' + pidArg(pid) + ')">Save to her file</button></div></div>';
  }).catch(function (e) { out.innerHTML = '<p class="muted">Could not get an answer: ' + esc(e.message) + '</p>'; });
}
function saveGuidance(pid) {
  var g = S.lastGuidance; if (!g) return;
  var text = g.d.answer + '\n\n' + (g.d.key_points || []).map(function (k) { return '- ' + k.point; }).join('\n') + '\n\nAsk the care team:\n' + (g.d.questions_for_care_team || []).map(function (x) { return '- ' + x; }).join('\n') + '\n\nSources:\n' + (g.d.source_list || []).map(function (s, i) { return '[' + (i + 1) + '] ' + s.title + ' ' + s.url; }).join('\n');
  DB.put('records', { kind: 'update', for_profile_id: pid, title: 'Guidance: ' + g.q.slice(0, 80), occurred_at: new Date().toISOString(), fields: { text: text } })
    .then(loadAll).then(function () { toast('Saved to File → Updates'); if (Sync.enabled()) syncNow(); });
}
