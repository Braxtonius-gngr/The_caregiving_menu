#!/usr/bin/env node
/* Build-free checks: JS syntax, local references in index.html/sw.js, and that
 * every inline onclick handler names a global function defined in assets/js. */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var root = path.join(__dirname, '..');
var failures = 0;
function fail(msg) { failures++; console.error('FAIL ' + msg); }

// 1. syntax
var jsFiles = fs.readdirSync(path.join(root, 'assets/js')).filter(function (f) { return f.endsWith('.js'); }).map(function (f) { return 'assets/js/' + f; }).concat(['sw.js', 'scripts/check.js']);
jsFiles.forEach(function (f) {
  try { new vm.Script(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f }); }
  catch (e) { fail('syntax ' + f + ': ' + e.message); }
});

// 2. local references
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var refs = [];
html.replace(/(?:src|href)="([^"]+)"/g, function (_, r) { refs.push(r); });
var sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
sw.replace(/'\.\/([^']+)'/g, function (_, r) { if (r) refs.push(r); });
var manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
manifest.icons.forEach(function (i) { refs.push(i.src); });
refs.forEach(function (r) {
  if (/^(https?:)?\/\//.test(r) || r.startsWith('#') || r.startsWith('?') || r === './') return;
  if (r.startsWith('/')) fail('absolute local URL breaks GitHub Pages subpaths: ' + r);
  if (!fs.existsSync(path.join(root, r.replace(/^\.\//, '')))) fail('missing file referenced: ' + r);
});
jsFiles.filter(function (f) { return f.startsWith('assets/js/'); }).forEach(function (f) {
  if (sw.indexOf("'./" + f + "'") < 0) fail('sw.js shell cache is missing ' + f);
});

// 3. inline handlers resolve to globals
var allJs = jsFiles.filter(function (f) { return f.startsWith('assets/js/'); }).map(function (f) { return fs.readFileSync(path.join(root, f), 'utf8'); }).join('\n');
var defined = {};
allJs.replace(/^function\s+([A-Za-z_$][\w$]*)/gm, function (_, n) { defined[n] = true; });
allJs.replace(/^var\s+([A-Za-z_$][\w$]*)/gm, function (_, n) { defined[n] = true; });
['if', 'this', 'event', 'document', 'confirm', 'location', 'State', 'DB', 'Sync', 'Promise', 'history'].forEach(function (n) { defined[n] = true; });
var handlerSrc = html + '\n' + allJs;
var re = /on(?:click|change|input)=\\?["']([^"']*)/g, m, seen = {};
while ((m = re.exec(handlerSrc))) {
  var first = (m[1].match(/^[!\s]*([A-Za-z_$][\w$]*)/) || [])[1];
  if (first && !defined[first] && !seen[first]) { seen[first] = true; fail('inline handler calls undefined global: ' + first); }
}

// 4. the look (P-020): screens use line icons, not emoji, and colours come from tokens.css.
// Typographic marks (✓ ✗ ♥ arrows) are fine. Comments are skipped. Data colours are allowed by file:
// fluids.js holds the urine colour swatches (real colours, not theme), yourdata.js the print-out styles.
var HEX_OK = { 'assets/js/fluids.js': true, 'assets/js/yourdata.js': true };
function isEmoji(n) { return n >= 0x1F000 || (n >= 0x2600 && n <= 0x27BF && n !== 0x2713 && n !== 0x2717 && n !== 0x2665) || n === 0x2B50 || n === 0x23F8; }
jsFiles.filter(function (f) { return f.startsWith('assets/js/'); }).forEach(function (f) {
  fs.readFileSync(path.join(root, f), 'utf8').split('\n').forEach(function (line, i) {
    var code = line.replace(/^\s*(\/\/|\/?\*).*$/, '').replace(/\s\/\/ .*$/, '');
    var em = /&#(\d+);/g, mm;
    while ((mm = em.exec(code))) if (isEmoji(+mm[1])) { fail('emoji ' + mm[0] + ' in ' + f + ':' + (i + 1) + ' (use icon())'); break; }
    for (var ch of code) if (/\p{Extended_Pictographic}/u.test(ch) && isEmoji(ch.codePointAt(0))) { fail('emoji ' + ch + ' in ' + f + ':' + (i + 1) + ' (use icon())'); break; }
    if (!HEX_OK[f] && /(?<![&\w])#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/.test(code)) fail('hard-coded colour in ' + f + ':' + (i + 1) + ' (use a token from tokens.css)');
  });
});

if (failures) { console.error(failures + ' check(s) failed'); process.exit(1); }
console.log('ok: ' + jsFiles.length + ' scripts, ' + refs.length + ' references, handlers resolve');
