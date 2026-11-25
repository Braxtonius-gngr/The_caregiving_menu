/* Your data: export, delete the family (7-day grace), leave, delete my account.
 * Design: docs/private/product/design/step-c1-export-delete.md. The server function /account
 * makes every check again; these screens only explain and ask.
 * - Owners export the whole family; every member can export their own data.
 * - Exporting the family, deleting the family and deleting your account need a sign-in from the
 *   last 10 minutes (a fresh email code or Google), so an unlocked phone can't be used for them.
 * - Every export, delete request, cancel and leave is logged; owners see the list here. */

// Outside services that handle the family's data, for the export's "who has had your data" sheet.
var DATA_PROCESSORS = [
  ['Supabase', 'Stores the family’s records, photos and sign-ins.'],
  ['Anthropic', 'Reads photos, typed and spoken words when you use Snap it, Say it, Scribe or Ask, to fill in the form. Nothing is saved until you check it.'],
  ['Twilio', 'Checks that a phone number you saved is real (only the number is sent).'],
  ['Cloudflare', 'Checks that a person, not a bot, is signing in (no health data).'],
  ['GitHub', 'Hosts the app’s pages (no health data).'],
  ['openFDA and USDA', 'Get only medicine or food names to look up labels and nutrition (no names of people).']
];

/* ---------- locked family ---------- */
function eraseWhen() { return State.eraseAfter ? new Date(State.eraseAfter).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : ''; }
function eraseBanner() {
  if (!State.eraseAfter) return '';
  return '<div class="card" style="border:2px solid var(--bad)"><h3 class="flag-text" style="margin-top:0">&#9888; This family will be deleted on ' + esc(eraseWhen()) + '</h3>' +
    '<p>Everything (records, photos, history and sign-ins) will be erased for good. Until then you can read and export, but nothing can be added or changed, and the AI is off.</p>' +
    (State.role === 'owner' ? '<div class="btn-row"><button class="btn" onclick="cancelErase()">Cancel the deletion</button><button class="btn ghost" onclick="showScreen(\'settings\')">Export first</button></div>' : '<p class="muted">Only an owner can cancel it.</p>') + '</div>';
}

/* ---------- Settings: Your data ---------- */
function renderYourData() {
  return (Sync.enabled() ? '<h2>Reports</h2><div class="card" id="reportsBox"><p class="muted">Sign in to see reports.</p></div>' : '') + '<h2>Your data</h2><div class="card" id="yourDataBox">' + (Sync.enabled() ? '<p class="muted">Sign in to export or delete.</p>' : '<p class="muted">Everything is on this phone only.</p>') + '</div>' +
    '<h2>This phone only</h2><div class="card"><p class="muted">A backup of what is on this phone, and tools for this phone. They don’t change the family’s data in the cloud.</p><div class="btn-row"><button class="btn ghost" onclick="exportJSON()">Save a phone backup</button><button class="btn ghost" onclick="document.getElementById(\'importFile\').click()">Restore from backup</button><input id="importFile" type="file" accept="application/json,.json" class="hidden" onchange="importJSON(this)"><button class="btn ghost" onclick="loadSample()">Load sample data</button><button class="btn danger" onclick="if(confirm(\'Erase everything on this phone? The family’s data in the cloud stays.\'))DB.wipe().then(function(){location.reload()})">Erase this phone</button></div><p class="muted">v' + TCM_CONFIG.APP_VERSION + '</p></div>';
}
function fillYourData(s) {
  var box = document.getElementById('yourDataBox'); if (!box) return;
  if (!s) { box.innerHTML = '<p class="muted">Sign in above to export or delete.</p>'; return; }
  var owner = State.role === 'owner';
  box.innerHTML = (State.eraseAfter ? eraseBanner() : '') +
    '<h3 style="margin-top:0">Take a copy</h3>' +
    '<p class="muted">Straight from the cloud, with photos and the edit history, plus a list of every outside service that has handled it. The file isn’t locked: keep it somewhere safe.</p>' +
    '<div class="btn-row">' + (owner ? '<button class="btn" onclick="exportStart(\'family\')">Export the family file</button>' : '') + '<button class="btn ghost" onclick="exportStart(\'mine\')">Export my own data</button></div>' +
    '<h3>Leave or delete</h3>' +
    '<div class="btn-row"><button class="btn ghost" onclick="leaveStart(false)">Leave this family</button><button class="btn ghost" onclick="leaveStart(true)">Delete my account</button>' +
    (owner && !State.eraseAfter ? '<button class="btn danger" onclick="deleteFamilyStart()">Delete the family</button>' : '') + '</div>' +
    (owner ? '<div id="dataReqs"></div>' : '');
  if (owner) Sync.dataRequests(15).then(function (rows) {
    var el = document.getElementById('dataReqs'); if (!el || !rows.length) return;
    var what = { export_family: 'downloaded the full family file', export_mine: 'downloaded their own data', delete_family: 'asked to delete the family', cancel_delete: 'cancelled the deletion', leave: 'left the family', delete_me: 'deleted their account' };
    el.innerHTML = '<h3>Recent exports and requests</h3>' + rows.map(function (r) {
      return '<div class="list-item"><div class="grow"><b>' + esc(r.who || 'A former member') + '</b> ' + esc(what[r.kind] || r.kind) + '<div class="muted">' + esc(new Date(r.created_at).toLocaleString()) + '</div></div></div>';
    }).join('');
  });
}

