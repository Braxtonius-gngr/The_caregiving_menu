/* Phone notifications (design: product/design/step-notifications.md, decision P-027).
 * Each person turns them on for their own phone and chooses what they get. The server (function
 * notify, every 10 minutes) works out what is due with the same rules as Today and sends each alert
 * once. Permission is asked only when the person taps Turn on, never on first open. */

var NOTIFY_KINDS = [['doses', 'A dose not marked', '3 hours after its set time. Not while she is in care elsewhere.'],
  ['readings', 'Readings past the care team’s numbers', 'Also weight alerts and weight going up 3 mornings in a row.'],
  ['refills', 'Refills running low', 'When a counted supply has 5 days or fewer left.']];
var NOTIFY_DEFAULT = { kinds: { doses: true, readings: true, refills: true }, quiet_from: 22, quiet_to: 7, urgent_in_quiet: true, details: false, summary: false, summary_at: 20 };

function notifySupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
function notifyIsIos() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function notifyStandalone() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
function notifyKey() { var k = TCM_CONFIG.VAPID_PUBLIC_KEY || '', t = k.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((k.length + 3) % 4), b = atob(t), out = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) out[i] = b.charCodeAt(i); return out; }
function notifyB64(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function notifyCurrent() { return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }); }
function notifyRow(sub) { var c = Sync.getClient(); return c.from('push_subscriptions').select('*').eq('endpoint', sub.endpoint).maybeSingle().then(function (r) { return r.data || null; }); }

