// Family roles, invite links and edit history, checked against the real migrations in an
// in-memory Postgres (PGlite). Supabase's auth and storage schemas are stubbed just enough
// for the migrations and row-level security to run. No Docker or network needed:
//   cd tests && npm install && npm run sql
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const dir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const db = new PGlite({ extensions: { pg_trgm } });
process.on('unhandledRejection', (e) => { console.error('FAILED: ' + (e.message || e) + (e.where ? ' (at ' + e.where + ')' : '')); console.error(e.stack.split('\n').filter(l => l.includes('family.test')).join('\n')); process.exit(1); });

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant usage on schema auth, storage to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  -- Supabase grants these roles every table created in public; RLS does the guarding.
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
`);

// Apply migrations up to 0009 first, set up a family the way the old code did, then 0010,
// so the upgrade path on a project that already has members is what gets tested.
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
const before = files.filter(f => f < '0010'), after = files.filter(f => f >= '0010');
for (const f of before) await db.exec(readFileSync(dir + f, 'utf8'));

const U = { me: '11111111-1111-4111-8111-111111111111', mom: '22222222-2222-4222-8222-222222222222',
  aunt: '33333333-3333-4333-8333-333333333333', stranger: '44444444-4444-4444-8444-444444444444' };
await db.exec(`insert into auth.users values
  ('${U.me}','me@example.com'),('${U.mom}','mom@example.com'),('${U.aunt}','aunt@example.com'),('${U.stranger}','x@example.com')`);

async function as(user, sql, params) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false); set role authenticated;`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}
async function fails(user, sql, params, why) {
  let err = null;
  try { await as(user, sql, params); } catch (e) { err = e; }
  assert.ok(err, why + ' should have been refused');
  return err;
}
let n = 0; const ok = (m) => console.log('ok ' + (++n) + ' - ' + m);

// Old world: I create the household, mom joins with the old invite code.
const hid = (await as(U.me, 'select ensure_household() as h')).rows[0].h;
const oldCode = (await db.query('select invite_code from households where id = $1', [hid])).rows[0].invite_code;
await as(U.mom, 'select join_household($1)', [oldCode]);

// The scheduler and HTTP extensions exist only on Supabase; stand-ins record what is scheduled.
await db.exec(`
  create schema cron; create table cron.job (jobid serial primary key, jobname text, schedule text, command text);
  create function cron.schedule(n text, s text, c text) returns int language sql as $$ insert into cron.job (jobname, schedule, command) values (n, s, c) returning jobid $$;
  create function cron.unschedule(id int) returns boolean language sql as $$ delete from cron.job where jobid = id returning true $$;
  create schema net;
`);
const SUPABASE_ONLY = /create extension if not exists pg_(cron|net);/g;
for (const f of after) await db.exec(readFileSync(dir + f, 'utf8').replace(SUPABASE_ONLY, ''));

const roleOf = async (u) => (await db.query('select role from members where household_id = $1 and user_id = $2', [hid, u])).rows[0]?.role;
assert.equal(await roleOf(U.me), 'owner'); assert.equal(await roleOf(U.mom), 'caregiver');
ok('upgrade: creator becomes owner, joiner stays caregiver');

// The old link still works (as a caregiver link) until reset.
await as(U.aunt, 'select join_household($1)', [oldCode]);
assert.equal(await roleOf(U.aunt), 'caregiver');
// New members wait for an owner (0012): nothing visible until approved.
assert.equal((await as(U.aunt, 'select my_role($1) r', [hid])).rows[0].r, 'pending');
assert.equal((await as(U.aunt, 'select id from diary_entries')).rows.length, 0);
await fails(U.aunt, 'select * from household_members($1)', [hid], 'a person waiting listing members');
assert.equal((await as(U.mom, 'select * from household_members($1)', [hid])).rows.length, 2, 'caregivers do not see people waiting');
const waiting = (await as(U.me, 'select * from household_members($1)', [hid])).rows.find(m => m.user_id === U.aunt);
assert.equal(waiting.approved, false);
await fails(U.mom, 'select approve_member($1, $2, $3)', [hid, U.aunt, 'caregiver'], 'a caregiver approving someone');
await as(U.me, 'select approve_member($1, $2, $3)', [hid, U.aunt, 'caregiver']);
assert.equal((await as(U.aunt, 'select my_role($1) r', [hid])).rows[0].r, 'caregiver');
ok('links sent before the upgrade still work; new members wait for an owner to approve them');

