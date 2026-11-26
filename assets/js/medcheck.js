/* Compare her medicines (File -> Summary -> Compare sources). Lines up what each source says
 * about each medicine: the handwritten or printed list, discharge papers, the bottle, and what
 * was typed in. Mismatched strengths, possible duplicates (brand and generic saved twice),
 * medicines missing from a list or without a bottle, and anything flagged are shown first,
 * with a one-page printout to take to the pharmacist. No AI: this only compares what is saved. */

var MC_TYPE = { list: 'List', discharge: 'Discharge papers', bottle: 'Bottle', form: 'Typed in' };

function renderMedCheck(arg) {
  var pid = (arg && arg.pid) || S.filePid || State.activeProfile || null;
  S.medCheckPid = pid;
  var prof = State.profiles.find(function (p) { return p.id === pid; }) || { person_name: '' };
  var r = Logic.reconcileMeds(recordsOf(pid, ['medication']), careToday());
  var order = { bad: 0, warn: 1, info: 2 };
  var worst = function (x) { return x.issues.reduce(function (m, s) { return Math.min(m, order[s.level]); }, 3); };
  var items = r.items.slice().sort(function (a, b) { return worst(a) - worst(b) || (a.title || '').localeCompare(b.title || ''); });
  return '<div class="card"><h3>' + icon('pill') + ' Compare her medicines' + (prof.person_name ? ' (' + esc(prof.person_name) + ')' : '') + '</h3>' +
    '<p>Each medicine with what every source says: the medicine list, discharge papers, the bottle. Mismatches and possible duplicates are listed first. Take the printout to the pharmacist or doctor to sort them out.</p>' +
    (items.length ? '<p><b>' + items.length + '</b> medicine' + (items.length === 1 ? '' : 's') + ' &middot; <span class="' + (r.problems ? 'flag-text' : '') + '"><b>' + r.problems + '</b> to sort out</span></p>' : '') +
    '<div class="btn-row"><button class="btn" onclick="printMedCheck()">Print for the pharmacist</button><button class="btn ghost" onclick="copyText(medCheckText(), \'Copied\')">Copy as text</button><button class="btn ghost" onclick="snapIt(S.medCheckPid,\'medlist\')">' + icon('camera') + ' Snap a list or bottle</button></div></div>' +
    (items.length ? items.map(medCheckCard).join('') : '<p class="muted">No medicines saved yet. Snap her medicine list, the discharge papers or each bottle, and they show up here side by side.</p>');
}
function medCheckCard(x) {
  var bad = x.issues.filter(function (s) { return s.level !== 'info'; }), info = x.issues.filter(function (s) { return s.level === 'info'; });
  return '<div class="card' + (bad.length ? ' attention' : '') + '"><div class="row between"><b>' + esc(x.title) + '</b><button class="btn sm ghost" onclick="editRecord(\'' + x.id + '\')">Open</button></div>' +
    (x.also && x.also.length ? '<div class="muted">Also saved as: ' + esc(x.also.join(', ')) + '</div>' : '') +
    (x.generic && Logic.medStrength(x.generic) === null && x.title.toLowerCase().indexOf(x.generic) < 0 ? '<div class="muted">Generic: ' + esc(x.generic) + '</div>' : '') +
    (bad.length ? '<ul class="mc-issues">' + bad.map(function (s) { return '<li class="' + (s.level === 'bad' ? 'flag-text' : '') + '">' + esc(s.text) + '</li>'; }).join('') + '</ul>' : '<p class="muted">&#10003; Sources agree.</p>') +
    (x.sources.length ? '<table class="cmp"><tr><th>Source</th><th>Strength</th><th>What it says</th></tr>' + x.sources.map(function (s) {
      return '<tr><td>' + esc(s.label || MC_TYPE[s.type] || s.type) + (s.date ? '<div class="muted">' + esc(s.date) + '</div>' : '') + '</td><td>' + esc(s.strength || Logic.medStrength(s.said) || '—') + '</td><td>' + esc([s.said, s.dose, s.when].filter(Boolean).join(' · ') || '—') + '</td></tr>';
    }).join('') + '</table>' : '<p class="muted">Typed in by hand; no list or bottle saved for it yet.</p>') +
    (info.length ? '<p class="muted">' + info.map(function (s) { return esc(s.text); }).join(' ') + '</p>' : '') +
    '<p class="writer-only"><button class="linkish" onclick="mergeMedSheet(\'' + x.id + '\')">Same medicine as another entry? Merge them</button></p></div>';
}
function medCheckText() {
  var pid = S.medCheckPid, prof = State.profiles.find(function (p) { return p.id === pid; }) || { person_name: '' };
  var r = Logic.reconcileMeds(recordsOf(pid, ['medication']), careToday());
  return ['Medicines for ' + prof.person_name + ', compared across sources (' + localDay(new Date().toISOString()) + ')', ''].concat(r.items.map(function (x) {
    return '- ' + x.title + '\n' + x.sources.map(function (s) { return '    ' + (s.label || MC_TYPE[s.type]) + ': ' + [s.strength, s.said, s.dose, s.when].filter(Boolean).join(' · '); }).join('\n') +
      (x.issues.length ? '\n' + x.issues.map(function (s) { return '    ' + (s.level === 'info' ? 'Note: ' : 'CHECK: ') + s.text; }).join('\n') : '');
  })).join('\n');
}
function printMedCheck() {
  var holder = document.getElementById('printArea');
  if (!holder) { holder = document.createElement('div'); holder.id = 'printArea'; document.body.appendChild(holder); }
  var pid = S.medCheckPid, prof = State.profiles.find(function (p) { return p.id === pid; }) || { person_name: '' };
  var r = Logic.reconcileMeds(recordsOf(pid, ['medication']), careToday());
  holder.innerHTML = '<h2>Medicines: ' + esc(prof.person_name) + '</h2><p>Compared across her medicine list, discharge papers and bottles, ' + esc(localDay(new Date().toISOString())) + '. Prepared by the family; please help us correct anything marked CHECK.</p>' +
    r.items.map(function (x) {
      return '<h3>' + esc(x.title) + '</h3>' + (x.sources.length ? '<ul>' + x.sources.map(function (s) { return '<li>' + esc((s.label || MC_TYPE[s.type]) + ': ' + [s.strength, s.said, s.dose, s.when].filter(Boolean).join(' · ')) + '</li>'; }).join('') + '</ul>' : '') +
        x.issues.filter(function (s) { return s.level !== 'info'; }).map(function (s) { return '<p><b>CHECK:</b> ' + esc(s.text) + '</p>'; }).join('');
    }).join('') + '<p>Questions for the pharmacist:</p><ul><li>Which strength is right where the sources differ?</li><li>Are any of these the same medicine twice?</li><li>Is there anything she should no longer take?</li></ul>';
  document.body.classList.add('printing');
  setTimeout(function () { window.print(); setTimeout(function () { document.body.classList.remove('printing'); }, 500); }, 50);
}

