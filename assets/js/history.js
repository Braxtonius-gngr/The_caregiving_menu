/* Mistakes made visible and reversible: each entry's history with "restore this version",
 * recent changes across the family, a 30-day Trash, and extra photos per entry. */

/* ---------- history ---------- */
// Fields that are bookkeeping, not content: never shown as a change, never restored.
var HISTORY_SKIP = ['id', 'household_id', 'updated_at', 'user_id', 'edited_by', 'photo_data', 'after_photo_data', 'fts', 'deleted', 'photo_path', 'after_photo_path'];
var FIELD_LABEL = {
  free_text: 'description', eaten_at: 'time', taken_at: 'time', portion_mult: 'amount eaten/drunk', volume_ml: 'amount', fluid_ml: 'fluid in food',
  entry_kind: 'kind', output_type: 'output type', output_color: 'color', clots: 'clots', eaten_note: 'note', note: 'note', kcal: 'calories',
  sodium_mg: 'sodium', for_profile_id: 'person', recipe_id: 'recipe', value: 'value', unit: 'unit', standard: 'morning weight',
  person_name: 'name', daily_targets: 'daily targets', care_settings: 'limits and alerts', notes: 'notes', plate_status: 'plate', served_kcal: 'calories served'
};
function fmtField(k, v) {
  if (v == null || v === '') return '—';
  if (k === 'volume_ml' || k === 'fluid_ml') return amountText(v);
  if (k === 'eaten_at' || k === 'taken_at') return localDay(v) + ' ' + localTime(v);
  if (k === 'for_profile_id') { var p = State.profiles.find(function (x) { return x.id === v; }); return p ? p.person_name : 'someone removed'; }
  if (k === 'recipe_id') { var r = State.recipes.find(function (x) { return x.id === v; }); return r ? r.title : 'a recipe'; }
  if (k === 'output_color') return colorName(v);
  if (k === 'output_type') return OUTPUT_TYPES[v] || v;
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'object') return 'changed';
  return String(v).length > 60 ? String(v).slice(0, 57) + '...' : String(v);
}
function describeChange(row) {
  if (row.action === 'insert') return 'Created';
  if (row.action === 'delete') return 'Deleted';
  if (row.action === 'restore') return 'Restored from Trash';
  var o = row.old_row || {}, n = row.new_row || {}, parts = [];
  Object.keys(n).forEach(function (k) {
    if (HISTORY_SKIP.indexOf(k) >= 0) return;
    if (JSON.stringify(o[k] == null ? null : o[k]) === JSON.stringify(n[k] == null ? null : n[k])) return;
    parts.push((FIELD_LABEL[k] || k.replace(/_/g, ' ')) + ': ' + fmtField(k, o[k]) + ' → ' + fmtField(k, n[k]));
  });
  return parts.length ? parts.join('; ') : 'Photo or bookkeeping change';
}
function whoName(uid) { return uid ? ((State.memberNames || {})[uid] || 'a former member') : 'the app'; }
function showHistory(store, id) {
  if (!Sync.enabled()) return toast('History is kept in the cloud. Connect and sign in first.');
  openSheet('<h2 style="margin-top:0">History</h2><div id="histBody" class="muted">Loading...</div><div class="btn-row"><button class="btn ghost" onclick="closeSheet()">Close</button></div>');
  Sync.history(store, id).then(function (rows) {
    S.historyRows = rows;
    var el = document.getElementById('histBody'); if (!el) return;
    el.classList.remove('muted');
    el.innerHTML = rows.length ? rows.map(function (r, i) {
      var canRestore = State.role !== 'viewer' && r.action !== 'delete' && i > 0;
      return '<div class="list-item"><div class="grow"><b>' + esc(describeChange(r)) + '</b><div class="muted">' + esc(localDay(r.changed_at) + ' ' + localTime(r.changed_at)) + ' · ' + esc(whoName(r.changed_by)) + '</div></div>' +
        (canRestore ? '<button class="btn sm ghost" onclick="restoreVersion(' + i + ')">Restore this version</button>' : '') + '</div>';
    }).join('') : '<p class="muted">No changes recorded yet. History starts from the family update (version 0.2).</p>';
  }).catch(function (e) { var el = document.getElementById('histBody'); if (el) el.textContent = 'Could not load the history: ' + e.message; });
}
// Put the entry's content back the way it was after change i. Photos stay as they are.
function restoreVersion(i) {
  var row = (S.historyRows || [])[i]; if (!row) return;
  if (!confirm('Put this entry back the way it was on ' + localDay(row.changed_at) + ' ' + localTime(row.changed_at) + '? The change is recorded, so it can be undone too.')) return;
  var snap = row.new_row || {};
  DB.update(row.table_name, row.row_id, function (cur) {
    if (!cur) return null;
    Object.keys(snap).forEach(function (k) { if (HISTORY_SKIP.indexOf(k) < 0) cur[k] = snap[k]; });
    cur.deleted = false;
    return cur;
  }).then(function (saved) { closeSheet(); toast(saved ? 'Restored' : 'That entry is not on this device'); return loadAll(); }).then(function () { refresh(); if (Sync.enabled()) syncNow(); })
    .catch(function (e) { toast(e.message); });
}
function showRecentChanges() {
  openSheet('<h2 style="margin-top:0">Recent changes</h2><div id="histBody" class="muted">Loading...</div><div class="btn-row"><button class="btn ghost" onclick="closeSheet()">Close</button></div>');
  Sync.recentChanges(50).then(function (rows) {
    var el = document.getElementById('histBody'); if (!el) return;
    el.classList.remove('muted');
    el.innerHTML = rows.length ? rows.map(function (r) {
      var rec = r.new_row || {}, what = rec.free_text || rec.person_name || (rec.kind === 'weight' ? 'Weight ' + rec.value + ' ' + (rec.unit || '') : r.table_name.replace('_', ' '));
      return '<div class="list-item tappable" onclick="showHistory(\'' + r.table_name + '\',\'' + r.row_id + '\')"><div class="grow"><b>' + esc(what) + '</b> <span class="muted">' + esc(describeChange(r)) + '</span><div class="muted">' + esc(localDay(r.changed_at) + ' ' + localTime(r.changed_at)) + ' · ' + esc(whoName(r.changed_by)) + '</div></div></div>';
    }).join('') : '<p class="muted">Nothing yet.</p>';
  }).catch(function (e) { var el = document.getElementById('histBody'); if (el) el.textContent = 'Could not load changes: ' + e.message; });
}