// Codes are hidden from non-owners.
await fails(U.mom, 'select invite_code from households', [], 'a caregiver reading invite codes');
assert.equal((await as(U.mom, 'select * from household_invites')).rows.length, 0);
await fails(U.mom, 'select * from invite_links($1)', [hid], 'a caregiver asking for invite links');
assert.equal((await as(U.mom, 'select name from households')).rows.length, 1);
ok('only owners see invite codes; members still see the household name');

const links = Object.fromEntries((await as(U.me, 'select * from invite_links($1)', [hid])).rows.map(r => [r.role, r.code]));
assert.ok(links.caregiver && links.viewer && links.caregiver !== links.viewer);
ok('owner gets a caregiver link and a viewer link');

// Aunt rejoins with a viewer link: never demoted.
await as(U.aunt, 'select join_household($1)', [links.viewer]);
assert.equal(await roleOf(U.aunt), 'caregiver');
await as(U.me, 'select set_member_role($1, $2, $3)', [hid, U.aunt, 'viewer']);
assert.equal(await roleOf(U.aunt), 'viewer');
ok('a lower-role link never demotes; an owner can change roles');

// Writes by role.
const entry = '55555555-5555-4555-8555-555555555555';
await as(U.mom, `insert into diary_entries (id, household_id, eaten_at, free_text) values ($1, $2, now(), 'Water')`, [entry, hid]);
let row = (await db.query('select user_id, edited_by from diary_entries where id = $1', [entry])).rows[0];
assert.equal(row.user_id, U.mom); assert.equal(row.edited_by, U.mom);
ok('a caregiver can log; the server records who logged it');

await fails(U.aunt, `insert into diary_entries (id, household_id, eaten_at, free_text) values (gen_random_uuid(), $1, now(), 'x')`, [hid], 'a viewer logging');
await as(U.aunt, `update diary_entries set free_text = 'hacked' where id = $1`, [entry]);
assert.equal((await db.query('select free_text from diary_entries where id = $1', [entry])).rows[0].free_text, 'Water');
assert.equal((await as(U.aunt, 'select id from diary_entries')).rows.length, 1);
ok('a viewer can read but not add or change entries');

// Upsert from another member keeps the author and records the editor.
await as(U.me, `insert into diary_entries (id, household_id, eaten_at, free_text, user_id) values ($1, $2, now(), 'Water - Fl. In', null)
  on conflict (id) do update set free_text = excluded.free_text, user_id = excluded.user_id`, [entry, hid]);
row = (await db.query('select user_id, edited_by, free_text from diary_entries where id = $1', [entry])).rows[0];
assert.equal(row.user_id, U.mom); assert.equal(row.edited_by, U.me); assert.equal(row.free_text, 'Water - Fl. In');
ok('an edit (sync upsert) keeps the original author and records the editor');

// Hard deletes are owner-only; soft delete is fine for caregivers.
await as(U.mom, 'delete from diary_entries where id = $1', [entry]);
assert.equal((await db.query('select count(*)::int c from diary_entries where id = $1', [entry])).rows[0].c, 1);
await as(U.mom, 'update diary_entries set deleted = true where id = $1', [entry]);
await as(U.me, 'update diary_entries set deleted = false where id = $1', [entry]);
ok('caregivers soft-delete; only owners can hard-delete');

const hist = (await as(U.aunt, `select action, changed_by from audit_log where row_id = $1 order by id`, [entry])).rows;
assert.deepEqual(hist.map(h => h.action), ['insert', 'update', 'delete', 'restore']);
assert.deepEqual(hist.map(h => h.changed_by), [U.mom, U.me, U.mom, U.me]);
await fails(U.mom, `insert into audit_log (household_id, table_name, row_id, action) values ($1, 'x', gen_random_uuid(), 'insert')`, [hid], 'writing the history directly');
ok('every change lands in the edit history, which members can read but not write');