/* ---------- Merge two saved medicines by hand ----------
 * For when the duplicate check did not catch that two entries are one medicine (a brand the FDA
 * lookup missed, a misspelling). The other entry's doses, photos, sources and times move into
 * this one and it goes to Deleted for 30 days. When the check had not paired them, the merge was
 * forced: a short note (the two names, generics and strengths) goes to Reports so the matching
 * can be improved. The family can untick that. */
function mergeMedOthers(id) {
  var keep = (State.records || []).find(function (r) { return r.id === id; }), day = careToday();
  if (!keep) return [];
  return recordsOf(keep.for_profile_id || null, ['medication']).filter(function (r) { var f = r.fields || {}; return r.id !== id && !r.deleted && !(f.stop && f.stop < day); })
    .sort(function (a, b) { return (a.title || '').localeCompare(b.title || ''); });
}
function mergeMedSheet(id) {
  var keep = (State.records || []).find(function (r) { return r.id === id; }), others = mergeMedOthers(id);
  if (!keep) return;
  if (!others.length) return toast('There is no other medicine saved to merge with');
  var dup = others.find(function (r) { return Logic.medSame(Logic.medBrief(keep), Logic.medBrief(r)); });
  S.mergeMed = id;
  openSheet('<h2 style="margin-top:0" data-nosnap>Same medicine saved twice?</h2>' +
    '<p class="muted">Pick the entry that is the same medicine as <b>' + esc(keep.title) + '</b>. Its doses, photos, sources and times move into ' + esc(keep.title) + ', and it goes to Deleted, where it can be brought back for 30 days.</p>' +
    '<label for="mmOther">The same medicine as ' + esc(keep.title) + '</label><select id="mmOther" onchange="mergeMedPick()">' + others.map(function (r) {
      return '<option value="' + r.id + '"' + (dup && dup.id === r.id ? ' selected' : '') + '>' + esc([r.title, (r.fields || {}).dose].filter(Boolean).join(' · ')) + '</option>';
    }).join('') + '</select>' +
    '<div id="mmNote" aria-live="polite"></div>' +
    '<p class="note">Only merge when you are sure, from the bottle or the pharmacist, that both are the same medicine. Two different medicines merged into one could hide a dose.</p>' +
    '<div class="btn-row"><button class="btn" onclick="mergeMedSave()">Merge into ' + esc(keep.title) + '</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>');
  mergeMedPick();
}
// Shows what the merge will flag, and the note to the app maker when the app had not caught the pair.
function mergeMedPick() {
  var keep = (State.records || []).find(function (r) { return r.id === S.mergeMed; }), drop = (State.records || []).find(function (r) { return r.id === document.getElementById('mmOther').value; });
  var box = document.getElementById('mmNote'); if (!keep || !drop || !box) return;
  var m = Logic.mergeMeds(keep, drop);
  box.innerHTML = (m.clash ? '<div class="note flag">' + esc(m.clash) + '</div>' : '') +
    (m.caught ? '' : '<label class="check"><input type="checkbox" id="mmTell" checked> Tell the app maker the app missed this</label>' +
      '<p class="muted">Sends only the two names, generic names and strengths, so the app can learn to catch this pair by itself. The family&rsquo;s owners can see it in Settings.' + (Sync.enabled() ? '' : ' It is sent the next time this device syncs.') + '</p>');
}
function mergeMedSave() {
  var keepId = S.mergeMed, dropId = document.getElementById('mmOther').value, tellBox = document.getElementById('mmTell'), tell = !!(tellBox && tellBox.checked);
  var drop = (State.records || []).find(function (r) { return r.id === dropId; });
  if (!drop) return closeSheet();
  var pid = drop.for_profile_id || null, out = null, keptTitle = '';
  DB.update('records', keepId, function (cur) {
    if (!cur || cur.deleted) return null;
    out = Logic.mergeMeds(cur, drop); out.kept = Logic.medBrief(cur); keptTitle = cur.title;
    cur.fields = out.fields; return cur;
  }).then(function (rec) {
    if (!rec || !out) throw new Error('that medicine is no longer there');
    // Doses marked on the other entry now belong to this one; where both were marked, this one's stays.
    var doses = dosesOf(pid), mine = doses.filter(function (d) { return (d.fields || {}).med_id === keepId; });
    var move = doses.filter(function (d) { var f = d.fields || {}; return !d.deleted && f.med_id === dropId && (f.slot === 'prn' || !Logic.doseFor(mine, keepId, f.day, f.slot)); });
    var photos = (State.entryPhotos || []).filter(function (p) { return p.entry_id === dropId; });
    return Promise.all(move.map(function (d) { return DB.update('records', d.id, function (c) { if (!c) return null; c.fields = Object.assign({}, c.fields, { med_id: keepId }); return c; }); })
      .concat(photos.map(function (p) { return DB.update('entry_photos', p.id, function (c) { if (!c) return null; c.entry_id = keepId; return c; }); })));
  }).then(function () { return DB.remove('records', dropId); })
    .then(function () {
      if (out.caught || !tell) return;
      return mergeNoteQueue({ kept: out.kept, merged: Logic.medBrief(drop), strength_clash: !!out.clash, at: new Date().toISOString(), app_version: TCM_CONFIG.APP_VERSION });
    })
    .then(function () { closeSheet(); return loadAll(); })
    .then(function () {
      refresh(); if (Sync.enabled()) syncNow(); else mergeNoteFlush();
      toast('Merged into ' + keptTitle + (out.clash ? '. Flagged: strength differs' : '') + '. The other entry is in Deleted for 30 days.');
    })
    .catch(function (e) { toast('Could not merge: ' + e.message); });
}
// Notes wait on the device until they can be sent, so a merge made offline is still counted.
function mergeNoteQueue(note) { return DB.metaUpdate('merge_notes', function (cur) { return (cur || []).concat([note]); }); }
function mergeNoteText(n) {
  var one = function (x) { return '"' + x.title + '"' + (x.generic ? ' (generic ' + x.generic + ')' : ' (no generic found)') + (x.dose ? ', ' + x.dose : ''); };
  return 'Merged by hand: ' + one(n.merged) + ' into ' + one(n.kept) + '. The duplicate check did not pair them.' + (n.strength_clash ? ' Their strengths differ.' : '');
}
var mergeNoteBusy = false;
function mergeNoteFlush() {
  if (mergeNoteBusy || !Sync.enabled()) return Promise.resolve();
  mergeNoteBusy = true;
  return DB.meta('merge_notes').then(function (notes) {
    if (!notes || !notes.length) return;
    return Promise.all([Sync.householdId(), Sync.session()]).then(function (r) {
      var hid = r[0], uid = r[1] && r[1].user.id; if (!hid || !uid) return;
      return Sync.getClient().from('reports').insert(notes.map(function (n) {
        return { id: DB.uuid(), household_id: hid, user_id: uid, who: (State.memberNames || {})[uid] || null, kind: 'app', feature: 'med_merge', choices: ['missed'],
          comment: mergeNoteText(n), ai_input: n, app_version: n.app_version || TCM_CONFIG.APP_VERSION, device: navigator.userAgent.slice(0, 200) };
      })).then(function (res) {
        if (res.error) throw res.error;
        return DB.metaUpdate('merge_notes', function (cur) { return (cur || []).filter(function (x) { return !notes.some(function (n) { return n.at === x.at; }); }); });
      });
    });
  }).catch(function () { /* stays queued for the next sync */ }).then(function () { mergeNoteBusy = false; });
}
