/* Compare her medicines (File -> Summary -> Compare sources). Lines up what each source says
 * about each medicine: the handwritten or printed list, discharge papers, the bottle, and what
 * was typed in. Mismatched strengths, possible duplicates (brand and generic saved twice),
 * medicines missing from a list or without a bottle, and anything flagged are shown first,
 * with a one-page printout to take to the pharmacist. No AI: this only compares what is saved. */

var MC_TYPE = { list: 'List', discharge: 'Discharge papers', bottle: 'Bottle', form: 'Typed in' };

function renderMedCheck(arg) {
  var pid = (arg && arg.pid) || S.filePid || State.activeProfile || null;
  S.medCheckPid = pid;
  var prof = State.profiles.find(function (p) { return p.id === pid; }) || { person_name: '' };
  var r = Logic.reconcileMeds(recordsOf(pid, ['medication']), careToday());
  var order = { bad: 0, warn: 1, info: 2 };
  var worst = function (x) { return x.issues.reduce(function (m, s) { return Math.min(m, order[s.level]); }, 3); };
  var items = r.items.slice().sort(function (a, b) { return worst(a) - worst(b) || (a.title || '').localeCompare(b.title || ''); });
  return '<div class="card"><h3>&#128138; Compare her medicines' + (prof.person_name ? ' (' + esc(prof.person_name) + ')' : '') + '</h3>' +
    '<p>Each medicine with what every source says: the medicine list, discharge papers, the bottle. Mismatches and possible duplicates are listed first. Take the printout to the pharmacist or doctor to sort them out.</p>' +
    (items.length ? '<p><b>' + items.length + '</b> medicine' + (items.length === 1 ? '' : 's') + ' &middot; <span class="' + (r.problems ? 'flag-text' : '') + '"><b>' + r.problems + '</b> to sort out</span></p>' : '') +
    '<div class="btn-row"><button class="btn" onclick="printMedCheck()">Print for the pharmacist</button><button class="btn ghost" onclick="copyText(medCheckText(), \'Copied\')">Copy as text</button><button class="btn ghost" onclick="snapIt(S.medCheckPid,\'medlist\')">&#128247; Snap a list or bottle</button></div></div>' +
    (items.length ? items.map(medCheckCard).join('') : '<p class="muted">No medicines saved yet. Snap her medicine list, the discharge papers or each bottle, and they show up here side by side.</p>');
}
function medCheckCard(x) {
  var bad = x.issues.filter(function (s) { return s.level !== 'info'; }), info = x.issues.filter(function (s) { return s.level === 'info'; });
  return '<div class="card' + (bad.length ? ' attention' : '') + '"><div class="row between"><b>' + esc(x.title) + '</b><button class="btn sm ghost" onclick="editRecord(\'' + x.id + '\')">Open</button></div>' +
    (x.generic && Logic.medStrength(x.generic) === null && x.title.toLowerCase().indexOf(x.generic) < 0 ? '<div class="muted">Generic: ' + esc(x.generic) + '</div>' : '') +
    (bad.length ? '<ul class="mc-issues">' + bad.map(function (s) { return '<li class="' + (s.level === 'bad' ? 'flag-text' : '') + '">' + esc(s.text) + '</li>'; }).join('') + '</ul>' : '<p class="muted">&#10003; Sources agree.</p>') +
    (x.sources.length ? '<table class="cmp"><tr><th>Source</th><th>Strength</th><th>What it says</th></tr>' + x.sources.map(function (s) {
      return '<tr><td>' + esc(s.label || MC_TYPE[s.type] || s.type) + (s.date ? '<div class="muted">' + esc(s.date) + '</div>' : '') + '</td><td>' + esc(s.strength || Logic.medStrength(s.said) || '—') + '</td><td>' + esc([s.said, s.dose, s.when].filter(Boolean).join(' · ') || '—') + '</td></tr>';
    }).join('') + '</table>' : '<p class="muted">Typed in by hand; no list or bottle saved for it yet.</p>') +
    (info.length ? '<p class="muted">' + info.map(function (s) { return esc(s.text); }).join(' ') + '</p>' : '') + '</div>';
}
function medCheckText() {
  var pid = S.medCheckPid, prof = State.profiles.find(function (p) { return p.id === pid; }) || { person_name: '' };
  var r = Logic.reconcileMeds(recordsOf(pid, ['medication']), careToday());
  return ['Medicines for ' + prof.person_name + ', compared across sources (' + localDay(new Date().toISOString()) + ')', ''].concat(r.items.map(function (x) {
    return '- ' + x.title + '\n' + x.sources.map(function (s) { return '    ' + (s.label || MC_TYPE[s.type]) + ': ' + [s.strength, s.said, s.dose, s.when].filter(Boolean).join(' · '); }).join('\n') +
      (x.issues.length ? '\n' + x.issues.map(function (s) { return '    ' + (s.level === 'info' ? 'Note: ' : 'CHECK: ') + s.text; }).join('\n') : '');
  })).join('\n');
}
function printMedCheck() {
  var holder = document.getElementById('printArea');
  if (!holder) { holder = document.createElement('div'); holder.id = 'printArea'; document.body.appendChild(holder); }
  var pid = S.medCheckPid, prof = State.profiles.find(function (p) { return p.id === pid; }) || { person_name: '' };
  var r = Logic.reconcileMeds(recordsOf(pid, ['medication']), careToday());
  holder.innerHTML = '<h2>Medicines: ' + esc(prof.person_name) + '</h2><p>Compared across her medicine list, discharge papers and bottles, ' + esc(localDay(new Date().toISOString())) + '. Prepared by the family; please help us correct anything marked CHECK.</p>' +
    r.items.map(function (x) {
      return '<h3>' + esc(x.title) + '</h3>' + (x.sources.length ? '<ul>' + x.sources.map(function (s) { return '<li>' + esc((s.label || MC_TYPE[s.type]) + ': ' + [s.strength, s.said, s.dose, s.when].filter(Boolean).join(' · ')) + '</li>'; }).join('') + '</ul>' : '') +
        x.issues.filter(function (s) { return s.level !== 'info'; }).map(function (s) { return '<p><b>CHECK:</b> ' + esc(s.text) + '</p>'; }).join('');
    }).join('') + '<p>Questions for the pharmacist:</p><ul><li>Which strength is right where the sources differ?</li><li>Are any of these the same medicine twice?</li><li>Is there anything she should no longer take?</li></ul>';
  document.body.classList.add('printing');
  setTimeout(function () { window.print(); setTimeout(function () { document.body.classList.remove('printing'); }, 500); }, 50);
}