// Photos.
await as(U.mom, `insert into storage.objects (bucket_id, name) values ('photos', $1)`, [hid + '/diary/a.jpg']);
await fails(U.aunt, `insert into storage.objects (bucket_id, name) values ('photos', $1)`, [hid + '/diary/b.jpg'], 'a viewer uploading a photo');
assert.equal((await as(U.aunt, 'select name from storage.objects')).rows.length, 1);
assert.equal((await as(U.stranger, 'select name from storage.objects')).rows.length, 0);
ok('viewers see photos but cannot upload; strangers see nothing');

// Strangers.
assert.equal((await as(U.stranger, 'select * from diary_entries')).rows.length, 0);
await fails(U.stranger, 'select * from household_members($1)', [hid], 'a stranger listing members');
ok('a stranger sees no entries and no members');

// Members list and names.
await as(U.mom, 'select set_my_name($1, $2)', [hid, '  Mom  ']);
const people = (await as(U.aunt, 'select * from household_members($1)', [hid])).rows;
assert.equal(people.length, 3); assert.equal(people[0].role, 'owner');
assert.equal(people.find(p => p.user_id === U.mom).display_name, 'Mom');
assert.ok(people.find(p => p.user_id === U.aunt).is_me);
ok('members list shows names, emails and roles, owners first');

// Owners: promote mom, last-owner protection, removal and leaving.
await fails(U.me, 'select set_member_role($1, $2, $3)', [hid, U.me, 'caregiver'], 'the only owner stepping down');
await fails(U.me, 'select remove_member($1, $2)', [hid, U.me], 'the only owner leaving');
await as(U.me, 'select set_member_role($1, $2, $3)', [hid, U.mom, 'owner']);
await fails(U.aunt, 'select remove_member($1, $2)', [hid, U.mom], 'a viewer removing someone');
await as(U.mom, 'select remove_member($1, $2)', [hid, U.aunt]);
assert.equal(await roleOf(U.aunt), undefined);
await as(U.me, 'select set_member_role($1, $2, $3)', [hid, U.me, 'caregiver']);
ok('a second owner can be added; the last owner is protected; owners remove people');

// Reset: every old link dies.
await as(U.mom, 'select * from reset_invite_links($1)', [hid]);
await fails(U.stranger, 'select join_household($1)', [links.viewer], 'joining with a reset link');
await fails(U.stranger, 'select join_household($1)', [oldCode], 'joining with the pre-upgrade code after reset');
ok('resetting links cancels every link sent before');

// Household name.
await as(U.mom, 'select set_household_name($1, $2)', [hid, "Our care team"]);
await fails(U.me, 'select set_household_name($1, $2)', [hid, 'x'], 'a caregiver renaming the family');
assert.equal((await db.query('select name from households where id = $1', [hid])).rows[0].name, "Our care team");
ok('owners can name the family');

// ---------- Phase 1: outputs, food fluid, weights, day start ----------
await as(U.mom, `insert into diary_entries (id, household_id, eaten_at, free_text, entry_kind, output_type, output_color, clots, volume_ml, portion_mult)
  values (gen_random_uuid(), $1, now(), 'Urine', 'output', 'urine', 'dark_yellow', false, 562, 1)`, [hid]);
await fails(U.mom, `insert into diary_entries (id, household_id, eaten_at, free_text, entry_kind) values (gen_random_uuid(), $1, now(), 'x', 'snack')`, [hid], 'an unknown entry kind');
await fails(U.mom, `insert into diary_entries (id, household_id, eaten_at, free_text, entry_kind, output_type) values (gen_random_uuid(), $1, now(), 'x', 'output', 'blood')`, [hid], 'an unknown output type');
await as(U.mom, `insert into diary_entries (id, household_id, eaten_at, free_text, fluid_ml) values (gen_random_uuid(), $1, now(), 'Soup', 237)`, [hid]);
ok('outputs and fluid in food are stored');

