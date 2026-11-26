/* Ask her file: questions in plain words ("When did we change her furosemide?", "What is the
 * home health number?", "What did the nurse say last time?"), answered only from what is saved,
 * with numbered sources you can tap to open. Her name and the family's names are not sent;
 * care team names are, since they are often the answer. */

var ASK_SUGGEST = ['What did the nurse say at the last visit?', 'What is the home health office number?', 'Which medicines changed recently?', 'Has she refused any medicines this week?', 'What should we ask at her next appointment?', 'What is her Medicare number?'];

function renderAsk(arg) {
  var pid = (arg && arg.pid) || S.askPid || State.activeProfile || (State.profiles[0] && State.profiles[0].id) || null;
  S.askPid = pid; S.askLog = S.askLog || [];
  var prof = State.profiles.find(function (p) { return p.id === pid; }) || { person_name: '' };
  return '<div class="card"><h3>&#128172; Ask her file' + (prof.person_name ? ': ' + esc(prof.person_name) : '') + '</h3>' +
    '<p class="muted">Answers come only from what is saved in the app, with the entries they came from. If it is not in her file, it says so. It does not give medical advice.</p>' +
    '<textarea id="askQ" data-autosave rows="2" placeholder="Ask anything about her care, medicines, visits, numbers..."></textarea>' +
    '<div class="btn-row"><button class="btn" onclick="askRun()">Ask</button>' + ((window.SpeechRecognition || window.webkitSpeechRecognition) ? '<button class="btn ghost" onclick="askListen()">&#127908; Say it</button>' : '') + '</div>' +
    '<label class="muted" for="askCmp">Compare models (for testing)</label><select id="askCmp" onchange="S.askCmp=this.value"><option value="">Off</option><option value="sonnet"' + (S.askCmp === 'sonnet' ? ' selected' : '') + '>Opus vs Sonnet</option><option value="haiku"' + (S.askCmp === 'haiku' ? ' selected' : '') + '>Opus vs Haiku</option></select>' +
    '<div class="chips">' + ASK_SUGGEST.map(function (q) { return '<button class="chip" onclick="document.getElementById(\'askQ\').value=this.textContent;askRun()">' + esc(q) + '</button>'; }).join('') + '</div></div>' +
    '<div id="askOut" aria-live="polite"></div>' +
    S.askLog.filter(function (x) { return x.pid === pid; }).slice().reverse().map(askCard).join('');
}
function askListen() {
  var Rec = window.SpeechRecognition || window.webkitSpeechRecognition; if (!Rec) return;
  var rec = new Rec(); rec.lang = navigator.language || 'en-US'; rec.interimResults = true;
  var ta = document.getElementById('askQ');
  rec.onresult = function (ev) { var t = ''; for (var i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript; if (ta) ta.value = t; };
  rec.onend = function () { if (ta && ta.value.trim()) askRun(); };
  try { rec.start(); toast('Listening...'); } catch (e) { toast('Could not start listening'); }
}

// Everything saved about her, as numbered lines the AI must cite. Newest first within each kind.
function askFacts(pid) {
  var facts = [], add = function (text, open) { if (text) facts.push({ text: String(text).replace(/\s+/g, ' ').trim().slice(0, 1500), open: open || null }); };
  var prof = State.profiles.find(function (p) { return p.id === pid; }) || {};
  var reOf = function (names) { var n = names.filter(function (x) { return x && x.length > 2; }).map(function (x) { return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }); return n.length ? new RegExp('\\b(' + n.join('|') + ')\\b', 'gi') : null; };
  var herRe = reOf([prof.person_name]), famRe = reOf(Object.keys(State.memberNames || {}).map(function (k) { return State.memberNames[k]; }));
  var scrub = function (s) { s = String(s || ''); if (herRe) s = s.replace(herRe, 'her'); if (famRe) s = s.replace(famRe, 'a family member'); return s; };
  var recs = (State.records || []).filter(function (r) { return !r.deleted && (r.for_profile_id || null) === (pid || null); });
  var byNew = function (a, b) { return (a.occurred_at || a.updated_at || '') < (b.occurred_at || b.updated_at || '') ? 1 : -1; };
  var f = function (r, keys) { var fl = r.fields || {}; return keys.map(function (k) { return fl[k[0]] ? k[1] + ': ' + (typeof fl[k[0]] === 'object' ? JSON.stringify(fl[k[0]]) : fl[k[0]]) : ''; }).filter(Boolean).join('; '); };
  recs.filter(function (r) { return r.kind === 'medication'; }).forEach(function (r) {
    var fl = r.fields || {}, src = Logic.medSources(r).map(function (s) { return (s.label || s.type) + (s.date ? ' (' + s.date + ')' : '') + ': ' + [s.strength, s.said, s.dose, s.when].filter(Boolean).join(' '); }).join(' | ');
    add('Medicine ' + r.title + (fl.stop && fl.stop < careToday() ? ' (STOPPED ' + fl.stop + ')' : '') + '. ' + f(r, [['dose', 'dose'], ['slots', 'given'], ['with_food', 'food'], ['when', 'timing'], ['purpose', 'for'], ['prescriber', 'prescribed by'], ['pharmacy', 'pharmacy'], ['start', 'started'], ['refill_on', 'refill due'], ['instructions', 'instructions'], ['generic', 'generic']]) + (src ? '. Sources: ' + src : '') + (fl.check ? '. FLAGGED: ' + fl.check : '') + '. Last changed ' + localDay(r.updated_at || ''), r.id);
  });
  ['allergy', 'condition', 'directive'].forEach(function (k) { recs.filter(function (r) { return r.kind === k; }).forEach(function (r) { add((RECORD_KINDS[k] || {}).label + ': ' + r.title + '. ' + f(r, [['reaction', 'reaction'], ['severity', 'severity'], ['since', 'since'], ['kept', 'kept'], ['notes', 'notes']]), r.id); }); });
  recs.filter(function (r) { return r.kind === 'contact'; }).forEach(function (r) { add('Care team: ' + r.title + '. ' + f(r, [['role', 'role'], ['phone', 'phone'], ['fax', 'fax'], ['address', 'address'], ['portal', 'portal'], ['notes', 'notes']]) + ((r.fields || {}).check ? '. FLAGGED: ' + r.fields.check : '') + ((r.fields || {}).check_answer ? '. Answer: ' + JSON.stringify(r.fields.check_answer) : ''), r.id); });
  recs.filter(function (r) { return r.kind === 'visit'; }).sort(byNew).forEach(function (r) { add('Visit ' + localDay(r.occurred_at || '') + ' with ' + r.title + '. ' + scrub(f(r, [['where', 'where'], ['why', 'why'], ['said', 'said'], ['changed', 'changed'], ['meds_changed', 'medicines changed'], ['tests', 'tests'], ['next_appt', 'next appointment'], ['questions', 'questions']])) + ((r.fields || {}).transcript ? '. Notes: ' + scrub(r.fields.transcript).slice(0, 1200) : ''), r.id); });
  recs.filter(function (r) { return r.kind === 'lab'; }).sort(byNew).slice(0, 60).forEach(function (r) { add('Lab ' + localDay(r.occurred_at || '') + ': ' + r.title + ' ' + f(r, [['value', 'result'], ['unit', 'unit'], ['low', 'low'], ['high', 'high'], ['range_text', 'range'], ['notes', 'notes']]), r.id); });
  recs.filter(function (r) { return r.kind === 'document'; }).sort(byNew).forEach(function (r) { var fl = r.fields || {}; add('Document ' + localDay(r.occurred_at || '') + ': ' + r.title + ' (' + (fl.doc_type || 'Other') + '). ' + scrub(fl.notes || '') + (fl.extra ? ' Details: ' + fl.extra.map(function (x) { return x.label + ' = ' + x.value; }).join('; ') : ''), r.id); });
  recs.filter(function (r) { return r.kind === 'exercise'; }).forEach(function (r) { add('Therapy exercise: ' + r.title + '. ' + f(r, [['how', 'how'], ['how_often', 'how often'], ['from', 'from'], ['active', 'still doing'], ['notes', 'notes']]), r.id); });
  recs.filter(function (r) { return r.kind === 'event'; }).forEach(function (r) { add('Important day ' + localDay(r.occurred_at || '') + ': ' + r.title + '. ' + f(r, [['repeat', 'repeats'], ['notes', 'notes']]), r.id); });
  recs.filter(function (r) { return r.kind === 'update'; }).sort(byNew).slice(0, 40).forEach(function (r) { add('Family update ' + localDay(r.occurred_at || '') + ': ' + scrub((r.title ? r.title + '. ' : '') + ((r.fields || {}).text || '')), r.id); });
  // Doses, last 14 days: one line per day with anything not given spelled out.
  var since = new Date(Date.now() - 14 * 86400000).toISOString(), byDay = {};
  recs.filter(function (r) { return r.kind === 'dose' && r.occurred_at >= since; }).forEach(function (r) { var d = localDay(r.occurred_at), fl = r.fields || {}; (byDay[d] = byDay[d] || []).push(r.title + ' ' + (fl.status || 'given') + (fl.note ? ' (' + scrub(fl.note) + ')' : '') + ' ' + localTime(r.occurred_at)); });
  Object.keys(byDay).sort().reverse().forEach(function (d) { add('Doses marked ' + d + ': ' + byDay[d].join(', ')); });
  // Readings, last 30 days.
  (State.measurements || []).filter(function (m) { return !m.deleted && (m.for_profile_id || null) === (pid || null) && m.taken_at >= new Date(Date.now() - 30 * 86400000).toISOString(); })
    .sort(function (a, b) { return a.taken_at < b.taken_at ? 1 : -1; }).slice(0, 80)
    .forEach(function (m) { add('Reading ' + localDay(m.taken_at) + ' ' + localTime(m.taken_at) + ': ' + ((VITALS[m.kind] || ['Weight'])[0]) + ' ' + m.value + (m.value2 != null ? '/' + m.value2 : '') + ' ' + (m.unit || '') + (m.pulse != null ? ', pulse ' + m.pulse : '') + (m.rhythm ? ', ' + m.rhythm : '') + (m.note ? ' (' + scrub(m.note) + ')' : '')); });
  add(scrub(fluidsText(pid, careToday(), 14)));
  if (prof.notes) add('Family notes: ' + scrub(prof.notes));
  return facts;
}
function askRun() {
  var ta = document.getElementById('askQ'), q = ta ? ta.value.trim() : '', pid = S.askPid;
  if (q.length < 3) return toast('Type or say a question first');
  if (!Sync.enabled()) return toast('Turn on sync in Settings to ask questions');
  var facts = askFacts(pid), out = document.getElementById('askOut');
  if (!facts.length) return toast('Her file is empty so far');
  if (out) out.innerHTML = '<div class="card"><p><b>' + esc(q) + '</b></p><p class="muted">Looking through her file...</p></div>';
  var lines = facts.map(function (x, i) { return '[' + (i + 1) + '] ' + x.text; }).join('\n').slice(0, 90000);
  var cmp = S.askCmp, payload = { question: q.slice(0, 500), facts: lines, today: careToday() };
  var call = function (model) { return Sync.brain('ask_file', Object.assign({ try_model: model }, payload)); };
  (cmp ? Promise.all([call('opus'), call(cmp)]) : call(undefined).then(function (d) { return [d]; })).then(function (ds) {
    var at = new Date().toISOString(), items = ds.map(function (d, i) { return { pid: pid, q: q, d: d, facts: facts, at: at, label: cmp ? (i ? (cmp === 'sonnet' ? 'Sonnet' : 'Haiku') : 'Opus') : '' }; });
    items.forEach(function (it) { S.askLog.push(it); }); while (S.askLog.length > 20) S.askLog.shift();
    if (ta) ta.value = '';
    var o = document.getElementById('askOut'); if (o) o.innerHTML = items.map(askCard).join('') + aiWrongLink('ask_file');
  }).catch(function (e) { var o = document.getElementById('askOut'); if (o) o.innerHTML = '<p class="flag-text">Could not answer: ' + esc(e.message) + '</p>'; });
}
function askCard(x) {
  var d = x.d || {}, srcs = (d.sources || []).filter(function (n) { return x.facts[n - 1]; });
  return '<div class="card' + (d.found === false ? '' : ' ok-note') + '">' + (x.label ? '<p class="muted"><b>' + esc(x.label) + '</b>' + (d._cost_cents != null ? ' &middot; ' + (d._cost_cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 3 }) : '') + '</p>' : '') + '<p><b>' + esc(x.q) + '</b> <span class="muted">' + esc(localTime(x.at)) + '</span></p>' +
    '<p class="prewrap">' + esc(d.answer || '') + '</p>' +
    (d.found === false ? '<p class="muted">Not found in her file. Add it once you know (Snap it, Say it or a form), and it can be found next time.</p>' : '') +
    (d.ask_care_team && d.ask_care_team.length ? '<p><b>Ask her care team:</b></p><ul>' + d.ask_care_team.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '') +
    (srcs.length ? '<p class="muted">From:</p><ul class="ask-src">' + srcs.map(function (n) {
      var fct = x.facts[n - 1];
      return '<li>' + (fct.open ? '<a href="#" onclick="event.preventDefault();editRecord(\'' + fct.open + '\')">' + esc(fct.text.slice(0, 140)) + (fct.text.length > 140 ? '…' : '') + '</a>' : '<span class="muted">' + esc(fct.text.slice(0, 160)) + (fct.text.length > 160 ? '…' : '') + '</span>') + '</li>';
    }).join('') + '</ul>' : '') + '</div>';
}
