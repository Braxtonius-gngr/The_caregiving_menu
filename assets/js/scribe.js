/* Scribe: notes for a visit (nurse, doctor, hospice, therapist). Either tell it what happened
 * (type, or use the keyboard's microphone) or let the phone listen to the whole visit and write
 * down what it hears. No audio is kept, only the words. The AI then pulls out the parts that
 * matter and fills in the Visit form for a person to check before saving. The words in progress
 * are saved on the phone as you go, so closing the sheet by accident loses nothing. */

var SCRIBE_KEY = 'tcm-scribe-draft';
var SCRIBE_MAX = 80000;

function scribeDraft() { try { return JSON.parse(localStorage.getItem(SCRIBE_KEY) || 'null'); } catch (e) { return null; } }
function scribeSave() {
  var sc = S.scribe, ta = document.getElementById('scribeText'); if (!sc) return;
  if (ta) sc.text = ta.value;
  try { localStorage.setItem(SCRIBE_KEY, JSON.stringify({ pid: sc.pid, text: sc.text || '', started: sc.started })); } catch (e) { /* storage full or blocked */ }
}
function scribeClear() { try { localStorage.removeItem(SCRIBE_KEY); } catch (e) { /* blocked */ } }
function scribeCanListen() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }

function scribeIt(pid) {
  var old = scribeDraft();
  S.scribe = { pid: pid || null, text: '', started: new Date().toISOString(), listening: false };
  if (old && old.text && (old.pid || null) === (pid || null)) { S.scribe.text = old.text; S.scribe.started = old.started || S.scribe.started; }
  scribeSheet();
}
function scribeSheet() {
  var sc = S.scribe, can = scribeCanListen();
  openSheet('<h2 style="margin-top:0" data-nosnap>&#127897; Scribe a visit</h2>' +
    '<p>Tell it what happened at the visit, or let it listen to the whole visit. Then it pulls out what matters (what they said, what changed, medicine changes, tests, next appointment, questions) and fills in the Visit form for you to check.</p>' +
    (can
      ? '<div class="btn-row"><button class="btn" id="scribeListenBtn" onclick="scribeToggle()">' + (sc.listening ? '&#9208; Pause listening' : '&#127897; Listen to the visit') + '</button></div>' +
        '<p class="muted">Ask first: tell the nurse or doctor you are taking notes with your phone. Some states require everyone&rsquo;s OK to record. No sound is saved, only the words. Keep the phone face up, near whoever is talking, with the app open.</p>'
      : '<p class="muted">Listening is not available in this browser. Type below, or tap the microphone on your keyboard to talk instead of typing.</p>') +
    '<div id="scribeLive" class="muted" aria-live="polite">' + (sc.listening ? 'Listening...' : '') + '</div>' +
    '<label for="scribeText">What happened (you can edit this)</label>' +
    '<textarea id="scribeText" rows="10" oninput="scribeSave()" placeholder="e.g. Nurse Pat came at 2. BP 142/80, lungs clear, ankles a little swollen. Stop the furosemide on Sundays, keep the rest. Lab draw next Tuesday. Call if weight up 3 lb in 2 days.">' + esc(sc.text || '') + '</textarea>' +
    '<div class="btn-row"><button class="btn writer-only" onclick="scribeRun()">Pull out the important parts</button><button class="btn ghost" onclick="closeSheet()">Close</button>' +
    (sc.text ? '<button class="btn ghost" onclick="scribeDiscard()">Start over</button>' : '') + '</div>' +
    '<div id="scribeOut" aria-live="polite"></div>');
  var ta = document.getElementById('scribeText'); if (ta) ta.scrollTop = ta.scrollHeight;
}
function scribeDiscard() {
  if (!confirm('Clear these notes and start over?')) return;
  scribeStop(); scribeClear(); S.scribe.text = ''; scribeSheet();
}