/* ---------- Trash ---------- */
var TRASH_DAYS = 30;
function trashItems() {
  var since = Date.now() - TRASH_DAYS * 864e5;
  var fresh = function (r) { return r.deleted && new Date(r.updated_at).getTime() >= since; };
  return (State.trash || []).filter(fresh).sort(function (a, b) { return a.updated_at < b.updated_at ? 1 : -1; });
}
function trashLink() {
  var n = trashItems().length;
  return n ? '<p><button class="linkish" onclick="showScreen(\'trash\')">Deleted (' + n + ')</button></p>' : '';
}
function renderTrash() {
  var items = trashItems(), owner = State.role === 'owner' || State.role == null;
  return '<p class="muted">Deleted entries stay here for ' + TRASH_DAYS + ' days with their photos, then the photos are removed.</p>' +
    (items.length ? items.map(function (r) {
      var label = r._store === 'records' ? esc((RECORD_KINDS[r.kind] || {}).label || 'File item') + ': ' + esc(r.title || '') : r._store === 'measurements' ? 'Weight ' + r.value + ' ' + (r.unit || '') : ((r.entry_kind === 'output' ? '&#128701; ' : r.entry_kind === 'drink' ? '&#129380; ' : '') + esc(r.free_text || 'Meal'));
      var when = r.eaten_at || r.taken_at || r.occurred_at || r.updated_at;
      return '<div class="card row"><div class="grow"><b>' + label + '</b> <span class="muted">' + esc(localDay(when) + ' ' + localTime(when)) + '</span><div class="muted">deleted ' + esc(localDay(r.updated_at) + ' ' + localTime(r.updated_at)) + (r.edited_by ? ' by ' + esc(whoName(r.edited_by)) : '') + '</div></div>' +
        '<div class="btn-col"><button class="btn sm writer-only" onclick="restoreFromTrash(\'' + r._store + '\',\'' + r.id + '\')">Restore</button>' +
        (owner ? '<button class="btn sm danger" onclick="deleteForever(\'' + r._store + '\',\'' + r.id + '\')">Delete forever</button>' : '') + '</div></div>';
    }).join('') : '<div class="empty">Trash is empty.</div>') +
    '<div class="btn-row"><button class="btn ghost" onclick="showScreen(\'diary\')">Back to diary</button></div>';
}
function restoreFromTrash(store, id) {
  DB.update(store, id, function (cur) { if (!cur) return null; cur.deleted = false; return cur; })
    .then(function (saved) { toast(saved ? 'Restored' : 'Not found'); return loadAll(); }).then(function () { refresh(); if (Sync.enabled()) syncNow(); })
    .catch(function (e) { toast(e.message); });
}
function deleteForever(store, id) {
  if (!confirm('Delete this forever, with its photos? This cannot be undone.')) return;
  var extras = (State.allEntryPhotos || []).filter(function (p) { return p.entry_id === id; });
  var cloud = Sync.enabled() ? Sync.hardDelete(store, id) : Promise.resolve();
  cloud.then(function () {
    return Promise.all([Sync.removeRecordPhotos(store, id)].concat(extras.map(function (p) {
      return DB.update('entry_photos', p.id, function (cur) { if (!cur) return null; cur.deleted = true; cur.photo_data = null; return cur; }).then(function () { return Sync.removeRecordPhotos('entry_photos', p.id); });
    })));
  }).then(function () { return DB.purge(store, id); }).then(function () { toast('Deleted forever'); return loadAll(); }).then(refresh)
    .catch(function (e) { toast('Could not delete: ' + e.message); });
}
// After 30 days in Trash, an owner's phone removes the photos (the row stays as a tombstone).
function purgeOldTrashPhotos() {
  if (State.role !== 'owner' || !Sync.enabled()) return Promise.resolve();
  var cutoff = Date.now() - TRASH_DAYS * 864e5;
  return DB.meta('trash_photos_purged').then(function (done) {
    done = done || [];
    var old = (State.trash || []).filter(function (r) { return r._store === 'diary_entries' && new Date(r.updated_at).getTime() < cutoff && (r.photo_path || r.after_photo_path) && done.indexOf(r.id) < 0; });
    if (!old.length) return;
    return Promise.all(old.map(function (r) { return Sync.removeRecordPhotos('diary_entries', r.id); }))
      .then(function () { return DB.meta('trash_photos_purged', done.concat(old.map(function (r) { return r.id; })).slice(-500)); });
  });
}

