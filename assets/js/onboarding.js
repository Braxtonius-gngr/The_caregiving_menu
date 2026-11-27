/* First run for a new family, sign-in with Google, and the consent notices.
 * - Signed out with nobody cared for yet: Today shows a welcome card (Google, or email).
 * - Signed in with nobody cared for yet: two short screens (who, and their permission).
 * - Then a Getting started card on Today until its four steps are done (families set up this way only).
 * - The AI notice shows once per person before the first Snap it / Say it / Scribe / Ask her file.
 * Consents are stored in the consents table (who, what, version, when). */

var TS_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function signInGoogle() {
  var c = Sync.getClient(); if (!c) return toast('The app is not connected to its cloud yet');
  c.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.href.split('#')[0].split('?')[0] } })
    .then(function (r) { if (r.error) toast('Google sign-in: ' + r.error.message); });
}
// Email link, with bot protection when a Turnstile site key is configured.
function signInEmail(inputId, boxId) {
  var email = (document.getElementById(inputId) || {}).value || '';
  if (!/^\S+@\S+\.\S+$/.test(email.trim())) return toast('Type your email address');
  var go = function (token) {
    var c = Sync.getClient();
    c.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: location.href.split('#')[0].split('?')[0], captchaToken: token || undefined } })
      .then(function (r) {
        if (r.error) throw r.error;
        try { localStorage.setItem('tcm-signin-email', email.trim()); } catch (e) { /* blocked */ }
        S.codeFor = email.trim(); refresh(); if (currentScreen === 'settings') renderAuthBox();
        toast('We emailed you a sign-in code');
      }).catch(function (e) { toast(/rate|limit|seconds/i.test(e.message) ? 'Too many emails just now. Wait a few minutes, then try again.' : e.message); });
  };
  if (!TCM_CONFIG.TURNSTILE_SITE_KEY) return go(null);
  var box = document.getElementById(boxId); if (!box) return go(null);
  loadTurnstile().then(function (ts) {
    box.innerHTML = ''; ts.render(box, { sitekey: TCM_CONFIG.TURNSTILE_SITE_KEY, callback: go, 'error-callback': function () { toast('Could not check you are a person. Try again.'); } });
  }).catch(function () { toast('Could not load the sign-in check. Try again.'); });
}
// The code from the email, typed into the app. On iPhone the link opens Safari, which is a separate
// sign-in from the home-screen app, so the code is the dependable way in.
function codeEmail() { if (S.codeFor) return S.codeFor; try { return localStorage.getItem('tcm-signin-email') || ''; } catch (e) { return ''; } }
function verifyCode(id) {
  var email = codeEmail(), code = ((document.getElementById(id) || {}).value || '').replace(/\D/g, '');
  if (code.length < 6) return toast('Type the code from the email');
  Sync.getClient().auth.verifyOtp({ email: email, token: code, type: 'email' }).then(function (r) {
    if (r.error) throw r.error;
    try { localStorage.removeItem('tcm-signin-email'); } catch (e) { /* blocked */ }
    S.codeFor = null; State.signedIn = true; toast('Signed in');
    return syncNow();
  }).then(function () { refresh(); if (currentScreen === 'settings') renderAuthBox(); })
    .catch(function (e) { toast(/expired|invalid/i.test(e.message) ? 'That code didn\u2019t work or has expired. Send a new one.' : e.message); });
}
function cancelCode() { try { localStorage.removeItem('tcm-signin-email'); } catch (e) { /* blocked */ } S.codeFor = null; refresh(); if (currentScreen === 'settings') renderAuthBox(); }
var _tsP = null;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return _tsP || (_tsP = new Promise(function (ok, bad) { var s = document.createElement('script'); s.src = TS_URL; s.async = true; s.onload = function () { ok(window.turnstile); }; s.onerror = bad; document.head.appendChild(s); }));
}
function signInBlock(id) {
  var g = TCM_CONFIG.GOOGLE_SIGNIN, waiting = codeEmail();
  if (waiting) {
    return '<div class="code-box"><p>We emailed a sign-in code to <b>' + esc(waiting) + '</b>. Type it here:</p>' +
      '<input id="' + id + 'Code" class="code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="12345678">' +
      '<div class="btn-row"><button class="btn" onclick="verifyCode(\'' + id + 'Code\')">Sign in</button><button class="btn ghost" onclick="cancelCode()">Use a different email</button></div>' +
      '<p class="muted small">No email? Check spam, or wait a minute and use a different email to send again. You can also tap the link in the email on this phone.</p></div>';
  }
  return (g ? '<div class="btn-row"><button class="btn google-btn" onclick="signInGoogle()"><span class="g-logo">G</span> Continue with Google</button></div>' : '') +
    '<details class="email-signin"' + (g ? '' : ' open') + '><summary class="muted">' + (g ? 'Or use your email' : 'Sign in with your email') + '</summary><div class="row"><input id="' + id + 'Email" type="email" class="grow" placeholder="you@example.com" autocomplete="email" autocapitalize="none" spellcheck="false" inputmode="email">' +
    '<button class="btn" onclick="signInEmail(\'' + id + 'Email\',\'' + id + 'Ts\')">Send code</button></div><div id="' + id + 'Ts"></div></details>' +
    '<p class="muted small">By continuing you agree to the <a href="legal/terms.html" target="_blank" rel="noopener">terms</a> and <a href="legal/privacy.html" target="_blank" rel="noopener">privacy policy</a> (drafts under legal review), including the <a href="legal/health-data.html" target="_blank" rel="noopener">health data policy</a>, and confirm you are 18 or older.</p>';
}

