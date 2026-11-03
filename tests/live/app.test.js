// End-to-end test of the app against a real Supabase stack: auth, PostgREST,
// row-level security and Storage. Runs against `supabase start` by default, or any
// project via API_URL / ANON_KEY / SERVICE_ROLE_KEY (use a throwaway project).
//
//   cd tests && npm install && npm run live
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const env = require('./env')();
const ROOT = path.join(__dirname, '../..');
const FIX = path.join(__dirname, '../fixtures');
const UMD = require.resolve('@supabase/supabase-js/dist/umd/supabase.js');
const RUN = Date.now().toString(36);
let failures = 0;
function check(name, ok, detail) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' (' + detail + ')' : '')); if (!ok) failures++; }

// Admin reads bypass RLS so the test can see the server's real state.
const admin = (p, init = {}) => fetch(env.API_URL + p, Object.assign({}, init, { headers: Object.assign({ apikey: env.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }, init.headers || {}) })).then(r => r.json());
const rows = (table, q) => admin('/rest/v1/' + table + '?' + q);
const objects = prefix => admin('/storage/v1/object/list/photos', { method: 'POST', body: JSON.stringify({ prefix, limit: 1000 }) });
// Mirrors ensure_household(): invite memberships first, then newest.
async function householdOf(userId) { const m = await rows('members', 'select=household_id&user_id=eq.' + userId + '&order=via_invite.desc,created_at.desc'); return m[0] && m[0].household_id; }

async function user(name) {
  const email = name + '-' + RUN + '@example.com';
  const u = await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password: 'test-pass-123', email_confirm: true }) });
  const s = await fetch(env.API_URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: env.ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'test-pass-123' }) }).then(r => r.json());
  if (!s.access_token) throw new Error('sign-in failed for ' + email + ': ' + JSON.stringify(s));
  return { id: u.id || s.user.id, session: s };
}

function serve() {
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, () => r({ srv, url: 'http://localhost:' + srv.address().port + '/' })));
}

async function device(browser, app, u, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const key = 'sb-' + new URL(env.API_URL).hostname.split('.')[0] + '-auth-token';
  if (u) await ctx.addInitScript(([k, s]) => { localStorage.setItem(k, s); }, [key, JSON.stringify(u.session)]);
  if (!opts.unconfigured) await ctx.route('**/assets/js/config.js', r => r.fulfill({ contentType: 'application/javascript', body: `var TCM_CONFIG = { SUPABASE_URL: '${env.API_URL}', SUPABASE_ANON_KEY: '${env.ANON_KEY}', APP_VERSION: 'live-test' };` }));
  // Serve supabase-js locally so the test does not depend on the CDN.
  await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js', r => r.fulfill({ contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(UMD) }));
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto(app + (opts.hash || '')); await p.waitForSelector('.tabbar');
  return p;
}
const sync = p => p.evaluate(() => syncNow().then(() => Sync.run()).then(r => r, e => ({ error: String(e && e.message || e) })));

