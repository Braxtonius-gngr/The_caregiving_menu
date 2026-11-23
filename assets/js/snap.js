/* Snap it: one photo reader for every source (cuff, meter, oximeter, thermometer, scale,
 * pill bottle, lab report, appointment card). The AI says what it is and reads it, but if
 * any number is unclear it asks for another photo instead of guessing. Retakes are sent
 * together with the earlier tries so it can combine them. Nothing saves without a person
 * checking the filled-in form. */

var SNAP_KINDS = {
  vitals: 'a blood pressure cuff, sugar meter, oxygen meter or thermometer screen',
  weight: 'a bathroom scale display',
  medication: 'a prescription bottle or pharmacy label',
  lab: 'a lab report',
  visit: 'an appointment card or reminder'
};
var SNAP_MAX_TRIES = 3;

function snapIt(pid, expect) {
  S.snap = { pid: pid || null, expect: expect || null, images: [] };
  openSheet('<h2 style="margin-top:0">&#128247; Snap it</h2>' +
    '<p>' + (expect && SNAP_KINDS[expect] ? 'Take a photo of ' + SNAP_KINDS[expect] + '.' : 'Take a photo of a cuff or meter screen, the scale, a pill bottle label, a lab report or an appointment card.') + ' The app reads it and fills in the form for you to check.</p>' +
    '<p class="muted">Fill the frame, avoid glare, hold still. If anything is unclear it will ask for another photo rather than guess.</p>' +
    snapButtons('Take photo') + '<div id="snapOut" aria-live="polite"></div>');
}
function snapButtons(label) {
  return '<div class="btn-row"><button class="btn" onclick="document.getElementById(\'snapCam\').click()">&#128247; ' + label + '</button><button class="btn ghost" onclick="document.getElementById(\'snapLib\').click()">Choose a photo</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>' +
    '<input id="snapCam" type="file" accept="image/*" capture="environment" class="hidden" onchange="snapFile(this)"><input id="snapLib" type="file" accept="image/*" class="hidden" onchange="snapFile(this)">';
}
function snapFile(input) {
  var f = input.files[0], sn = S.snap; if (!f || !sn) return;
  if (!Sync.enabled()) return toast('Turn on sync in Settings to read photos');
  var out = document.getElementById('snapOut'); if (out) out.innerHTML = '<p>Reading the photo...</p>';
  downscale(f, 1600).then(function (img) {
    sn.images.push(img); if (sn.images.length > SNAP_MAX_TRIES) sn.images.shift();
    sn.tries = (sn.tries || 0) + 1;
    return Sync.brain('read_photo', { images: sn.images, expect: sn.expect ? SNAP_KINDS[sn.expect] : null });
  }).then(function (d) { snapResult(d); })
    .catch(function (e) { var o = document.getElementById('snapOut'); if (o) o.innerHTML = '<p class="flag-text">Could not read the photo: ' + esc(e.message) + '</p>'; });
}
function snapResult(d) {
  var sn = S.snap, out = document.getElementById('snapOut'); if (!sn) return;
  if (d.kind === 'food_label' || d.kind === 'other') {
    var food = d.kind === 'food_label';
    return openSheet('<h2 style="margin-top:0">&#128247; Snap it</h2><p>' + esc(d.summary || '') + '</p>' +
      '<p>' + (food ? 'Food labels go in <b>Kitchen</b> &rarr; Pantry &rarr; Scan, which saves the nutrition facts.' : 'This does not look like something the app can file yet.') + '</p>' +
      snapButtons('Try another photo') + (food ? '<div class="btn-row"><button class="btn ghost" onclick="closeSheet();showScreen(\'kitchen\')">Open Kitchen</button></div>' : '') + '<div id="snapOut" aria-live="polite"></div>');
  }
  if (d.decision === 'retake') {
    var last = sn.tries >= SNAP_MAX_TRIES;
    return openSheet('<h2 style="margin-top:0">&#128247; One more photo, please</h2>' +
      '<div class="card attention"><p><b>' + esc(d.retake_reason || 'Part of it was not clear enough to read for sure.') + '</b></p>' +
      (d.retake_tip ? '<p>&#128161; ' + esc(d.retake_tip) + '</p>' : '') + '</div>' +
      (d.summary ? '<p class="muted">So far: ' + esc(d.summary) + '</p>' : '') +
      (last ? '<p class="muted">Still unclear after ' + sn.tries + ' photos. You can keep trying, or type it in.</p>' : '<p class="muted">Your earlier photo is kept, so it can combine the two.</p>') +
      snapButtons('Take another photo') +
      (last ? '<div class="btn-row"><button class="btn ghost" onclick="snapTypeIn()">Type it in instead</button></div>' : '') +
      '<div id="snapOut" aria-live="polite"></div>');
  }
  snapFill(d);
}
// After a few unclear photos: open the right blank form.
function snapTypeIn() {
  var sn = S.snap || {}, e = sn.expect;
  if (e === 'weight') return logWeight();
  if (e === 'medication' || e === 'lab' || e === 'visit') return editRecord(null, e, sn.pid);
  logVital(sn.pid);
}

