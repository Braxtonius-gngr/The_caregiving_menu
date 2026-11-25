/* "This was wrong?" under AI results and "Something's wrong?" in help. Design: step-c2-reports.md.
 * - The phone remembers the last AI call per feature (Sync.lastAi): what was sent (without the
 *   photos), what came back, and the photos. A report sends exactly that, with the photos copied
 *   to <family>/reports/.
 * - A report changes nothing in the record; fixing an entry is still done by editing it.
 * - Owners see their family's reports in Settings; senders see their own; the app maker sees all
 *   on the Reports screen and is the only one who sets status or replies (row-level security). */

var AI_FEATURES = {
  read_photo: 'Snap it', fill_form: 'Fill from a photo', quick_log: 'Say it', scribe: 'Scribe', ask_file: 'Ask her file',
  handoff: 'Catch me up', guidance: 'Guidance answer', schedule_draft: 'Schedule draft', timing_questions: 'Pharmacist questions', meal_ideas: 'Meal ideas',
  parse_recipe: 'Recipe reading', parse_receipt: 'Receipt reading', pantry_photo: 'Pantry photo', estimate_plate: 'Plate estimate',
  appointment_summary: 'Appointment summary', diet_swaps: 'Diet swaps', variations: 'Recipe variations'
};
var REPORT_CHOICES = [['misread', 'Misread a word or number'], ['medicine', 'Wrong medicine or dose'], ['time', 'Wrong time or date'],
  ['missed', 'Missed something'], ['made_up', 'Made something up'], ['other', 'Something else']];
var REPORT_STATUS = { 'new': ['Sent', ''], seen: ['Seen', 'warn'], fixed: ['Fixed', 'ok'] };

// The link under an AI result. Marks that call as shown so openSheet doesn't add a second one.
function aiWrongLink(mode) {
  var l = Sync.lastAi(mode); if (!l) return '';
  l.shown = true;
  return '<p class="ai-wrong"><button class="linkish" onclick="reportStart(\'ai\',\'' + mode + '\')">This was wrong?</button></p>';
}
// openSheet adds the link to a sheet that shows an AI result just received (Snap it and others).
function aiWrongAppend(html) {
  var l = Sync.lastAi();
  if (!l || l.shown || Date.now() - l.at > 10000 || html.indexOf('ai-wrong') >= 0) return html;
  return html + aiWrongLink(l.mode);
}