/* ---------- confirm it's you (a sign-in from the last 10 minutes) ---------- */
var freshThen = null;
function needFresh(then) {
  Sync.signedInAgo().then(function (ago) {
    if (ago < 540) return then();
    freshThen = then;
    Sync.session().then(function (s) {
      var google = s && s.user && (s.user.app_metadata || {}).provider === 'google';
      openSheet('<h2 style="margin-top:0" data-nosnap>Confirm it’s you</h2><p>For safety, this needs a fresh sign-in, so nobody can do it from a phone left unlocked.</p>' +
        (google ? '<div class="btn-row"><button class="btn" onclick="signInGoogle()">Continue with Google</button></div><p class="muted">After Google brings you back, tap the same button again.</p><p class="muted">Or use an email code:</p>' : '') +
        '<div class="btn-row"><button class="btn' + (google ? ' ghost' : '') + '" onclick="freshSendCode()">Email me a code</button></div><div id="freshTs"></div>' +
        '<div id="freshCodeRow" class="hidden"><label for="freshCode">Code from the email to ' + esc(s.user.email) + '</label><div class="row"><input id="freshCode" class="grow" inputmode="numeric" autocomplete="one-time-code" maxlength="10"><button class="btn sm" onclick="freshVerify()">Confirm</button></div></div>' +
        '<div class="btn-row"><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>');
    });
  });
}
function freshSendCode() {
  Sync.session().then(function (s) {
    var c = Sync.getClient(), email = s.user.email;
    var go = function (token) {
      c.auth.signInWithOtp({ email: email, options: { shouldCreateUser: false, captchaToken: token || undefined } }).then(function (r) {
        if (r.error) throw r.error;
        document.getElementById('freshCodeRow').classList.remove('hidden');
        toast('We emailed you a code');
      }).catch(function (e) { toast(/rate|limit|seconds/i.test(e.message) ? 'Too many emails just now. Wait a few minutes, then try again.' : e.message); });
    };
    if (!TCM_CONFIG.TURNSTILE_SITE_KEY) return go(null);
    loadTurnstile().then(function (ts) { var box = document.getElementById('freshTs'); box.innerHTML = ''; ts.render(box, { sitekey: TCM_CONFIG.TURNSTILE_SITE_KEY, callback: go }); })
      .catch(function () { toast('Could not load the sign-in check. Try again.'); });
  });
}
function freshVerify() {
  var code = (document.getElementById('freshCode').value || '').replace(/\D/g, '');
  if (code.length < 6) return toast('Type the code from the email');
  Sync.session().then(function (s) {
    return Sync.getClient().auth.verifyOtp({ email: s.user.email, token: code, type: 'email' });
  }).then(function (r) {
    if (r.error) throw r.error;
    closeSheet(); var then = freshThen; freshThen = null; if (then) then();
  }).catch(function (e) { toast(/expired|invalid/i.test(e.message) ? 'That code didn’t work. Check it, or send a new one.' : e.message); });
}
// Runs a server action; if the server says the sign-in is too old, confirm and try once more.
function withFresh(fn) {
  return fn().catch(function (e) {
    if (e && e.code === 'reauth') { needFresh(function () { fn().catch(function (e2) { toast(e2.message); }); }); return; }
    toast(e.message);
  });
}

