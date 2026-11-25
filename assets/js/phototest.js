/* Photo reader test (Settings -> Photo reader test). Before the family relies on Snap it for
 * medicines and blood pressure, run real photos you know the answers to and see how often it
 * reads them right, asks for a retake, or gets something wrong. Photos stay on this device;
 * nothing is saved to her file. Each photo is one Snap it read (two AI calls). */

var PT = { cases: [], running: false };

function renderPhotoTest() {
  var done = PT.cases.filter(function (c) { return c.verdict; });
  var count = function (v) { return done.filter(function (c) { return c.verdict === v; }).length; };
  return '<div class="card"><h3>Photo reader test</h3>' +
    '<p>Add photos you already know the right answer to: cuff and meter screens, the scale, pill bottles, a lab report, a care team sheet. Include a few bad ones on purpose (glare, blurry, cut off).</p>' +
    '<p class="muted">For each photo, type the right answer in plain words, e.g. <i>138/72 pulse 64</i>, <i>furosemide 40 mg</i>, <i>weight 151.2</i>. For a photo that is too bad to read, type <b>retake</b>. Photos stay on this phone and nothing is added to her file.</p>' +
    '<div class="btn-row"><button class="btn" onclick="document.getElementById(\'ptAdd\').click()">&#128247; Add photos</button>' +
    (PT.cases.length ? '<button class="btn" ' + (PT.running ? 'disabled ' : '') + 'onclick="runPhotoTest()">' + (PT.running ? 'Running...' : 'Run the test') + '</button><button class="btn ghost" onclick="copyPhotoTest()">Copy results</button><button class="btn ghost" onclick="PT.cases=[];refresh()">Clear</button>' : '') + '</div>' +
    '<input id="ptAdd" type="file" accept="image/*" multiple class="hidden" onchange="addTestPhotos(this)"></div>' +
    (done.length ? '<div class="card"><h3>Results: ' + done.length + ' of ' + PT.cases.length + ' photos</h3>' +
      '<p>&#10003; Correct: <b>' + count('correct') + '</b> &middot; Rightly asked for a retake: <b>' + count('retake_ok') + '</b> &middot; Missed something: <b>' + count('missed') + '</b></p>' +
      '<p class="' + (count('wrong') + count('should_retake') ? 'flag-text' : '') + '">&#9888; Wrong number: <b>' + count('wrong') + '</b> &middot; Read it when it should have asked: <b>' + count('should_retake') + '</b> &middot; Asked for a retake on a good photo: <b>' + count('retake_extra') + '</b></p>' +
      '<p class="muted">Wrong numbers are the ones that matter most. Send me the copied results and I will tune the reader.</p></div>' : '') +
    PT.cases.map(function (c, i) {
      return '<div class="card row"><img class="photo-thumb" alt="" src="' + c.img + '"><div class="grow">' +
        '<label for="ptE' + i + '">Right answer</label><input id="ptE' + i + '" value="' + esc(c.expected || '') + '" oninput="PT.cases[' + i + '].expected=this.value" placeholder="e.g. 138/72 pulse 64, or retake">' +
        (c.error ? '<p class="flag-text">' + esc(c.error) + '</p>' : '') +
        (c.verdict ? '<p class="' + (/wrong|should/.test(c.verdict) ? 'flag-text' : '') + '"><b>' + esc(PT_LABEL[c.verdict]) + '</b>' + (c.why ? ': ' + esc(c.why) : '') + '</p><p class="muted">Read as: ' + esc(c.got || '') + '</p>' : '') +
        '</div><button class="icon-btn" aria-label="Remove" onclick="PT.cases.splice(' + i + ',1);refresh()">&times;</button></div>';
    }).join('');
}
var PT_LABEL = { correct: '✓ Correct', missed: 'Missed something', wrong: '⚠ Wrong number', retake_ok: '✓ Rightly asked for a retake', should_retake: '⚠ Read it, but should have asked for a retake', retake_extra: 'Asked for a retake on a readable photo' };

function addTestPhotos(input) {
  var files = Array.prototype.slice.call(input.files || []); if (!files.length) return;
  files.reduce(function (p, f) { return p.then(function () { return downscale(f, 1600).then(function (img) { PT.cases.push({ img: img, expected: '' }); }); }); }, Promise.resolve())
    .then(function () { refresh(); });
}

