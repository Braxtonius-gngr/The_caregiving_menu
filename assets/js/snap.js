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
  openSheet('<h2 style="margin-top:0">' + icon('camera') + ' Snap it</h2>' +
    '<p>' + (expect && SNAP_KINDS[expect] ? 'Take a photo of ' + SNAP_KINDS[expect] + '.' : 'Take a photo of a cuff or meter screen, the scale, a pill bottle label, a lab report, an appointment card, a care team list or any paper worth keeping.') + ' The app reads it and fills in the form for you to check.</p>' +
    '<p class="muted">Fill the frame, avoid glare, hold still. If anything is unclear it will ask for another photo rather than guess.</p>' +
    snapButtons('Take photo') + '<div id="snapOut" aria-live="polite"></div>');
}
function snapButtons(label) {
  return '<div class="btn-row"><button class="btn" onclick="document.getElementById(\'snapCam\').click()">' + icon('camera') + ' ' + label + '</button><button class="btn ghost" onclick="document.getElementById(\'snapLib\').click()">Choose a photo</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>' +
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
    return openSheet('<h2 style="margin-top:0">' + icon('camera') + ' Snap it</h2><p>' + esc(d.summary || '') + '</p>' +
      '<p>' + (food ? 'Food labels go in <b>Kitchen</b> &rarr; Pantry &rarr; Scan, which saves the nutrition facts.' : 'This does not look like a paper or screen the app reads. You can still keep it in Documents &rarr; Misc.') + '</p>' +
      snapButtons('Try another photo') + (food ? '<div class="btn-row"><button class="btn ghost" onclick="closeSheet();showScreen(\'kitchen\')">Open Kitchen</button></div>' : '<div class="btn-row"><button class="btn ghost" onclick="snapTeam(S.snapLast)">Keep it in Misc</button></div>') + '<div id="snapOut" aria-live="polite"></div>');
  }
  if (d.decision === 'retake') {
    var last = sn.tries >= SNAP_MAX_TRIES;
    return openSheet('<h2 style="margin-top:0">' + icon('camera') + ' One more photo, please</h2>' +
      '<div class="card attention"><p><b>' + esc(d.retake_reason || 'Part of it was not clear enough to read for sure.') + '</b></p>' +
      (d.retake_tip ? '<p>' + icon('bulb') + ' ' + esc(d.retake_tip) + '</p>' : '') + '</div>' +
      (d.summary ? '<p class="muted">So far: ' + esc(d.summary) + '</p>' : '') +
      (last ? '<p class="muted">Still unclear after ' + sn.tries + ' photos. You can keep trying, or type it in.</p>' : '<p class="muted">Your earlier photo is kept, so it can combine the two.</p>') +
      snapButtons('Take another photo') +
      (last ? '<div class="btn-row"><button class="btn ghost" onclick="snapTypeIn()">Type it in instead</button></div>' : '') +
      '<div id="snapOut" aria-live="polite"></div>');
  }
  // The paper seems to go on: ask for the next page before filling anything.
  if (d.more_pages && !sn.noMore && sn.images.length < SNAP_MAX_IMAGES) {
    return openSheet('<h2 style="margin-top:0">' + icon('doc') + ' Is there another page?</h2>' +
      '<p>' + esc(d.summary || '') + '</p>' +
      '<div class="card"><p><b>It looks like this continues' + (d.more_pages_hint ? ' (' + esc(d.more_pages_hint) + ')' : '') + '.</b> Add the next page so nothing is missed. Pages so far: ' + sn.images.length + '.</p></div>' +
      snapPageInputs() +
      '<div class="btn-row"><button class="btn" onclick="snapAddPage(\'cam\')">' + icon('camera') + ' Add the next page</button><button class="btn ghost" onclick="snapAddPage(\'lib\')">Choose a photo</button><button class="btn ghost" onclick="snapNoMore()">That&rsquo;s all, use what you have</button></div>' +
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
  return snapPageInputs() + '<div class="btn-row"><button class="btn ghost sm" onclick="snapAddPage(\'cam\')">' + icon('doc') + ' Add another page</button><span class="muted">' + sn.images.length + ' page' + (sn.images.length === 1 ? '' : 's') + ' read</span></div><div id="snapOut" aria-live="polite"></div>';
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
  var h = '<div class="ok-note">' + icon('camera') + ' Filled in from the photo: ' + esc(d.summary || '') + '. Check every number before saving.' +
    (d.uncertain && d.uncertain.length ? ' Left blank (not clear): ' + esc(d.uncertain.join(', ')) + '.' : '') + '</div>';
  var body = document.getElementById('sheetBody'), h2 = body && body.querySelector('h2');
  if (h2) h2.insertAdjacentHTML('afterend', h);
  // If this fills a record form, its Save attaches the photo and keeps any doubt as a flag.
  S.snapPending = { check: d.uncertain && d.uncertain.length ? 'Not clear in the photo: ' + d.uncertain.join(', ') : null, photos: true, read: S.snapRead || {} };
}
function snapSet(id, v) { var el = document.getElementById(id); if (el && v != null && v !== '') { el.value = v; S.snapRead = S.snapRead || {}; S.snapRead[id] = String(v); } }
function snapFill(d) {
  var sn = S.snap, pid = sn.pid, v = d.vitals || {};
  S.snapRead = {};
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
    // Same medicine already saved (from a list, or an earlier bottle)? Offer to merge instead of a duplicate.
    var mm = d.medication || {}, o = document.getElementById('snapOut');
    if (o) o.innerHTML = '<p>Checking her medicines for this one...</p>';
    return snapGeneric(mm.name).then(function (g) {
      var ex = snapFindMed(pid, mm.name, g);
      if (ex) snapMergeBottle(d, ex, g); else snapNewBottle(d, g);
    });
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
    scrollList(rows.map(function (r, i) {
      var range = r.low != null && r.high != null ? r.low + '–' + r.high : r.low != null ? 'over ' + r.low : r.high != null ? 'under ' + r.high : (r.range_text || '');
      return '<label class="check"><input type="checkbox" id="sl' + i + '" checked> <b>' + esc(r.test) + '</b> ' + esc(r.value != null ? r.value : r.value_text) + ' ' + esc(r.unit || '') + (range ? ' <span class="muted">(range ' + esc(range) + ')</span>' : '') + (r.flag ? ' <span class="flag-text">' + esc(r.flag) + '</span>' : '') + '</label>';
    }), 6, true) +
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
  S.snapTeam = { rows: rows, facts: facts, doc: doc, summary: d.summary || '', uncertain: d.uncertain || [] };
  // Each box remembers what the photo said; editing one shows "Photo read: ..." right away.
  var box = function (id, label, val, cls) { return '<input id="' + id + '" class="' + (cls || '') + '" aria-label="' + label + '" placeholder="' + label + '" value="' + esc(val || '') + '" data-read="' + esc(val || '') + '" oninput="snapDiffHint(this)"><div class="muted photo-diff hidden" id="' + id + 'Diff"></div>'; };
  openSheet('<h2 style="margin-top:0">' + icon('camera') + ' From the photo</h2>' +
    '<p class="muted">' + esc(d.summary || '') + '</p>' +
    (rows.length ? '<h3>Add to the Care team</h3><p class="muted">Fix anything it misread right here, and untick old or wrong entries. What the photo said is kept with each one, so a change can be traced later.</p>' +
      (d.uncertain && d.uncertain.length ? '<div class="card attention"><p><b>Not clear in the photo</b></p><ul>' + d.uncertain.map(function (u) { return '<li>' + esc(u) + '</li>'; }).join('') + '</ul></div>' : '') +
      scrollList(rows.map(function (c, i) {
        var dup = have[snapNameKey(c.name)];
        return '<div class="card snap-row"><label class="check"><input type="checkbox" id="st' + i + '"' + (dup ? '' : ' checked') + '> <b>Add</b>' + (dup ? ' <span class="muted">(already in the Care team)</span>' : '') + '</label>' +
          box('stN' + i, 'Name', c.name) + box('stR' + i, 'Role', c.role) + box('stP' + i, 'Phone', c.phone) +
          (c.fax ? box('stF' + i, 'Fax', c.fax) : '') + '</div>';
      }), 6, true) : '') +
    '<h3>Keep the page</h3><label class="check"><input type="checkbox" id="stDoc" checked> Save it as a Document with the photo</label>' +
    '<label for="stTitle">Title</label><input id="stTitle" value="' + esc(doc.title || (d.kind === 'care_team' ? 'Care team sheet' : 'Document')) + '">' +
    (facts.length ? '<h3>Details it found</h3>' + facts.map(function (f, i) { return '<label for="sfV' + i + '">' + esc(f.label) + '</label>' + box('sfV' + i, f.label, f.value); }).join('') : '') +
    '<label for="stDetails">What it says</label><textarea id="stDetails" rows="5">' + esc(doc.details || '') + '</textarea>' +
    snapMorePagesRow() +
    '<div class="btn-row"><button class="btn" onclick="saveSnapTeam()">Save</button><button class="btn ghost" onclick="snapIt(S.snap && S.snap.pid)">Retake</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>');
}
function snapNorm(v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' '); }
function snapDiffHint(el) {
  var hint = document.getElementById(el.id + 'Diff'), read = el.getAttribute('data-read') || '';
  if (!hint) return;
  var changed = snapNorm(el.value) !== snapNorm(read);
  hint.classList.toggle('hidden', !changed);
  hint.textContent = changed ? 'Photo read: “' + (read || '(blank)') + '”. Your change is saved with a note.' : '';
}
function snapVal(id, fallback) { var el = document.getElementById(id); return el ? el.value.trim() : (fallback || ''); }
function saveSnapTeam() {
  var st = S.snapTeam || { rows: [], doc: {}, facts: [] }, sn = S.snap || {}, pid = sn.pid || null;
  var picks = [];
  st.rows.forEach(function (c, i) { var el = document.getElementById('st' + i); if (el && el.checked) picks.push({ c: c, name: snapVal('stN' + i, c.name), role: snapVal('stR' + i, c.role), phone: snapVal('stP' + i, c.phone), fax: snapVal('stF' + i, c.fax) }); });
  var keepDoc = document.getElementById('stDoc').checked, title = document.getElementById('stTitle').value.trim() || 'Document', details = document.getElementById('stDetails').value.trim();
  if (!picks.length && !keepDoc) return toast('Nothing checked');
  if (picks.some(function (x) { return !x.name; })) return toast('Every ticked row needs a name');
  var chain = picks.reduce(function (p, x) {
    var c = x.c;
    // Flag a contact the AI was unsure about (its name appears in the "not clear" list), unless the person already fixed it.
    var key = snapNameKey(c.name), doubt = (st.uncertain || []).filter(function (u) { var k = snapNameKey(u); return key && k && (k.indexOf(key) >= 0 || key.indexOf(k) >= 0); });
    var edited = snapNorm(x.name) !== snapNorm(c.name) || snapNorm(x.phone) !== snapNorm(c.phone);
    var check = doubt.length && !edited ? 'Not clear in the photo: ' + doubt.join(', ') + '. Check the name and number.' : (x.phone ? null : 'No phone number yet.');
    return p.then(function () {
      return DB.put('records', { kind: 'contact', for_profile_id: pid, title: x.name, occurred_at: null, fields: { role: x.role || null, phone: x.phone || null, fax: x.fax || null, address: c.address || null,
        notes: [c.notes, 'From a photo'].filter(Boolean).join('; '), check: check, from_photo: { title: c.name || '', role: c.role || '', phone: c.phone || '', fax: c.fax || '' } } });
    });
  }, Promise.resolve());
  if (keepDoc) chain = chain.then(function () {
    var dt = st.doc.date ? new Date(st.doc.date + 'T12:00:00').toISOString() : new Date().toISOString();
    var read = (st.facts || []).map(function (f) { return { label: f.label, value: f.value }; });
    var extra = read.map(function (f, i) { return { label: f.label, value: snapVal('sfV' + i, f.value) }; }).filter(function (f) { return f.value; });
    return DB.put('records', { kind: 'document', for_profile_id: pid, title: title, occurred_at: dt, fields: { doc_type: st.doc.doc_type || 'Other', notes: details || null, extra: extra.length ? extra : null,
      check: st.uncertain && st.uncertain.length ? 'Not clear in the photo: ' + st.uncertain.join(', ') : null, from_photo: { title: st.doc.title || '', extra: read } } }).then(function (rec) { return snapKeepPhotos(rec); });
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

/* ---------- Medicines: one entry per medicine, whatever the source ----------
 * A handwritten list and a pill bottle can describe the same medicine. Names are matched by
 * the first word or by the FDA generic name (Lasix = furosemide), so the second source is
 * added to the existing medicine instead of making a duplicate. Both photos are attached to it,
 * and a mismatch (list says 20 mg, bottle says 40 mg) is flagged for someone to check. */
function snapMedKey(n) { return String(n || '').toLowerCase().split(/[\s,(]/)[0].replace(/[^a-z]/g, ''); }
function snapGeneric(name) {
  if (!name) return Promise.resolve(null);
  return Sync.lookup('drug_label', name).then(function (r) {
    var g = r && r.found ? { generic: (r.generic || '').toLowerCase() || null, brand: (r.brand || '').toLowerCase() || null } : null;
    return g && snapGenericFits(name, g) ? g : null;
  }, function () { return null; });
}
// The FDA search returns its closest label, which can be a different product: "ezetimibe" finds
// "ezetimibe and simvastatin", "probiotic" finds a sunscreen. Accept it only when the brand is the
// name asked about, or every word of the generic name (salt words aside) is in what was asked.
var SNAP_SALT = /^(hydrochloride|hcl|besylate|calcium|sodium|potassium|magnesium|hemihydrate|monohydrate|dihydrate|tartrate|succinate|maleate|mesylate|citrate|sulfate|acetate|phosphate|bromide|fumarate|er|xr|sr|extended|release)$/;
function snapGenericFits(name, g) {
  var q = String(name || '').toLowerCase();
  return [g.brand, g.generic].some(function (n) {
    var words = String(n || '').split(/[\s,\/]+/).filter(function (w) { return w && !SNAP_SALT.test(w); });
    return words.length > 0 && words.every(function (w) { return w === 'and' ? / and |\/|\+/.test(q) : q.indexOf(w) >= 0; });
  });
}
// "AM", "PM", "bedtime", "as needed" written on a list -> the medicine's time slots (see MED_SLOTS).
function snapWhenSlots(w) {
  var s = String(w || '').toLowerCase(), out = [];
  if (/\b(am|a\.m\.|morning|breakfast|qam)\b/.test(s)) out.push('morning');
  if (/\b(noon|midday|lunch)\b/.test(s)) out.push('noon');
  if (/\b(pm|p\.m\.|evening|supper|dinner|qpm)\b/.test(s)) out.push('evening');
  if (/\b(bed|bedtime|hs|night)\b/.test(s)) out.push('bedtime');
  if (!out.length && /\b(twice a day|bid|2x a day|two times a day)\b/.test(s)) out.push('morning', 'evening');
  if (/\b(prn|as needed|when needed|if needed)\b/.test(s)) out.push('prn');
  return out.join(',');
}
// The name is the medicine; the strength goes in Dose ("100 mg", or "100 mg, 1 tablet").
function snapCap(n) { n = String(n || '').trim(); return n ? n.charAt(0).toUpperCase() + n.slice(1) : n; }
function snapDoseText(strength, dose) { return [String(strength || '').trim(), String(dose || '').trim()].filter(Boolean).join(', ') || null; }
// Adds the strength to a saved medicine's Dose when neither its name nor its dose has one.
function snapAddStrength(cur, strength) {
  var f = cur.fields = cur.fields || {};
  if (!strength || snapStrength(cur.title) || snapStrength(f.dose)) return;
  f.dose = snapDoseText(strength, f.dose);
}
function snapJoin(a, b, sep) { if (!b) return a || b || ''; if (!a) return b; return a.split(sep).indexOf(b) >= 0 ? a : a + sep + b; }
function snapUnionSlots(a, b) { var out = String(a || '').split(',').filter(Boolean); String(b || '').split(',').filter(Boolean).forEach(function (s) { if (out.indexOf(s) < 0) out.push(s); }); return out.join(','); }
// The same medicine and strength written in more than one place (an AM column and a PM column)
// is one medicine given at both times, not two medicines.
function snapMergeRows(rows) {
  var out = [], by = {};
  rows.forEach(function (m) {
    var nk = snapMedKey(m.name || m.written), k = nk + '|' + (snapStrength(m.strength) || snapStrength(m.written) || '');
    var c = nk && by[k];
    if (!c) { c = Object.assign({}, m); if (nk) by[k] = c; out.push(c); return; }
    c.when = snapJoin(c.when, m.when, ' and ');
    c.dose = snapJoin(c.dose, m.dose, ' / ');
    c.written = snapJoin(c.written, m.written, ' / ');
    c.notes = snapJoin(c.notes, m.notes, '; ');
    c.doubt = snapJoin(c.doubt, m.doubt, '; ');
    if (m.is_medicine !== 'yes') c.is_medicine = c.is_medicine === 'no' || m.is_medicine === 'no' ? 'no' : 'unsure';
    c.lines = (c.lines || 1) + 1;
  });
  return out;
}
function snapFindMed(pid, name, g) {
  var keys = [snapMedKey(name)];
  if (g) { if (g.generic) keys.push(snapMedKey(g.generic)); if (g.brand) keys.push(snapMedKey(g.brand)); }
  keys = keys.filter(Boolean);
  return recordsOf(pid, ['medication']).find(function (r) {
    var fl = r.fields || {};
    return [snapMedKey(r.title), snapMedKey(fl.generic)].some(function (k) { return k && keys.indexOf(k) >= 0; });
  }) || null;
}
// "40 mg", "0.5mg" -> "40mg"; null when no strength is written.
function snapStrength(t) { var m = String(t || '').toLowerCase().replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(mcg|mg|g|ml|units?|iu|%)/); return m ? (+m[1]) + m[2].replace(/s$/, '') : null; }
function snapAddCheck(old, add) { add = (add || []).filter(Boolean); if (!add.length) return old || null; return [old].concat(add).filter(Boolean).join('\n'); }

// A new medicine from a bottle: the usual form, with the photo attached and any doubts flagged on save.
function snapNewBottle(d, g) {
  var m = d.medication || {}, pid = S.snap.pid;
  editRecord(null, 'medication', pid);
  snapSet('rTitle', snapCap(m.name)); snapSet('rf-dose', snapDoseText(m.strength, null));
  var stock = [m.quantity ? 'Qty ' + m.quantity : '', m.refills ? 'Refills: ' + m.refills : '', m.filled_on ? 'Filled ' + m.filled_on : ''].filter(Boolean).join(' · ');
  snapSet('rf-instructions', [m.directions ? 'Label: ' + m.directions : '', m.warnings && m.warnings.length ? 'Label warnings: ' + m.warnings.join('; ') : '', stock].filter(Boolean).join('\n'));
  snapSet('rf-prescriber', m.prescriber); snapSet('rf-pharmacy', m.pharmacy); snapSet('rf-generic', g && g.generic);
  snapNote(d);
  S.snapPending.check = d.uncertain && d.uncertain.length ? 'Not clear on the bottle: ' + d.uncertain.join(', ') : null;
  S.snapPending.source = snapBottleSource(m);
  var hint = document.getElementById('labelHint'); if (hint) hint.textContent = 'Set the dose and when to give it. "Fill from the FDA label" adds the official warnings.';
}
function snapBottleSource(m) { return { type: 'bottle', label: 'Bottle', strength: m.strength || null, dose: null, when: null, said: m.directions || null, prescriber: m.prescriber || null, pharmacy: m.pharmacy || null, date: m.filled_on || localDay(new Date().toISOString()) }; }
// The bottle matches a medicine already saved: show both side by side and add the bottle to it.
function snapMergeBottle(d, ex, g) {
  var m = d.medication || {}, fl = ex.fields || {};
  var savedStr = snapStrength(ex.title) || snapStrength(fl.dose), bottleStr = snapStrength(m.strength) || snapStrength(m.name);
  var clash = savedStr && bottleStr && savedStr !== bottleStr;
  var row = function (label, a, b, bad) { return '<tr' + (bad ? ' class="flag-text"' : '') + '><th>' + label + '</th><td>' + esc(a || '—') + '</td><td>' + esc(b || '—') + '</td></tr>'; };
  S.snapMerge = { d: d, id: ex.id, g: g, clash: clash ? 'Strength differs: saved ' + savedStr + ', bottle ' + bottleStr + '. Check with the pharmacist which is right.' : null };
  openSheet('<h2 style="margin-top:0">' + icon('pill') + ' Same medicine as one already saved?</h2>' +
    '<p>This bottle looks like <b>' + esc(ex.title) + '</b>, already in her medicines' + (fl.instructions && /medicine list/.test(fl.instructions) ? ' (from the medicine list)' : '') + '.</p>' +
    (clash ? '<div class="card attention"><p><b>' + icon('alert') + ' ' + esc(S.snapMerge.clash) + '</b></p></div>' : '') +
    '<table class="cmp"><tr><th></th><th>Saved</th><th>Bottle</th></tr>' +
    row('Strength', savedStr || '', m.strength || '', clash) +
    row('Directions', [fl.dose, fl.when].filter(Boolean).join(', '), m.directions) +
    row('Prescriber', fl.prescriber, m.prescriber, fl.prescriber && m.prescriber && fl.prescriber.toLowerCase() !== m.prescriber.toLowerCase()) +
    row('Pharmacy', fl.pharmacy, m.pharmacy) + '</table>' +
    (d.uncertain && d.uncertain.length ? '<p class="flag-text">Not clear on the bottle: ' + esc(d.uncertain.join(', ')) + '</p>' : '') +
    '<p class="muted">Adding fills in what is missing, keeps the label wording in Instructions, attaches the bottle photo, and flags anything that does not match.</p>' +
    '<div class="btn-row"><button class="btn" onclick="saveMergeBottle()">Add to ' + esc(ex.title) + '</button><button class="btn ghost" onclick="snapNewBottle(S.snapMerge.d, S.snapMerge.g)">It&rsquo;s a different medicine</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>');
}
function saveMergeBottle() {
  var mg = S.snapMerge; if (!mg) return;
  var m = mg.d.medication || {}, unc = mg.d.uncertain || [];
  var stock = [m.quantity ? 'Qty ' + m.quantity : '', m.refills ? 'Refills: ' + m.refills : '', m.filled_on ? 'Filled ' + m.filled_on : ''].filter(Boolean).join(' · ');
  var label = ['Bottle label' + (m.filled_on ? ' (filled ' + m.filled_on + ')' : '') + ': ' + (m.directions || ''), m.warnings && m.warnings.length ? 'Label warnings: ' + m.warnings.join('; ') : '', stock].filter(Boolean).join('\n');
  DB.update('records', mg.id, function (cur) {
    if (!cur || cur.deleted) return null;
    var f = cur.fields = cur.fields || {};
    if (!f.prescriber && m.prescriber) f.prescriber = m.prescriber;
    if (!f.pharmacy && m.pharmacy) f.pharmacy = m.pharmacy;
    if (!f.generic && mg.g && mg.g.generic) f.generic = mg.g.generic;
    snapAddStrength(cur, m.strength);
    f.instructions = [f.instructions, label].filter(Boolean).join('\n');
    f.sources = (f.sources || []).concat([snapBottleSource(m)]);
    var pres = f.prescriber && m.prescriber && f.prescriber.toLowerCase() !== m.prescriber.toLowerCase() ? 'Prescriber differs: saved ' + f.prescriber + ', bottle ' + m.prescriber + '.' : null;
    f.check = snapAddCheck(f.check, [mg.clash, pres, unc.length ? 'Not clear on the bottle: ' + unc.join(', ') : null]);
    return cur;
  }).then(function (rec) { return snapKeepPhotos(rec); })
    .then(function () { closeSheet(); return loadAll(); })
    .then(function () { refresh(); if (Sync.enabled()) syncNow(); toast('Added to the saved medicine, with the bottle photo' + (mg.clash ? '. Flagged: strength differs' : '')); })
    .catch(function (e) { toast('Could not save: ' + e.message); });
}

/* A list of medicines (handwritten or printed). Every name is checked against the FDA label
 * database; anything the AI was unsure of, or that is not found, starts unticked with the name
 * editable, so nothing is added as a medicine without a person agreeing. Lines that match a
 * medicine already saved are added to it, not duplicated. */
function snapMeds(d) {
  var sn = S.snap, pid = sn.pid, rows = snapMergeRows((d.med_list || []).filter(function (m) { return m && (m.name || m.written); }));
  if (!rows.length) return snapResult({ decision: 'retake', retake_reason: 'No medicine lines could be read.', retake_tip: 'Lay the list flat in good light and fill the frame with it.', summary: d.summary });
  S.snapMeds = rows; S.snapListSource = d.list_source || 'handwritten list'; S.snapMedInfo = rows.map(function (m) { var ex = snapFindMed(pid, m.name, null); return { match: ex ? ex.id : null, g: null, found: null }; });
  openSheet('<h2 style="margin-top:0">' + icon('pill') + ' Medicine list from the photo</h2>' +
    '<p class="muted">' + esc(d.summary || '') + ' Each name is checked against the FDA list. Ticked lines become her medicines, or are added to the one already saved; you then set when each is given.</p>' +
    scrollList(rows.map(function (m, i) {
      var unsure = m.is_medicine !== 'yes';
      return '<div class="card' + (unsure ? ' attention' : '') + '"><label class="check"><input type="checkbox" id="sm' + i + '"' + (unsure ? '' : ' checked') + '> <b>Add</b></label>' +
        '<input id="smName' + i + '" value="' + esc(m.name || '') + '" aria-label="Medicine name" onchange="snapCheckMed(' + i + ')">' +
        '<div class="muted">' + esc([m.strength, m.dose, m.when, m.notes].filter(Boolean).join(' · ')) + '</div>' +
        '<div class="muted">Written: &ldquo;' + esc(m.written || '') + '&rdquo;' + (m.lines > 1 ? ' (on the list ' + m.lines + ' times: one medicine, given ' + esc(m.when || 'at each time') + ')' : '') + '</div>' +
        (unsure ? '<p class="flag-text">' + (m.is_medicine === 'no' ? 'This may not be a medicine. ' : 'Not sure this is right. ') + esc(m.doubt || '') + '</p>' : '') +
        '<p class="muted" id="smMatch' + i + '"></p>' +
        '<div class="row"><span class="muted grow" id="smChk' + i + '">Checking the FDA list...</span><button type="button" class="btn sm ghost" onclick="snapCheckMed(' + i + ')">Check again</button></div></div>';
    }), 6, true) +
    '<label class="check"><input type="checkbox" id="smDoc" checked> Also keep the list under Documents</label>' +
    snapMorePagesRow() +
    '<div class="btn-row"><button class="btn" onclick="saveSnapMeds()">Save ticked medicines</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>');
  rows.forEach(function (m, i) { snapShowMatch(i); snapCheckMed(i); });
}
function snapShowMatch(i) {
  var info = S.snapMedInfo[i], el = document.getElementById('smMatch' + i); if (!el) return;
  var ex = info.match && (State.records || []).find(function (r) { return r.id === info.match; });
  el.innerHTML = ex ? icon('link') + ' Matches <b>' + esc(ex.title) + '</b>, already saved: this line and the list photo will be added to it.' : '';
}
function snapCheckMed(i) {
  var el = document.getElementById('smChk' + i), nm = document.getElementById('smName' + i), name = nm && nm.value.trim(), info = S.snapMedInfo[i];
  if (!el) return;
  if (!name) { el.textContent = 'Type the name to check it.'; return; }
  el.textContent = 'Checking the FDA list...';
  snapGeneric(name).then(function (g) {
    var e2 = document.getElementById('smChk' + i); if (!e2) return;
    info.g = g; info.found = !!g;
    var ex = snapFindMed(S.snap && S.snap.pid, name, g); info.match = ex ? ex.id : null; snapShowMatch(i);
    if (g) e2.innerHTML = '&#10003; Found: ' + esc(g.generic || g.brand || name.toLowerCase());
    else { e2.innerHTML = '<span class="flag-text">' + icon('alert') + ' Not found in the FDA list. Check the spelling, or ask the pharmacist. (Vitamins and supplements are usually not on it; tick Add to keep it anyway.)</span>'; var c = document.getElementById('sm' + i); if (c) c.checked = false; }
  });
}
function saveSnapMeds() {
  var rows = S.snapMeds || [], pid = S.snap && S.snap.pid, picks = [];
  rows.forEach(function (m, i) { var c = document.getElementById('sm' + i), n = document.getElementById('smName' + i); if (c && c.checked && n && n.value.trim()) picks.push({ m: m, name: n.value.trim(), info: S.snapMedInfo[i] }); });
  var keepDoc = document.getElementById('smDoc').checked;
  if (!picks.length && !keepDoc) return toast('Nothing ticked');
  var added = 0, merged = 0, flagged = 0, ls = S.snapListSource || 'handwritten list', today = localDay(new Date().toISOString());
  var srcOf = function (m) { return { type: ls === 'discharge papers' ? 'discharge' : 'list', label: ls.charAt(0).toUpperCase() + ls.slice(1), strength: m.strength || null, dose: m.dose || null, when: m.when || null, said: m.written || null, date: today }; };
  var made = {};
  var chain = picks.reduce(function (p, x) {
    return p.then(function () {
      var m = x.m, info = x.info || {}, line = 'From the medicine list: "' + (m.written || x.name) + '"';
      var key = snapMedKey(x.name) + '|' + (snapStrength(m.strength) || ''), same = snapMedKey(x.name) && made[key];
      var slots = snapWhenSlots(m.when);
      if (same) {
        return DB.update('records', same, function (cur) {
          if (!cur || cur.deleted) return null;
          var f = cur.fields = cur.fields || {};
          f.when = snapJoin(f.when, m.when, ' and '); f.slots = snapUnionSlots(f.slots, slots) || null;
          f.instructions = [f.instructions, line].filter(Boolean).join('\n');
          f.sources = (f.sources || []).concat([srcOf(m)]);
          return cur;
        });
      }
      var doubts = [m.is_medicine !== 'yes' ? 'The list was hard to read here' + (m.doubt ? ': ' + m.doubt : '') + '. Confirm it is ' + x.name + '.' : null,
        info.found === false ? x.name + ' was not found in the FDA list. Check the spelling with the pharmacist.' : null];
      if (info.match) {
        return DB.update('records', info.match, function (cur) {
          if (!cur || cur.deleted) return null;
          var f = cur.fields = cur.fields || {}, savedStr = snapStrength(cur.title) || snapStrength(f.dose), listStr = snapStrength(m.strength);
          if (!f.dose && m.dose) f.dose = m.dose;
          if (!savedStr) snapAddStrength(cur, m.strength);
          if (!f.when && m.when) f.when = m.when;
          if (!f.slots && slots) { f.slots = slots; f.timing_source = 'From the ' + ls; }
          if (!f.generic && info.g && info.g.generic) f.generic = info.g.generic;
          f.instructions = [f.instructions, line].filter(Boolean).join('\n');
          f.sources = (f.sources || []).concat([srcOf(m)]);
          f.check = snapAddCheck(f.check, doubts.concat([savedStr && listStr && savedStr !== listStr ? 'Strength differs: saved ' + savedStr + ', ' + (ls === 'discharge papers' ? 'the discharge papers say ' : 'the list says ') + listStr + '. Check with the pharmacist which is right.' : null]));
          if (f.check) flagged++;
          return cur;
        }).then(function (rec) { merged++; if (rec && snapMedKey(x.name)) made[key] = rec.id; return snapKeepPhotos(rec); });
      }
      var check = snapAddCheck(null, doubts); if (check) flagged++;
      return DB.put('records', { kind: 'medication', for_profile_id: pid, title: snapCap(x.name), occurred_at: null,
        fields: { dose: snapDoseText(m.strength, m.dose), when: m.when || null, slots: slots || null, timing_source: slots ? 'From the ' + ls : null, generic: info.g && info.g.generic || null, instructions: [line, m.notes].filter(Boolean).join('\n'), check: check, sources: [srcOf(m)], from_photo: { title: snapCap(m.name), dose: snapDoseText(m.strength, m.dose) || '', when: m.when || '' } } })
        .then(function (rec) { added++; if (rec && snapMedKey(x.name)) made[key] = rec.id; return snapKeepPhotos(rec); });
    });
  }, Promise.resolve());
  if (keepDoc) chain = chain.then(function () {
    return DB.put('records', { kind: 'document', for_profile_id: pid, title: ls === 'discharge papers' ? 'Discharge medicine list' : 'Medicine list', occurred_at: new Date().toISOString(), fields: { doc_type: 'Other', notes: rows.map(function (m) { return m.written; }).filter(Boolean).join('\n') } }).then(snapKeepPhotos);
  });
  chain.then(function () { closeSheet(); return loadAll(); })
    .then(function () { refresh(); if (Sync.enabled()) syncNow(); toast([added ? added + ' added' : '', merged ? merged + ' added to ones already saved' : '', flagged ? flagged + ' flagged to double-check' : ''].filter(Boolean).join(', ') || 'Saved'); })
    .catch(function (e) { toast('Could not save: ' + e.message); });
}

/* ---------- Flags: anything uncertain waits for a person to confirm it ---------- */
// After a record form filled from a photo is saved: attach the photos and keep any doubt as a flag.
function snapAfterSave(rec) {
  var p = S.snapPending; S.snapPending = null;
  if (!p || !rec) return Promise.resolve();
  var chain = p.photos ? snapKeepPhotos(rec) : Promise.resolve();
  // Keep what the photo said next to what was saved, so later changes can be traced.
  var fp = {}; Object.keys(p.read || {}).forEach(function (id) { fp[id === 'rTitle' ? 'title' : id.replace(/^rf-/, '')] = p.read[id]; });
  if (p.check || p.source || Object.keys(fp).length) chain = chain.then(function () { return DB.update('records', rec.id, function (cur) { if (!cur) return null; cur.fields = cur.fields || {}; if (p.check) cur.fields.check = snapAddCheck(cur.fields.check, [p.check]); if (p.source) cur.fields.sources = (cur.fields.sources || []).concat([p.source]); if (Object.keys(fp).length) cur.fields.from_photo = fp; return cur; }); });
  return chain;
}
var _snapCloseSheet = closeSheet;
closeSheet = function () { var pend = S.snapPending; _snapCloseSheet(); if (pend === S.snapPending) S.snapPending = null; };
function checksFor(pid) { return (State.records || []).filter(function (r) { return !r.deleted && (r.for_profile_id || null) === (pid || null) && r.fields && r.fields.check; }); }
function todayChecks(pid) {
  var rs = checksFor(pid); if (!rs.length) return '';
  return '<div class="card"><h3>' + icon('question') + ' To double-check</h3><p class="muted">Read from photos or lists, but not certain. Tap one to check it and mark it done.</p>' +
    scrollList(rs.map(function (r) { return '<div class="list-item tappable" onclick="editRecord(\'' + r.id + '\')"><div class="grow"><b>' + esc(r.title || (RECORD_KINDS[r.kind] || {}).label || '') + '</b><div class="muted">' + esc(checkLine(r)) + '</div></div></div>'; }), 4) + '</div>';
}
/* Answering a flag: confirm what you can, keep the rest as a "maybe" that still needs approval.
 * fields.check_answer = { confirmed, maybe, at }. With nothing left unsure, the flag is cleared;
 * otherwise it stays open showing "Maybe: ... (needs approval)". History records who answered. */
function checkBoxHtml(r) {
  var f = r.fields || {}, a = f.check_answer || null, id = r.id;
  var ans = a && (a.confirmed || a.maybe) ? '<p>' + (a.confirmed ? '&#10003; <b>Confirmed:</b> ' + esc(a.confirmed) : '') + (a.confirmed && a.maybe ? '<br>' : '') + (a.maybe ? icon('question') + ' <b>Maybe:</b> ' + esc(a.maybe) + ' <span class="muted">(needs approval)</span>' : '') + (a.at ? ' <span class="muted">&middot; ' + esc(localDay(a.at)) + '</span>' : '') + '</p>' : '';
  if (!f.check) return ans ? '<div class="card ok-note">' + ans + '</div>' : '';
  return '<div class="card attention"><p><b>' + icon('question') + ' Please double-check</b></p><div class="prewrap">' + esc(f.check) + '</div>' + ans +
    '<details class="writer-only"><summary><b>Answer what you can</b></summary>' +
    '<label for="ckConf">What you can confirm</label><input id="ckConf" data-autosave value="' + esc((a && a.confirmed) || '') + '" placeholder="e.g. First name is Crystal">' +
    '<label for="ckMaybe">Still unsure (kept as a &ldquo;maybe&rdquo;)</label><input id="ckMaybe" data-autosave value="' + esc((a && a.maybe) || '') + '" placeholder="e.g. Last name, maybe Cannon">' +
    '<div class="btn-row"><button class="btn sm" onclick="saveCheckAnswer(\'' + id + '\')">Save answer</button></div>' +
    '<p class="muted">Leave &ldquo;still unsure&rdquo; empty when everything is confirmed; the flag then clears.</p></details>' +
    '<div class="btn-row"><button class="btn sm writer-only" onclick="clearCheck(\'' + id + '\')">Checked, all good</button></div></div>';
}
function saveCheckAnswer(id) {
  var conf = (document.getElementById('ckConf') || {}).value || '', maybe = (document.getElementById('ckMaybe') || {}).value || '';
  conf = conf.trim(); maybe = maybe.trim();
  if (!conf && !maybe) return toast('Type what you can confirm, or what is still unsure');
  DB.update('records', id, function (cur) {
    if (!cur) return null; cur.fields = cur.fields || {};
    cur.fields.check_answer = { confirmed: conf || null, maybe: maybe || null, at: new Date().toISOString() };
    if (!maybe) cur.fields.check = null;
    return cur;
  }).then(loadAll).then(function () { refresh(); if (Sync.enabled()) syncNow(); editRecord(id); toast(maybe ? 'Saved. The “maybe” stays on the To double-check list.' : 'Confirmed. Flag cleared.'); });
}
function checkLine(r) {
  var a = r.fields.check_answer;
  if (a && a.maybe) return 'Maybe: ' + a.maybe + ' (needs approval)' + (a.confirmed ? '. Confirmed: ' + a.confirmed : '');
  return String(r.fields.check).split('\n')[0];
}
function clearCheck(id) {
  DB.update('records', id, function (cur) { if (!cur) return null; cur.fields = cur.fields || {}; cur.fields.check = null; return cur; })
    .then(loadAll).then(function () { refresh(); if (Sync.enabled()) syncNow(); editRecord(id); toast('Marked as checked'); });
}

/* A therapy home exercise sheet: tick exercises to keep under File -> Therapy, and keep the pages. */
function snapExercises(d) {
  var rows = (d.exercises || []).filter(function (x) { return x && x.name; }), doc = d.document || {};
  S.snapEx = { rows: rows, doc: doc };
  openSheet('<h2 style="margin-top:0">' + icon('exercise') + ' Therapy exercises from the photo</h2>' +
    '<p class="muted">' + esc(d.summary || '') + ' Ticked exercises go to File &rarr; Therapy.</p>' +
    (rows.length ? scrollList(rows.map(function (x, i) {
      return '<label class="check"><input type="checkbox" id="sx' + i + '" checked> <b>' + esc(x.name) + '</b> <span class="muted">' + esc([x.how, x.how_often].filter(Boolean).join(' · ')) + '</span>' + (x.notes ? '<div class="muted">' + esc(x.notes) + '</div>' : '') + '</label>';
    }), 6, true) : '<p>No exercises could be read clearly.</p>') +
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
  var box = '<div class="form-snap writer-only"><button type="button" class="btn sm ghost" onclick="document.getElementById(\'fsCam\').click()">' + icon('camera') + ' Fill from a photo</button>' +
    '<button type="button" class="btn sm ghost" onclick="document.getElementById(\'fsLib\').click()" aria-label="Fill from a saved photo">' + icon('image') + '</button>' +
    '<input id="fsCam" type="file" accept="image/*" capture="environment" class="hidden" onchange="formSnapFile(this)"><input id="fsLib" type="file" accept="image/*" class="hidden" onchange="formSnapFile(this)">' +
    '<div id="fsOut" class="muted" aria-live="polite"></div></div>';
  if (h2) h2.insertAdjacentHTML('afterend', box); else body.insertAdjacentHTML('afterbegin', box);
}
function formSnapFile(input) {
  if (!aiNoticeSeen()) {
    if (!confirm('Photos are sent to our AI service (Anthropic) to fill in this form. Nothing is saved until you check it, and it is not medical advice. Continue?')) { input.value = ''; return; }
    try { localStorage.setItem('tcm-ai-notice', '1'); } catch (e) { /* blocked */ }
    recordConsent('ai_notice', { via: 'fill_from_photo' });
  }
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
      o.innerHTML = '<div class="card attention"><b>One more photo, please.</b> ' + esc(d.retake_reason || 'Part of it was not clear.') + (d.retake_tip ? '<br>' + icon('bulb') + ' ' + esc(d.retake_tip) : '') +
        '<br><span class="muted">' + (fs.tries >= SNAP_MAX_TRIES ? 'Still unclear after ' + fs.tries + ' photos; you can type it in.' : 'Your earlier photo is kept so they can be combined.') + '</span></div>';
      return;
    }
    var n = formSnapApply(d.values || []);
    o.innerHTML = '<div class="ok-note">' + icon('camera') + ' ' + esc(d.summary || '') + ' ' + (n ? 'Filled ' + n + ' field' + (n > 1 ? 's' : '') + ' (outlined). Check them before saving.' : 'Nothing on this form could be filled from it.') +
      (d.uncertain && d.uncertain.length ? ' Left blank (not clear): ' + esc(d.uncertain.join(', ')) + '.' : '') + '</div>' + aiWrongLink('fill_form');
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
