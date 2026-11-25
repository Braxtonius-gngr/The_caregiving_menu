/* Patient file: summary (conditions, allergies, medicines, directives), care team, labs,
 * visits, documents, family updates, and a one-page export for the doctor. Every item is a
 * row in `records` (kind + title + fields), so History, Restore and Deleted work the same
 * way as in the diary. Nothing here gives advice: it records and organizes. */

var LAB_TESTS = ['eGFR', 'Creatinine', 'BUN', 'Potassium', 'Sodium', 'Phosphorus', 'Calcium', 'Albumin', 'Hemoglobin', 'Hematocrit', 'A1c', 'Glucose', 'Bicarbonate (CO2)', 'PTH'];
var LAB_UNITS = { eGFR: 'mL/min/1.73m²', Creatinine: 'mg/dL', BUN: 'mg/dL', Potassium: 'mmol/L', Sodium: 'mmol/L', Phosphorus: 'mg/dL', Calcium: 'mg/dL', Albumin: 'g/dL', Hemoglobin: 'g/dL', Hematocrit: '%', A1c: '%', Glucose: 'mg/dL', 'Bicarbonate (CO2)': 'mmol/L', PTH: 'pg/mL' };
// Fields per kind: [key, label, type]. Types: text, textarea, date, datetime, number, tel, select:<a|b|c>,
// slots (medicine time slots), hidden, heading (a sub-heading, no value).
var RECORD_KINDS = {
  condition: { label: 'Condition', title: 'Condition', fields: [['since', 'Since', 'text'], ['notes', 'Notes', 'textarea']] },
  allergy: { label: 'Allergy', title: 'Allergic to', fields: [['reaction', 'Reaction', 'text'], ['severity', 'Severity', 'select:Mild|Moderate|Severe|Unknown']] },
  medication: { label: 'Medicine', title: 'Medicine', fields: [['dose', 'Dose (e.g. 40 mg, 1 tablet)', 'text'], ['slots', 'When to give it', 'slots'], ['with_food', 'Food', 'select:With food|Without food|Either'], ['when', 'Other timing notes', 'text'], ['purpose', 'What it is for', 'text'], ['prescriber', 'Prescribed by', 'text'], ['pharmacy', 'Pharmacy', 'text'], ['start', 'Started', 'date'], ['stop', 'Stop on (leave blank if ongoing)', 'date'], ['refill_on', 'Next refill due', 'date'], ['instructions', 'Instructions from the doctor or pharmacist', 'textarea'], ['generic', '', 'hidden'],
    ['label_head', 'From the label', 'heading'], ['label_boxed', 'Boxed warning', 'textarea'], ['label_how', 'How to take it', 'textarea'], ['label_side', 'Side effects to watch for', 'textarea'], ['label_warn', 'Warnings', 'textarea'], ['label_patients', 'For patients and families', 'textarea'], ['label_older', 'Older adults', 'textarea'], ['label_source', '', 'hidden'], ['label_date', '', 'hidden']] },
  directive: { label: 'Directive', title: 'Document (e.g. DNR, POLST, living will, power of attorney)', fields: [['kept', 'Where the original is kept', 'text'], ['notes', 'Notes', 'textarea']] },
  contact: { label: 'Care team', title: 'Name', fields: [['role', 'Role (kidney doctor, hospice nurse, pharmacy...)', 'text'], ['phone', 'Phone', 'tel'], ['fax', 'Fax', 'text'], ['address', 'Address', 'text'], ['portal', 'Patient portal link', 'text'], ['notes', 'Notes', 'textarea']] },
  lab: { label: 'Lab result', title: 'Test', date: 'date', fields: [['value', 'Result', 'number'], ['unit', 'Unit', 'text'], ['low', 'Range low (from the report)', 'number'], ['high', 'Range high (from the report)', 'number'], ['range_text', 'Range as printed, if not numbers', 'text'], ['notes', 'Notes', 'textarea']] },
  visit: { label: 'Visit', title: 'Who (doctor, nurse, hospice...)', date: 'datetime', fields: [['where', 'Where', 'text'], ['why', 'Why', 'text'], ['said', 'What they said', 'textarea'], ['changed', 'What changed', 'textarea'], ['meds_changed', 'Medicines started, stopped or changed', 'textarea'], ['tests', 'Tests ordered', 'textarea'], ['next_appt', 'Next appointment', 'datetime'], ['questions', 'Questions for next time', 'textarea'], ['transcript', 'Full notes from the scribe', 'textarea']] },
  document: { label: 'Document', title: 'Title', date: 'date', fields: [['doc_type', 'Kind', 'select:Discharge papers|Report|Insurance card|ID|Directive|Bill|Other'], ['notes', 'Notes', 'textarea']] },
  update: { label: 'Update', title: 'Headline (optional)', date: 'datetime', fields: [['text', 'What happened', 'textarea']] },
  event: { label: 'Important day', title: 'What (lab draw, refill, birthday...)', date: 'date', fields: [['repeat', 'Repeats', 'select:No|Every year|Every month'], ['notes', 'Notes', 'textarea']] },
  dose: { label: 'Dose given', title: 'Medicine', date: 'datetime', fields: [['status', 'Status', 'select:given|skipped|refused'], ['note', 'Note', 'textarea']] },
  plan: { label: 'Schedule draft', title: 'Title', date: 'datetime', fields: [] },
  exercise: { label: 'Exercise', title: 'Exercise', fields: [['how', 'Sets, reps or hold', 'text'], ['how_often', 'How often', 'text'], ['from', 'From (therapist or clinic)', 'text'], ['active', 'Still doing it', 'select:Yes|No'], ['notes', 'How to do it, cautions', 'textarea']] }
};
var MED_SLOTS = [['morning', 'Morning', 8], ['noon', 'Midday', 12], ['evening', 'Evening', 17], ['bedtime', 'Bedtime', 21], ['prn', 'Only when needed', null]];
var FILE_SECTIONS = [['summary', 'Summary'], ['team', 'Care team'], ['labs', 'Labs'], ['visits', 'Visits'], ['therapy', 'Therapy'], ['documents', 'Documents'], ['updates', 'Updates'], ['export', 'For the doctor']];

