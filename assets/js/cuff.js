/* Blood pressure cuff: read stored readings over Bluetooth (Chrome on Android, standard Blood
 * Pressure Service), or photograph the cuff's screen and let the AI read it. Nothing is saved
 * without the family seeing it first. A diagnostic log helps when a cuff won't connect. */

var BP_SERVICE = 0x1810, BP_MEASUREMENT = 0x2a35, CURRENT_TIME_SERVICE = 0x1805, CURRENT_TIME = 0x2a2b;
function cuffSupported() { return !!(navigator.bluetooth && navigator.bluetooth.requestDevice); }
function cuffLog(msg) {
  S.cuffLog = (S.cuffLog || []).concat(new Date().toLocaleTimeString() + '  ' + msg).slice(-80);
  var el = document.getElementById('cuffLog'); if (el) el.textContent = S.cuffLog.join('\n');
}
function cuffUser(pid) { return +careSettingsOf(pid).cuff_user || 1; }

function connectCuff(pid) {
  S.cuffFound = [];
  openSheet('<h2 style="margin-top:0">Get readings from the cuff</h2>' +
    (cuffSupported() ? '' : '<p class="note">This phone or browser can\'t use Bluetooth from a web page. Use Chrome on an Android phone, or <b>Snap the cuff screen</b> instead.</p>') +
    '<ol class="q-list"><li>Turn the cuff <b>off</b>.</li><li>First time only: hold the cuff\'s Bluetooth / transfer button 3 to 5 seconds until a <b>P</b> flashes (pairing). After that, a short press until it flashes <b>O</b> (send readings).</li><li>Tap <b>Search</b> and pick the cuff (often named BLESmart...). If the phone asks to pair, allow it.</li></ol>' +
    '<label for="cuffUser">Her user number on the cuff</label><select id="cuffUser"><option value="1"' + (cuffUser(pid) === 1 ? ' selected' : '') + '>User 1</option><option value="2"' + (cuffUser(pid) === 2 ? ' selected' : '') + '>User 2</option></select>' +
    '<div class="btn-row"><button class="btn" onclick="searchCuff(' + pidArg(pid) + ')"' + (cuffSupported() ? '' : ' disabled') + '>Search</button><button class="btn ghost" onclick="closeSheet()">Close</button></div>' +
    '<div id="cuffResult" aria-live="polite"></div>' +
    '<details><summary class="muted">Connection log</summary><pre id="cuffLog" class="prewrap cuff-log">' + esc((S.cuffLog || []).join('\n')) + '</pre><button class="btn sm ghost" onclick="copyText((S.cuffLog||[]).join(\'\\n\'),\'Log copied\')">Copy log</button></details>');
}
// Omron sets the date and time only through the app it is paired with; write the phone's
// time too, so new readings carry the right time. Failure here is logged, not fatal.
function writeCurrentTime(server) {
  return server.getPrimaryService(CURRENT_TIME_SERVICE).then(function (s) { return s.getCharacteristic(CURRENT_TIME); }).then(function (c) {
    var d = new Date(), y = d.getFullYear();
    var buf = new Uint8Array([y & 255, y >> 8, d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), ((d.getDay() + 6) % 7) + 1, 0, 1]);
    return (c.writeValueWithResponse ? c.writeValueWithResponse(buf) : c.writeValue(buf)).then(function () { cuffLog('Set the cuff clock to the phone time'); });
  }).catch(function (e) { cuffLog('Clock not set (' + e.message + ')'); });
}
function searchCuff(pid) {
  var userSel = document.getElementById('cuffUser'), want = +(userSel && userSel.value) || 1, res = document.getElementById('cuffResult');
  S.cuffFound = []; var device, idle;
  res.innerHTML = '<p class="muted">Pick the cuff in the list...</p>';
  navigator.bluetooth.requestDevice({ filters: [{ services: [BP_SERVICE] }, { namePrefix: 'BLESmart' }, { namePrefix: 'BLEsmart' }, { namePrefix: 'OMRON' }], optionalServices: [BP_SERVICE, CURRENT_TIME_SERVICE, 'device_information', 'battery_service'] })
    .then(function (d) { device = d; cuffLog('Picked ' + (d.name || 'a device')); res.innerHTML = '<p class="muted">Connecting...</p>'; return d.gatt.connect(); })
    .then(function (server) {
      cuffLog('Connected'); device.addEventListener('gattserverdisconnected', function () { cuffLog('Cuff disconnected'); finishCuff(pid, want); });
      return writeCurrentTime(server).then(function () { return server.getPrimaryService(BP_SERVICE); });
    })
    .then(function (svc) { cuffLog('Found the blood pressure service'); return svc.getCharacteristic(BP_MEASUREMENT); })
    .then(function (ch) {
      ch.addEventListener('characteristicvaluechanged', function (ev) {
        var v = ev.target.value, bytes = []; for (var i = 0; i < v.byteLength; i++) bytes.push(v.getUint8(i));
        var r = Logic.parseBpMeasurement(bytes); S.cuffFound.push(r);
        cuffLog('Reading: ' + r.sys + '/' + r.dia + (r.pulse != null ? ' pulse ' + r.pulse : '') + (r.time ? ' at ' + r.time.y + '-' + r.time.mo + '-' + r.time.d + ' ' + r.time.h + ':' + (r.time.mi < 10 ? '0' : '') + r.time.mi : ' (no time)') + (r.user != null ? ' user ' + r.user : '') + (r.irregular ? ' IRREGULAR' : ''));
        res.innerHTML = '<p class="muted">Receiving... ' + S.cuffFound.length + ' reading(s)</p>';
        clearTimeout(idle); idle = setTimeout(function () { try { device.gatt.disconnect(); } catch (e) { finishCuff(pid, want); } }, 6000);
      });
      return ch.startNotifications().then(function () {
        cuffLog('Waiting for readings (the cuff sends its stored readings now)');
        res.innerHTML = '<p class="muted">Waiting for the cuff to send readings...</p>';
        idle = setTimeout(function () { try { device.gatt.disconnect(); } catch (e) { finishCuff(pid, want); } }, 20000);
      });
    })
    .catch(function (e) {
      cuffLog('Stopped: ' + e.name + ': ' + e.message);
      res.innerHTML = '<p class="note">' + (e.name === 'NotFoundError' ? 'No cuff picked. Make sure the P or O is flashing, then Search again.' : e.name === 'SecurityError' || e.name === 'NotAllowedError' ? 'Bluetooth permission was blocked. Allow Bluetooth for this site in Chrome settings and try again.' : 'Could not read the cuff: ' + esc(e.message) + '. Open the connection log below and send it to whoever set up the app.') + '</p>';
    });
}
// Called once the cuff disconnects (it does after sending everything) or goes quiet.
function finishCuff(pid, want) {
  if (S.cuffFinishing) return; S.cuffFinishing = true; setTimeout(function () { S.cuffFinishing = false; }, 1500);
  var res = document.getElementById('cuffResult'); if (!res) return;
  var mine = S.cuffFound.filter(function (r) { return r.user == null || r.user === want; });
  var rows = mine.map(function (r) {
    var at = r.time && r.time.y > 2000 ? new Date(r.time.y, r.time.mo - 1, r.time.d, r.time.h, r.time.mi, r.time.s) : null;
    return { r: r, at: at, dup: at ? isDuplicateBp(pid, at, r.sys, r.dia) : false };
  });
  var fresh = rows.filter(function (x) { return !x.dup; });
  if (!S.cuffFound.length) { res.innerHTML = '<p class="note">The cuff connected but sent no readings. Take a reading first, or press the transfer button until <b>O</b> flashes and Search again. If it was just paired, readings taken before pairing may not be sent.</p>'; return; }
  S.cuffRows = fresh;
  res.innerHTML = '<p>' + S.cuffFound.length + ' reading(s) received; ' + (S.cuffFound.length - mine.length ? (S.cuffFound.length - mine.length) + ' for the other user skipped; ' : '') + (rows.length - fresh.length ? (rows.length - fresh.length) + ' already in the app; ' : '') + '<b>' + fresh.length + ' new</b>.</p>' +
    (fresh.length ? '<table class="io-table"><tr><th></th><th>When</th><th>BP</th><th>Pulse</th></tr>' + fresh.map(function (x, i) {
      return '<tr><td><input type="checkbox" class="cuffPick" value="' + i + '" checked aria-label="Save this reading"></td><td>' + (x.at ? esc(localDay(x.at.toISOString()) + ' ' + localTime(x.at.toISOString())) : '<span class="flag-text">no time</span>') + '</td><td>' + x.r.sys + '/' + x.r.dia + '</td><td>' + (x.r.pulse == null ? '' : x.r.pulse) + (x.r.irregular ? ' <span class="flag-text">irregular</span>' : '') + '</td></tr>';
    }).join('') + '</table>' + (fresh.some(function (x) { return !x.at; }) ? '<p class="muted">Readings without a time will be saved at the current time.</p>' : '') +
      '<div class="btn-row"><button class="btn" onclick="saveCuffReadings(' + pidArg(pid) + ')">Save checked readings</button></div>' : '');
}
function isDuplicateBp(pid, at, sys, dia) {
  return (State.measurements || []).some(function (m) { return !m.deleted && m.kind === 'blood_pressure' && (m.for_profile_id || null) === (pid || null) && +m.value === sys && +m.value2 === dia && Math.abs(new Date(m.taken_at) - at) < 120000; });
}
function saveCuffReadings(pid) {
  var picks = Array.prototype.map.call(document.querySelectorAll('.cuffPick:checked'), function (c) { return S.cuffRows[+c.value]; });
  var user = +(document.getElementById('cuffUser') || {}).value || 1;
  var p = State.profiles.find(function (x) { return x.id === pid; });
  var saveUser = p && cuffUser(pid) !== user ? DB.update('diet_profiles', pid, function (c) { c.care_settings = Object.assign({}, c.care_settings || {}, { cuff_user: user }); return c; }) : Promise.resolve();
  saveUser.then(function () {
    return picks.reduce(function (chain, x) {
      return chain.then(function () {
        return DB.put('measurements', { kind: 'blood_pressure', value: x.r.sys, value2: x.r.dia, unit: 'mmHg', taken_at: (x.at || new Date()).toISOString(), standard: false,
          pulse: x.r.pulse, rhythm: x.r.irregular ? 'irregular' : (x.r.pulse != null ? 'regular' : null),
          note: 'From the cuff (Bluetooth)' + (x.r.movement ? '; moved during reading' : '') + (x.r.cuffLoose ? '; cuff loose' : ''), for_profile_id: pid });
      });
    }, Promise.resolve());
  }).then(function () { closeSheet(); return loadAll(); }).then(function () { refresh(); if (Sync.enabled()) syncNow(); toast(picks.length + ' reading(s) saved'); })
    .catch(function (e) { toast('Could not save: ' + e.message); });
}
