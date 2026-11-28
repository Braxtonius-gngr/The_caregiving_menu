#!/usr/bin/env node
/* Copies the app's pure rule files (units.js, logic.js) into the server functions, so the phone
 * notifications use exactly the rules Today uses. Run after changing either file; npm test fails
 * while the copy is out of date. Usage: node scripts/sync-shared.js [--check] */
'use strict';
var fs = require('fs'), path = require('path');
var root = path.join(__dirname, '..'), out = path.join(root, 'supabase/functions/_shared/carelogic.ts');
function build() {
  var src = ['units.js', 'logic.js'].map(function (f) { return fs.readFileSync(path.join(root, 'assets/js', f), 'utf8').split(String.fromCharCode(13)).join(''); });
  return '// @ts-nocheck\n// GENERATED from assets/js/units.js and assets/js/logic.js by scripts/sync-shared.js. Do not edit here.\n' +
    'const window = {}; const navigator = {};\n' + src.join('\n') + '\nexport { Logic, Units };\n';
}
var want = build();
if (process.argv.indexOf('--check') >= 0) {
  var have = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split(String.fromCharCode(13)).join('') : ''; // git may check files out with CRLF
  if (have !== want) { console.error('FAIL supabase/functions/_shared/carelogic.ts is out of date: run node scripts/sync-shared.js'); process.exit(1); }
  console.log('shared rules in sync');
} else { fs.writeFileSync(out, want); console.log('wrote ' + path.relative(root, out)); }