/* ---------- Today when nobody is cared for yet ---------- */
function welcomeCard() {
  if (!State.signedIn) {
    return '<div class="card welcome">' + art('welcome') + '<h2 style="margin-top:0">Welcome to The Caregiving Menu</h2>' +
      '<p>One shared record for the family caring for someone at home: medicines, drinks and output, readings, visits and papers. Snap a photo or just say what happened, and it fills itself in for you to check.</p>' +
      signInBlock('w') +
      '<p class="muted">Joining a family? Open the invite link they sent you, then sign in.</p></div>';
  }
  return '<div class="card welcome"><h2 style="margin-top:0">Let&rsquo;s set up</h2><p>First, who are you caring for? It takes a minute.</p>' +
    '<div class="btn-row"><button class="btn" onclick="welcomeStep1()">Start</button></div>' +
    '<p class="muted">Joining someone else&rsquo;s family instead? Open the invite link they sent you.</p></div>';
}
function welcomeStep1() {
  S.welcome = S.welcome || { who: 'someone' };
  openSheet('<h2 style="margin-top:0">Who are you caring for?</h2>' +
    '<label for="wcName">Their name (or what the family calls them)</label><input id="wcName" data-autosave value="' + esc(S.welcome.name || '') + '" placeholder="e.g. Grandma Rose">' +
    '<div class="chips" id="wcWho"><button type="button" class="chip' + (S.welcome.who !== 'me' ? ' on' : '') + '" data-v="someone" onclick="pickChip(\'wcWho\',this)">Someone else</button><button type="button" class="chip' + (S.welcome.who === 'me' ? ' on' : '') + '" data-v="me" onclick="pickChip(\'wcWho\',this)">Myself</button></div>' +
    '<div class="btn-row"><button class="btn" onclick="welcomeStep2()">Next</button><button class="btn ghost" onclick="closeSheet()">Later</button></div>');
}
function welcomeStep2() {
  var name = (document.getElementById('wcName').value || '').trim();
  if (!name) return toast('Type their name first');
  S.welcome.name = name; S.welcome.who = chipValue('wcWho') || 'someone';
  if (S.welcome.who === 'me') return welcomeSave('self');
  openSheet('<h2 style="margin-top:0">Is ' + esc(name) + ' OK with this?</h2>' +
    '<p>The family will keep notes about ' + esc(name) + '&rsquo;s health here. It&rsquo;s their information, so it matters that they agree, or that someone can decide for them.</p>' +
    '<div class="chips col" id="wcAuth">' +
    '<button type="button" class="chip" data-v="agreed" onclick="pickChip(\'wcAuth\',this)">' + esc(name) + ' agreed</button>' +
    '<button type="button" class="chip" data-v="representative" onclick="pickChip(\'wcAuth\',this)">I can decide for them (power of attorney, guardian)</button>' +
    '<button type="button" class="chip" data-v="not_asked" onclick="pickChip(\'wcAuth\',this)">Not asked yet</button></div>' +
    '<p class="muted">If not yet, ask when you can; you can change this answer in their profile.</p>' +
    '<div class="btn-row"><button class="btn" onclick="welcomeSave()">Done</button><button class="btn ghost" onclick="welcomeStep1()">Back</button></div>');
}
function welcomeSave(auth) {
  auth = auth || chipValue('wcAuth');
  if (!auth) return toast('Pick one answer');
  var name = S.welcome.name, now = new Date().toISOString();
  DB.put('diet_profiles', { person_name: name, notes: '', daily_targets: {}, care_settings: { authority: auth, authority_at: now, onboarded_at: now, self: auth === 'self' } })
    .then(function (p) {
      State.activeProfile = p.id; DB.meta('active_profile', p.id);
      recordConsent('patient_authority', { profile: p.id, answer: auth });
      return Sync.householdName().then(function (n) { if (!n || n === 'Home') return Sync.setHouseholdName(auth === 'self' ? name + '’s care' : name + '’s family'); }).catch(function () {});
    })
    .then(function () { S.welcome = null; closeSheet(); return loadAll(); })
    .then(function () { refresh(); if (Sync.enabled()) syncNow(); firstRunMeds(State.activeProfile, name); })
    .catch(function (e) { toast('Could not save: ' + e.message); });
}

