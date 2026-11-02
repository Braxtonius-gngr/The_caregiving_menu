/* Cloud sync via Supabase. Offline-first: local IndexedDB is the source of truth,
 * the outbox is pushed when online, remote changes newer than our watermark are pulled. */
var Sync = (function () {
  var client = null;
  var SYNCED = ['ingredients', 'recipes', 'recipe_ingredients', 'recipe_variations', 'pantry_items', 'diet_profiles', 'profile_rules', 'diary_entries', 'shopping_list', 'usage_log'];

  function enabled() { return !!(TCM_CONFIG.SUPABASE_URL && TCM_CONFIG.SUPABASE_ANON_KEY && window.supabase); }

  function getClient() {
    if (!enabled()) return null;
    if (!client) client = window.supabase.createClient(TCM_CONFIG.SUPABASE_URL, TCM_CONFIG.SUPABASE_ANON_KEY);
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

  function householdId() {
    return DB.meta('household_id').then(function (h) {
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
        delete rec.photo_data; // local copy only; the photo itself lives in Storage at photo_path
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
          if (store !== 'diary_entries') return DB.bulkPut(store, r.data);
          // Keep the local photo copy when the server row still points at the same photo.
          return Promise.all(r.data.map(function (row) {
            return DB.get(store, row.id).then(function (local) {
              if (local && local.photo_data && local.photo_path === row.photo_path) row.photo_data = local.photo_data;
              return row;
            });
          })).then(function (rows) { return DB.bulkPut(store, rows); });
        });
      })).then(function () { return DB.meta('last_pull', newest); }).then(function () { return n; });
    });
  }

  // Diary photos taken offline (or before sign-in) carry photo_data but no photo_path.
  // Upload them first so the rows pushed next already point at Storage.
  function uploadPendingPhotos() {
    var c = getClient();
    return Promise.all([DB.all('diary_entries'), householdId()]).then(function (res) {
      var pending = res[0].filter(function (e) { return e.photo_data && !e.photo_path; }), hid = res[1];
      var chain = Promise.resolve(0);
      pending.forEach(function (e) {
        chain = chain.then(function (n) {
          var path = hid + '/diary/' + e.id + '.jpg';
          return dataUrlToBlob(e.photo_data).then(function (blob) {
            return c.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: true });
          }).then(function (r) {
            if (r.error) throw r.error;
            e.photo_path = path;
            return DB.put('diary_entries', e).then(function () { return n + 1; });
          }).catch(function () { return n; }); // leave it pending; never block the rest of the sync
        });
      });
      return chain;
    });
  }

  function run() {
    return session().then(function (s) {
      if (!s) return { pushed: 0, pulled: 0, photos: 0, signedIn: false };
      return uploadPendingPhotos().then(function (ph) {
        return push().then(function (p) { return pull().then(function (q) { return { pushed: p, pulled: q, photos: ph, signedIn: true }; }); });
      });
    });
  }

  // Calls the /brain Edge Function. mode: parse_recipe | parse_receipt | estimate_plate | variations | diet_swaps | canonicalize
  function brain(mode, payload) {
    var c = getClient();
    if (!c) return Promise.reject(new Error('Cloud not configured. Set SUPABASE_URL in assets/js/config.js.'));
    return c.functions.invoke('brain', { body: Object.assign({ mode: mode }, payload) }).then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  function lookup(kind, q) {
    var c = getClient();
    if (!c) return Promise.reject(new Error('Cloud not configured.'));
    return c.functions.invoke('lookup', { body: { kind: kind, q: q } }).then(function (r) { if (r.error) throw r.error; return r.data; });
  }

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

  // Returns a displayable src for a diary entry's photo: the local copy if we have one,
  // otherwise downloads it from Storage once and keeps it locally for offline viewing.
  var inflight = {};
  function photoSrc(entry) {
    if (entry.photo_data) return Promise.resolve(entry.photo_data);
    if (!entry.photo_path) return Promise.resolve(null);
    var c = getClient();
    if (!c) return Promise.resolve(null);
    if (inflight[entry.id]) return inflight[entry.id];
    inflight[entry.id] = c.storage.from(BUCKET).download(entry.photo_path).then(function (r) {
      if (r.error) throw r.error;
      return blobToDataUrl(r.data);
    }).then(function (dataUrl) {
      return DB.get('diary_entries', entry.id).then(function (rec) {
        if (rec) { rec.photo_data = dataUrl; return DB.put('diary_entries', rec, { silent: true }); }
      }).then(function () { entry.photo_data = dataUrl; return dataUrl; });
    }).catch(function () { return null; }).then(function (src) { delete inflight[entry.id]; return src; });
    return inflight[entry.id];
  }

  function removePhoto(path) {
    var c = getClient();
    if (!c || !path) return Promise.resolve();
    return c.storage.from(BUCKET).remove([path]).then(function () {}, function () {});
  }

  return { photoSrc: photoSrc, removePhoto: removePhoto, uploadPendingPhotos: uploadPendingPhotos, inviteCode: inviteCode, joinHousehold: joinHousehold, enabled: enabled, getClient: getClient, session: session, signIn: signIn, signOut: signOut, run: run, brain: brain, lookup: lookup };
})();