/* ---------- listening: the browser's speech recognition, restarted whenever it stops on its own ---------- */
function scribeToggle() { if (S.scribe && S.scribe.listening) scribeStop(); else scribeStart(); }
function scribeStart() {
  var sc = S.scribe, Rec = window.SpeechRecognition || window.webkitSpeechRecognition; if (!sc || !Rec) return;
  scribeSave();
  var rec = new Rec();
  rec.continuous = true; rec.interimResults = true; rec.lang = navigator.language || 'en-US';
  rec.onresult = function (ev) {
    var interim = '';
    for (var i = ev.resultIndex; i < ev.results.length; i++) {
      var t = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) {
        var ta = document.getElementById('scribeText'), cur = ta ? ta.value : (sc.text || '');
        sc.text = (cur ? cur.replace(/\s+$/, '') + (/[.!?]$/.test(cur.trim()) ? ' ' : '. ') : '') + t.trim();
        if (ta) { ta.value = sc.text; ta.scrollTop = ta.scrollHeight; }
        scribeSave();
      } else interim += t;
    }
    var live = document.getElementById('scribeLive'); if (live) live.textContent = interim ? 'Hearing: ' + interim : 'Listening...';
  };
  rec.onerror = function (ev) {
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { scribeStop(); toast('Allow the microphone for this app to listen'); }
  };
  rec.onend = function () { if (sc.listening && sc.rec === rec) { try { rec.start(); } catch (e) { scribeStop(); } } };
  sc.rec = rec; sc.listening = true;
  try { rec.start(); } catch (e) { sc.listening = false; return toast('Could not start listening: ' + e.message); }
  if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { sc.wake = l; }).catch(function () { /* screen may dim */ });
  scribeButtons();
}
function scribeStop() {
  var sc = S.scribe; if (!sc) return;
  sc.listening = false;
  if (sc.rec) { try { sc.rec.stop(); } catch (e) { /* already stopped */ } sc.rec = null; }
  if (sc.wake) { sc.wake.release().catch(function () {}); sc.wake = null; }
  scribeButtons();
}
function scribeButtons() {
  var b = document.getElementById('scribeListenBtn'), live = document.getElementById('scribeLive'), on = S.scribe && S.scribe.listening;
  if (b) b.innerHTML = on ? '&#9208; Pause listening' : '&#127897; ' + (S.scribe && S.scribe.text ? 'Keep listening' : 'Listen to the visit');
  if (live) live.textContent = on ? 'Listening...' : '';
}
// Closing the sheet stops listening; the words stay saved for next time.
var _closeSheetPlain = closeSheet;
closeSheet = function () { if (S.scribe && S.scribe.listening) { scribeSave(); scribeStop(); } _closeSheetPlain(); };

/* ---------- the AI pulls out what matters ---------- */
function scribeRun() {
  var sc = S.scribe; scribeSave();
  var text = (sc.text || '').trim();
  if (text.length < 15) return toast('Add a few words about the visit first');
  if (!Sync.enabled()) return toast('Turn on sync in Settings to use the scribe');
  scribeStop();
  var out = document.getElementById('scribeOut'); if (out) out.innerHTML = '<p>Reading the notes...</p>';
  var meds = recordsOf(sc.pid, ['medication']).map(function (r) { return r.title; }).filter(Boolean).slice(0, 60);
  Sync.brain('scribe', { text: text.slice(-SCRIBE_MAX), meds: meds, started: sc.started, today: localDay(new Date().toISOString()) })
    .then(function (d) { scribeFill(d, text); })
    .catch(function (e) { var o = document.getElementById('scribeOut'); if (o) o.innerHTML = '<p class="flag-text">Could not read the notes: ' + esc(e.message) + '. Your notes are still saved.</p>'; });
}
function scribeFill(d, text) {
  var sc = S.scribe, v = d.visit || {};
  editRecord(null, 'visit', sc.pid);
  var set = function (id, val) { var el = document.getElementById(id); if (el && val) { el.value = val; el.classList.add('snap-filled'); } };
  set('rTitle', v.who);
  if (v.when) set('rWhen', v.when);
  set('rf-where', v.where); set('rf-why', v.why); set('rf-said', v.said); set('rf-changed', v.changed);
  set('rf-meds_changed', v.meds_changed); set('rf-tests', v.tests); set('rf-next_appt', v.next_appt);
  set('rf-questions', v.questions); set('rf-transcript', text);
  var todo = (d.to_do || []).filter(Boolean), check = (d.double_check || []).filter(Boolean);
  var h = '<div class="ok-note">&#127897; Filled in from your notes: ' + esc(d.summary || '') + ' Check it before saving.</div>' +
    (check.length ? '<div class="card attention"><p><b>Double-check these</b> (unclear or possibly misheard):</p><ul>' + check.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></div>' : '') +
    (todo.length ? '<div class="card"><p><b>To do after this visit</b></p><ul>' + todo.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul><p class="muted">These are saved with the visit under "What changed". Medicine changes: update them in File &rarr; Summary too.</p></div>' : '');
  if (todo.length) { var ch = document.getElementById('rf-changed'); if (ch) { ch.value = (ch.value ? ch.value + '\n' : '') + 'To do: ' + todo.join('; '); ch.classList.add('snap-filled'); } }
  var body = document.getElementById('sheetBody'), h2 = body && body.querySelector('h2');
  if (h2) h2.insertAdjacentHTML('afterend', h);
  S.scribe.pendingClear = true;
}