const w = '66666666-6666-4666-8666-666666666666';
await as(U.mom, `insert into measurements (id, household_id, kind, value, unit, taken_at, standard) values ($1, $2, 'weight', 152.4, 'lb', now(), true)`, [w, hid]);
row = (await db.query('select user_id, edited_by from measurements where id = $1', [w])).rows[0];
assert.equal(row.user_id, U.mom);
await as(U.me, `update measurements set value = 152.2 where id = $1`, [w]); // me is a caregiver here
assert.deepEqual((await as(U.mom, `select action from audit_log where row_id = $1 order by id`, [w])).rows.map(r => r.action), ['insert', 'update']);
await as(U.mom, 'select set_member_role($1, $2, $3)', [hid, U.me, 'viewer']);
await fails(U.me, `insert into measurements (id, household_id, kind, value, taken_at) values (gen_random_uuid(), $1, 'weight', 1, now())`, [hid], 'a viewer logging a weight');
assert.equal((await as(U.me, 'select id from measurements')).rows.length, 1);
assert.equal((await as(U.stranger, 'select id from measurements')).rows.length, 0);
await as(U.mom, 'select set_member_role($1, $2, $3)', [hid, U.me, 'caregiver']);
ok('weights follow the same roles, author stamp and edit history');

assert.equal((await as(U.aunt, 'select day_start_hour from households')).rows.length, 0); // aunt was removed
assert.equal((await as(U.me, 'select day_start_hour from households')).rows[0].day_start_hour, 6);
await as(U.mom, 'select set_day_start($1, 5)', [hid]);
await fails(U.me, 'select set_day_start($1, 4)', [hid], 'a caregiver changing the day start');
await fails(U.mom, 'select set_day_start($1, 24)', [hid], 'an impossible hour');
assert.equal((await db.query('select day_start_hour from households where id = $1', [hid])).rows[0].day_start_hour, 5);
ok('the family day starts at 6 am by default; owners can change it');

// ---------- Phase 2: several photos per entry ----------
const ph = '77777777-7777-4777-8777-777777777777';
await as(U.me, `insert into entry_photos (id, household_id, entry_id, photo_path, pos) values ($1, $2, $3, $4, 1)`, [ph, hid, entry, hid + '/extra/' + ph + '.jpg']);
assert.equal((await db.query('select user_id from entry_photos where id = $1', [ph])).rows[0].user_id, U.me);
await as(U.mom, 'select set_member_role($1, $2, $3)', [hid, U.me, 'viewer']);
await fails(U.me, `insert into entry_photos (id, household_id, entry_id) values (gen_random_uuid(), $1, $2)`, [hid, entry], 'a viewer adding a photo');
assert.equal((await as(U.me, 'select id from entry_photos')).rows.length, 1);
await as(U.mom, 'select set_member_role($1, $2, $3)', [hid, U.me, 'caregiver']);
assert.equal((await as(U.stranger, 'select id from entry_photos')).rows.length, 0);
ok('extra photos follow the same roles; strangers see none');

// ---------- Phase 3: patient file ----------
const rec = '88888888-8888-4888-8888-888888888888';
await as(U.me, `insert into records (id, household_id, kind, title, fields) values ($1, $2, 'lab', 'Potassium', '{"value": 5.4, "unit": "mmol/L", "low": 3.5, "high": 5.1}')`, [rec, hid]);
await fails(U.me, `insert into records (id, household_id, kind, title) values (gen_random_uuid(), $1, 'gossip', 'x')`, [hid], 'an unknown record kind');
await as(U.mom, `update records set fields = fields || '{"value": 5.2}' where id = $1`, [rec]);
assert.deepEqual((await as(U.me, `select action, changed_by from audit_log where row_id = $1 order by id`, [rec])).rows.map(r => [r.action, r.changed_by]), [['insert', U.me], ['update', U.mom]]);
await as(U.mom, 'select set_member_role($1, $2, $3)', [hid, U.me, 'viewer']);
await fails(U.me, `insert into records (id, household_id, kind, title) values (gen_random_uuid(), $1, 'update', 'x')`, [hid], 'a viewer adding to the file');
assert.equal((await as(U.me, 'select id from records')).rows.length, 1);
await as(U.mom, 'select set_member_role($1, $2, $3)', [hid, U.me, 'caregiver']);
assert.equal((await as(U.stranger, 'select id from records')).rows.length, 0);
await as(U.me, `insert into entry_photos (id, household_id, entry_id, entry_store, mime, file_name) values (gen_random_uuid(), $1, $2, 'records', 'application/pdf', 'discharge.pdf')`, [hid, rec]);
ok('patient file records follow the roles, author stamp and edit history; PDFs attach');