// First run (Step B): straight from setup to the medicine list, the thing a new family most needs.
// Snap it reads papers or bottles into a list to confirm line by line; typing one in is the fallback.
function firstRunMeds(pid, name) {
  var a = pid ? '\'' + pid + '\'' : 'null';
  openSheet(art('first-meds', 'small') + '<h2 style="margin-top:0">Do you have ' + esc(name) + '&rsquo;s medicines nearby?</h2>' +
    '<p>Hospital papers, a medicine list or the pill bottles all work. Take a photo and the app reads them into a list for you to check, one line at a time. Nothing is saved until you confirm it.</p>' +
    '<div class="btn-col"><button class="btn" onclick="closeSheet();snapIt(' + a + ')">' + icon('camera') + ' Snap them now</button>' +
    '<button class="btn ghost" onclick="closeSheet();editRecord(null,\'medication\',' + a + ')">Type a medicine in</button>' +
    '<button class="btn ghost" onclick="closeSheet();toast(\'You can do this any time from Getting started on Today.\')">Not now</button></div>');
}

/* ---------- Getting started (families set up through the welcome screens) ---------- */
function gsHidden() { try { return localStorage.getItem('tcm-gs-hide') === '1'; } catch (e) { return false; } }
function isInstalled() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
function gettingStarted(pid) {
  var p = State.profiles.find(function (x) { return x.id === pid; });
  if (!p || !(p.care_settings || {}).onboarded_at || gsHidden()) return '';
  var cs = p.care_settings || {}, a = pid ? '\'' + pid + '\'' : 'null';
  var steps = [
    [recordsOf(pid, ['medication']).length > 0, 'Snap the hospital papers, medicine list or pill bottles', 'It reads them and builds the medicine list for you to check.', 'snapIt(' + a + ')'],
    [Object.keys(State.memberNames || {}).length > 1, 'Invite a helper', 'A sibling or friend who helps; they can add notes too.', 'shareInvite(\'caregiver\')'],
    [isInstalled(), 'Add the app to your home screen', 'So it opens like any other app.', 'showInstallGuide()'],
    [!!(cs.wake_time && cs.bed_time), 'Set when ' + esc(p.person_name) + ' usually wakes and goes to bed', 'Medicine times and the day&rsquo;s summary use these.', 'editProfileSettings(' + a + ')']
  ];
  var done = steps.filter(function (s) { return s[0]; }).length;
  if (done === steps.length) return '';
  return '<div class="card gs"><div class="row between"><h3>' + icon('star') + ' Getting started</h3><span class="muted">' + done + ' of ' + steps.length + '</span></div>' +
    steps.map(function (s) { return '<div class="list-item' + (s[0] ? ' gs-done' : ' tappable') + '"' + (s[0] ? '' : ' onclick="' + s[3] + '"') + '><div class="grow"><b>' + (s[0] ? '&#10003; ' : '') + s[1] + '</b>' + (s[0] ? '' : '<div class="muted">' + s[2] + '</div>') + '</div>' + (s[0] ? '' : '<span class="muted">&rsaquo;</span>') + '</div>'; }).join('') +
    '<div class="btn-row"><button class="btn sm ghost" onclick="gsHide()">Hide this</button></div></div>';
}
function gsHide() { try { localStorage.setItem('tcm-gs-hide', '1'); } catch (e) { /* blocked */ } refresh(); }
function editProfileSettings(pid) { if (typeof editProfile === 'function') return editProfile(pid); showScreen('settings'); }
function showInstallGuide() {
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  openSheet('<h2 style="margin-top:0">Add it to your home screen</h2>' +
    (ios ? '<ol><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (the square with an arrow, at the bottom).</li><li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>'
      : '<ol><li>Open this page in <b>Chrome</b>.</li><li>Tap the <b>&#8942;</b> menu (top right).</li><li>Tap <b>Add to home screen</b> or <b>Install app</b>, then <b>Install</b>.</li></ol>') +
    '<p class="muted">Then open it from the new icon. It works like any other app, even with a weak signal.</p>' +
    '<div class="btn-row"><button class="btn" onclick="closeSheet()">OK</button></div>');
}

