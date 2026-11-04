// Runs both Edge Functions for real on Deno, signed in against the Supabase stack,
// with outside services replaced (see harness.ts). Checks the auth gate, every
// brain mode's response shape, the exact request sent to Claude, and the lookup
// mappings. Needs Deno and a running stack (`supabase start`).
//
//   cd tests && npm run functions
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const env = require('./env')();
let failures = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' (' + detail + ')' : '')); if (!ok) failures++; }

function start(dir, fn, port) {
  const p = spawn('deno', ['run', '-A', 'harness.ts', fn, String(port)], { cwd: dir, env: Object.assign({}, process.env, { SUPABASE_URL: env.API_URL, SUPABASE_ANON_KEY: env.ANON_KEY, ANTHROPIC_API_KEY: 'sk-ant-test' }), stdio: 'ignore' });
  return p;
}
async function waitUp(port) { for (let i = 0; i < 120; i++) { try { await fetch('http://localhost:' + port, { method: 'OPTIONS' }); return; } catch (e) { await new Promise(r => setTimeout(r, 500)); } } throw new Error('function on ' + port + ' did not start'); }

(async () => {
  // Scratch copy so Deno resolves npm packages on its own instead of the repo's package.json.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcm-fn-'));
  fs.cpSync(path.join(__dirname, '../../supabase/functions'), path.join(dir, 'functions'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'harness.ts'), path.join(dir, 'harness.ts'));
  fs.writeFileSync(path.join(dir, 'deno.json'), '{"nodeModulesDir":"auto"}');
  const procs = [start(dir, 'brain', 8801), start(dir, 'lookup', 8802)];
  try {
    await waitUp(8801); await waitUp(8802);
    const email = 'fn-' + Date.now().toString(36) + '@example.com';
    await fetch(env.API_URL + '/auth/v1/admin/users', { method: 'POST', headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'test-pass-123', email_confirm: true }) });
    const tok = (await (await fetch(env.API_URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: env.ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'test-pass-123' }) })).json()).access_token;
    const call = (port, body, auth) => fetch('http://localhost:' + port, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, auth ? { Authorization: 'Bearer ' + auth } : {}), body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() }));
    const img = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, '../fixtures/meal.jpg')).toString('base64');

    check('brain refuses callers who are not signed in', (await call(8801, { mode: 'parse_recipe', text: 'x' })).status === 401);
    check('brain refuses a forged token', (await call(8801, { mode: 'parse_recipe', text: 'x' }, 'not-a-token')).status === 401);
    const modes = {
      parse_recipe_text: [{ mode: 'parse_recipe', text: '2 cups oats\nboil' }, ['title', 'ingredients', 'steps', 'confidence']],
      parse_recipe_photo: [{ mode: 'parse_recipe', image: img }, ['title', 'ingredients']],
      parse_recipe_url: [{ mode: 'parse_recipe', url: 'https://recipes.example/lemon-chicken' }, ['title', 'source_ref']],
      parse_recipe_batch_page: [{ mode: 'parse_recipe', image: img, batch: true }, ['title', 'starts_mid_recipe', 'ends_incomplete', 'issues']],
      parse_recipe_pages: [{ mode: 'parse_recipe', images: [img, img], batch: true }, ['title', 'steps', 'ends_incomplete']],
      parse_receipt: [{ mode: 'parse_receipt', image: img }, ['store', 'items']],
      pantry_photo: [{ mode: 'pantry_photo', images: [img, img] }, ['store', 'items']],
      estimate_plate: [{ mode: 'estimate_plate', text: 'two eggs and toast' }, ['items', 'kcal', 'sodium_mg', 'confidence']],
      variations: [{ mode: 'variations', angle: 'lighter', recipe: { title: 'Soup' }, pantry: [] }, ['options']],
      diet_swaps: [{ mode: 'diet_swaps', recipe: { title: 'Soup' }, profile: { name: 'Memaw', rules: [], targets: {} } }, ['options']],
      canonicalize: [{ mode: 'canonicalize', inputs: ['GV YEL ONION'] }, ['matches']],
      appointment_summary: [{ mode: 'appointment_summary', digest: { person: 'Memaw' } }, ['headline', 'questions_for_clinician', 'caveats']],
    };
    for (const [name, [body, keys]] of Object.entries(modes)) {
      const r = await call(8801, body, tok);
      check('brain ' + name, r.status === 200 && keys.every(k => k in r.body), r.status + ' ' + Object.keys(r.body).join(','));
    }
    check('brain rejects an unknown mode', (await call(8801, { mode: 'nope' }, tok)).status === 400);

    const log = await (await fetch('http://localhost:8801/__log')).json();
    const req = log[0];
    check('Claude call: model, fallback beta and structured output', req.body.model === 'claude-opus-5-5' && req.beta === 'server-side-fallback-2026-07-01' && req.body.fallbacks === 'default' && req.body.output_config.format.type === 'json_schema', JSON.stringify({ model: req.body.model, beta: req.beta }));
    check('Claude call: no forced tool use or thinking config (both 400 on this model)', !('tool_choice' in req.body) && !('thinking' in req.body));
    check('Claude call: API key sent server-side only', req.auth === 'Bearer sk-ant-test');
    check('photo sent as a base64 image block', log[1].body.messages[0].content[0].type === 'image' && log[1].body.messages[0].content[0].source.media_type === 'image/jpeg');
    check('recipe URL read from its JSON-LD first', log[2].body.messages[0].content[0].text.includes('JSON-LD recipe data'));
    const pages = log[4].body.messages[0].content;
    check('stitched pages sent together, in order, as one recipe', pages.filter(c => c.type === 'image').length === 2 && pages[2].text.includes('consecutive pages of ONE recipe'));

    const bc = (await call(8802, { kind: 'barcode', q: '5000112637922' })).body;
    check('barcode lookup maps Open Food Facts (g to mg)', bc.name === 'rolled oats' && bc.nutrition.sodium_mg === 6 && bc.nutrition.potassium_mg === 362, JSON.stringify(bc));
    check('unknown barcode returns no name', (await call(8802, { kind: 'barcode', q: '0000000000000' })).body.name === null);
    const us = (await call(8802, { kind: 'usda', q: 'oats' })).body;
    check('USDA lookup maps nutrient numbers', us.kcal_100g === 379 && us.sodium_mg === 6 && us.protein_g === 13.2, JSON.stringify(us));
  } finally {
    procs.forEach(p => p.kill());
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
