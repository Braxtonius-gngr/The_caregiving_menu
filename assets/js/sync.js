/* Cloud sync via Supabase. Offline-first: local IndexedDB is the source of truth,
 * the outbox is pushed when online, remote changes newer than our watermark are pulled. */
var Sync = (function () {
  var client = null;
  var SYNCED = ['ingredients', 'recipes', 'recipe_ingredients', 'recipe_variations', 'pantry_items', 'diet_profiles', 'profile_rules', 'diary_entries', 'shopping_list', 'usage_log'];

  // Where the cloud lives: details saved on this device (Settings or a setup link) win,
  // then the values baked into config.js. The anon key is public by design; RLS guards data.
  var LS_CONFIG = 'tcm_cloud', LS_INVITE = 'tcm_pending_invite';
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function config() {
    var saved = null;
    try { saved = JSON.parse(lsGet(LS_CONFIG) || 'null'); } catch (e) {}
    if (saved && saved.url && saved.key) return { url: saved.url, key: saved.key, source: 'device' };
    return { url: TCM_CONFIG.SUPABASE_URL, key: TCM_CONFIG.SUPABASE_ANON_KEY, source: 'file' };
  }
  // Sign-in is stored per exact host, so a session can never be sent to a different
  // server that merely shares the first part of its name.
  function authStorageKey(url) { return 'tcm-auth:' + new URL(url).host; }
  function configured() { var c = config(); return !!(c.url && c.key); }
  function enabled() { return configured() && !!window.supabase; }
  function validUrl(u) { return /^https:\/\/[^\s/]+/.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(u); }
  function saveConfig(url, key) {
    url = String(url || '').trim().replace(/\/+$/, ''); key = String(key || '').trim();
    if (!validUrl(url)) throw new Error('That does not look like a Supabase URL (https://...supabase.co).');
    if (key.length < 20) throw new Error('Paste the full anon (public) key.');
    lsSet(LS_CONFIG, JSON.stringify({ url: url, key: key })); client = null;
  }
  function clearConfig() { lsSet(LS_CONFIG, null); lsSet(LS_INVITE, null); client = null; }

  // Setup links carry the cloud details and, optionally, a household invite code:
  //   https://host/app/#connect=<base64url JSON {u, k, i}>
  function setupLink(invite) {
    var c = config();
    var payload = btoa(JSON.stringify({ u: c.url, k: c.key, i: invite || undefined })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return location.href.split('#')[0].split('?')[0] + '#connect=' + payload;
  }
  // Returns true if the page was opened from a setup link (and applies it).
  function applySetupLink() {
    var m = location.hash.match(/^#connect=([A-Za-z0-9_-]+)$/);
    if (!m) return false;
    history.replaceState(null, '', location.pathname + location.search);
    var data = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')));
    var host = new URL(String(data.u)).host, current = configured() ? new URL(config().url).host : null;
    if (host !== current) {
      var official = /\.supabase\.co$/.test(host) || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
      var msg = 'Connect this device to ' + host + '?\n\nYour sign-in, recipes, diary and photos will be stored there. Only accept setup links from someone you trust.' +
        (official ? '' : '\n\nWarning: this is not a Supabase-hosted address.') + (current ? '\n\nThis replaces the current connection to ' + current + '.' : '');
      if (!confirm(msg)) return false;
    }
    saveConfig(data.u, data.k);
    if (data.i) lsSet(LS_INVITE, String(data.i));
    return true;
  }
  // After sign-in on a device set up from a link, join the household it was meant for.
  function joinPendingInvite() {
    var code = lsGet(LS_INVITE);
    if (!code || !enabled()) return Promise.resolve(false);
    return session().then(function (s) {
      if (!s) return false;
      return joinHousehold(code).then(function () { lsSet(LS_INVITE, null); return true; });
    });
  }
  function pendingInvite() { return lsGet(LS_INVITE); }

  function getClient() {
    if (!enabled()) return null;
    if (!client) { var c = config(); client = window.supabase.createClient(c.url, c.key, { auth: { storageKey: authStorageKey(c.url) } }); }
    return client;
  }

  function session() {
    var c = getClient();
    if (!c) return Promise.resolve(null);
    return c.auth.getSession().then(function (r) { return r.data.session; });
  }

  function signIn(email) {
    var c = getClient();
    if (!c) return Promise.reject(new Error('Cloud not configured'));
    return c.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.href.split('#')[0] } });
  }
  function signOut() { var c = getClient(); return c ? c.auth.signOut() : Promise.resolve(); }

  // The cached household and pull cursor belong to one project. If this device is now
  // pointed at a different project (Settings or a setup link), start over against it.
  function householdId() {
    var url = config().url;
    return Promise.all([DB.meta('household_id'), DB.meta('project_url')]).then(function (m) {
      if (m[0] && m[1] === url) return m[0];
      if (m[1] !== url) return Promise.all([DB.meta('household_id', null), DB.meta('last_pull', null), DB.meta('project_url', url)]).then(function () { return null; });
      return null;
    }).then(function (h) {
      if (h) return h;
      var c = getClient();
      return c.rpc('ensure_household').then(function (r) {
        if (r.error) throw r.error;
        return DB.meta('household_id', r.data).then(function () { return r.data; });
      });
    });
  }

  function push() {
    var c = getClient();
    if (!c) return Promise.resolve(0);
    return Promise.all([DB.outbox(), householdId()]).then(function (res) {
      var items = res[0], hid = res[1];
      if (!items.length) return 0;
      var byStore = {};
      items.forEach(function (it) {
        if (SYNCED.indexOf(it.store) < 0) return;
        var rec = Object.assign({}, it.record, { household_id: hid });
        delete rec.fts; // server-generated column
        delete rec.photo_data; // local copies only; the photos themselves live in Storage at photo_path / after_photo_path
        delete rec.after_photo_data;
        (byStore[it.store] = byStore[it.store] || []).push(rec);
      });
      return Promise.all(Object.keys(byStore).map(function (store) {
        return c.from(store).upsert(byStore[store], { onConflict: 'id' }).then(function (r) { if (r.error) throw r.error; });
      })).then(function () { return DB.clearOutbox(items.map(function (i) { return i.id; })); }).then(function () { return items.length; });
    });
  }

  function pull() {
    var c = getClient();
    if (!c) return Promise.resolve(0);
    return DB.meta('last_pull').then(function (since) {
      since = since || '1970-01-01T00:00:00Z';
      var newest = since, n = 0;
      return Promise.all(SYNCED.map(function (store) {
        return c.from(store).select('*').gt('updated_at', since).then(function (r) {
          if (r.error) throw r.error;
          r.data.forEach(function (row) { if (row.updated_at > newest) newest = row.updated_at; });
          n += r.data.length;
          return DB.reconcile(store, r.data, PHOTO_STORES[store] ? function (row, local) {
            // Keep each local photo copy when the server row still points at the same photo.
            // Postgres sends null for an unset path; a never-uploaded local entry has undefined.
            photoSlots(store).forEach(function (sl) {
              if (local && local[sl.data] && !row.deleted && (local[sl.path] || null) === (row[sl.path] || null)) row[sl.data] = local[sl.data];
            });
            return row;
          } : null);
        });
      })).then(function () { return DB.meta('last_pull', newest); }).then(function () { return n; });
    });
  }

  // Which records carry a photo, and the Storage folder each one uses.
  var PHOTO_STORES = { diary_entries: 'diary', recipes: 'recipes' };
  // Photo slots per record: the local copy field, the Storage path field and a file-name tag.
  // A diary entry can also hold an "after the meal" photo of what was left on the plate.
  var MAIN_SLOT = { data: 'photo_data', path: 'photo_path', tag: '' };
  var AFTER_SLOT = { data: 'after_photo_data', path: 'after_photo_path', tag: '-after' };
  function photoSlots(store) { return store === 'diary_entries' ? [MAIN_SLOT, AFTER_SLOT] : [MAIN_SLOT]; }

  // Photos taken offline (or before sign-in) carry photo_data but no photo_path.
  // Each upload gets a fresh versioned name, so replacing a photo changes the path
  // and other devices know to fetch the new one instead of keeping their old copy.
  function uploadPendingPhotos() {
    var c = getClient();
    var stores = Object.keys(PHOTO_STORES);
    return Promise.all([householdId()].concat(stores.map(function (st) { return DB.all(st); }))).then(function (res) {
      var hid = res[0], chain = Promise.resolve(0);
      stores.forEach(function (store, i) {
        photoSlots(store).forEach(function (sl) {
          res[i + 1].filter(function (e) { return e[sl.data] && !e[sl.path]; }).forEach(function (e) {
            chain = chain.then(function (n) {
              // File names start with the record id, so deleting the record removes every photo it had.
              var path = hid + '/' + PHOTO_STORES[store] + '/' + e.id + sl.tag + '-' + Date.now().toString(36) + '.jpg';
              var uploaded = false;
              return dataUrlToBlob(e[sl.data]).then(function (blob) {
                return c.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: true });
              }).then(function (r) {
                if (r.error) throw r.error;
                uploaded = true;
                return attachPhotoPath(c, store, e.id, e[sl.data], path, sl);
              }).then(function (ok) { return ok ? n + 1 : n; }).catch(function () {
                // The next sync uploads under a new name, so this copy would be orphaned.
                return (uploaded ? queuePhotoDelete(path) : Promise.resolve()).then(function () { return n; });
              });
            });
          });
        });
      });
      return chain;
    });
  }

  // Set photo_path locally only if the record is still live and still holds the photo
  // we uploaded. Runs atomically, so a deletion or a new photo taken meanwhile wins.
  function adoptPath(store, id, photoData, path, silent, sl) {
    // mergePending: if an edit to this record is still waiting to upload, that queued copy
    // gets the path too, so pushing it later cannot clear the photo on the server.
    return DB.update(store, id, function (cur) {
      if (!cur || cur.deleted || cur[sl.data] !== photoData || cur[sl.path]) return null;
      cur[sl.path] = path; return cur;
    }, { silent: silent, mergePending: true }).then(function (rec) {
      if (rec) return true;
      return queuePhotoDelete(path).then(function () { return false; }); // superseded: drop this upload
    });
  }

  // Photo-only update. Never re-push the whole row: that would overwrite a deletion
  // made on another device. Only a row that is still live on the server gets the path.
  function attachPhotoPath(c, store, id, photoData, path, sl) {
    var set = {}; set[sl.path] = path;
    // Only a live row with no photo in this slot yet: if another upload already attached one, it won.
    return c.from(store).update(set).eq('id', id).eq('deleted', false).is(sl.path, null).select('id').then(function (r) {
      if (r.error) throw r.error;
      if (r.data && r.data.length) return adoptPath(store, id, photoData, path, true, sl);
      return c.from(store).select('id,deleted,' + sl.path).eq('id', id).then(function (q) {
        if (q.error) throw q.error;
        var row = q.data && q.data[0];
        if (row && !row.deleted && row[sl.path] && row[sl.path] !== path) {
          // A competing upload attached first; keep the server's photo and drop only ours.
          return queuePhotoDelete(path).then(function () { return false; });
        }
        if (row) {
          // Deleted elsewhere: mirror the tombstone and drop the photo we just uploaded.
          return DB.update(store, id, function (cur) { if (!cur) return null; cur.deleted = true; cur.photo_data = null; cur.after_photo_data = null; return cur; }, { silent: true })
            .then(function () { return queuePhotoDelete(path); }).then(function () { return false; });
        }
        // Not on the server yet (created mid-sync): it goes up whole with its next push.
        return adoptPath(store, id, photoData, path, false, sl);
      });
    });
  }

  // One sync at a time. A call made while a sync is running joins it, and one more
  // pass runs afterwards to pick up whatever changed meanwhile.
  var inflight_run = null, rerun = false;
  function run() {
    if (inflight_run) { rerun = true; return inflight_run; }
    inflight_run = runOnce().then(function (r) {
      inflight_run = null;
      if (!rerun) return r;
      rerun = false;
      // Report both passes, so a caller still refreshes for what the first pass pulled.
      return run().then(function (r2) {
        return { pushed: r.pushed + r2.pushed, pulled: r.pulled + r2.pulled, photos: r.photos + r2.photos, signedIn: r2.signedIn };
      });
    }, function (e) { inflight_run = null; rerun = false; throw e; });
    return inflight_run;
  }

  // Order matters: push local changes, pull remote ones (including deletions made on
  // other devices), and only then attach photos, so an upload never revives a deleted entry.
  function runOnce() {
    return session().then(function (s) {
      if (!s) return { pushed: 0, pulled: 0, photos: 0, signedIn: false };
      return push().then(function (p) {
        return pull().then(function (q) {
          return uploadPendingPhotos().then(function (ph) {
            return flushPhotoDeletes().then(function () { return { pushed: p, pulled: q, photos: ph, signedIn: true }; });
          });
        });
      });
    });
  }

  // Calls the /brain Edge Function. mode: parse_recipe | parse_receipt | estimate_plate | variations | diet_swaps | canonicalize
  // Calls an Edge Function and turns failures into messages a person can act on.
  function invokeFn(name, body) {
    var c = getClient();
    if (!c) return Promise.reject(new Error('Cloud not configured. Open Settings and connect first.'));
    return session().then(function (s) {
      if (!s) throw new Error('Sign in first: Settings, then Cloud sync, then send yourself a sign-in link.');
      return c.functions.invoke(name, { body: body });
    }).then(function (r) {
      if (!r.error) return r.data;
      var res = r.error.context;
      if (!res || typeof res.json !== 'function') throw r.error;
      return res.json().catch(function () { return {}; }).then(function (d) {
        if (res.status === 401) throw new Error('Your sign-in has expired. Sign in again in Settings.');
        throw new Error((d && d.error) || ('Cloud error ' + res.status));
      });
    });
  }
  function brain(mode, payload) { return invokeFn('brain', Object.assign({ mode: mode }, payload)); }
  function lookup(kind, q) { return invokeFn('lookup', { kind: kind, q: q }); }

  function inviteCode() {
    var c = getClient();
    return householdId().then(function (hid) { return c.from('households').select('invite_code').eq('id', hid).single(); }).then(function (r) { if (r.error) throw r.error; return r.data.invite_code; });
  }
  function joinHousehold(code) {
    var c = getClient();
    return c.rpc('join_household', { code: code }).then(function (r) {
      if (r.error) throw r.error;
      return DB.meta('household_id', r.data).then(function () { return DB.meta('last_pull', null); });
    });
  }

  var BUCKET = 'photos';
  function dataUrlToBlob(dataUrl) { return fetch(dataUrl).then(function (r) { return r.blob(); }); }
  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) { var fr = new FileReader(); fr.onload = function () { resolve(fr.result); }; fr.onerror = reject; fr.readAsDataURL(blob); });
  }

  // Returns a displayable src for a record's photo: the local copy if we have one,
  // otherwise downloads it from Storage once and keeps it locally for offline viewing.
  var inflight = {};
  // after: true for a diary entry's "after the meal" photo.
  function photoSrc(rec, store, after) {
    store = store || 'diary_entries';
    var sl = after ? AFTER_SLOT : MAIN_SLOT;
    if (rec[sl.data]) return Promise.resolve(rec[sl.data]);
    if (!rec[sl.path]) return Promise.resolve(null);
    var c = getClient();
    if (!c) return Promise.resolve(null);
    var key = store + ':' + rec.id + ':' + rec[sl.path];
    if (inflight[key]) return inflight[key];
    inflight[key] = c.storage.from(BUCKET).download(rec[sl.path]).then(function (r) {
      if (r.error) throw r.error;
      return blobToDataUrl(r.data);
    }).then(function (dataUrl) {
      // Cache it only if the record is still live and still points at this photo.
      return DB.update(store, rec.id, function (cur) {
        if (!cur || cur.deleted || cur[sl.path] !== rec[sl.path]) return null;
        cur[sl.data] = dataUrl; return cur;
      }, { silent: true }).then(function (saved) { if (saved) rec[sl.data] = dataUrl; return dataUrl; });
    }).catch(function () { return null; }).then(function (src) { delete inflight[key]; return src; });
    return inflight[key];
  }

  // Photo deletions are queued in local meta and retried on every signed-in sync
  // until Storage confirms them, so deleting offline never leaves an orphan behind.
  var DELETE_QUEUE = 'pending_photo_deletes';
  function queuePhotoDelete(path) {
    return DB.metaUpdate(DELETE_QUEUE, function (list) {
      list = list || [];
      if (list.indexOf(path) < 0) list.push(path);
      return list;
    });
  }
  // Queue items are exact Storage paths, or "record:<folder>/<id>" meaning every photo
  // ever stored for that record. Deleting a record uses the second form, so cleanup
  // does not depend on this device knowing the latest photo path.
  function flushPhotoDeletes() {
    var c = getClient();
    if (!c) return Promise.resolve(0);
    return DB.meta(DELETE_QUEUE).then(function (list) {
      if (!list || !list.length) return 0;
      var exact = list.filter(function (p) { return p.indexOf('record:') !== 0; });
      var records = list.filter(function (p) { return p.indexOf('record:') === 0; });
      var done = exact.slice();
      return householdId().then(function (hid) {
        return Promise.all(records.map(function (item) {
          var parts = item.slice(7).split('/'), folder = parts[0], id = parts[1];
          var store = Object.keys(PHOTO_STORES).find(function (k) { return PHOTO_STORES[k] === folder; });
          // Wait until the server has the tombstone: before that, another device's upload
          // could still attach to the live row after this cleanup ran.
          return c.from(store).select('deleted').eq('id', id).then(function (q) {
            if (q.error) throw q.error;
            if (q.data && q.data[0] && !q.data[0].deleted) return []; // not yet; retry next sync
            return c.storage.from(BUCKET).list(hid + '/' + folder, { search: id, limit: 100 }).then(function (r) {
              if (r.error) throw r.error;
              done.push(item);
              return (r.data || []).filter(function (o) { return o.name.indexOf(id) === 0; }).map(function (o) { return hid + '/' + folder + '/' + o.name; });
            });
          });
        }));
      }).then(function (found) {
        var paths = exact.concat([].concat.apply([], found));
        return paths.length ? c.storage.from(BUCKET).remove(paths) : { error: null };
      }).then(function (r) {
        if (r.error) return 0;
        // Atomic: anything queued while this ran survives the cleanup.
        return DB.metaUpdate(DELETE_QUEUE, function (now) {
          return (now || []).filter(function (p) { return done.indexOf(p) < 0; });
        }).then(function () { return done.length; });
      }).catch(function () { return 0; });
    });
  }
  function flushIfSignedIn() {
    if (!getClient()) return Promise.resolve(0);
    return session().then(function (s) { return s ? flushPhotoDeletes() : 0; }).catch(function () { return 0; });
  }
  // Always queue, even if the Supabase library failed to load this session;
  // the network call waits for a signed-in sync.
  function removePhoto(path) {
    if (!path || !configured()) return Promise.resolve();
    return queuePhotoDelete(path).then(flushIfSignedIn);
  }
  function removeRecordPhotos(store, id) {
    if (!PHOTO_STORES[store] || !id || !configured()) return Promise.resolve();
    return queuePhotoDelete('record:' + PHOTO_STORES[store] + '/' + id).then(flushIfSignedIn);
  }

  return { authStorageKey: authStorageKey, config: config, configured: configured, saveConfig: saveConfig, clearConfig: clearConfig, setupLink: setupLink, applySetupLink: applySetupLink, joinPendingInvite: joinPendingInvite, pendingInvite: pendingInvite, photoSrc: photoSrc, removePhoto: removePhoto, removeRecordPhotos: removeRecordPhotos, flushPhotoDeletes: flushPhotoDeletes, uploadPendingPhotos: uploadPendingPhotos, inviteCode: inviteCode, joinHousehold: joinHousehold, enabled: enabled, getClient: getClient, session: session, signIn: signIn, signOut: signOut, run: run, brain: brain, lookup: lookup };
})();
