/* IndexedDB store. One object store per noun, plus a change log for sync.
 * All records carry: id (uuid), updated_at (ISO), deleted (bool). */
var DB = (function () {
  var NAME = 'tcm';
  var VERSION = 1;
  var STORES = ['ingredients', 'recipes', 'recipe_ingredients', 'recipe_variations', 'pantry_items', 'diet_profiles', 'profile_rules', 'diary_entries', 'shopping_list', 'usage_log', 'intake_jobs', 'outbox', 'meta'];
  var dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = function () {
        var d = req.result;
        STORES.forEach(function (s) {
          if (!d.objectStoreNames.contains(s)) {
            var os = d.createObjectStore(s, { keyPath: 'id' });
            if (s !== 'meta' && s !== 'outbox') os.createIndex('updated_at', 'updated_at');
            if (s === 'recipe_ingredients') { os.createIndex('recipe_id', 'recipe_id'); os.createIndex('ingredient_id', 'ingredient_id'); }
            if (s === 'pantry_items' || s === 'usage_log' || s === 'shopping_list') os.createIndex('ingredient_id', 'ingredient_id');
            if (s === 'profile_rules') os.createIndex('profile_id', 'profile_id');
            if (s === 'diary_entries') os.createIndex('eaten_at', 'eaten_at');
          }
        });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbp;
  }

  function tx(store, mode, fn) {
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(store, mode);
        var os = t.objectStore(store);
        var out = fn(os);
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }

  function all(store) {
    return tx(store, 'readonly', function (os) { return os.getAll(); }).then(function (rows) { return (rows || []).filter(function (r) { return !r.deleted; }); });
  }
  function get(store, id) { return tx(store, 'readonly', function (os) { return os.get(id); }); }
  function byIndex(store, index, value) {
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var req = d.transaction(store).objectStore(store).index(index).getAll(value);
        req.onsuccess = function () { resolve((req.result || []).filter(function (r) { return !r.deleted; })); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  // put() stamps updated_at and queues the change for cloud sync.
  function put(store, rec, opts) {
    opts = opts || {};
    if (!rec.id) rec.id = uuid();
    rec.updated_at = new Date().toISOString();
    if (rec.deleted == null) rec.deleted = false;
    return tx(store, 'readwrite', function (os) { os.put(rec); return rec; }).then(function (r) {
      if (!opts.silent) return tx('outbox', 'readwrite', function (os) { os.put({ id: store + ':' + rec.id, store: store, record: rec }); }).then(function () { return r; });
      return r;
    });
  }
  function remove(store, id) {
    return get(store, id).then(function (rec) { if (!rec) return null; rec.deleted = true; return put(store, rec); });
  }
  function bulkPut(store, recs) { return Promise.all(recs.map(function (r) { return put(store, r, { silent: true }); })); }
  function meta(key, value) {
    if (value === undefined) return get('meta', key).then(function (r) { return r ? r.value : null; });
    return tx('meta', 'readwrite', function (os) { os.put({ id: key, value: value }); });
  }
  // Atomic read-modify-write of one record: fn gets the current record (or undefined)
  // and returns the new one, or null/undefined to leave it untouched. The record and
  // its outbox entry are written in the same transaction, so a write that waited on
  // the network can never overwrite a change (such as a deletion) made in the meantime.
  function update(store, id, fn, opts) {
    opts = opts || {};
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction([store, 'outbox'], 'readwrite');
        var os = t.objectStore(store);
        var out = null;
        var req = os.get(id);
        req.onsuccess = function () {
          var next = fn(req.result);
          if (!next) return;
          next.updated_at = new Date().toISOString();
          if (next.deleted == null) next.deleted = false;
          os.put(next); out = next;
          var ob = t.objectStore('outbox'), key = store + ':' + next.id;
          if (!opts.silent) ob.put({ id: key, store: store, record: next });
          else if (opts.mergePending) {
            var pend = ob.get(key);
            pend.onsuccess = function () { if (pend.result) ob.put({ id: key, store: store, record: next }); };
          }
        };
        t.oncomplete = function () { resolve(out); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  // Apply rows pulled from the server. A record with an edit still waiting in the outbox
  // is left alone (the local edit is newer and goes up on the next push); merge(row, local)
  // can carry local-only fields such as photo bytes across. One transaction, so an edit
  // made while the pull was in flight cannot be overwritten.
  function reconcile(store, rows, merge) {
    if (!rows.length) return Promise.resolve(0);
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction([store, 'outbox'], 'readwrite');
        var os = t.objectStore(store), ob = t.objectStore('outbox'), applied = 0;
        rows.forEach(function (row) {
          var pend = ob.get(store + ':' + row.id);
          pend.onsuccess = function () {
            if (pend.result) return; // unpushed local edit wins
            var cur = os.get(row.id);
            cur.onsuccess = function () { os.put(merge ? merge(row, cur.result) : row); applied++; };
          };
        });
        t.oncomplete = function () { resolve(applied); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  // Read-modify-write of one meta value inside a single readwrite transaction,
  // so two overlapping updates cannot overwrite each other.
  function metaUpdate(key, fn) {
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction('meta', 'readwrite');
        var os = t.objectStore('meta');
        var out;
        var req = os.get(key);
        req.onsuccess = function () {
          out = fn(req.result ? req.result.value : null);
          os.put({ id: key, value: out });
        };
        t.oncomplete = function () { resolve(out); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }
  function outbox() { return tx('outbox', 'readonly', function (os) { return os.getAll(); }); }
  function clearOutbox(ids) { return tx('outbox', 'readwrite', function (os) { ids.forEach(function (id) { os.delete(id); }); }); }
  function wipe() { return open().then(function (d) { d.close(); dbp = null; return new Promise(function (res) { var r = indexedDB.deleteDatabase(NAME); r.onsuccess = r.onerror = r.onblocked = function () { res(); }; }); }); }

  return { STORES: STORES, uuid: uuid, all: all, get: get, byIndex: byIndex, put: put, remove: remove, bulkPut: bulkPut, meta: meta, metaUpdate: metaUpdate, update: update, reconcile: reconcile, outbox: outbox, clearOutbox: clearOutbox, wipe: wipe };
})();