function reportStart(kind, mode) {
  var ai = kind === 'ai' ? Sync.lastAi(mode) : null;
  S.reportCtx = { kind: kind, mode: mode || null, ai: ai, screen: S.lastScreen || currentScreen };
  var photos = ai ? reportImages(ai.payload).length : 0;
  openSheet('<h2 style="margin-top:0" data-nosnap>' + (kind === 'ai' ? 'What was wrong?' : 'Something’s wrong?') + '</h2>' +
    (kind === 'ai' ? '<p class="muted">About: ' + esc(AI_FEATURES[mode] || mode) + '</p>' + REPORT_CHOICES.map(function (c) { return '<label class="check"><input type="checkbox" name="repChoice" value="' + c[0] + '"> ' + c[1] + '</label>'; }).join('')
      : '<p class="muted">A bug, confusing words, sync trouble, something missing: anything.</p>') +
    '<label for="repText">' + (kind === 'ai' ? 'In your own words (what should it have said?)' : 'What happened?') + '</label><textarea id="repText" rows="4" maxlength="2000"></textarea>' +
    '<p class="note">' + (kind === 'ai' ? 'Your words, what the AI filled in' + (photos ? ', and the photo' + (photos > 1 ? 's' : '') + ' it read' : '') : 'Your words, the screen you were on, the app version and your phone type') +
    ' go to the family’s owners and to the app maker, to fix the mistake. Nothing in the record changes; edit the entry to correct it.</p>' +
    '<div class="btn-row"><button class="btn" id="repSend" onclick="reportSend()">Send</button><button class="btn ghost" onclick="closeSheet()">Cancel</button></div>');
}
function reportImages(p) {
  if (!p) return [];
  return [].concat(p.images || [], p.image ? [p.image] : []).filter(function (x) { return typeof x === 'string' && x.indexOf('data:image') === 0; });
}
function clipJson(v, n) { var s = JSON.stringify(v == null ? null : v); return s && s.length > n ? { clipped: s.slice(0, n) } : v; }
function dataUrlBlob(u) {
  var parts = u.split(','), mime = (parts[0].match(/data:([^;]+)/) || [])[1] || 'image/jpeg', bin = atob(parts[1]), a = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new Blob([a], { type: mime });
}
function reportSend() {
  var ctx = S.reportCtx || {}, text = (document.getElementById('repText').value || '').trim();
  var choices = [].map.call(document.querySelectorAll('input[name="repChoice"]:checked'), function (x) { return x.value; });
  if (!text && !choices.length) return toast('Say what was wrong first');
  if (!Sync.enabled()) return toast('Reports need the cloud. Sign in first.');
  var btn = document.getElementById('repSend'); if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
  var c = Sync.getClient(), id = DB.uuid(), hid, uid;
  Promise.all([Sync.householdId(), Sync.session()]).then(function (r) {
    hid = r[0]; uid = r[1] && r[1].user.id;
    if (!hid || !uid) throw new Error('Sign in first.');
    var imgs = ctx.ai ? reportImages(ctx.ai.payload) : [];
    return Promise.all(imgs.map(function (u, i) {
      var path = hid + '/reports/' + id + '-' + (i + 1) + '.jpg';
      return c.storage.from('photos').upload(path, dataUrlBlob(u), { contentType: 'image/jpeg' }).then(function (res) { return res.error ? null : path; });
    }));
  }).then(function (paths) {
    var input = ctx.ai ? Object.assign({}, ctx.ai.payload) : null;
    if (input) { delete input.images; delete input.image; }
    return c.from('reports').insert({
      id: id, household_id: hid, user_id: uid, who: (State.memberNames || {})[uid] || null, kind: ctx.kind, feature: ctx.kind === 'ai' ? ctx.mode : ctx.screen,
      choices: choices, comment: text || null, ai_input: clipJson(input, 20000), ai_output: ctx.ai ? clipJson(ctx.ai.result, 30000) : null,
      photo_paths: paths.filter(Boolean), app_version: TCM_CONFIG.APP_VERSION, device: navigator.userAgent.slice(0, 200)
    }).then(function (res) { if (res.error) throw res.error; });
  }).then(function () { closeSheet(); toast('Thanks. Sent to the family’s owners and the app maker.'); })
    .catch(function (e) { if (btn) { btn.disabled = false; btn.textContent = 'Send'; } toast('Could not send: ' + e.message); });
}

/* ---------- Settings: the family's reports ---------- */
function fillReports(s) {
  var box = document.getElementById('reportsBox'); if (!box) return;
  if (!s) { box.innerHTML = '<p class="muted">Sign in to see reports.</p>'; return; }
  var c = Sync.getClient();
  Promise.all([Sync.householdId(), c.rpc('is_app_admin')]).then(function (r) {
    var admin = r[1] && r[1].data === true;
    return c.from('reports').select('id, who, kind, feature, choices, comment, status, reply, created_at').eq('household_id', r[0]).order('created_at', { ascending: false }).limit(30).then(function (q) {
      var rows = q.data || [];
      box.innerHTML = '<p class="muted">' + (State.role === 'owner' ? 'Everything your family has reported, and the app maker’s replies.' : 'What you have reported, and the app maker’s replies.') + ' To report something, tap <b>This was wrong?</b> under an AI result, or <b>Something’s wrong?</b> in the ? help.</p>' +
        (rows.length ? rows.map(reportRow).join('') : '<p class="muted">No reports yet.</p>') +
        (admin ? '<div class="btn-row"><button class="btn sm" onclick="showScreen(\'reports\')">Open all reports (app maker)</button></div>' : '');
    });
  }).catch(function (e) { box.innerHTML = '<p class="muted">Couldn’t load reports: ' + esc(e.message) + '</p>'; });
}
function reportRow(r) {
  var st = REPORT_STATUS[r.status] || [r.status, ''];
  var what = r.kind === 'ai' ? (AI_FEATURES[r.feature] || r.feature) : 'App problem' + (r.feature ? ' (' + r.feature + ')' : '');
  var picks = (r.choices || []).map(function (k) { return (REPORT_CHOICES.find(function (c) { return c[0] === k; }) || [k, k])[1]; });
  return '<div class="list-item"><div class="grow"><b>' + esc(what) + '</b> <span class="badge ' + st[1] + '">' + st[0] + '</span>' +
    '<div class="muted">' + esc((r.who || 'A former member') + ' · ' + new Date(r.created_at).toLocaleString()) + '</div>' +
    (picks.length ? '<div>' + esc(picks.join(', ')) + '</div>' : '') + (r.comment ? '<div>' + esc(r.comment) + '</div>' : '') +
    (r.reply ? '<div class="ok-note">App maker: ' + esc(r.reply) + '</div>' : '') + '</div></div>';
}