(async () => {
  const { srv, url: app } = await serve();
  const browser = await chromium.launch();
  const [carer, sibling, outsider, newcomer, restorer] = [await user('carer'), await user('sibling'), await user('outsider'), await user('newcomer'), await user('restorer')];

  // 1. First sync creates the household and pushes the sample kitchen.
  const A = await device(browser, app, carer);
  await A.evaluate(() => loadSample()); await A.waitForTimeout(1500);
  const first = await sync(A);
  check('first sync succeeds', !first.error && first.signedIn, JSON.stringify(first));
  const hid = await householdOf(carer.id);
  const counts = {};
  for (const t of ['ingredients', 'recipes', 'recipe_ingredients', 'pantry_items', 'diet_profiles', 'usage_log']) counts[t] = (await rows(t, 'select=id&household_id=eq.' + hid)).length;
  check('every table reached the server', counts.recipes === 4 && counts.ingredients >= 20 && counts.recipe_ingredients >= 20 && counts.pantry_items >= 15 && counts.diet_profiles === 1, JSON.stringify(counts));

  // 2. Diary and recipe photos land in Storage under the household folder.
  await A.click('[data-tab=diary]'); await A.click('text=+ Log a meal');
  await A.selectOption('#lRecipe', { label: 'Banana cinnamon oatmeal' }); await A.setInputFiles('#lPhoto', FIX + '/meal.jpg');
  await A.click('#sheetBody .btn:has-text("Log")'); await A.waitForTimeout(2000);
  await A.click('[data-tab=recipes]'); await A.click('#recipeList .card:has-text("soup")'); await A.click('text=Edit');
  await A.setInputFiles('#fPhoto', FIX + '/meal.jpg'); await A.click('#sheetBody .btn:has-text("Save")'); await A.waitForTimeout(2000);
  await sync(A);
  const diaryRows = await rows('diary_entries', 'select=id,photo_path,deleted&household_id=eq.' + hid);
  const soup = (await rows('recipes', 'select=id,photo_path&household_id=eq.' + hid)).find(r => r.photo_path);
  check('diary photo uploaded and linked', diaryRows.length === 1 && !!diaryRows[0].photo_path && (await objects(hid + '/diary')).length === 1);
  check('recipe photo uploaded and linked', !!soup && (await objects(hid + '/recipes')).length === 1);

  // 3. A family member joins with the invite code and sees everything, photos too.
  const code = await A.evaluate(() => Sync.inviteCode());
  const B = await device(browser, app, sibling);
  await B.evaluate(c => Sync.joinHousehold(c), code); await sync(B); await B.evaluate(() => loadAll());
  await B.click('[data-tab=recipes]'); await B.waitForTimeout(2000);
  const bThumb = await B.getAttribute('#recipeList .card:has-text("soup") img.photo-thumb', 'src').catch(() => null);
  check('joined member sees the household', (await B.evaluate(() => State.recipes.length)) === 4 && (await B.evaluate(() => State.diary.length)) === 1);
  check('joined member downloads the photo', !!bThumb && bThumb.startsWith('data:image'));
  check('the invited household wins for a two-household member', (await householdOf(sibling.id)) === hid);

  // 4. Someone in another household sees and changes nothing, even asking directly.
  const C = await device(browser, app, outsider);
  await sync(C);
  const leak = await C.evaluate(async ({ hid, p }) => {
    const c = Sync.getClient();
    const r = await c.from('recipes').select('id').eq('household_id', hid);
    const l = await c.storage.from('photos').list(hid + '/diary');
    const d = await c.storage.from('photos').download(p);
    const w = await c.from('recipes').insert({ id: crypto.randomUUID(), household_id: hid, title: 'intruder' });
    const j = await c.rpc('join_household', { code: 'not-a-code' });
    return { read: r.data ? r.data.length : -1, list: l.data ? l.data.length : -1, download: !!d.error, insert: !!w.error, badJoin: !!j.error };
  }, { hid, p: diaryRows[0].photo_path });
  check('outsider cannot read rows', leak.read === 0);
  check('outsider cannot list photos', leak.list === 0);
  check('outsider cannot download a photo', leak.download);
  check('outsider cannot write into the household', leak.insert);
  check('a wrong invite code is refused', leak.badJoin);

  // 5. Delete on one device: tombstone everywhere and the photo leaves Storage.
  const entry = await B.evaluate(() => State.diary[0].id);
  await B.evaluate(id => deleteDiaryEntry(id), entry); await B.waitForTimeout(800);
  await sync(B); await sync(A);
  check('deletion reaches the server', (await rows('diary_entries', 'select=deleted&id=eq.' + entry))[0].deleted === true);
  check('deleted entry\'s photo is removed from Storage', (await objects(hid + '/diary')).length === 0);
  check('other device applies the deletion', await A.evaluate(id => DB.get('diary_entries', id).then(r => r.deleted && !r.photo_data), entry));

  // 6. Replace a recipe photo: new object, old one removed, other device follows.
  const oldPath = soup.photo_path;
  await A.click('[data-tab=recipes]'); await A.click('#recipeList .card:has-text("soup")'); await A.click('text=Edit');
  await A.setInputFiles('#fPhoto', FIX + '/other.jpg'); await A.click('#sheetBody .btn:has-text("Save")'); await A.waitForTimeout(2000);
  await sync(A); await sync(B);
  const newPath = (await rows('recipes', 'select=photo_path&id=eq.' + soup.id))[0].photo_path;
  const recipeObjs = (await objects(hid + '/recipes')).map(o => hid + '/recipes/' + o.name);
  check('replaced photo: only the new object remains', newPath !== oldPath && recipeObjs.length === 1 && recipeObjs[0] === newPath);
  check('other device points at the new photo', (await B.evaluate(id => DB.get('recipes', id).then(r => r.photo_path), soup.id)) === newPath);

  // 7. A device set up from a setup link connects and joins the household after sign-in.
  const link = await A.evaluate(c => Sync.setupLink(c), code);
  const D = await device(browser, app, newcomer, { unconfigured: true, hash: '#' + link.split('#')[1] });
  await sync(D); await D.evaluate(() => loadAll());
  check('setup link connects and joins', (await D.evaluate(() => Sync.config().source)) === 'device' && (await householdOf(newcomer.id)) === hid && (await D.evaluate(() => State.recipes.length)) === 4);

  // 8. The Settings form connects an unconfigured device.
  const E = await device(browser, app, null, { unconfigured: true });
  await E.click('button[aria-label=Settings]');
  await E.fill('#cfgUrl', env.API_URL); await E.fill('#cfgKey', env.ANON_KEY); await E.click('#screen button:has-text("Connect")');
  check('settings form connects', await E.evaluate(() => Sync.enabled() && Sync.config().source === 'device'));

  // 9. A backup restored into a different household arrives complete, photos re-uploaded.
  await A.click('[data-tab=diary]'); await A.click('text=+ Log a meal');
  await A.selectOption('#lRecipe', { label: 'Buttered toast and eggs' }); await A.setInputFiles('#lPhoto', FIX + '/meal.jpg');
  await A.click('#sheetBody .btn:has-text("Log")'); await A.waitForTimeout(1500); await sync(A);
  // Same object the Export button downloads (photos fetched into the backup first).
  const backup = await A.evaluate(async () => { await loadAll(); for (const e of State.diary) await Sync.photoSrc(e); return JSON.stringify(await buildBackup()); });
  const tmp = path.join(require('os').tmpdir(), 'tcm-backup-' + RUN + '.json'); fs.writeFileSync(tmp, backup);
  const F = await device(browser, app, restorer);
  await sync(F);
  await F.click('button[aria-label=Settings]'); await F.setInputFiles('#importFile', tmp); await F.waitForTimeout(2500);
  await sync(F);
  const fh = await householdOf(restorer.id);
  const fDiary = await rows('diary_entries', 'select=id,photo_path&household_id=eq.' + fh + '&deleted=eq.false');
  const fRecipes = await rows('recipes', 'select=id&household_id=eq.' + fh);
  const fLines = await rows('recipe_ingredients', 'select=recipe_id,ingredient_id&household_id=eq.' + fh);
  const fIngs = new Set((await rows('ingredients', 'select=id&household_id=eq.' + fh)).map(r => r.id));
  check('restore lands in the new household', fh !== hid && fRecipes.length === 4, fRecipes.length + ' recipes');
  const broken = fLines.filter(l => !fIngs.has(l.ingredient_id) || !fRecipes.some(r => r.id === l.recipe_id));
  check('restored references stay wired up', fLines.length >= 20 && broken.length === 0, fLines.length + ' lines, ' + broken.length + ' broken');
  check('original household is untouched', (await rows('recipes', 'select=id&household_id=eq.' + hid)).length === 4);
  check('restored photos are re-uploaded to the new household', fDiary.length === 1 && !!fDiary[0].photo_path && fDiary[0].photo_path.startsWith(fh + '/') && (await objects(fh + '/diary')).length === 1);
  fs.unlinkSync(tmp);

  const errs = [A, B, C, D, E, F].flatMap(p => p.errors);
  check('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close(); srv.close();
  console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