// The Notifications card in Settings. Fills itself in, since it needs to ask the browser and the server.
function fillNotifyBox() {
  var box = document.getElementById('notifyBox'); if (!box) return;
  if (!Sync.enabled() || !TCM_CONFIG.VAPID_PUBLIC_KEY) { box.innerHTML = '<p class="muted">Sign in to get notifications on this phone.</p>'; return; }
  if (notifyIsIos() && !notifyStandalone()) {
    box.innerHTML = '<p><b>On an iPhone or iPad, notifications need the app on the home screen.</b></p><p class="muted">In Safari, tap Share, then "Add to Home Screen". Open the app from that icon and come back here.</p>';
    return;
  }
  if (!notifySupported()) { box.innerHTML = '<p class="muted">This browser cannot show notifications. Chrome on Android, or the app added to an iPhone home screen, can.</p>'; return; }
  if (Notification.permission === 'denied') { box.innerHTML = '<p><b>Notifications are blocked for this app.</b></p><p class="muted">Allow them in the phone&rsquo;s settings for this app (or this site in the browser), then come back.</p>'; return; }
  box.innerHTML = '<p class="muted">Checking this phone...</p>';
  notifyCurrent().then(function (sub) {
    if (!sub) {
      box.innerHTML = '<p>Get a notification on this phone when a dose is not marked, a reading is past a number the care team gave, or a refill is running low. Each person chooses for their own phone.</p>' +
        '<div class="btn-row"><button class="btn" onclick="notifyTurnOn()">' + icon('alert') + ' Turn on notifications</button></div>';
      return;
    }
    return notifyRow(sub).then(function (row) {
      if (!row) return notifySave(sub, NOTIFY_DEFAULT).then(fillNotifyBox);
      var p = Object.assign({}, NOTIFY_DEFAULT, row.prefs || {}), k = Object.assign({}, NOTIFY_DEFAULT.kinds, p.kinds || {});
      var hours = function (id, v) { var o = ''; for (var h = 0; h < 24; h++) o += '<option value="' + h + '"' + (h === v ? ' selected' : '') + '>' + ((h % 12) || 12) + (h < 12 ? ' am' : ' pm') + '</option>'; return '<select id="' + id + '" onchange="notifyPrefsChanged()">' + o + '</select>'; };
      box.innerHTML = '<p class="ok-note">' + icon('tick') + ' Notifications are on for this phone.</p>' +
        NOTIFY_KINDS.map(function (x) { return '<label class="check"><input type="checkbox" id="nk-' + x[0] + '"' + (k[x[0]] !== false ? ' checked' : '') + ' onchange="notifyPrefsChanged()"> <span><b>' + x[1] + '</b><br><span class="muted">' + x[2] + '</span></span></label>'; }).join('') +
        '<label class="check"><input type="checkbox" id="nk-summary"' + (p.summary ? ' checked' : '') + ' onchange="notifyPrefsChanged()"> <span><b>Evening summary</b><br><span class="muted">Doses marked and fluid in and out, once in the evening.</span></span></label>' +
        '<h3 style="margin-top:14px">Quiet hours</h3><div class="row"><div class="grow"><label for="nqFrom">From</label>' + hours('nqFrom', p.quiet_from) + '</div><div class="grow"><label for="nqTo">Until</label>' + hours('nqTo', p.quiet_to) + '</div></div>' +
        '<label class="check"><input type="checkbox" id="nqUrgent"' + (p.urgent_in_quiet !== false ? ' checked' : '') + ' onchange="notifyPrefsChanged()"> Still tell me about readings past the care team&rsquo;s numbers during quiet hours</label>' +
        '<h3 style="margin-top:14px">On the locked screen</h3><label class="check"><input type="checkbox" id="nDetails"' + (p.details ? ' checked' : '') + ' onchange="notifyPrefsChanged()"> Show the details (otherwise it says &ldquo;Something needs a look&rdquo;)</label>' +
        '<p class="muted">With details on, anyone who can see this phone&rsquo;s screen can read them.</p>' +
        '<div class="btn-row"><button class="btn sm" onclick="notifyTest()">Send a test</button><button class="btn sm ghost" onclick="notifyTurnOff()">Turn off on this phone</button></div><div id="notifyMsg" class="muted" aria-live="polite"></div>';
    });
  }).catch(function (e) { box.innerHTML = '<p class="flag-text">Could not check notifications: ' + esc(e.message) + '</p>'; });
}
function notifySave(sub, prefs) {
  var c = Sync.getClient(), j = sub.toJSON();
  prefs = Object.assign({}, prefs, { tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
  return Sync.householdId().then(function (hid) {
    return c.from('push_subscriptions').upsert({ endpoint: sub.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, household_id: hid, prefs: prefs, device: navigator.userAgent.slice(0, 200), updated_at: new Date().toISOString() }, { onConflict: 'endpoint' });
  }).then(function (r) { if (r.error) throw new Error(r.error.message); });
}
function notifyTurnOn() {
  Notification.requestPermission().then(function (perm) {
    if (perm !== 'granted') { toast('Notifications were not allowed'); return fillNotifyBox(); }
    return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: notifyKey() }); })
      .then(function (sub) { return notifySave(sub, NOTIFY_DEFAULT); })
      .then(function () { toast('Notifications are on for this phone'); fillNotifyBox(); });
  }).catch(function (e) { toast('Could not turn on: ' + e.message); fillNotifyBox(); });
}
var notifyTimer = null;
function notifyPrefsChanged() {
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(function () {
    var on = function (id) { var el = document.getElementById(id); return !!(el && el.checked); }, num = function (id) { return +document.getElementById(id).value; };
    var kinds = {}; NOTIFY_KINDS.forEach(function (x) { kinds[x[0]] = on('nk-' + x[0]); });
    var prefs = { kinds: kinds, summary: on('nk-summary'), quiet_from: num('nqFrom'), quiet_to: num('nqTo'), urgent_in_quiet: on('nqUrgent'), details: on('nDetails'), summary_at: 20 };
    notifyCurrent().then(function (sub) { if (sub) return notifySave(sub, prefs); }).then(function () { var m = document.getElementById('notifyMsg'); if (m) m.textContent = 'Saved.'; })
      .catch(function (e) { toast('Could not save: ' + e.message); });
  }, 400);
}
function notifyTest() {
  var m = document.getElementById('notifyMsg'); if (m) m.textContent = 'Sending a test...';
  Sync.session().then(function (s) {
    return fetch(TCM_CONFIG.SUPABASE_URL + '/functions/v1/notify', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token, apikey: TCM_CONFIG.SUPABASE_ANON_KEY }, body: JSON.stringify({ action: 'test' }) });
  }).then(function (r) { return r.json(); }).then(function (d) {
    if (m) m.textContent = d.sent ? 'Sent. It should arrive within a minute.' : 'Could not send: ' + (d.error || 'the phone did not accept it') + '.';
  }).catch(function (e) { if (m) m.textContent = 'Could not send: ' + e.message; });
}
function notifyTurnOff() {
  notifyCurrent().then(function (sub) {
    if (!sub) return;
    var c = Sync.getClient();
    return c.from('push_subscriptions').delete().eq('endpoint', sub.endpoint).then(function () { return sub.unsubscribe(); });
  }).then(function () { toast('Notifications are off for this phone'); fillNotifyBox(); })
    .catch(function (e) { toast('Could not turn off: ' + e.message); });
}
// Tapping a notification opens ?open=<screen>; go there once the app has loaded.
function notifyOpenFromUrl() {
  var m = /[?&]open=([a-z]+)/.exec(location.search); if (!m) return;
  history.replaceState(null, '', location.pathname);
  if (typeof showScreen === 'function') showScreen(m[1] === 'file' ? 'file' : m[1] === 'diary' ? 'diary' : 'home');
}