/* ---------- extra photos ---------- */
function extraPhotosOf(entryId) {
  return (State.entryPhotos || []).filter(function (p) { return p.entry_id === entryId; }).sort(function (a, b) { return (a.pos || 0) - (b.pos || 0); });
}
function extraCount(e) { var n = extraPhotosOf(e.id).length; return n ? ' · +' + n + ' photo' + (n === 1 ? '' : 's') : ''; }
function extraPhotosSection(entryId, store) {
  store = store || 'diary_entries';
  var list = extraPhotosOf(entryId);
  return '<h3>' + (store === 'records' ? 'Photos and PDFs' : 'More photos') + '</h3><div class="photo-strip" id="xStrip">' + list.map(function (p) {
    return '<div class="photo-tile"><button type="button" class="photo-btn" aria-label="View ' + (p.mime === 'application/pdf' ? 'PDF ' + esc(p.file_name || '') : 'photo') + '" onclick="viewExtraPhoto(\'' + p.id + '\')">' + (p.mime === 'application/pdf' ? '<span class="pdf-tile">&#128196;<br>' + esc((p.file_name || 'PDF').slice(0, 14)) + '</span>' : '<img class="photo-thumb" alt="" data-photo="' + p.id + '" data-store="entry_photos"' + (p.photo_data ? ' src="' + esc(p.photo_data) + '"' : '') + '>') + '</button>' +
      '<button type="button" class="icon-btn writer-only" aria-label="Remove photo" onclick="removeExtraPhoto(\'' + p.id + '\',\'' + entryId + '\')">&times;</button></div>';
  }).join('') + '</div>' +
    '<div class="btn-row writer-only"><button type="button" class="btn ghost sm" onclick="document.getElementById(\'xCam\').click()">&#128247; Take another</button><button type="button" class="btn ghost sm" onclick="document.getElementById(\'xLib\').click()">&#128444; Add photos</button></div>' +
    '<input id="xCam" type="file" accept="image/*" capture="environment" class="hidden" onchange="addExtraPhotos(this, \'' + entryId + '\', \'' + store + '\')"><input id="xLib" type="file" accept="' + (store === 'records' ? 'image/*,application/pdf' : 'image/*') + '" multiple class="hidden" onchange="addExtraPhotos(this, \'' + entryId + '\', \'' + store + '\')">';
}
function addExtraPhotos(input, entryId, store) {
  store = store || 'diary_entries';
  var files = [].slice.call(input.files || []); input.value = '';
  if (!files.length) return;
  var start = extraPhotosOf(entryId).length + 1;
  toast('Adding ' + files.length + ' photo' + (files.length === 1 ? '' : 's') + '...');
  Promise.all(files.map(function (f, i) {
    var pdf = f.type === 'application/pdf';
    if (pdf && f.size > 15e6) { toast(f.name + ' is over 15 MB, so it was left out'); return Promise.resolve(null); }
    var read = pdf ? new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(f); }) : downscale(f, 1600);
    return read.then(function (d) { return DB.put('entry_photos', { entry_id: entryId, entry_store: store, photo_data: d, photo_path: null, pos: start + i, caption: null, mime: pdf ? 'application/pdf' : 'image/jpeg', file_name: f.name || null }); }, function () { return null; });
  })).then(function (saved) {
    var ok = saved.filter(Boolean).length;
    toast(ok === files.length ? 'Photos added' : ok + ' of ' + files.length + ' photos added; the rest could not be opened');
    return loadAll();
  }).then(function () { refreshExtraStrip(entryId, store); refresh(); if (Sync.enabled()) syncNow(); });
}
function refreshExtraStrip(entryId, store) {
  var strip = document.getElementById('xStrip'); if (!strip) return;
  var holder = document.createElement('div'); holder.innerHTML = extraPhotosSection(entryId, store);
  strip.replaceWith(holder.querySelector('#xStrip'));
  hydratePhotos();
}
function removeExtraPhoto(id, entryId) {
  if (!confirm('Remove this photo?')) return;
  DB.update('entry_photos', id, function (cur) { if (!cur) return null; cur.deleted = true; cur.photo_data = null; return cur; })
    .then(function () { return Sync.removeRecordPhotos('entry_photos', id); }).then(loadAll).then(function () { var p = (State.allEntryPhotos || []).find(function (x) { return x.id === id; }); refreshExtraStrip(entryId, p && p.entry_store); refresh(); });
}
function viewExtraPhoto(id) {
  var p = (State.entryPhotos || []).find(function (x) { return x.id === id; }); if (!p) return;
  if (p.mime === 'application/pdf') {
    toast('Opening ' + (p.file_name || 'PDF') + '...');
    return Sync.photoSrc(p, 'entry_photos').then(function (src) { if (!src) return toast('This PDF is not available offline yet'); return fetch(src).then(function (r) { return r.blob(); }).then(function (b) { window.open(URL.createObjectURL(new Blob([b], { type: 'application/pdf' })), '_blank'); }); });
  }
  Sync.photoSrc(p, 'entry_photos').then(function (src) { if (src) zoomImage(src, 'Photo'); else toast('This photo is not available offline yet'); });
}