function runPhotoTest() {
  if (!Sync.enabled()) return toast('Turn on sync in Settings first');
  var todo = PT.cases.filter(function (c) { return (c.expected || '').trim(); });
  if (!todo.length) return toast('Type the right answer for at least one photo');
  if (!confirm('Run ' + todo.length + ' photo(s) through the reader? Each one uses a little of the AI credit.')) return;
  PT.running = true; refresh();
  todo.reduce(function (p, c) {
    return p.then(function () {
      c.verdict = null; c.error = null;
      return Sync.brain('read_photo', { images: [c.img] }).then(function (d) { scorePhotoCase(c, d); }, function (e) { c.error = e.message; });
    }).then(function () { if (currentScreen === 'phototest') bgRefresh(); });
  }, Promise.resolve()).then(function () { PT.running = false; refresh(); toast('Test finished'); });
}

// Pull every number and word the reader returned, then compare with the right answer.
function ptFlatten(v, out) {
  if (v == null || v === false) return out;
  if (Array.isArray(v)) { v.forEach(function (x) { ptFlatten(x, out); }); return out; }
  if (typeof v === 'object') { Object.keys(v).forEach(function (k) { if (!/^(retake_|summary|uncertain|more_pages|decision|kind)/.test(k)) ptFlatten(v[k], out); }); return out; }
  out.push(String(v)); return out;
}
function ptNumbers(s) { return (String(s).replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []).map(Number); }
function scorePhotoCase(c, d) {
  var exp = (c.expected || '').trim().toLowerCase(), wantRetake = /^retake\b/.test(exp);
  var got = ptFlatten(d, []).join(' | ');
  c.got = (d.kind ? d.kind.replace(/_/g, ' ') + ': ' : '') + (d.decision === 'retake' ? 'asked for a retake (' + (d.retake_reason || '') + ')' : (d.summary || got).slice(0, 200));
  if (d.decision === 'retake') { c.verdict = wantRetake ? 'retake_ok' : 'retake_extra'; c.why = ''; return; }
  if (wantRetake) { c.verdict = 'should_retake'; c.why = 'you marked this photo as unreadable'; return; }
  var wantNums = ptNumbers(exp), gotNums = ptNumbers(got);
  var words = exp.replace(/\d+(?:\.\d+)?/g, ' ').split(/[^a-z]+/).filter(function (w) { return w.length >= 4 && ['pulse', 'weight', 'tablet', 'tablets', 'daily', 'with', 'take'].indexOf(w) < 0; });
  var gotLow = got.toLowerCase();
  var missingNums = wantNums.filter(function (n) { return gotNums.indexOf(n) < 0; });
  var missingWords = words.filter(function (w) { return gotLow.indexOf(w) < 0; });
  // Screens (cuff, meters, scale): any reading that is not in the right answer is a wrong number.
  var screen = /bp_monitor|glucose_meter|pulse_oximeter|thermometer|scale/.test(d.kind || '');
  var v = d.vitals || {}, w = d.weight || {};
  var shown = screen ? [v.systolic, v.diastolic, v.pulse, v.value, w.value].filter(function (x) { return x != null; }) : [];
  var extra = shown.filter(function (n) { return wantNums.indexOf(n) < 0; });
  if (extra.length) { c.verdict = 'wrong'; c.why = 'read ' + extra.join(', ') + ', which is not in the right answer'; return; }
  if (missingNums.length && !screen && gotNums.length && wantNums.length && missingNums.length === wantNums.length) { c.verdict = 'wrong'; c.why = 'none of ' + wantNums.join(', ') + ' was read'; return; }
  if (missingNums.length || missingWords.length) { c.verdict = 'missed'; c.why = 'did not find ' + missingNums.concat(missingWords).join(', '); return; }
  c.verdict = 'correct'; c.why = '';
}
function copyPhotoTest() {
  var lines = PT.cases.map(function (c, i) { return (i + 1) + '. Right answer: ' + (c.expected || '(none)') + ' | ' + (c.verdict ? PT_LABEL[c.verdict] : 'not run') + (c.why ? ' (' + c.why + ')' : '') + ' | Read as: ' + (c.got || c.error || ''); });
  copyText(lines.join('\n'), 'Results copied');
}
