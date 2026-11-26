/* Say it: quick entries by voice (or typing). "She drank 8 ounces of water", "gave her the
 * morning pills", "BP 142 over 80 pulse 70", "urine 300 ml dark yellow", "she ate half a
 * sandwich". The AI turns the words into entries; each one is shown as a plain sentence to
 * tick before anything is saved, and anything unclear starts unticked with the reason. */

function sayIt(pid) {
  S.say = { pid: pid || null, text: '', listening: false };
  var can = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  openSheet('<h2 style="margin-top:0">' + icon('mic') + ' Say it</h2>' +
    '<p>Say what happened, as you would tell family: <i>&ldquo;She drank 8 ounces of water,&rdquo;</i> <i>&ldquo;gave her the morning pills,&rdquo;</i> <i>&ldquo;BP 142 over 80, pulse 70,&rdquo;</i> <i>&ldquo;urine 300, dark yellow.&rdquo;</i> Several things at once is fine.</p>' +
    (can ? '<div class="btn-row"><button class="btn" id="sayMic" onclick="sayListen()">' + icon('mic') + ' Tap and talk</button></div>' : '<p class="muted">Tap the microphone on your keyboard to talk, or type.</p>') +
    '<div id="sayLive" class="muted" aria-live="polite"></div>' +
    '<label for="sayText">What you said (you can fix it)</label><textarea id="sayText" data-autosave rows="3" placeholder="She drank 8 ounces of water at 2"></textarea>' +
    '<div class="btn-row"><button class="btn writer-only" onclick="sayRun()">Make entries</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>' +
    '<div id="sayOut" aria-live="polite"></div>');
}
function sayListen() {
  var sa = S.say, Rec = window.SpeechRecognition || window.webkitSpeechRecognition; if (!sa || !Rec) return;
  if (sa.rec) { try { sa.rec.stop(); } catch (e) { /* stopped */ } return; }
  var rec = new Rec(); rec.lang = navigator.language || 'en-US'; rec.interimResults = true; rec.continuous = false;
  var btn = document.getElementById('sayMic'), live = document.getElementById('sayLive'), ta = document.getElementById('sayText');
  var base = ta ? ta.value.trim() : '';
  rec.onresult = function (ev) {
    var fin = '', interim = '';
    for (var i = 0; i < ev.results.length; i++) { if (ev.results[i].isFinal) fin += ev.results[i][0].transcript; else interim += ev.results[i][0].transcript; }
    if (ta) ta.value = (base ? base + ' ' : '') + (fin || interim);
    if (live) live.textContent = interim ? 'Hearing: ' + interim : '';
  };
  rec.onerror = function (ev) { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') toast('Allow the microphone for this app to listen'); };
  rec.onend = function () {
    sa.rec = null; if (btn) btn.innerHTML = icon('mic') + ' Tap and talk';
    if (live) live.textContent = '';
    if (ta && ta.value.trim() && ta.value.trim() !== base) sayRun(); // read it as soon as she stops talking
  };
  sa.rec = rec; if (btn) btn.innerHTML = '&#9209; Listening... tap to stop';
  try { rec.start(); } catch (e) { sa.rec = null; toast('Could not start listening: ' + e.message); }
}
function sayMeds(pid) {
  return recordsOf(pid, ['medication']).filter(function (r) { var f = r.fields || {}; return !(f.stop && f.stop < careToday()); })
    .map(function (r, i) { return { ref: 'm' + (i + 1), id: r.id, name: r.title, slots: (r.fields || {}).slots || '' }; });
}
function sayRun() {
  var sa = S.say, ta = document.getElementById('sayText'), text = ta ? ta.value.trim() : '';
  if (!sa) return;
  if (text.length < 3) return toast('Say or type what happened first');
  if (!Sync.enabled()) return toast('Turn on sync in Settings to use Say it');
  var meds = sayMeds(sa.pid); sa.meds = meds; sa.text = text;
  var out = document.getElementById('sayOut'); if (out) out.innerHTML = '<p>Making entries...</p>';
  Sync.brain('quick_log', { text: text.slice(0, 2000), now: localTime(new Date().toISOString()), meds: meds.map(function (m) { return { ref: m.ref, name: m.name, slots: m.slots }; }) })
    .then(function (d) { sayShow(d); })
    .catch(function (e) { var o = document.getElementById('sayOut'); if (o) o.innerHTML = '<p class="flag-text">Could not read it: ' + esc(e.message) + '</p>'; });
}

// One readable sentence per entry, so a person can check it at a glance.
function sayLine(it, meds) {
  var amt = it.amount != null ? it.amount + ' ' + (it.unit || '') : '';
  var at = it.time ? ' at ' + it.time : '';
  switch (it.type) {
    case 'drink': return icon('cup') + ' Drink: <b>' + esc(it.what || 'drink') + '</b>' + (amt ? ', ' + esc(amt.trim()) : ', <span class="flag-text">how much?</span>') + (it.portion != null && it.portion < 1 ? ', drank ' + Math.round(it.portion * 100) + '%' : '') + esc(at);
    case 'meal': return icon('meal') + ' Ate: <b>' + esc(it.what || 'food') + '</b>' + (it.portion != null && it.portion < 1 ? ', about ' + Math.round(it.portion * 100) + '% of it' : '') + esc(at);
    case 'output': return icon('output') + ' ' + esc(OUTPUT_TYPES[it.output_type] || 'Output') + (amt ? ': ' + esc(amt.trim()) : '') + (it.color ? ', ' + esc(colorName(it.color)) : '') + (it.clots ? ', <b>clots</b>' : '') + esc(at);
    case 'vital': return icon('vitals') + ' ' + esc((VITALS[it.vital_kind] || ['Reading'])[0]) + ' <b>' + esc(it.value) + (it.value2 != null ? '/' + esc(it.value2) : '') + '</b>' + (it.pulse != null ? ', pulse ' + esc(it.pulse) : '') + (it.rhythm ? ', ' + esc(rhythmName(it.rhythm)) : '') + esc(at);
    case 'weight': return icon('scale') + ' Weight <b>' + esc(it.value) + ' ' + esc(it.unit || State.weightUnit || 'lb') + '</b>' + esc(at);
    case 'dose': {
      var names = sayDoseTargets(it, meds).map(function (m) { return m.name; });
      return icon('pill') + ' ' + esc(names.length ? names.join(', ') : (it.what || 'medicine')) + ': <b>' + esc(it.status || 'given') + '</b>' + (it.slot ? ' (' + esc(slotName(it.slot).toLowerCase()) + ')' : '') + (it.note ? ', ' + esc(it.note) : '') + esc(at);
    }
    default: return icon('update') + ' Note: ' + esc(it.note || it.what || '');
  }
}
// "the morning pills" -> every medicine given in that slot; otherwise the one medicine named.
function sayDoseTargets(it, meds) {
  // ...leaving out any medicine named on its own ("but she refused the lisinopril").
  var named = ((S.say && S.say.items) || []).filter(function (x) { return x !== it && x.type === 'dose' && x.med_ref && x.med_ref !== 'all'; }).map(function (x) { return x.med_ref; });
  if (it.med_ref === 'all') return meds.filter(function (m) { return it.slot && String(m.slots).split(',').indexOf(it.slot) >= 0 && named.indexOf(m.ref) < 0; });
  var m = meds.find(function (x) { return x.ref === it.med_ref; });
  return m ? [m] : [];
}
function sayShow(d) {
  var sa = S.say, items = (d.items || []).filter(function (it) { return it && it.type; }); sa.items = items;
  var out = document.getElementById('sayOut'); if (!out) return;
  if (!items.length) { out.innerHTML = '<p class="flag-text">Nothing to log was found in that. ' + esc((d.unclear || []).join(' ')) + '</p>'; return; }
  out.innerHTML = '<h3>Check these, then save</h3>' + items.map(function (it, i) {
    var problem = it.unsure || (it.type === 'drink' && it.amount == null ? 'How much was not said.' : '') || (it.type === 'dose' && !sayDoseTargets(it, sa.meds).length ? 'Which medicine? None of her saved medicines matched.' : '');
    return '<label class="check card' + (problem ? ' attention' : '') + '"><input type="checkbox" id="sy' + i + '"' + (problem ? '' : ' checked') + '> ' + sayLine(it, sa.meds) +
      (problem ? '<div class="flag-text">' + esc(problem) + '</div>' : '') + '</label>';
  }).join('') +
    ((d.unclear || []).length ? '<p class="flag-text">Not sure about: ' + esc(d.unclear.join('; ')) + '. Fix the words above and tap Make entries again.</p>' : '') +
    '<div class="btn-row"><button class="btn" onclick="saySave()">Save ticked</button></div>' + aiWrongLink('quick_log');
}
// "14:30" today (or yesterday if that time has not come yet), else now.
function sayWhen(t) {
  var now = new Date(); if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return now.toISOString();
  var p = t.split(':'), d = new Date(now); d.setHours(+p[0], +p[1], 0, 0);
  if (d - now > 10 * 60000) d.setDate(d.getDate() - 1);
  return d.toISOString();
}
function sayMl(it) { var u = it.unit === 'ml' || it.unit === 'cup' ? it.unit : 'oz'; return it.amount > 0 ? Math.round(Logic.toMl(it.amount, u)) : null; }
function saySave() {
  var sa = S.say, pid = sa.pid, picks = (sa.items || []).filter(function (it, i) { var c = document.getElementById('sy' + i); return c && c.checked; });
  if (!picks.length) return toast('Nothing ticked');
  var saved = 0;
  var one = function (it) {
    var at = sayWhen(it.time);
    if (it.type === 'drink' || it.type === 'meal') {
      var drink = it.type === 'drink', what = it.what || (drink ? 'drink' : 'food');
      var e = { entry_kind: drink ? 'drink' : 'meal', eaten_at: at, free_text: what, volume_ml: drink ? sayMl(it) : null, portion_mult: it.portion > 0 && it.portion <= 1 ? it.portion : 1,
        for_profile_id: pid, recipe_id: null, estimate_source: 'estimate', eaten_note: it.note || null };
      if (drink && ZERO_CAL_DRINK.test(what)) { Logic.NUTRIENTS.forEach(function (k) { e[k] = 0; }); e.estimate_source = 'water'; e.confidence = 1; return DB.put('diary_entries', e); }
      return estimateEntry(e, { text: what + (it.portion > 0 && it.portion < 1 ? ' (ate about ' + Math.round(it.portion * 100) + '%)' : '') }).catch(function () { /* saved without an estimate */ }).then(function () { return DB.put('diary_entries', e); });
    }
    if (it.type === 'output') {
      var o = { entry_kind: 'output', output_type: it.output_type || 'urine', output_color: it.color || null, clots: !!it.clots, volume_ml: sayMl(it), eaten_note: it.note || null, eaten_at: at,
        for_profile_id: pid, free_text: OUTPUT_TYPES[it.output_type || 'urine'], recipe_id: null, estimate_source: 'output', confidence: null };
      Logic.NUTRIENTS.forEach(function (k) { o[k] = 0; });
      return DB.put('diary_entries', o);
    }
    if (it.type === 'vital' && VITALS[it.vital_kind]) return DB.put('measurements', { kind: it.vital_kind, value: +it.value, value2: it.value2 != null ? +it.value2 : null, unit: VITALS[it.vital_kind][1], taken_at: at, standard: false, note: it.note || 'Said by voice', for_profile_id: pid, pulse: it.pulse != null ? +it.pulse : null, rhythm: it.rhythm || null });
    if (it.type === 'weight') return DB.put('measurements', { kind: 'weight', value: +it.value, value2: null, unit: it.unit === 'kg' ? 'kg' : 'lb', taken_at: at, standard: new Date(at).getHours() < 11, note: it.note || 'Said by voice', for_profile_id: pid });
    if (it.type === 'dose') return sayDoseTargets(it, sa.meds).reduce(function (p, m) {
      var slot = it.slot || String(m.slots).split(',').filter(Boolean)[0] || 'prn';
      return p.then(function () { return saveDose(m.id, slot, pid, it.status || 'given', it.note || null, { at: at }); });
    }, Promise.resolve());
    return DB.put('records', { kind: 'update', for_profile_id: pid, title: '', occurred_at: at, fields: { text: it.note || it.what || '' } });
  };
  picks.reduce(function (p, it) { return p.then(function () { return one(it); }).then(function () { saved++; }); }, Promise.resolve())
    .then(function () { closeSheet(); return loadAll(); })
    .then(function () { refresh(); if (Sync.enabled()) syncNow(); toast(saved + ' entr' + (saved === 1 ? 'y' : 'ies') + ' saved'); })
    .catch(function (e) { toast('Could not save: ' + e.message); });
}