/* ---------- Reports screen (app maker only; the database refuses anyone else) ---------- */
function renderReports(arg) {
  var which = (arg && arg.status) || 'open';
  setTimeout(function () { loadAdminReports(which); }, 0);
  return '<div class="seg" role="tablist">' + [['open', 'Open'], ['fixed', 'Fixed'], ['all', 'All']].map(function (t) { return '<button role="tab" aria-selected="' + (t[0] === which) + '" class="seg-btn' + (t[0] === which ? ' on' : '') + '" onclick="showScreen(\'reports\',{status:\'' + t[0] + '\'})">' + t[1] + '</button>'; }).join('') + '</div>' +
    '<p class="muted">Reports from every family. Health details: read here only, never copy them anywhere public.</p><div id="adminReports">Loading...</div>';
}
function loadAdminReports(which) {
  var c = Sync.getClient(), box = function () { return document.getElementById('adminReports'); };
  if (!c) return;
  var q = c.from('reports').select('*').order('created_at', { ascending: false }).limit(100);
  if (which === 'open') q = q.neq('status', 'fixed'); else if (which === 'fixed') q = q.eq('status', 'fixed');
  q.then(function (r) {
    if (!box()) return;
    if (r.error) { box().innerHTML = '<p class="muted">' + esc(r.error.message) + '</p>'; return; }
    S.adminReports = {}; (r.data || []).forEach(function (x) { S.adminReports[x.id] = x; });
    box().innerHTML = (r.data || []).length ? r.data.map(function (x) {
      return '<div class="card">' + reportRow(x) +
        '<div class="muted">Family ' + esc(String(x.household_id).slice(0, 8)) + ' · v' + esc(x.app_version || '?') + ' · ' + esc((x.device || '').slice(0, 60)) + '</div>' +
        (x.photo_paths && x.photo_paths.length ? '<div class="row" id="rp-' + x.id + '"></div>' : '') +
        (x.ai_output ? '<details><summary>What the AI said</summary><pre class="prewrap">' + esc(JSON.stringify(x.ai_output, null, 1)) + '</pre></details>' : '') +
        (x.ai_input ? '<details><summary>What it was given (without photos)</summary><pre class="prewrap">' + esc(JSON.stringify(x.ai_input, null, 1)) + '</pre></details>' : '') +
        '<label for="rr-' + x.id + '">Reply the family sees</label><input id="rr-' + x.id + '" maxlength="500" value="' + esc(x.reply || '') + '">' +
        '<div class="btn-row"><button class="btn sm ghost" onclick="adminReport(\'' + x.id + '\',\'seen\')">Mark seen</button><button class="btn sm" onclick="adminReport(\'' + x.id + '\',\'fixed\')">Mark fixed</button></div></div>';
    }).join('') : '<p class="muted">Nothing here.</p>';
    (r.data || []).forEach(function (x) {
      (x.photo_paths || []).forEach(function (p) {
        c.storage.from('photos').createSignedUrl(p, 600).then(function (u) {
          var el = document.getElementById('rp-' + x.id); if (!el || !u.data) return;
          el.insertAdjacentHTML('beforeend', '<a href="' + esc(u.data.signedUrl) + '" target="_blank" rel="noopener"><img class="photo-thumb" alt="Photo the AI read" src="' + esc(u.data.signedUrl) + '"></a>');
        });
      });
    });
  });
}
function adminReport(id, status) {
  var reply = (document.getElementById('rr-' + id) || {}).value || '';
  Sync.getClient().from('reports').update({ status: status, reply: reply.trim() || null, updated_at: new Date().toISOString() }).eq('id', id).select('id')
    .then(function (r) { if (r.error || !(r.data || []).length) throw new Error((r.error && r.error.message) || 'Not allowed'); toast(status === 'fixed' ? 'Marked fixed' : 'Marked seen'); refresh(); })
    .catch(function (e) { toast(e.message); });
}