/* ---------- export ---------- */
var exportReady = null;
function exportStart(scope) {
  var go = function () {
    openSheet('<h2 style="margin-top:0" data-nosnap>Preparing your copy</h2><p id="expStep" class="muted">Starting...</p>');
    var step = function (t) { var el = document.getElementById('expStep'); if (el) el.textContent = t; };
    var run = Sync.run().catch(function () {}).then(function () { return Sync.exportAll(scope, step); });
    run.then(function (out) {
      out.who_has_had_your_data = DATA_PROCESSORS.map(function (p) { return { service: p[0], what: p[1] }; });
      exportReady = out;
      var miss = out.photos_missing.length;
      openSheet('<h2 style="margin-top:0" data-nosnap>Your copy is ready</h2>' +
        '<p>' + Object.keys(out.photos).length + ' photos' + (out.records ? ', ' + out.records.length + ' records' : '') + (out.audit_log ? ', ' + out.audit_log.length + ' edit history entries' : '') + '.</p>' +
        (miss ? '<p class="flag-text">' + miss + ' photo(s) could not be downloaded. Try again on a better connection.</p>' : '') +
        '<div class="btn-row"><button class="btn" onclick="exportSave(\'json\')">Save the data file</button>' + (scope === 'family' ? '<button class="btn ghost" onclick="exportSave(\'html\')">Save the printout</button>' : '') + '</div>' +
        '<p class="muted">The data file can be read by other apps. ' + (scope === 'family' ? 'The printout is for a doctor or a lawyer. ' : '') + 'Neither is locked: keep them somewhere safe.</p>' +
        '<div class="btn-row"><button class="btn ghost" onclick="exportReady=null;closeSheet()">Done</button></div>');
    }).catch(function (e) {
      closeSheet();
      if (e && e.code === 'reauth') return needFresh(function () { exportStart(scope); });
      toast(e.message);
    });
  };
  if (scope === 'family') needFresh(go); else go();
}
function exportSave(kind) {
  var out = exportReady; if (!out) return;
  var name = 'caregiving-' + (out.scope === 'family' ? 'family' : 'my-data') + '-' + todayISO();
  var blob = kind === 'json' ? new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }) : new Blob([exportPrintout(out)], { type: 'text/html' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name + (kind === 'json' ? '.json' : '.html'); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
}
// A readable page: who is in the family, who has had the data, and each person's file.
function exportPrintout(out) {
  var people = (out.members || []).map(function (m) { return '<li>' + esc(memberLabel(m)) + ' (' + esc(m.role || '') + ')</li>'; }).join('');
  var files = State.profiles.map(function (p) { return '<section>' + exportHtml(p.id, p) + '</section>'; }).join('<hr>');
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(out.household_name || 'Family') + ' — family file</title>' +
    '<style>body{font:16px/1.5 system-ui,sans-serif;max-width:800px;margin:2em auto;padding:0 1em;color:#222}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}.muted{color:#666}hr{margin:2em 0}</style></head><body>' +
    '<h1>' + esc(out.household_name || 'Family') + ': family file</h1><p class="muted">Exported ' + esc(new Date(out.exported_at).toLocaleString()) + ' from The Caregiving Menu. The full data, photos and edit history are in the data file saved with this page.</p>' +
    '<h2>People in the family</h2><ul>' + people + '</ul>' +
    '<h2>Who has had your data</h2><ul>' + out.who_has_had_your_data.map(function (p) { return '<li><b>' + esc(p.service) + '</b>: ' + esc(p.what) + '</li>'; }).join('') + '</ul>' +
    '<hr>' + files + '</body></html>';
}

/* ---------- delete the family ---------- */
function deleteFamilyStart() {
  needFresh(function () {
    Sync.householdName().then(function (name) {
      openSheet('<h2 style="margin-top:0" data-nosnap>Delete the family?</h2>' +
        '<p>Everything (every record, photo, the edit history, invites) and the sign-ins of people in no other family will be <b>erased for good after 7 days</b>.</p>' +
        '<p>From now until then the family is locked: everyone can read and export, nobody can add or change anything, and the AI is off. Every member sees the date. Any owner can cancel during the 7 days.</p>' +
        '<p>Export the family file first if you want a copy.</p>' +
        '<label for="delName">To confirm, type the family’s name: <b>' + esc(name) + '</b></label><input id="delName" autocomplete="off">' +
        '<div class="btn-row"><button class="btn danger" onclick="deleteFamilyConfirm()">Delete in 7 days</button><button class="btn ghost" onclick="closeSheet()">Keep the family</button></div>');
    }).catch(function (e) { toast(e.message); });
  });
}
function deleteFamilyConfirm() {
  var typed = document.getElementById('delName').value;
  withFresh(function () {
    return Sync.account('start_delete', { confirm: typed }).then(function (r) {
      closeSheet(); State.eraseAfter = r.erase_after;
      return DB.meta('erase_after', r.erase_after).then(function () { applyRole(State.role); toast('The family will be deleted on ' + eraseWhen() + '. You can cancel until then.'); showScreen('settings'); });
    });
  });
}
function cancelErase() {
  if (!confirm('Cancel the deletion? The family goes back to normal for everyone.')) return;
  Sync.account('cancel_delete').then(function () {
    State.eraseAfter = null;
    return DB.meta('erase_after', null).then(function () { applyRole(State.role); toast('Deletion cancelled'); refresh(); });
  }).catch(function (e) { toast(e.message); });
}

/* ---------- leave / delete my account ---------- */
function leaveStart(deleteAccount) {
  openSheet('<h2 style="margin-top:0" data-nosnap>' + (deleteAccount ? 'Delete your account?' : 'Leave this family?') + '</h2>' +
    (deleteAccount ? '<p>You leave every family you’re in and your sign-in is erased. This can’t be undone.</p>' : '<p>You lose access straight away. An owner can invite you back.</p>') +
    '<p>What you entered stays with the family, because it’s part of the patient’s record.</p>' +
    '<p><b>Your name on what you wrote:</b></p>' +
    '<label class="check"><input type="radio" name="keepName" value="no" checked> Show me as “Former member” (your name is removed for good, including from the edit history)</label>' +
    '<label class="check"><input type="radio" name="keepName" value="yes"> Keep my name on what I wrote</label>' +
    '<p class="muted">A name typed inside a note (“Ana gave the 8 pm pills”) isn’t changed automatically; an owner can edit it.</p>' +
    '<div class="btn-row"><button class="btn danger" onclick="leaveConfirm(' + !!deleteAccount + ')">' + (deleteAccount ? 'Delete my account' : 'Leave the family') + '</button><button class="btn ghost" onclick="closeSheet()">Stay</button></div>');
}
function leaveConfirm(deleteAccount) {
  var keep = (document.querySelector('input[name="keepName"]:checked') || {}).value === 'yes';
  var done = function () {
    closeSheet();
    var clear = deleteAccount ? DB.wipe().then(function () { return Sync.signOut(); })
      : Promise.all([DB.meta('household_id', null), DB.meta('last_pull', null), DB.meta('my_role', null), DB.meta('family_members', null), DB.meta('erase_after', null)]);
    return clear.then(function () { toast(deleteAccount ? 'Your account was deleted' : 'You left the family'); setTimeout(function () { location.reload(); }, 800); });
  };
  var call = function () { return Sync.account(deleteAccount ? 'delete_me' : 'leave', { keep_name: keep }).then(done); };
  if (deleteAccount) needFresh(function () { withFresh(call); }); else withFresh(call);
}