var SNAP_VITAL = { bp_monitor: 'blood_pressure', glucose_meter: 'glucose', pulse_oximeter: 'oxygen', thermometer: 'temperature' };
function snapNote(d) {
  var h = '<div class="ok-note">&#128247; Filled in from the photo: ' + esc(d.summary || '') + '. Check every number before saving.' +
    (d.uncertain && d.uncertain.length ? ' Left blank (not clear): ' + esc(d.uncertain.join(', ')) + '.' : '') + '</div>';
  var body = document.getElementById('sheetBody'), h2 = body && body.querySelector('h2');
  if (h2) h2.insertAdjacentHTML('afterend', h);
}
function snapSet(id, v) { var el = document.getElementById(id); if (el && v != null && v !== '') el.value = v; }
function snapFill(d) {
  var sn = S.snap, pid = sn.pid, v = d.vitals || {};
  if (SNAP_VITAL[d.kind]) {
    var kind = SNAP_VITAL[d.kind];
    logVital(pid, kind);
    if (kind === 'blood_pressure') { snapSet('vVal', v.systolic); snapSet('vVal2', v.diastolic); } else snapSet('vVal', v.value);
    snapSet('vPulse', v.pulse);
    var rh = v.afib_symbol ? 'afib' : v.irregular_symbol ? 'irregular' : null, chip = rh && document.querySelector('#vRhythm [data-v="' + rh + '"]');
    if (chip && !chip.classList.contains('on')) chip.click();
    if (v.time_shown) snapSet('vNote', 'Screen showed ' + v.time_shown);
    return snapNote(d);
  }
  if (d.kind === 'scale') {
    return logWeight().then(function () {
      var w = d.weight || {};
      snapSet('wVal', w.value); if (w.unit) snapSet('wUnit', w.unit);
      var who = document.getElementById('wWho'); if (who && pid) who.value = pid;
      snapNote(d);
    });
  }
  if (d.kind === 'med_label') {
    var m = d.medication || {};
    editRecord(null, 'medication', pid);
    snapSet('rTitle', [m.name, m.strength].filter(Boolean).join(' '));
    var stock = [m.quantity ? 'Qty ' + m.quantity : '', m.refills ? 'Refills: ' + m.refills : '', m.filled_on ? 'Filled ' + m.filled_on : ''].filter(Boolean).join(' · ');
    snapSet('rf-instructions', [m.directions ? 'Label: ' + m.directions : '', m.warnings && m.warnings.length ? 'Label warnings: ' + m.warnings.join('; ') : '', stock].filter(Boolean).join('\n'));
    snapSet('rf-prescriber', m.prescriber); snapSet('rf-pharmacy', m.pharmacy);
    snapNote(d);
    var hint = document.getElementById('labelHint'); if (hint) hint.textContent = 'Set the dose and when to give it. "Fill from the FDA label" adds the official warnings.';
    return;
  }
  if (d.kind === 'lab_report') return snapLabs(d);
  if (d.kind === 'appointment') {
    var a = d.appointment || {};
    editRecord(null, 'visit', pid);
    snapSet('rTitle', a.with_whom);
    if (a.date) snapSet('rWhen', a.date + 'T' + (a.time || '09:00'));
    snapSet('rf-where', a.place); snapSet('rf-why', [a.reason, a.notes].filter(Boolean).join('. '));
    return snapNote(d);
  }
  snapResult({ kind: 'other', summary: d.summary });
}

/* Lab report: a checklist of the rows it read; checked rows become Lab results. */
function snapLabs(d) {
  var rows = (d.labs || []).filter(function (r) { return r.test && (r.value != null || r.value_text); });
  S.snapLabs = rows;
  if (!rows.length) return snapResult({ decision: 'retake', retake_reason: 'No results could be read clearly.', retake_tip: 'Lay the page flat in good light and fill the frame with the results table.', summary: d.summary });
  var today = localDay(new Date().toISOString());
  openSheet('<h2 style="margin-top:0">Lab results from the photo</h2>' +
    '<p class="muted">' + esc(d.summary || '') + ' Untick anything that looks wrong; you can edit each one later.' + (d.uncertain && d.uncertain.length ? ' Not clear enough to read: ' + esc(d.uncertain.join(', ')) + '.' : '') + '</p>' +
    '<label for="slDate">Date of the test</label><input id="slDate" type="date" value="' + esc(rows[0].date || today) + '">' +
    rows.map(function (r, i) {
      var range = r.low != null && r.high != null ? r.low + '–' + r.high : r.low != null ? 'over ' + r.low : r.high != null ? 'under ' + r.high : (r.range_text || '');
      return '<label class="check"><input type="checkbox" id="sl' + i + '" checked> <b>' + esc(r.test) + '</b> ' + esc(r.value != null ? r.value : r.value_text) + ' ' + esc(r.unit || '') + (range ? ' <span class="muted">(range ' + esc(range) + ')</span>' : '') + (r.flag ? ' <span class="flag-text">' + esc(r.flag) + '</span>' : '') + '</label>';
    }).join('') +
    '<div class="btn-row"><button class="btn" onclick="saveSnapLabs()">Save checked results</button><button class="btn ghost" onclick="snapIt(S.snap && S.snap.pid,\'lab\')">Retake</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>');
}
function saveSnapLabs() {
  var rows = S.snapLabs || [], pid = S.snap && S.snap.pid, day = document.getElementById('slDate').value || localDay(new Date().toISOString());
  var picks = rows.filter(function (r, i) { var c = document.getElementById('sl' + i); return c && c.checked; });
  if (!picks.length) return toast('Nothing checked');
  picks.reduce(function (p, r) {
    return p.then(function () {
      return DB.put('records', { kind: 'lab', for_profile_id: pid, title: r.test, occurred_at: new Date((r.date || day) + 'T12:00:00').toISOString(),
        fields: { value: r.value, unit: r.unit || LAB_UNITS[r.test] || null, low: r.low, high: r.high, range_text: r.range_text || (r.value == null ? r.value_text : null), notes: ['From a photo of the report', r.flag ? 'flagged ' + r.flag : ''].filter(Boolean).join('; ') } });
    });
  }, Promise.resolve()).then(function () { closeSheet(); return loadAll(); })
    .then(function () { refresh(); if (Sync.enabled()) syncNow(); toast(picks.length + ' result(s) saved'); })
    .catch(function (e) { toast('Could not save: ' + e.message); });
}