/* ---------- Consents ---------- */
function recordConsent(type, detail) {
  var c = Sync.enabled() && Sync.getClient(); if (!c) return Promise.resolve();
  return Sync.householdId().then(function (hid) { if (hid) return c.from('consents').insert({ household_id: hid, type: type, detail: detail || {} }); }).catch(function () {});
}
// The AI notice: once per person per device, before the first AI capture.
function aiNoticeSeen() { try { return localStorage.getItem('tcm-ai-notice') === '1'; } catch (e) { return true; } }
function aiGate(run, manual) {
  if (aiNoticeSeen()) return run();
  S.aiGate = { run: run, manual: manual };
  openSheet('<h2 style="margin-top:0">Before you use the AI helpers</h2>' +
    '<ul><li>Photos, your words and her saved notes are sent to our AI service (Anthropic) to fill in forms and answer questions. They are not used to train AI.</li>' +
    '<li>Nothing is saved until you check it, and anything it isn&rsquo;t sure of is flagged for a person to confirm.</li>' +
    '<li>It is not medical advice. Questions about treatment go to her care team.</li></ul>' +
    '<div class="btn-row"><button class="btn" onclick="aiGateOk()">OK, continue</button><button class="btn ghost" onclick="aiGateManual()">Type it myself instead</button></div>');
}
function aiGateOk() {
  try { localStorage.setItem('tcm-ai-notice', '1'); } catch (e) { /* blocked */ }
  recordConsent('ai_notice', {});
  var g = S.aiGate; S.aiGate = null; if (g) g.run();
}
function aiGateManual() { var g = S.aiGate; S.aiGate = null; closeSheet(); if (g && g.manual) g.manual(); }
var _obSnapIt = snapIt, _obSayIt = sayIt, _obScribeIt = scribeIt, _obAskRun = askRun;
snapIt = function () { var a = arguments; aiGate(function () { _obSnapIt.apply(null, a); }, function () { openCapture(); }); };
sayIt = function () { var a = arguments; aiGate(function () { _obSayIt.apply(null, a); }, function () { openCapture(); }); };
scribeIt = function () { var a = arguments; aiGate(function () { _obScribeIt.apply(null, a); }, function () { editRecord(null, 'visit', a[0] || null); }); };
askRun = function () { var a = arguments; aiGate(function () { _obAskRun.apply(null, a); }, null); };
