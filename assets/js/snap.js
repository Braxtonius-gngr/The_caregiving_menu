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
  visit: 'an appointment card or reminder',
  contact: 'a care team list, business card or emergency plan',
  medlist: 'a list of her medicines',
  exercise: 'a therapy home exercise sheet'
};
var SNAP_MAX_TRIES = 3;
var SNAP_MAX_IMAGES = 6; // retakes plus extra pages of one document

function snapIt(pid, expect) {
  S.snap = { pid: pid || null, expect: expect || null, images: [] };
  openSheet('<h2 style="margin-top:0">&#128247; Snap it</h2>' +
    '<p>' + (expect && SNAP_KINDS[expect] ? 'Take a photo of ' + SNAP_KINDS[expect] + '.' : 'Take a photo of a cuff or meter screen, the scale, a pill bottle label, a lab report, an appointment card, a care team list or any paper worth keeping.') + ' The app reads it and fills in the form for you to check.</p>' +
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
    sn.images.push(img); if (sn.images.length > SNAP_MAX_IMAGES) sn.images.shift();
    if (sn.addingPage) sn.addingPage = false; else sn.tries = (sn.tries || 0) + 1;
    return Sync.brain('read_photo', { images: sn.images, expect: sn.expect ? SNAP_KINDS[sn.expect] : null });
  }).then(function (d) { snapResult(d); })
    .catch(function (e) { var o = document.getElementById('snapOut'); if (o) o.innerHTML = '<p class="flag-text">Could not read the photo: ' + esc(e.message) + '</p>'; });
}
function snapResult(d) {
  var sn = S.snap, out = document.getElementById('snapOut'); if (!sn) return;
  S.snapLast = d;
  if (d.kind === 'food_label' || d.kind === 'other') {
    var food = d.kind === 'food_label';
    return openSheet('<h2 style="margin-top:0">&#128247; Snap it</h2><p>' + esc(d.summary || '') + '</p>' +
      '<p>' + (food ? 'Food labels go in <b>Kitchen</b> &rarr; Pantry &rarr; Scan, which saves the nutrition facts.' : 'This does not look like a paper or screen the app reads. You can still keep it in Documents &rarr; Misc.') + '</p>' +
      snapButtons('Try another photo') + (food ? '<div class="btn-row"><button class="btn ghost" onclick="closeSheet();showScreen(\'kitchen\')">Open Kitchen</button></div>' : '<div class="btn-row"><button class="btn ghost" onclick="snapTeam(S.snapLast)">Keep it in Misc</button></div>') + '<div id="snapOut" aria-live="polite"></div>');
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
  // The paper seems to go on: ask for the next page before filling anything.
  if (d.more_pages && !sn.noMore && sn.images.length < SNAP_MAX_IMAGES) {
    return openSheet('<h2 style="margin-top:0">&#128196; Is there another page?</h2>' +
      '<p>' + esc(d.summary || '') + '</p>' +
      '<div class="card"><p><b>It looks like this continues' + (d.more_pages_hint ? ' (' + esc(d.more_pages_hint) + ')' : '') + '.</b> Add the next page so nothing is missed. Pages so far: ' + sn.images.length + '.</p></div>' +
      snapPageInputs() +
      '<div class="btn-row"><button class="btn" onclick="snapAddPage(\'cam\')">&#128247; Add the next page</button><button class="btn ghost" onclick="snapAddPage(\'lib\')">Choose a photo</button><button class="btn ghost" onclick="snapNoMore()">That&rsquo;s all, use what you have</button></div>' +
      '<div id="snapOut" aria-live="polite"></div>');
  }
  snapFill(d);
}
function snapPageInputs() {
  return '<input id="snapCam" type="file" accept="image/*" capture="environment" class="hidden" onchange="snapFile(this)"><input id="snapLib" type="file" accept="image/*" class="hidden" onchange="snapFile(this)">';
}
function snapAddPage(src) {
  var sn = S.snap; if (!sn) return;
  if (sn.images.length >= SNAP_MAX_IMAGES) return toast('Up to ' + SNAP_MAX_IMAGES + ' pages at a time. Save these, then snap the rest.');
  sn.addingPage = true; sn.noMore = false;
  var el = document.getElementById(src === 'lib' ? 'snapLib' : 'snapCam'); if (el) el.click();
}
function snapNoMore() { var sn = S.snap; if (!sn || !S.snapLast) return; sn.noMore = true; snapFill(S.snapLast); }
// On result sheets: add a page any time; the whole set is read again together.
function snapMorePagesRow() {
  var sn = S.snap || { images: [] };
  return snapPageInputs() + '<div class="btn-row"><button class="btn ghost sm" onclick="snapAddPage(\'cam\')">&#128196; Add another page</button><span class="muted">' + sn.images.length + ' page' + (sn.images.length === 1 ? '' : 's') + ' read</span></div><div id="snapOut" aria-live="polite"></div>';
}
// After a few unclear photos: open the right blank form.
function snapTypeIn() {
  var sn = S.snap || {}, e = sn.expect;
  if (e === 'weight') return logWeight();
  if (e === 'medication' || e === 'lab' || e === 'visit' || e === 'exercise') return editRecord(null, e, sn.pid);
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
  if (d.kind === 'care_team' || d.kind === 'document') return snapTeam(d);
  if (d.kind === 'med_list') return snapMeds(d);
  if (d.kind === 'therapy_plan') return snapExercises(d);
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

/* Care team sheet or a paper worth keeping: tick contacts to add to the Care team, and keep
 * the page itself as a Document with the photo attached. */
function snapNameKey(n) { return String(n || '').toLowerCase().replace(/\b(dr|md|do|np|rn)\b\.?/g, '').replace(/[^a-z0-9]/g, ''); }
function snapTeam(d) {
  var sn = S.snap, pid = sn.pid, doc = d.document || {}, facts = (doc.fields || []).filter(function (f) { return f && f.label && f.value; });
  var have = {}; recordsOf(pid, ['contact']).forEach(function (r) { have[snapNameKey(r.title)] = true; });
  var rows = (d.contacts || []).filter(function (c) { return c && c.name; });
  S.snapTeam = { rows: rows, doc: doc, summary: d.summary || '' };
  openSheet('<h2 style="margin-top:0">&#128247; From the photo</h2>' +
    '<p class="muted">' + esc(d.summary || '') + '</p>' +
    (rows.length ? '<h3>Add to the Care team</h3><p class="muted">Untick anything that looks wrong; you can edit each one later.' + (d.uncertain && d.uncertain.length ? ' Not clear: ' + esc(d.uncertain.join(', ')) + '.' : '') + '</p>' +
      rows.map(function (c, i) {
        var dup = have[snapNameKey(c.name)];
        return '<label class="check"><input type="checkbox" id="st' + i + '"' + (dup ? '' : ' checked') + '> <b>' + esc(c.name) + '</b> <span class="muted">' + esc(c.role || '') + '</span>' +
          (c.phone ? ' · ' + esc(c.phone) : '') + (c.fax ? ' · fax ' + esc(c.fax) : '') + (dup ? ' <span class="muted">(already in the Care team)</span>' : '') + '</label>';
      }).join('') : '') +
    '<h3>Keep the page</h3><label class="check"><input type="checkbox" id="stDoc" checked> Save it as a Document with the photo</label>' +
    '<label for="stTitle">Title</label><input id="stTitle" value="' + esc(doc.title || (d.kind === 'care_team' ? 'Care team sheet' : 'Document')) + '">' +
    (facts.length ? '<p class="muted">Details it found (you can edit them after saving):</p><ul>' + facts.map(function (f) { return '<li><b>' + esc(f.label) + ':</b> ' + esc(f.value) + '</li>'; }).join('') + '</ul>' : '') +
    '<label for="stDetails">What it says</label><textarea id="stDetails" rows="5">' + esc(doc.details || '') + '</textarea>' +
    snapMorePagesRow() +
    '<div class="btn-row"><button class="btn" onclick="saveSnapTeam()">Save</button><button class="btn ghost" onclick="snapIt(S.snap && S.snap.pid)">Retake</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>');
}
function saveSnapTeam() {
  var st = S.snapTeam || { rows: [], doc: {} }, sn = S.snap || {}, pid = sn.pid || null;
  var picks = st.rows.filter(function (c, i) { var el = document.getElementById('st' + i); return el && el.checked; });
  var keepDoc = document.getElementById('stDoc').checked, title = document.getElementById('stTitle').value.trim() || 'Document', details = document.getElementById('stDetails').value.trim();
  if (!picks.length && !keepDoc) return toast('Nothing checked');
  var chain = picks.reduce(function (p, c) {
    return p.then(function () { return DB.put('records', { kind: 'contact', for_profile_id: pid, title: c.name, occurred_at: null, fields: { role: c.role || null, phone: c.phone || null, fax: c.fax || null, address: c.address || null, notes: [c.notes, 'From a photo'].filter(Boolean).join('; ') } }); });
  }, Promise.resolve());
  if (keepDoc) chain = chain.then(function () {
    var dt = st.doc.date ? new Date(st.doc.date + 'T12:00:00').toISOString() : new Date().toISOString();
    var extra = (st.doc.fields || []).filter(function (f) { return f && f.label && f.value; }).map(function (f) { return { label: f.label, value: f.value }; });
    return DB.put('records', { kind: 'document', for_profile_id: pid, title: title, occurred_at: dt, fields: { doc_type: st.doc.doc_type || 'Other', notes: details || null, extra: extra.length ? extra : null } }).then(function (rec) { return snapKeepPhotos(rec); });
  });
  chain.then(function () { closeSheet(); return loadAll(); })
    .then(function () { refresh(); if (Sync.enabled()) syncNow(); toast((picks.length ? picks.length + ' contact(s) added' : '') + (picks.length && keepDoc ? ', ' : '') + (keepDoc ? 'page saved to Documents' : '')); })
    .catch(function (e) { toast('Could not save: ' + e.message); });
}

// Attach every page photo to a saved record.
function snapKeepPhotos(rec) {
  var imgs = (S.snap && S.snap.images) || [];
  if (!rec || !imgs.length) return Promise.resolve();
  return imgs.reduce(function (p, img, i) { return p.then(function () { return DB.put('entry_photos', { entry_id: rec.id, entry_store: 'records', photo_data: img, photo_path: null, pos: i, caption: null, mime: 'image/jpeg', file_name: null }); }); }, Promise.resolve());
}

/* A list of medicines (handwritten or printed). Every name is checked against the FDA label
 * database; anything the AI was unsure of, or that is not found, starts unticked with the name
 * editable, so nothing is added as a medicine without a person agreeing. */
function snapMedKey(n) { return String(n || '').toLowerCase().replace(/[^a-z]/g, ''); }
function snapMeds(d) {
  var sn = S.snap, pid = sn.pid, rows = (d.med_list || []).filter(function (m) { return m && (m.name || m.written); });
  if (!rows.length) return snapResult({ decision: 'retake', retake_reason: 'No medicine lines could be read.', retake_tip: 'Lay the list flat in good light and fill the frame with it.', summary: d.summary });
  var have = {}; recordsOf(pid, ['medication']).forEach(function (r) { have[snapMedKey((r.title || '').split(' ')[0])] = true; });
  S.snapMeds = rows;
  openSheet('<h2 style="margin-top:0">&#128138; Medicine list from the photo</h2>' +
    '<p class="muted">' + esc(d.summary || '') + ' Each name is checked against the FDA list. Ticked ones are added to her medicines; you then set when each is given.</p>' +
    rows.map(function (m, i) {
      var unsure = m.is_medicine !== 'yes', dup = have[snapMedKey((m.name || '').split(' ')[0])];
      return '<div class="card' + (unsure ? ' attention' : '') + '"><label class="check"><input type="checkbox" id="sm' + i + '"' + (unsure || dup ? '' : ' checked') + '> <b>Add</b></label>' +
        '<input id="smName' + i + '" value="' + esc(m.name || '') + '" aria-label="Medicine name">' +
        '<div class="muted">' + esc([m.strength, m.dose, m.when, m.notes].filter(Boolean).join(' · ')) + '</div>' +
        '<div class="muted">Written: &ldquo;' + esc(m.written || '') + '&rdquo;</div>' +
        (unsure ? '<p class="flag-text">' + (m.is_medicine === 'no' ? 'This may not be a medicine. ' : 'Not sure this is right. ') + esc(m.doubt || '') + '</p>' : '') +
        (dup ? '<p class="muted">Already in her medicines.</p>' : '') +
        '<div class="row"><span class="muted grow" id="smChk' + i + '">Checking the FDA list...</span><button type="button" class="btn sm ghost" onclick="snapCheckMed(' + i + ')">Check again</button></div></div>';
    }).join('') +
    snapMorePagesRow() +
    '<div class="btn-row"><button class="btn" onclick="saveSnapMeds()">Add ticked medicines</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>');
  rows.forEach(function (m, i) { snapCheckMed(i); });
}
function snapCheckMed(i) {
  var el = document.getElementById('smChk' + i), nm = document.getElementById('smName' + i), name = nm && nm.value.trim();
  if (!el) return;
  if (!name) { el.textContent = 'Type the name to check it.'; return; }
  el.textContent = 'Checking the FDA list...';
  Sync.lookup('drug_label', name).then(function (r) {
    var e2 = document.getElementById('smChk' + i); if (!e2) return;
    if (r && r.found) e2.innerHTML = '&#10003; Found: ' + esc(((r.generic || r.brand || name) + '').toLowerCase());
    else { e2.innerHTML = '<span class="flag-text">&#9888; Not found in the FDA list. Check the spelling, or ask the pharmacist.</span>'; var c = document.getElementById('sm' + i); if (c) c.checked = false; }
  }).catch(function () { var e3 = document.getElementById('smChk' + i); if (e3) e3.textContent = 'Could not check right now.'; });
}
function saveSnapMeds() {
  var rows = S.snapMeds || [], pid = S.snap && S.snap.pid, picks = [];
  rows.forEach(function (m, i) { var c = document.getElementById('sm' + i), n = document.getElementById('smName' + i); if (c && c.checked && n && n.value.trim()) picks.push({ m: m, name: n.value.trim() }); });
  if (!picks.length) return toast('Nothing ticked');
  picks.reduce(function (p, x) {
    return p.then(function () {
      var m = x.m;
      return DB.put('records', { kind: 'medication', for_profile_id: pid, title: x.name + (m.strength ? ' ' + m.strength : ''), occurred_at: null,
        fields: { dose: m.dose || null, when: m.when || null, notes: null, instructions: ['From a medicine list photo: "' + (m.written || '') + '"', m.notes].filter(Boolean).join('\n') } });
    });
  }, Promise.resolve()).then(function () { closeSheet(); return loadAll(); })
    .then(function () { refresh(); if (Sync.enabled()) syncNow(); toast(picks.length + ' medicine(s) added. Set when each is given in File → Summary.'); })
    .catch(function (e) { toast('Could not save: ' + e.message); });
}

/* A therapy home exercise sheet: tick exercises to keep under File -> Therapy, and keep the pages. */
function snapExercises(d) {
  var rows = (d.exercises || []).filter(function (x) { return x && x.name; }), doc = d.document || {};
  S.snapEx = { rows: rows, doc: doc };
  openSheet('<h2 style="margin-top:0">&#129336; Therapy exercises from the photo</h2>' +
    '<p class="muted">' + esc(d.summary || '') + ' Ticked exercises go to File &rarr; Therapy.</p>' +
    (rows.length ? rows.map(function (x, i) {
      return '<label class="check"><input type="checkbox" id="sx' + i + '" checked> <b>' + esc(x.name) + '</b> <span class="muted">' + esc([x.how, x.how_often].filter(Boolean).join(' · ')) + '</span>' + (x.notes ? '<div class="muted">' + esc(x.notes) + '</div>' : '') + '</label>';
    }).join('') : '<p>No exercises could be read clearly.</p>') +
    '<label for="sxFrom">From (therapist or clinic)</label><input id="sxFrom" value="' + esc(doc.title || '') + '">' +
    '<label class="check"><input type="checkbox" id="sxDoc" checked> Also keep the pages under Documents</label>' +
    snapMorePagesRow() +
    '<div class="btn-row"><button class="btn" onclick="saveSnapExercises()">Save</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>');
}
function saveSnapExercises() {
  var st = S.snapEx || { rows: [], doc: {} }, pid = S.snap && S.snap.pid, from = document.getElementById('sxFrom').value.trim();
  var picks = st.rows.filter(function (x, i) { var c = document.getElementById('sx' + i); return c && c.checked; });
  var keepDoc = document.getElementById('sxDoc').checked;
  if (!picks.length && !keepDoc) return toast('Nothing ticked');
  var chain = picks.reduce(function (p, x) {
    return p.then(function () { return DB.put('records', { kind: 'exercise', for_profile_id: pid, title: x.name, occurred_at: new Date().toISOString(), fields: { how: x.how || null, how_often: x.how_often || null, from: from || null, notes: x.notes || null, active: 'Yes' } }); });
  }, Promise.resolve());
  if (keepDoc) chain = chain.then(function () {
    return DB.put('records', { kind: 'document', for_profile_id: pid, title: 'Therapy exercises' + (from ? ' (' + from + ')' : ''), occurred_at: new Date().toISOString(), fields: { doc_type: 'Report', notes: st.doc.details || null } }).then(snapKeepPhotos);
  });
  chain.then(function () { closeSheet(); return loadAll(); })
    .then(function () { refresh(); if (Sync.enabled()) syncNow(); toast(picks.length + ' exercise(s) saved to File → Therapy'); })
    .catch(function (e) { toast('Could not save: ' + e.message); });
}

/* ---------- Fill from a photo: any form ----------
 * Every sheet with fields gets a "Fill from a photo" button. It sends the form's own field
 * list (id, label, type, options) with the photo; the AI fills only what it can read
 * clearly and asks for another photo otherwise. Filled fields are outlined so they get checked. */
var FORM_SNAP_SKIP = '[onclick*="snapIt"], #snapOut, [data-nosnap]';
var _openSheetPlain = openSheet;
openSheet = function (html) { _openSheetPlain(html); addFormSnap(); };

function formFields() {
  var body = document.getElementById('sheetBody'), out = [];
  Array.prototype.forEach.call(body.querySelectorAll('input[id], select[id], textarea[id]'), function (el) {
    var t = (el.type || el.tagName).toLowerCase();
    if (/^(hidden|file|checkbox|radio|button|submit)$/.test(t) || el.disabled || el.readOnly || el.offsetParent === null) return;
    var lab = body.querySelector('label[for="' + el.id + '"]'), text = lab ? lab.textContent : (el.getAttribute('aria-label') || el.placeholder || '');
    if (!text) { var prev = el.closest('.slot-time'); if (prev) text = prev.textContent; }
    var f = { id: el.id, label: text.trim().slice(0, 120), type: el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'long text' : t };
    if (el.placeholder && lab) f.label += ' (e.g. ' + el.placeholder + ')';
    if (el.tagName === 'SELECT') f.options = Array.prototype.map.call(el.options, function (o) { return o.textContent.trim(); }).filter(Boolean);
    out.push(f);
  });
  return out;
}
function addFormSnap() {
  var body = document.getElementById('sheetBody');
  S.formSnap = null;
  if (!body || body.querySelector(FORM_SNAP_SKIP) || !formFields().length) return;
  var h2 = body.querySelector('h2');
  var box = '<div class="form-snap writer-only"><button type="button" class="btn sm ghost" onclick="document.getElementById(\'fsCam\').click()">&#128247; Fill from a photo</button>' +
    '<button type="button" class="btn sm ghost" onclick="document.getElementById(\'fsLib\').click()" aria-label="Fill from a saved photo">&#128444;</button>' +
    '<input id="fsCam" type="file" accept="image/*" capture="environment" class="hidden" onchange="formSnapFile(this)"><input id="fsLib" type="file" accept="image/*" class="hidden" onchange="formSnapFile(this)">' +
    '<div id="fsOut" class="muted" aria-live="polite"></div></div>';
  if (h2) h2.insertAdjacentHTML('afterend', box); else body.insertAdjacentHTML('afterbegin', box);
}
function formSnapFile(input) {
  var f = input.files[0]; input.value = ''; if (!f) return;
  if (!Sync.enabled()) return toast('Turn on sync in Settings to read photos');
  var out = document.getElementById('fsOut'), h2 = document.querySelector('#sheetBody h2');
  var fs = S.formSnap || (S.formSnap = { images: [], tries: 0 });
  out.textContent = 'Reading the photo...';
  downscale(f, 1600).then(function (img) {
    fs.images.push(img); if (fs.images.length > SNAP_MAX_TRIES) fs.images.shift(); fs.tries++;
    return Sync.brain('fill_form', { images: fs.images, form: h2 ? h2.textContent : '', fields: formFields() });
  }).then(function (d) {
    var o = document.getElementById('fsOut'); if (!o) return;
    if (d.decision === 'retake') {
      o.innerHTML = '<div class="card attention"><b>One more photo, please.</b> ' + esc(d.retake_reason || 'Part of it was not clear.') + (d.retake_tip ? '<br>&#128161; ' + esc(d.retake_tip) : '') +
        '<br><span class="muted">' + (fs.tries >= SNAP_MAX_TRIES ? 'Still unclear after ' + fs.tries + ' photos; you can type it in.' : 'Your earlier photo is kept so they can be combined.') + '</span></div>';
      return;
    }
    var n = formSnapApply(d.values || []);
    o.innerHTML = '<div class="ok-note">&#128247; ' + esc(d.summary || '') + ' ' + (n ? 'Filled ' + n + ' field' + (n > 1 ? 's' : '') + ' (outlined). Check them before saving.' : 'Nothing on this form could be filled from it.') +
      (d.uncertain && d.uncertain.length ? ' Left blank (not clear): ' + esc(d.uncertain.join(', ')) + '.' : '') + '</div>';
  }).catch(function (e) { var o = document.getElementById('fsOut'); if (o) o.textContent = 'Could not read the photo: ' + e.message; });
}
function formSnapApply(values) {
  var n = 0;
  values.forEach(function (v) {
    var el = document.getElementById(v.id), val = v.value == null ? '' : String(v.value).trim();
    if (!el || !val || !document.getElementById('sheetBody').contains(el)) return;
    if (el.tagName === 'SELECT') {
      var opt = Array.prototype.find.call(el.options, function (o) { return o.value.toLowerCase() === val.toLowerCase() || o.textContent.trim().toLowerCase() === val.toLowerCase(); });
      if (!opt) return; el.value = opt.value;
    } else {
      if (el.type === 'number' && isNaN(+val)) return;
      el.value = val; if (el.value !== val && el.type !== 'number') return;
    }
    el.classList.add('snap-filled'); n++;
    // input only: some selects re-draw the whole form on change, which would wipe what was filled.
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return n;
}