// ---------- Phase 4: important days and doses ----------
await as(U.me, `insert into records (id, household_id, kind, title, occurred_at, fields) values (gen_random_uuid(), $1, 'event', 'Lab draw', now(), '{"repeat": "Every month"}')`, [hid]);
await as(U.me, `insert into records (id, household_id, kind, title, occurred_at, fields) values (gen_random_uuid(), $1, 'dose', 'Furosemide', now(), '{"med_id": "m1", "day": "2026-11-23", "slot": "morning", "status": "given"}')`, [hid]);
await as(U.mom, 'select set_member_role($1, $2, $3)', [hid, U.me, 'viewer']);
await fails(U.me, `insert into records (id, household_id, kind, title) values (gen_random_uuid(), $1, 'dose', 'x')`, [hid], 'a viewer marking a dose');
await as(U.mom, 'select set_member_role($1, $2, $3)', [hid, U.me, 'caregiver']);
assert.equal((await as(U.mom, `select id from records where kind = 'dose'`)).rows.length, 1);
ok('important days and dose marks are records: caregivers write, viewers cannot');

await as(U.me, `insert into measurements (id, household_id, kind, value, value2, unit, taken_at, pulse, rhythm) values (gen_random_uuid(), $1, 'blood_pressure', 142, 80, 'mmHg', now(), 96, 'afib')`, [hid]);
await fails(U.me, `insert into measurements (id, household_id, kind, value, unit, taken_at, rhythm) values (gen_random_uuid(), $1, 'blood_pressure', 120, 'mmHg', now(), 'wobbly')`, [hid], 'an unknown heart rhythm');
assert.equal((await as(U.mom, `select pulse, rhythm from measurements where rhythm = 'afib'`)).rows[0].pulse, '96');
ok('blood pressure keeps pulse and rhythm (regular, irregular, AFib)');

// ---------- Phase 5: medicine plans need an owner to approve ----------
const plan = '99999999-9999-4999-8999-999999999999';
await as(U.me, `insert into records (id, household_id, kind, title, fields) values ($1, $2, 'plan', 'Med timing draft', '{"status": "draft"}')`, [plan, hid]);
await fails(U.me, `update records set fields = fields || '{"status": "approved"}' where id = $1`, [plan], 'a caregiver approving a plan');
await fails(U.me, `insert into records (id, household_id, kind, title, fields) values (gen_random_uuid(), $1, 'plan', 'x', '{"status": "approved"}')`, [hid], 'a caregiver adding an already-approved plan');
await as(U.me, `update records set fields = fields || '{"note": "asked pharmacist"}' where id = $1`, [plan]);
await as(U.mom, `update records set fields = fields || '{"status": "approved", "approved_by": "Pharmacist"}' where id = $1`, [plan]);
assert.equal((await as(U.me, `select fields->>'status' s from records where id = $1`, [plan])).rows[0].s, 'approved');
ok('medicine plans: caregivers draft and edit; only an owner approves');

// ---------- Many families: nothing crosses between households ----------
// Every table in public is checked, listed from the database itself, so a table added later
// without the right policy fails here. Family A = hid (me, mom, aunt); family B = the stranger.
const tables = (await db.query(`select c.relname t, c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`)).rows;
for (const t of tables) assert.ok(t.rls, `row-level security is off on ${t.t}`);
ok(`row-level security is on for all ${tables.length} tables`);