function filePid(arg) { return arg && arg.pid !== undefined ? arg.pid : (S.filePid !== undefined ? S.filePid : (State.activeProfile || ((State.profiles[0] || {}).id) || null)); }
function recordsOf(pid, kinds) {
  return (State.records || []).filter(function (r) { return (r.for_profile_id || null) === (pid || null) && kinds.indexOf(r.kind) >= 0; });
}
function byDateDesc(a, b) { return (a.occurred_at || a.updated_at) < (b.occurred_at || b.updated_at) ? 1 : -1; }
function fmtWhen(iso, withTime) { if (!iso) return ''; return localDay(iso) + (withTime ? ' ' + localTime(iso) : ''); }

function renderFile(arg) {
  arg = arg || {};
  var pid = filePid(arg); S.filePid = pid;
  var section = arg.section || S.fileSection || 'summary'; S.fileSection = section;
  var prof = State.profiles.find(function (p) { return p.id === pid; });
  var go = function (o) { return 'showScreen(\'file\',' + JSON.stringify(o).replace(/"/g, '&quot;') + ')'; };
  var head = '<div class="chips">' + State.profiles.map(function (p) { return '<span class="chip' + (p.id === pid ? ' on' : '') + '" onclick="' + go({ pid: p.id, section: section }) + '">' + esc(p.person_name) + '</span>'; }).join('') + '</div>' +
    (prof ? '' : '<p class="muted">Add the person you care for in Settings first.</p>') +
    '<div class="seg" role="tablist">' + FILE_SECTIONS.map(function (s) { return '<button role="tab" aria-selected="' + (s[0] === section) + '" class="seg-btn' + (s[0] === section ? ' on' : '') + '" onclick="' + go({ pid: pid, section: s[0] }) + '">' + s[1] + '</button>'; }).join('') + '</div>';
  if (!prof) return head;
  var body = { summary: fileSummary, team: fileTeam, labs: fileLabs, visits: fileVisits, therapy: fileTherapy, documents: fileDocuments, updates: fileUpdates, export: fileExport }[section] || fileSummary;
  return head + body(pid, prof);
}
function addBtn(kind, pid, label) { return '<button class="btn sm writer-only" onclick="editRecord(null,\'' + kind + '\',' + (pid ? '\'' + pid + '\'' : 'null') + ')">+ ' + esc(label || RECORD_KINDS[kind].label) + '</button>'; }
function recordCard(r, sub, extra) {
  var files = extraPhotosOf(r.id).length;
  return '<div class="card tappable" role="button" tabindex="0" onclick="editRecord(\'' + r.id + '\')" onkeydown="if(event.key===\'Enter\')this.click()"><b>' + esc(r.title || RECORD_KINDS[r.kind].label) + '</b>' + (sub ? ' <span class="muted">' + sub + '</span>' : '') +
    (extra ? '<div class="muted">' + extra + '</div>' : '') + (files ? '<div class="muted">&#128206; ' + files + ' file' + (files === 1 ? '' : 's') + '</div>' : '') + '</div>';
}

/* ---------- sections ---------- */
function fileSummary(pid, prof) {
  var group = function (kind, heading, sub) {
    var rs = recordsOf(pid, [kind]).sort(function (a, b) { return (a.title || '').localeCompare(b.title || ''); });
    return '<div class="row between"><h2>' + heading + '</h2>' + addBtn(kind, pid) + '</div>' +
      (rs.length ? rs.map(function (r) { return recordCard(r, sub(r)); }).join('') : '<p class="muted">None recorded.</p>');
  };
  var f = function (r, k) { return esc((r.fields || {})[k] || ''); };
  var next = nextAppointment(pid);
  return (next ? '<div class="note"><b>Next appointment:</b> ' + esc(fmtWhen(next.when, true)) + ' · ' + esc(next.with) + '</div>' : '') +
    group('allergy', 'Allergies', function (r) { return [f(r, 'reaction'), f(r, 'severity')].filter(Boolean).join(' · '); }) +
    group('condition', 'Conditions', function (r) { return f(r, 'since') ? 'since ' + f(r, 'since') : ''; }) +
    group('medication', 'Medicines', function (r) { return [f(r, 'dose'), esc(slotsText(r)), f(r, 'purpose'), r.fields && r.fields.stop && r.fields.stop < careToday() ? 'stopped' : ''].filter(Boolean).join(' · '); }) +
    '<div class="btn-row"><button class="btn sm ghost" onclick="showScreen(\'meds\',{pid:' + (pid ? '\'' + pid + '\'' : 'null') + '})">Daily meds</button><button class="btn sm ghost" onclick="showScreen(\'medcheck\',{pid:' + (pid ? '\'' + pid + '\'' : 'null') + '})">Compare sources</button></div>' +
    group('directive', 'Directives and legal papers', function (r) { return f(r, 'kept') ? 'kept: ' + f(r, 'kept') : ''; }) +
    '<p class="muted">Keep this list the way the doctors and pharmacy have it. The app records; it doesn\'t advise.</p>';
}
function fileTeam(pid) {
  var rs = recordsOf(pid, ['contact']).sort(function (a, b) { return (a.title || '').localeCompare(b.title || ''); });
  return '<div class="row between"><h2>Care team</h2>' + addBtn('contact', pid, 'Person or place') + '</div>' +
    (rs.length ? rs.map(function (r) {
      var fl = r.fields || {}, tel = fl.phone_e164 || (fl.phone || '').replace(/[^\d+]/g, '');
      return '<div class="card row"><div class="grow tappable" onclick="editRecord(\'' + r.id + '\')"><b>' + esc(r.title) + '</b> <span class="muted">' + esc(fl.role || '') + '</span>' +
        '<div class="muted">' + esc([fl.phone, fl.phone_type ? (LINE_TYPE_TEXT[fl.phone_type] || fl.phone_type) : '', fl.fax ? 'fax ' + fl.fax : ''].filter(Boolean).join(' · ')) + '</div></div>' +
        (tel ? '<a class="btn sm" href="tel:' + esc(tel) + '">Call</a>' : '') + '</div>';
    }).join('') : '<p class="muted">Add the doctors, nurses, hospice or home health, and the pharmacy.</p>');
}
function labStatus(r) {
  var fl = r.fields || {}, v = +fl.value, lo = fl.low === '' || fl.low == null ? null : +fl.low, hi = fl.high === '' || fl.high == null ? null : +fl.high;
  if (fl.value === '' || fl.value == null || isNaN(v)) return '';
  if (lo != null && v < lo) return 'below this report\'s range';
  if (hi != null && v > hi) return 'above this report\'s range';
  if (lo != null || hi != null) return 'within this report\'s range';
  return '';
}
function fileLabs(pid) {
  var rs = recordsOf(pid, ['lab']).sort(byDateDesc), tests = {};
  rs.forEach(function (r) { (tests[r.title] = tests[r.title] || []).push(r); });
  var names = Object.keys(tests).sort(function (a, b) { var ia = LAB_TESTS.indexOf(a), ib = LAB_TESTS.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b); });
  return '<div class="row between"><h2>Labs</h2>' + addBtn('lab', pid, 'Result') + '</div>' +
    '<p class="muted">Each result keeps the range printed on its own report. Labs differ, so the app never assumes a "normal".</p>' +
    (names.length ? names.map(function (t) {
      var list = tests[t], last = list[0], fl = last.fields || {}, st = labStatus(last);
      return '<div class="card"><div class="row between"><b>' + esc(t) + '</b><span class="muted">' + esc(fmtWhen(last.occurred_at)) + '</span></div>' +
        '<div><b class="big-num">' + esc(fl.value == null ? '—' : fl.value) + '</b> ' + esc(fl.unit || '') + (st ? ' <span class="' + (st.indexOf('within') === 0 ? 'muted' : 'flag-text') + '">' + esc(st) + '</span>' : '') + '</div>' +
        '<div class="muted">' + esc(fl.low != null && fl.low !== '' || fl.high != null && fl.high !== '' ? 'Report range ' + (fl.low != null && fl.low !== '' ? fl.low : '') + '–' + (fl.high != null && fl.high !== '' ? fl.high : '') : (fl.range_text ? 'Report range ' + fl.range_text : 'No range entered')) + '</div>' +
        labTrend(list) +
        '<details><summary class="muted">' + list.length + ' result' + (list.length === 1 ? '' : 's') + '</summary>' + list.map(function (r) { return '<div class="list-item tappable" onclick="editRecord(\'' + r.id + '\')"><div class="grow">' + esc(fmtWhen(r.occurred_at)) + ': <b>' + esc((r.fields || {}).value) + '</b> ' + esc((r.fields || {}).unit || '') + ' <span class="muted">' + esc(labStatus(r)) + '</span></div></div>'; }).join('') + '</details></div>';
    }).join('') : '<p class="muted">No results yet. Type them in from the report or the patient portal, or photograph the report.</p>');
}
function labTrend(list) {
  var pts = list.filter(function (r) { return r.fields && r.fields.value !== '' && r.fields.value != null && !isNaN(+r.fields.value); }).slice(0, 10).reverse();
  if (pts.length < 2) return '';
  var vals = pts.map(function (r) { return +r.fields.value; }), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), span = (hi - lo) || 1, W = 300, H = 60;
  var xy = vals.map(function (v, i) { return [10 + i * (W - 20) / (vals.length - 1), H - 8 - (v - lo) / span * (H - 16)]; });
  return '<figure class="trend"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Trend of the last ' + vals.length + ' results, from ' + vals[0] + ' to ' + vals[vals.length - 1] + '"><polyline fill="none" stroke="currentColor" stroke-width="2" points="' + xy.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '"/>' +
    xy.map(function (p) { return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3" fill="currentColor"/>'; }).join('') + '</svg></figure>';
}
function nextAppointment(pid) {
  var now = new Date().toISOString(), cands = [];
  recordsOf(pid, ['visit']).forEach(function (r) {
    if (r.occurred_at && r.occurred_at > now) cands.push({ when: r.occurred_at, with: r.title || 'Visit' });
    var na = (r.fields || {}).next_appt; if (na && new Date(na).toISOString() > now) cands.push({ when: new Date(na).toISOString(), with: r.title || 'Follow-up' });
  });
  return cands.sort(function (a, b) { return a.when < b.when ? -1 : 1; })[0] || null;
}
function fileVisits(pid) {
  var now = new Date().toISOString(), rs = recordsOf(pid, ['visit']);
  var upcoming = rs.filter(function (r) { return r.occurred_at > now; }).sort(function (a, b) { return a.occurred_at < b.occurred_at ? -1 : 1; });
  var past = rs.filter(function (r) { return !(r.occurred_at > now); }).sort(byDateDesc);
  var card = function (r) { var fl = r.fields || {}; return recordCard(r, esc(fmtWhen(r.occurred_at, true)) + (fl.where ? ' · ' + esc(fl.where) : ''), esc([fl.why, fl.changed ? 'Changed: ' + fl.changed : ''].filter(Boolean).join(' · ').slice(0, 160))); };
  return '<div class="row between"><h2>Visits</h2><span>' + addBtn('visit', pid) + ' <button class="btn sm ghost writer-only" onclick="scribeIt(' + (pid ? '\'' + pid + '\'' : 'null') + ')">&#127897; Scribe</button></span></div>' +
    (upcoming.length ? '<h3>Coming up</h3>' + upcoming.map(card).join('') : '') +
    '<h3>Past visits</h3>' + (past.length ? past.map(card).join('') : '<p class="muted">After each visit, note what they said and what changed, and photograph the After Visit Summary.</p>');
}
// Documents grouped like folders; anything without a type of its own goes in Misc.
function docFolder(r) { var t = (r.fields || {}).doc_type; return r.kind === 'directive' ? 'Directive' : (!t || t === 'Other') ? 'Misc' : t; }
function fileDocuments(pid) {
  var rs = recordsOf(pid, ['document', 'directive']).sort(byDateDesc), groups = {}, order = ['Directive', 'Insurance card', 'ID', 'Discharge papers', 'Report', 'Bill', 'Misc'];
  rs.forEach(function (r) { var g = docFolder(r); (groups[g] = groups[g] || []).push(r); });
  var card = function (r) { var fl = r.fields || {}, ex = (fl.extra || []).slice(0, 2).map(function (f) { return f.label + ': ' + f.value; }).join(' · '); return recordCard(r, esc(fmtWhen(r.occurred_at)), ex ? esc(ex) : ''); };
  return '<div class="row between"><h2>Documents</h2><span>' + addBtn('document', pid) + ' <button class="btn sm ghost writer-only" onclick="snapIt(' + (pid ? '\'' + pid + '\'' : 'null') + ')">&#128247; Snap a paper</button></span></div>' +
    (rs.length ? order.concat(Object.keys(groups).filter(function (g) { return order.indexOf(g) < 0; })).filter(function (g) { return groups[g]; }).map(function (g) {
      return '<details class="doc-folder" open><summary><b>&#128193; ' + esc(g) + '</b> <span class="muted">(' + groups[g].length + ')</span></summary>' + groups[g].map(card).join('') + '</details>';
    }).join('') : '<p class="muted">Discharge papers, reports, insurance cards: snap a paper, or add a document and attach photos or PDFs. Papers that fit nowhere else go in Misc, with their own details pulled out.</p>');
}
function fileTherapy(pid) {
  var rs = recordsOf(pid, ['exercise']).sort(function (a, b) { return (a.title || '').localeCompare(b.title || ''); });
  var on = rs.filter(function (r) { return (r.fields || {}).active !== 'No'; }), off = rs.filter(function (r) { return (r.fields || {}).active === 'No'; });
  var card = function (r) { var fl = r.fields || {}; return recordCard(r, esc([fl.how, fl.how_often].filter(Boolean).join(' · ')), fl.notes ? esc(fl.notes.slice(0, 140)) : ''); };
  return '<div class="row between"><h2>Therapy</h2><span>' + addBtn('exercise', pid) + ' <button class="btn sm ghost writer-only" onclick="snapIt(' + (pid ? '\'' + pid + '\'' : 'null') + ',\'exercise\')">&#128247; Snap the sheet</button></span></div>' +
    (on.length ? on.map(card).join('') : '<p class="muted">Physical, occupational or speech therapy home exercises. Snap the sheet the therapist gave you and the exercises are listed here, with the pages kept under Documents.</p>') +
    (off.length ? '<h3>No longer doing</h3>' + off.map(card).join('') : '');
}
function fileUpdates(pid) {
  var rs = recordsOf(pid, ['update']).sort(byDateDesc);
  return '<div class="card writer-only"><label for="upText">Share an update with the family</label><textarea id="upText" rows="3" placeholder="Hospice nurse came at 2. Lungs clear, ankles more swollen than Monday."></textarea><div class="btn-row"><button class="btn sm" onclick="postUpdate(' + (pid ? '\'' + pid + '\'' : 'null') + ')">Post</button></div></div>' +
    (rs.length ? rs.map(function (r) {
      return '<div class="card tappable" onclick="editRecord(\'' + r.id + '\')"><div class="muted">' + esc(fmtWhen(r.occurred_at || r.updated_at, true)) + ' · ' + esc(whoName(r.user_id)) + '</div>' + (r.title ? '<b>' + esc(r.title) + '</b>' : '') + '<div class="prewrap">' + esc((r.fields || {}).text || '') + '</div></div>';
    }).join('') : '<p class="muted">No updates yet.</p>');
}
function postUpdate(pid) {
  var t = document.getElementById('upText').value.trim(); if (!t) return toast('Write something first');
  DB.put('records', { kind: 'update', for_profile_id: pid, title: '', occurred_at: new Date().toISOString(), fields: { text: t } })
    .then(loadAll).then(function () { toast('Posted'); refresh(); if (Sync.enabled()) syncNow(); }).catch(function (e) { toast(e.message); });
}

/* ---------- editing a record ---------- */
function editRecord(id, kind, pid) {
  var r = id ? (State.records || []).find(function (x) { return x.id === id; }) : null;
  if (id && !r) return;
  kind = r ? r.kind : kind; var K = RECORD_KINDS[kind], fl = (r && r.fields) || {};
  var dateType = K.date, dateVal = r && r.occurred_at ? (dateType === 'date' ? localDay(r.occurred_at) : localDay(r.occurred_at) + 'T' + localTime(r.occurred_at)) : (dateType === 'date' ? localDay(new Date().toISOString()) : localDay(new Date().toISOString()) + 'T' + localTime(new Date().toISOString()));
  var field = function (f) {
    var key = f[0], label = f[1], type = f[2], v = fl[key] == null ? '' : fl[key], fid = 'rf-' + key;
    if (type === 'textarea') return '<label for="' + fid + '">' + label + '</label><textarea id="' + fid + '" rows="3">' + esc(v) + '</textarea>';
    if (type.indexOf('select:') === 0) return '<label for="' + fid + '">' + label + '</label><select id="' + fid + '"><option value=""></option>' + type.slice(7).split('|').map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
    if (type === 'tel') return '<label for="' + fid + '">' + label + '</label><div class="row"><input id="' + fid + '" class="grow" type="tel" value="' + esc(v) + '" oninput="S.phoneCheck=null"><button type="button" class="btn sm ghost" onclick="checkPhoneField(\'' + fid + '\')">Check number</button></div><div class="muted" id="' + fid + 'Hint" aria-live="polite">' + (fl.phone_type ? esc(phoneTypeText(fl.phone_type, fl.phone_carrier)) : '') + '</div>';
    if (type === 'heading') return '<h3>' + esc(label) + '</h3>' + (key === 'label_head' ? labelHelp(fl) : '');
    if (type === 'hidden') return '<input id="' + fid + '" type="hidden" value="' + esc(v) + '">';
    if (type === 'slots') {
      var on = String(v).split(','), times = fl.slot_times || {};
      return '<label>' + label + '</label><div class="chips" id="' + fid + '">' + MED_SLOTS.map(function (s) { var sel = on.indexOf(s[0]) >= 0; return '<button type="button" class="chip' + (sel ? ' on' : '') + '" data-v="' + s[0] + '" aria-pressed="' + sel + '" onclick="toggleChip(this)">' + s[1] + '</button>'; }).join('') + '</div>' +
        '<div class="slot-times">' + MED_SLOTS.filter(function (s) { return s[2] != null; }).map(function (s) { return '<label class="slot-time"><span class="muted">' + s[1] + '</span><input type="time" id="rf-st-' + s[0] + '" value="' + esc(times[s[0]] || '') + '" placeholder="' + pad2(s[2]) + ':00"></label>'; }).join('') + '</div>' +
        '<p class="muted">Set a time only if she takes it at a set time; blank uses ' + MED_SLOTS.filter(function (s) { return s[2] != null; }).map(function (s) { return s[1].toLowerCase() + ' ' + (s[2] % 12 || 12) + (s[2] < 12 ? ' am' : ' pm'); }).join(', ') + '. A dose shows as due an hour before and overdue two hours after.</p>' + (fl.time ? '<p class="muted">Earlier note on timing: ' + esc(fl.time) + '</p>' : '');
    }
    if (type === 'date') return '<label for="' + fid + '">' + label + '</label><input id="' + fid + '" type="date" value="' + esc(v) + '">';
    if (type === 'datetime') { var dv = v ? localDay(new Date(v).toISOString()) + 'T' + localTime(new Date(v).toISOString()) : ''; return '<label for="' + fid + '">' + label + '</label><input id="' + fid + '" type="datetime-local" value="' + dv + '">'; }
    return '<label for="' + fid + '">' + label + '</label><input id="' + fid + '" ' + (type === 'number' ? 'type="number" step="any" inputmode="decimal"' : 'type="text"') + ' value="' + esc(v) + '">';
  };
  var titleField = kind === 'lab'
    ? '<label for="rTitle">' + K.title + '</label><input id="rTitle" list="labList" value="' + esc(r ? r.title : '') + '" oninput="fillLabUnit(this.value)"><datalist id="labList">' + LAB_TESTS.map(function (t) { return '<option value="' + esc(t) + '">'; }).join('') + '</datalist>'
    : '<label for="rTitle">' + K.title + '</label><input id="rTitle" value="' + esc(r ? r.title : '') + '">';
  if (!r && (kind === 'medication' || kind === 'lab' || kind === 'visit' || kind === 'exercise')) titleField = '<div class="btn-row writer-only"><button type="button" class="btn sm ghost" onclick="snapIt(' + (pid ? '\'' + pid + '\'' : 'null') + ',\'' + kind + '\')">&#128247; From a photo</button></div>' + titleField;
  if (!r && kind === 'visit') titleField = titleField.replace('</button></div>', '</button><button type="button" class="btn sm ghost" onclick="scribeIt(' + (pid ? '\'' + pid + '\'' : 'null') + ')">&#127897; Scribe it</button></div>');
  if (kind === 'medication') titleField += '<div class="btn-row writer-only"><button type="button" class="btn sm ghost" onclick="fillFromLabel()">Fill from the FDA label</button></div><div class="muted" id="labelHint" aria-live="polite"></div>';
  var checkBox = r ? checkBoxHtml(r) : '';
  openSheet('<h2 style="margin-top:0">' + (r ? '' : 'Add ') + esc(K.label) + '</h2>' + checkBox + titleField +
    (dateType ? '<label for="rWhen">' + (kind === 'lab' ? 'Date of the test' : 'When') + '</label><input id="rWhen" type="' + (dateType === 'date' ? 'date' : 'datetime-local') + '" value="' + dateVal + '">' : '') +
    K.fields.map(field).join('') + extraFieldsHtml(fl.extra) +
    (r && Sync.enabled() ? extraPhotosSection(r.id, 'records') : (r ? '' : '<p class="muted">Save first, then attach photos or PDFs.</p>')) +
    '<div class="btn-row"><button class="btn writer-only" onclick="saveRecord(' + (r ? '\'' + r.id + '\'' : 'null') + ',\'' + kind + '\',' + (pid ? '\'' + pid + '\'' : 'null') + ')">Save</button><button class="btn ghost" onclick="closeSheet()">Close</button>' +
    (r ? '<button class="btn ghost" onclick="showHistory(\'records\',\'' + r.id + '\')">History</button><button class="btn danger writer-only" onclick="deleteRecord(\'' + r.id + '\')">Delete</button>' : '') + '</div>');
  if (r) photoDiffNotes(fl);
}
// Where a saved value no longer matches what the photo said, show the photo's reading under
// the box, so a change (fixing a misread, or a newer number) can be traced. History says who and when.
function photoDiffNotes(fl) {
  var fp = fl && fl.from_photo; if (!fp) return;
  var norm = function (v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' '); };
  var note = function (el, read) {
    if (!el || norm(el.value) === norm(read)) return;
    if (el.parentNode && el.parentNode.classList && el.parentNode.classList.contains('row')) el = el.parentNode; // e.g. phone + Check number
    el.insertAdjacentHTML('afterend', '<div class="muted photo-diff">&#128247; Photo read: &ldquo;' + esc(read || '(blank)') + '&rdquo;. Changed since; History shows who and when.</div>');
  };
  Object.keys(fp).forEach(function (k) { if (k !== 'extra') note(document.getElementById(k === 'title' ? 'rTitle' : 'rf-' + k), fp[k]); });
  (fp.extra || []).forEach(function (f) {
    var lab = Array.prototype.find.call(document.querySelectorAll('#sheetBody label[data-extra-label]'), function (l) { return l.getAttribute('data-extra-label') === f.label; });
    if (lab) note(document.getElementById(lab.getAttribute('for')), f.value);
  });
}
// A document's own details (pulled from the page), as editable label/value boxes.
function extraFieldsHtml(extra) {
  if (!extra || !extra.length) return '';
  return '<h3>Details from the page</h3>' + extra.map(function (f, i) {
    return '<label for="rx-' + i + '" data-extra-label="' + esc(f.label) + '">' + esc(f.label) + '</label><input id="rx-' + i + '" data-extra="' + i + '" value="' + esc(f.value) + '">';
  }).join('');
}
function readExtraFields() {
  var els = document.querySelectorAll('#sheetBody [data-extra]'); if (!els.length) return undefined;
  return Array.prototype.map.call(els, function (el) { var lab = document.querySelector('#sheetBody label[for="' + el.id + '"]'); return { label: lab ? lab.getAttribute('data-extra-label') : '', value: el.value.trim() }; }).filter(function (f) { return f.value; });
}
// Picking a known test fills its usual unit, if the unit box is still empty.
function fillLabUnit(test) { var u = LAB_UNITS[test], el = document.getElementById('rf-unit'); if (u && el && !el.value) el.value = u; }
function saveRecord(id, kind, pid) {
  var K = RECORD_KINDS[kind], title = document.getElementById('rTitle').value.trim();
  if (!title && kind !== 'update') return toast('Fill in "' + K.title + '" first');
  var fields = {};
  K.fields.forEach(function (f) {
    var el = document.getElementById('rf-' + f[0]); if (!el || f[2] === 'heading') return;
    if (f[2] === 'slots') {
      fields[f[0]] = Array.prototype.map.call(el.querySelectorAll('.chip.on'), function (c) { return c.dataset.v; }).join(',') || null;
      var st = {}; MED_SLOTS.forEach(function (s) { var t = document.getElementById('rf-st-' + s[0]); if (t && t.value) st[s[0]] = t.value; });
      fields.slot_times = st; return;
    }
    var v = el.value.trim();
    if (f[2] === 'number') fields[f[0]] = v === '' ? null : +v;
    else if (f[2] === 'datetime') fields[f[0]] = v ? new Date(v).toISOString() : null;
    else fields[f[0]] = v || null;
  });
  var ex = readExtraFields(); if (ex !== undefined) fields.extra = ex.length ? ex : null;
  var chk = S.phoneCheck;
  if (fields.phone && chk && chk.id === 'rf-phone' && chk.res.valid) { fields.phone = chk.res.national || fields.phone; fields.phone_e164 = chk.res.e164; fields.phone_type = chk.res.line_type; fields.phone_carrier = chk.res.carrier; }
  var whenEl = document.getElementById('rWhen'), when = whenEl && whenEl.value ? new Date(K.date === 'date' ? whenEl.value + 'T12:00:00' : whenEl.value).toISOString() : null;
  var write = id
    ? DB.update('records', id, function (cur) {
        if (!cur || cur.deleted) return null;
        var keep = cur.fields || {};
        if (fields.phone && fields.phone !== keep.phone && !fields.phone_e164) { delete keep.phone_e164; delete keep.phone_type; delete keep.phone_carrier; }
        cur.fields = Object.assign({}, keep, fields); cur.title = title; if (K.date) cur.occurred_at = when; return cur;
      })
    : DB.put('records', { kind: kind, for_profile_id: pid, title: title, occurred_at: K.date ? when : null, fields: fields });
  write.then(function (saved) {
    S.phoneCheck = null; toast(saved ? 'Saved' : 'This was deleted elsewhere');
    if (saved && kind === 'visit' && S.scribe && S.scribe.pendingClear) { scribeClear(); S.scribe = null; }
    return (!id && saved ? snapAfterSave(saved) : Promise.resolve()).then(loadAll).then(function () {
      if (!id && saved && Sync.enabled() && (kind === 'visit' || kind === 'document' || kind === 'lab')) { editRecord(saved.id); toast('Saved. Attach photos or PDFs below.'); }
      else closeSheet();
      refresh(); if (Sync.enabled()) syncNow();
    });
  }).catch(function (e) { toast('Could not save: ' + e.message); });
}
function deleteRecord(id) {
  if (!confirm('Delete this? It goes to Deleted for 30 days.')) return;
  DB.remove('records', id).then(function () { closeSheet(); return loadAll(); })
    .then(function () { refresh(); toast('Deleted', 'Undo', function () { restoreFromTrash('records', id); }); });
}

/* ---------- export for the doctor ---------- */
function fileExport(pid, prof) {
  return '<p class="muted">One page to print or save as a PDF (Share → Print → Save as PDF on most phones). Check it before handing it over.</p>' +
    '<div class="btn-row"><button class="btn" onclick="printExport(' + (pid ? '\'' + pid + '\'' : 'null') + ')">Print or save as PDF</button><button class="btn ghost" onclick="copyText(exportText(' + (pid ? '\'' + pid + '\'' : 'null') + '),\'Copied\')">Copy as text</button></div>' +
    '<div class="card export-preview">' + exportHtml(pid, prof) + '</div>';
}
function exportHtml(pid, prof) {
  prof = prof || State.profiles.find(function (p) { return p.id === pid; }) || { person_name: '' };
  var list = function (kind, fmt) { var rs = recordsOf(pid, [kind]); return rs.length ? '<ul>' + rs.map(function (r) { return '<li>' + fmt(r) + '</li>'; }).join('') + '</ul>' : '<p>None recorded.</p>'; };
  var f = function (r, k) { return esc((r.fields || {})[k] || ''); };
  var labs = {}; recordsOf(pid, ['lab']).sort(byDateDesc).forEach(function (r) { if (!labs[r.title]) labs[r.title] = r; });
  var visits = recordsOf(pid, ['visit']).filter(function (r) { return r.occurred_at <= new Date().toISOString(); }).sort(byDateDesc).slice(0, 3);
  var qs = visits.filter(function (v) { return (v.fields || {}).questions; }).map(function (v) { return '[' + fmtWhen(v.occurred_at) + ', from the ' + v.title + ' visit] ' + v.fields.questions; });
  return '<h2>' + esc(prof.person_name) + '</h2><p class="muted">Prepared ' + esc(localDay(new Date().toISOString())) + ' by the family from home records.</p>' +
    '<h3>Allergies</h3>' + list('allergy', function (r) { return '<b>' + esc(r.title) + '</b>' + (f(r, 'reaction') ? ': ' + f(r, 'reaction') : ''); }) +
    '<h3>Conditions</h3>' + list('condition', function (r) { return esc(r.title) + (f(r, 'since') ? ' (since ' + f(r, 'since') + ')' : ''); }) +
    '<h3>Medicines</h3>' + list('medication', function (r) { return '<b>' + esc(r.title) + '</b> ' + [f(r, 'dose'), esc(slotsText(r)), f(r, 'when'), f(r, 'with_food')].filter(Boolean).join(', ') + (f(r, 'prescriber') ? ' (' + f(r, 'prescriber') + ')' : '') + (r.fields && r.fields.stop && r.fields.stop < careToday() ? ' (stopped ' + f(r, 'stop') + ')' : ''); }) +
    '<h3>Care team</h3>' + list('contact', function (r) { return esc(r.title) + (f(r, 'role') ? ', ' + f(r, 'role') : '') + (f(r, 'phone') ? ' · ' + f(r, 'phone') : ''); }) +
    '<h3>Latest labs</h3>' + (Object.keys(labs).length ? '<table class="io-table"><tr><th>Test</th><th>Date</th><th>Result</th><th>Report range</th></tr>' + Object.keys(labs).map(function (t) { var r = labs[t], fl = r.fields || {}; return '<tr><td>' + esc(t) + '</td><td>' + esc(fmtWhen(r.occurred_at)) + '</td><td>' + esc(fl.value == null ? '' : fl.value) + ' ' + esc(fl.unit || '') + '</td><td>' + esc(fl.range_text || ((fl.low != null ? fl.low : '') + '–' + (fl.high != null ? fl.high : ''))) + '</td></tr>'; }).join('') + '</table>' : '<p>None recorded.</p>') +
    '<h3>Fluid in and out, last 7 days</h3><pre class="prewrap">' + esc(fluidsText(pid, careToday(), 7)) + '</pre>' +
    '<h3>Recent visits</h3>' + (visits.length ? '<ul>' + visits.map(function (v) { var fl = v.fields || {}; return '<li><b>' + esc(fmtWhen(v.occurred_at)) + ' · ' + esc(v.title) + '</b>' + (fl.changed ? ': ' + esc(fl.changed) : '') + '</li>'; }).join('') + '</ul>' : '<p>None recorded.</p>') +
    (qs.length || prof.notes ? '<h3>Questions and notes from the family</h3><p class="prewrap">' + esc(qs.concat(prof.notes ? [prof.notes] : []).join('\n')) + '</p>' : '') +
    '<p class="muted">Home records kept by the family. Not a medical record.</p>';
}
function exportText(pid) {
  // innerText only keeps line breaks for rendered elements, so render it off screen briefly.
  var div = document.createElement('div'); div.innerHTML = exportHtml(pid);
  div.style.cssText = 'position:absolute;left:-9999px;top:0;width:600px';
  document.body.appendChild(div);
  var text = div.innerText; div.remove();
  return text.replace(/\n{3,}/g, '\n\n').trim();
}
function printExport(pid) {
  var holder = document.getElementById('printArea');
  if (!holder) { holder = document.createElement('div'); holder.id = 'printArea'; document.body.appendChild(holder); }
  holder.innerHTML = exportHtml(pid);
  document.body.classList.add('printing');
  setTimeout(function () { window.print(); setTimeout(function () { document.body.classList.remove('printing'); }, 500); }, 50);
}

/* ---------- Kitchen: recipes and pantry under one tab ---------- */
function renderKitchen(arg) {
  var which = (arg && arg.tab) || S.kitchenTab || 'ideas'; S.kitchenTab = which;
  return '<div class="seg" role="tablist">' + [['ideas', 'Ideas'], ['recipes', 'Recipes'], ['pantry', 'Pantry']].map(function (t) { return '<button role="tab" aria-selected="' + (t[0] === which) + '" class="seg-btn' + (t[0] === which ? ' on' : '') + '" onclick="showScreen(\'kitchen\',{tab:\'' + t[0] + '\'})">' + t[1] + '</button>'; }).join('') + '</div>' +
    (which === 'pantry' ? renderPantry() : which === 'recipes' ? renderRecipes() : renderKitchenIdeas());
}

/* ---------- medicine labels (FDA) ---------- */
function toggleChip(btn) { btn.classList.toggle('on'); btn.setAttribute('aria-pressed', btn.classList.contains('on')); }
function slotsText(r) {
  var fl = r.fields || {}, on = String(fl.slots || '').split(',');
  var times = fl.slot_times || {};
  return MED_SLOTS.filter(function (s) { return on.indexOf(s[0]) >= 0; }).map(function (s) { return s[1].toLowerCase() + (times[s[0]] ? ' ' + times[s[0]] : ''); }).join(', ');
}
var LABEL_KEYS = [['label_boxed', 'boxed_warning'], ['label_how', 'how_to_take'], ['label_side', 'side_effects'], ['label_warn', 'warnings'], ['label_patients', 'for_patients'], ['label_older', 'older_adults']];
function labelHelp(fl) {
  return '<p class="muted">Official label text, shortened. It is written for everyone, so change or replace any of it with what her doctor or pharmacist said. Whatever is saved here is what the app shows.' +
    (fl.label_source ? ' Filled from <a href="' + esc(fl.label_source) + '" target="_blank" rel="noopener">the FDA label</a>' + (fl.label_date ? ' dated ' + esc(fl.label_date) : '') + '.' : '') + '</p>';
}
// Fills empty boxes; asks before replacing text that is already there.
function fillFromLabel() {
  var name = document.getElementById('rTitle').value.trim(), hint = document.getElementById('labelHint');
  if (!name) return toast('Type the medicine name first');
  if (!Sync.enabled()) return toast('Turn on sync in Settings to look up labels');
  hint.textContent = 'Looking up the label...';
  Sync.lookup('drug_label', name).then(function (d) {
    if (!d || !d.found) { hint.textContent = 'No FDA label found for "' + name + '". Try the generic name (furosemide, not Lasix 40).'; return; }
    var filled = LABEL_KEYS.filter(function (k) { return d[k[1]]; });
    var typed = filled.filter(function (k) { var el = document.getElementById('rf-' + k[0]); return el && el.value.trim() && el.value.trim() !== d[k[1]]; });
    var replace = !typed.length || confirm('Some label boxes already have text. Replace them with the FDA wording? Cancel keeps yours and fills only the empty ones.');
    filled.forEach(function (k) { var el = document.getElementById('rf-' + k[0]); if (el && (replace || !el.value.trim())) el.value = d[k[1]]; });
    document.getElementById('rf-label_source').value = d.source || ''; document.getElementById('rf-label_date').value = d.label_date || '';
    hint.textContent = 'Filled from the FDA label for ' + (d.generic || d.brand || name).toLowerCase() + (d.label_date ? ' (' + d.label_date + ')' : '') + '. Check it, edit anything, then Save.';
  }).catch(function (e) { hint.textContent = 'Could not look it up: ' + e.message; });
}