const hidB = (await as(U.stranger, 'select ensure_household() as h')).rows[0].h;
assert.notEqual(hidB, hid);
const withHid = [];
for (const { t } of tables) {
  const cols = (await db.query(`select column_name c, data_type d, is_nullable n, column_default def, is_identity i from information_schema.columns where table_schema = 'public' and table_name = $1`, [t])).rows;
  if (!cols.some(c => c.c === 'household_id')) continue;
  withHid.push(t);
  // Make sure family A has at least one row here (inserted as the database owner, past the policies).
  if ((await db.query(`select count(*)::int c from ${t} where household_id = $1`, [hid])).rows[0].c) continue;
  const sample = { uuid: 'gen_random_uuid()', text: `'x'`, numeric: '1', integer: '1', bigint: '1', 'double precision': '1', real: '1', boolean: 'false', jsonb: `'{}'`, json: `'{}'`, date: 'current_date', 'timestamp with time zone': 'now()', ARRAY: `'{}'` };
  const need = cols.filter(c => c.n === 'NO' && c.def == null && c.i !== 'YES' && c.c !== 'household_id');
  // Text columns limited by a check ("type in ('a', 'b')") get the first allowed value.
  const checks = (await db.query(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid = $1::regclass and contype = 'c'`, [t])).rows.map(r => r.d);
  const allowed = (col) => { const d = checks.find(x => x.includes(col)); const m = d && d.match(/'([^']+)'/); return m ? `'${m[1]}'` : null; };
  const names = ['household_id'].concat(need.map(c => c.c)), vals = [`'${hid}'`].concat(need.map(c => (c.d === 'text' && allowed(c.c)) || sample[c.d] || `'x'`));
  try { await db.exec(`insert into ${t} (${names.join(',')}) values (${vals.join(',')})`); }
  catch (e) { assert.fail(`could not seed ${t} for the sweep: ${e.message}`); }
}
for (const t of withHid) {
  const aRows = (await db.query(`select count(*)::int c from ${t} where household_id = $1`, [hid])).rows[0].c;
  assert.ok(aRows > 0, `family A has a row in ${t}`);
  // Read: B sees none of A's rows, even asking for them by household.
  assert.equal((await as(U.stranger, `select * from ${t} where household_id = $1`, [hid])).rows.length, 0, `B reads A's ${t}`);
  // Change and delete: nothing of A's is touched.
  const upd = await as(U.stranger, `update ${t} set household_id = household_id where household_id = $1`, [hid]).catch(() => ({ affectedRows: 0 }));
  assert.equal(upd.affectedRows || 0, 0, `B updates A's ${t}`);
  const del = await as(U.stranger, `delete from ${t} where household_id = $1`, [hid]).catch(() => ({ affectedRows: 0 }));
  assert.equal(del.affectedRows || 0, 0, `B deletes A's ${t}`);
  assert.equal((await db.query(`select count(*)::int c from ${t} where household_id = $1`, [hid])).rows[0].c, aRows, `A's ${t} unchanged`);
  // Insert: a copy of one of A's rows, with a new id, refused for B.
  const one = (await db.query(`select row_to_json(x) j from ${t} x where household_id = $1 limit 1`, [hid])).rows[0].j;
  if ('id' in one) one.id = (await db.query('select gen_random_uuid() u')).rows[0].u;
  await fails(U.stranger, `insert into ${t} select * from json_populate_record(null::${t}, $1)`, [JSON.stringify(one)], `B inserting into A's ${t}`);
}
ok(`family B cannot read, change, delete or add rows of family A in any of ${withHid.length} household tables (${withHid.join(', ')})`);

// Photos and documents in storage: A's folder is closed to B.
await db.exec(`insert into storage.objects (bucket_id, name) values ('photos', '${hid}/records/x.jpg')`);
assert.equal((await as(U.stranger, `select name from storage.objects where bucket_id = 'photos' and name like $1`, [hid + '/%'])).rows.length, 0);
await fails(U.stranger, `insert into storage.objects (bucket_id, name) values ('photos', $1)`, [hid + '/records/sneaky.jpg'], 'B uploading into A\'s photo folder');
assert.ok((await as(U.mom, `select name from storage.objects where bucket_id = 'photos' and name like $1`, [hid + '/%'])).rows.some(r => r.name === hid + '/records/x.jpg'), 'a family member sees the family photo');
ok('photo storage: a family sees its own folder; another family sees and writes nothing there');

// Family-level functions refuse outsiders.
await fails(U.stranger, 'select * from household_members($1)', [hid], 'B listing A\'s members');
await fails(U.stranger, 'select * from invite_links($1)', [hid], 'B asking for A\'s invite links');
await fails(U.stranger, 'select set_member_role($1, $2, $3)', [hid, U.stranger, 'owner'], 'B making themselves owner of A');
assert.equal((await as(U.stranger, 'select my_role($1) r', [hid])).rows[0].r, null);
ok('member lists, invite links and roles of a family are closed to other families');

// Someone removed from a family loses everything at once.
const ownerNow = (await db.query(`select user_id from members where household_id = $1 and role = 'owner' limit 1`, [hid])).rows[0].user_id;
await as(ownerNow, 'select remove_member($1, $2)', [hid, U.aunt]);
for (const t of withHid) assert.equal((await as(U.aunt, `select * from ${t} where household_id = $1`, [hid])).rows.length, 0, `removed member still reads ${t}`);
assert.equal((await as(U.aunt, `select name from storage.objects where bucket_id = 'photos' and name like $1`, [hid + '/%'])).rows.length, 0);
ok('a removed member sees nothing of the family any more');

// ---------- Step C: export, delete, leave, reports (0021, 0023, 0024) ----------
// A family waiting to be erased is read-only for everyone, owners included.
await db.query(`update households set erase_after = now() + interval '7 days' where id = $1`, [hid]);
await fails(ownerNow, `insert into records (id, household_id, kind, title) values (gen_random_uuid(), $1, 'allergy', 'x')`, [hid], 'writing to a family set to be erased');
assert.ok((await as(U.mom, 'select id from records where household_id = $1', [hid])).rows.length > 0, 'a locked family can still be read');
await db.query(`update households set erase_after = null where id = $1`, [hid]);
await as(U.mom, `insert into records (id, household_id, kind, title) values (gen_random_uuid(), $1, 'allergy', 'after cancel')`, [hid]);
ok('a family set to be erased is read-only; cancelling makes it writable again');

// Reports: members send; owners read all; a sender reads their own only while in the family;
// nobody but the app maker sets status or replies.
const rep = (await as(U.mom, `insert into reports (household_id, user_id, kind, feature, comment) values ($1, $2, 'ai', 'read_photo', 'misread') returning id`, [hid, U.mom])).rows[0].id;
await fails(U.mom, `insert into reports (household_id, user_id, kind, status) values ($1, $2, 'app', 'fixed')`, [hid, U.mom], 'a sender marking their own report fixed');
await fails(U.mom, `insert into reports (household_id, user_id, kind) values ($1, $2, 'app')`, [hid, U.me], 'sending a report in someone else\'s name');
assert.equal((await as(ownerNow, 'select id from reports where id = $1', [rep])).rows.length, 1, 'owner reads the family\'s report');
assert.equal((await as(U.mom, `update reports set status = 'fixed' where id = $1 returning id`, [rep])).rows.length, 0, 'sender changes status');
assert.equal((await as(ownerNow, `update reports set reply = 'hi' where id = $1 returning id`, [rep])).rows.length, 0, 'owner replies as app maker');
assert.equal((await as(U.stranger, 'select id from reports where id = $1', [rep])).rows.length, 0, 'stranger reads the report');
const admin = '55555555-5555-4555-8555-555555555555';
await db.query(`insert into auth.users values ($1, 'maker@example.com')`, [admin]);
await db.query('insert into app_admins values ($1)', [admin]);
assert.equal((await as(admin, `update reports set status = 'fixed', reply = 'Fixed' where id = $1 returning id`, [rep])).rows.length, 1, 'app maker marks fixed');
assert.equal((await as(ownerNow, 'select reply from reports where id = $1', [rep])).rows[0].reply, 'Fixed');
ok('reports: members send, owners read, only the app maker sets status and replies');

// Leaving as "Former member": the id is replaced on entries, history and reports.
const momRecs = (await db.query('select count(*)::int c from records where household_id = $1 and (user_id = $2 or edited_by = $2)', [hid, U.mom])).rows[0].c;
assert.ok(momRecs > 0, 'mom has entries to redact');
await db.query('select redact_member($1, $2)', [hid, U.mom]);
for (const [t, cols] of [['records', ['user_id', 'edited_by']], ['reports', ['user_id']], ['audit_log', ['changed_by']]]) {
  const where = cols.map(c => `${c} = $2`).join(' or ');
  assert.equal((await db.query(`select count(*)::int c from ${t} where household_id = $1 and (${where})`, [hid, U.mom])).rows[0].c, 0, `mom's id left in ${t}`);
}
assert.equal((await db.query(`select count(*)::int c from audit_log where household_id = $1 and (old_row::text like $2 or new_row::text like $2)`, [hid, '%' + U.mom + '%'])).rows[0].c, 0, 'mom\'s id left inside the history rows');
await fails(U.mom, 'select redact_member($1, $2)', [hid, U.me], 'a member calling the redaction directly');
ok('leaving as Former member removes the id from entries, reports and the whole edit history; only the server can do it');

// The daily erase job is scheduled.
assert.ok((await db.query(`select 1 from cron.job where jobname = 'erase-due-families'`)).rows.length, 'erase job scheduled');
ok('the daily erase job is scheduled');

// Deleted entries: the server stamps when; after 30 days the row, its history, its extra
// photos and its files are erased. Restoring clears the stamp; a newer deletion waits.
const oldRec = (await as(ownerNow, `insert into records (id, household_id, kind, title) values (gen_random_uuid(), $1, 'allergy', 'old') returning id`, [hid])).rows[0].id;
const newRec = (await as(ownerNow, `insert into records (id, household_id, kind, title) values (gen_random_uuid(), $1, 'allergy', 'new') returning id`, [hid])).rows[0].id;
const back = (await as(ownerNow, `insert into records (id, household_id, kind, title) values (gen_random_uuid(), $1, 'allergy', 'back') returning id`, [hid])).rows[0].id;
const extra = (await as(ownerNow, `insert into entry_photos (id, household_id, entry_id, entry_store) values (gen_random_uuid(), $1, $2, 'records') returning id`, [hid, oldRec])).rows[0].id;
await as(ownerNow, `update records set deleted = true, deleted_at = now() - interval '90 days' where id = any($1)`, [[oldRec, newRec, back]]);
assert.ok((await db.query(`select deleted_at > now() - interval '1 minute' ok from records where id = $1`, [newRec])).rows[0].ok, 'a phone cannot backdate the deletion');
await as(ownerNow, 'update records set deleted = false where id = $1', [back]);
assert.equal((await db.query('select deleted_at from records where id = $1', [back])).rows[0].deleted_at, null, 'restoring clears the stamp');
await as(ownerNow, `update records set title = 'still old' where id = $1`, [oldRec]);
await db.exec(`set session_replication_role = replica; update records set deleted_at = now() - interval '31 days' where id = '${oldRec}'; set session_replication_role = origin;`);
await db.exec(`insert into storage.objects (bucket_id, name) values ('photos', '${hid}/extra/${extra}-a.jpg'), ('photos', '${hid}/extra/other-a.jpg')`);
assert.deepEqual((await db.query('select * from expired_photo_paths(30)')).rows.map(r => r.expired_photo_paths), [`${hid}/extra/${extra}-a.jpg`]);
await fails(ownerNow, 'select erase_expired_deleted(30)', [], 'a member calling the erase directly');
await fails(ownerNow, 'select * from expired_photo_paths(30)', [], 'a member listing the files to erase');
const gone = (await db.query('select erase_expired_deleted(30) g')).rows[0].g;
assert.equal(gone.rows, 2, 'the old entry and its extra photo are erased');
assert.ok(gone.history > 0, 'its edit history is erased');
assert.equal((await db.query('select count(*)::int c from records where id = $1', [oldRec])).rows[0].c, 0);
assert.equal((await db.query('select count(*)::int c from entry_photos where id = $1', [extra])).rows[0].c, 0);
assert.equal((await db.query('select count(*)::int c from audit_log where row_id = $1', [oldRec])).rows[0].c, 0);
assert.equal((await db.query('select count(*)::int c from records where id = any($1)', [[newRec, back]])).rows[0].c, 2, 'a recent deletion and a restored entry stay');
ok('deleted entries are erased with their history and photos 30 days after deletion; recent and restored ones stay');

console.log(`\nAll ${n} family checks passed.`);
