#!/usr/bin/env node
/* Unit tests for the pure modules (units.js, logic.js). Run: node scripts/logic-test.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var assert = require('assert');
var ctx = {};
vm.createContext(ctx);
ctx.window = {}; ctx.navigator = {};
['units.js', 'logic.js', 'scanner.js'].forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/js', f), 'utf8'), ctx); });
var Units = vm.runInContext('Units', ctx), Logic = vm.runInContext('Logic', ctx), Scanner = vm.runInContext('Scanner', ctx);
var n = 0;
function t(name, fn) { fn(); n++; console.log('  ok ' + name); }

t('parseLine fractions and prep', function () {
  var p = Units.parseLine('2 1/2 cups flour, sifted');
  assert.strictEqual(p.qty, 2.5); assert.strictEqual(p.unit, 'cups'); assert.strictEqual(p.name, 'flour'); assert.strictEqual(p.prep, 'sifted');
});
t('parseLine without unit keeps the word in the name', function () {
  var p = Units.parseLine('1 yellow onion, diced');
  assert.strictEqual(p.qty, 1); assert.strictEqual(p.unit, ''); assert.strictEqual(p.name, 'yellow onion');
});
t('covers converts units', function () {
  assert.ok(Units.covers(1, 'lb', 400, 'g'));
  assert.ok(!Units.covers(1, 'cup', 2, 'cups'));
  assert.ok(Units.covers(3, 'each', 2, ''));
  assert.ok(Units.covers(5, 'handful', 1, 'tsp')); // unknown units: presence counts
});
t('subtract stays in the pantry unit', function () {
  assert.ok(Math.abs(Units.subtract(2, 'lb', 1.5, 'lb') - 0.5) < 1e-9);
  assert.ok(Math.abs(Units.subtract(1, 'cup', 8, 'tbsp') - 0.5) < 0.01);
  assert.strictEqual(Units.subtract(1, 'each', 3, 'each'), 0);
});
t('normalizeName folds plurals and descriptors', function () {
  assert.strictEqual(Units.normalizeName('Fresh Carrots (organic)'), 'carrot');
});
t('ingredientMatch uses aliases', function () {
  var ings = [{ id: 'a', name: 'yellow onion', aliases: ['yel onion'] }];
  assert.strictEqual(Logic.ingredientMatch('YEL ONION', ings).id, 'a');
  assert.strictEqual(Logic.ingredientMatch('onions', ings).id, 'a');
});
t('coverage ignores optional lines', function () {
  var lines = [{ id: 1, ingredient_id: 'x', qty: 1, unit: 'cup' }, { id: 2, ingredient_id: 'y', qty: 1, unit: '', optional: true }];
  var c = Logic.coverage(lines, { x: [{ qty: 2, unit: 'cups' }] });
  assert.strictEqual(c.pct, 100);
  c = Logic.coverage(lines, {});
  assert.strictEqual(c.pct, 0); assert.strictEqual(c.missing.length, 1);
});
t('profile fit flags hard and soft rules', function () {
  var lines = [{ ingredient_id: 'soy' }];
  var fit = Logic.fitForProfile(lines, { sodium_mg: 900 }, [
    { kind: 'limit_nutrient', nutrient: 'sodium_mg', max_per_serving: 500, severity: 'soft' },
  ], { soy: { name: 'soy sauce' } });
  assert.strictEqual(fit.level, 'warn');
  fit = Logic.fitForProfile(lines, {}, [{ kind: 'avoid_ingredient', ingredient_id: 'soy', severity: 'hard' }], { soy: { name: 'soy sauce' } });
  assert.strictEqual(fit.level, 'bad');
});
t('recipe nutrition per serving', function () {
  var r = Logic.recipeNutrition({ servings: 2 }, [{ ingredient_id: 'o', qty: 200, unit: 'g' }], { o: { name: 'oats', kcal_100g: 400, sodium_mg: 10 } });
  assert.strictEqual(r.perServing.kcal, 400); assert.strictEqual(r.perServing.sodium_mg, 10);
});
t('restock: below par and frequently used', function () {
  var now = Date.now();
  var usage = { e: [0, 1, 2, 3].map(function (i) { return { event: 'cooked', qty: 2, at: new Date(now - i * 864e5).toISOString() }; }) };
  var s = Logic.restockSuggestions([{ ingredient_id: 'm', qty: 1, par_qty: 2 }, { ingredient_id: 'e', qty: 1 }], usage, { m: {}, e: {} });
  assert.strictEqual(s.length, 2);
});
t('volume-measured dry goods use density', function () {
  var r = Logic.recipeNutrition({ servings: 1 }, [{ ingredient_id: 'o', qty: 0.5, unit: 'cup' }], { o: { name: 'rolled oats', kcal_100g: 379 } });
  assert.ok(r.perServing.kcal > 130 && r.perServing.kcal < 180, 'half cup oats ~150 kcal, got ' + r.perServing.kcal);
});
t('a pinch of salt is tiny', function () {
  var p = Units.parseLine('1 pinch salt');
  assert.strictEqual(p.unit, 'pinch'); assert.strictEqual(p.name, 'salt');
  var r = Logic.recipeNutrition({ servings: 1 }, [{ ingredient_id: 's', qty: 1, unit: 'pinch' }], { s: { name: 'salt', kcal_100g: 0, sodium_mg: 38758 } });
  assert.ok(r.perServing.sodium_mg < 200, 'got ' + r.perServing.sodium_mg);
});
t('barcode check digits', function () {
  assert.ok(Scanner.validGtin('036000291452')); // UPC-A
  assert.ok(Scanner.validGtin('4006381333931')); // EAN-13
  assert.ok(Scanner.validGtin('96385074')); // EAN-8
  assert.ok(!Scanner.validGtin('036000291453')); // one digit off
  assert.ok(!Scanner.validGtin('12'));
  assert.ok(!Scanner.validGtin('ABC-123'));
});
t('UPC-E expands to UPC-A before validation', function () {
  assert.strictEqual(Scanner.expandUpcE('04252614'), '042100005264');
  assert.strictEqual(Scanner.expandUpcE('04252615'), null); // wrong check digit
  assert.strictEqual(JSON.stringify(Scanner.candidates('04252614', 'upc_e')), JSON.stringify(['042100005264']));
  assert.strictEqual(JSON.stringify(Scanner.candidates('04252614', 'ean_8')), JSON.stringify([])); // not a valid EAN-8
});
t('typed 8-digit codes try every valid reading', function () {
  assert.strictEqual(JSON.stringify(Scanner.candidates('04252614')), JSON.stringify(['042100005264']));
  assert.strictEqual(JSON.stringify(Scanner.candidates('96385074')), JSON.stringify(['96385074']));
  assert.strictEqual(JSON.stringify(Scanner.candidates('036000291452', 'upc_a')), JSON.stringify(['036000291452']));
  assert.strictEqual(JSON.stringify(Scanner.candidates('12345')), JSON.stringify([]));
  assert.strictEqual(JSON.stringify(Scanner.candidates('ABC-1234', 'code_128')), JSON.stringify(['ABC-1234']));
});
t('equivalent GTINs match, other codes match exactly', function () {
  assert.ok(Scanner.sameProduct('036000291452', '0036000291452'));
  assert.ok(Scanner.sameProduct('0036000291452', '00036000291452'));
  assert.ok(!Scanner.sameProduct('036000291452', '4006381333931'));
  assert.ok(Scanner.sameProduct('ABC-1234', 'ABC-1234'));
  assert.ok(!Scanner.sameProduct('036000291452', null));
});
// Arrays from the vm context compare by JSON.
function pagesOf(groups) { return JSON.parse(JSON.stringify(groups.map(function (x) { return x.pages; }))); }
t('stitchPages: stand-alone cards stay separate', function () {
  var g = Logic.stitchPages([{}, {}, {}]);
  assert.deepStrictEqual(pagesOf(g), [[0], [1], [2]]);
  assert.ok(g.every(function (x) { return x.complete; }));
});
t('stitchPages: a cut-off page joins the next page (or the one before)', function () {
  var P = function (s, e) { return { starts_mid: s, ends_incomplete: e }; };
  assert.deepStrictEqual(pagesOf(Logic.stitchPages([P(0, 1), P(1, 0), P(0, 0)])), [[0, 1], [2]]);
  assert.deepStrictEqual(pagesOf(Logic.stitchPages([P(1, 0), P(0, 1)])), [[1, 0]]);
  var three = Logic.stitchPages([P(0, 1), P(1, 1), P(1, 0)]);
  assert.deepStrictEqual(pagesOf(three), [[0, 1, 2]]); assert.ok(three[0].complete);
});
t('stitchPages: far-apart pieces join only when unambiguous', function () {
  var P = function (s, e) { return { starts_mid: s, ends_incomplete: e }; };
  assert.deepStrictEqual(pagesOf(Logic.stitchPages([P(0, 1), P(0, 0), P(1, 0)])), [[0, 2], [1]]);
  var amb = Logic.stitchPages([P(0, 1), P(0, 0), P(0, 1), P(0, 0), P(1, 0), P(1, 0)]);
  assert.strictEqual(amb.length, 6); // two open recipes, two loose pages: leave all for review
  assert.strictEqual(amb.filter(function (x) { return !x.complete; }).length, 4);
});
t('stitchPages: skipped photos keep their place and join nothing', function () {
  var P = function (s, e) { return { starts_mid: s, ends_incomplete: e }; }, X = { skip: true };
  // open A, skip, loose B, skip, open C, skip, loose D: two open and two loose, so nothing joins
  var g = Logic.stitchPages([P(0, 1), X, P(1, 0), X, P(0, 1), X, P(1, 0)]);
  assert.deepStrictEqual(pagesOf(g), [[0], [2], [4], [6]]);
  assert.deepStrictEqual(pagesOf(Logic.stitchPages([P(0, 1), X, P(1, 0)])), [[0, 2]]); // one each: still joined
});
t('stitchPages: missing first page, rest reversed, still one piece', function () {
  var P = function (s, e) { return { starts_mid: s, ends_incomplete: e }; };
  var g = Logic.stitchPages([P(1, 0), P(1, 1)]); // last page, then middle page
  assert.deepStrictEqual(pagesOf(g), [[1, 0]]); assert.ok(!g[0].complete);
});
// Minimal JPEG: SOI, APP1 Exif with IFD0 -> ExifIFD -> DateTimeOriginal (little-endian).
function exifJpeg(when) {
  var tiff = [0x49, 0x49, 0x2A, 0x00, 8, 0, 0, 0,
    1, 0, 0x69, 0x87, 4, 0, 1, 0, 0, 0, 26, 0, 0, 0, 0, 0, 0, 0,
    1, 0, 0x03, 0x90, 2, 0, 20, 0, 0, 0, 44, 0, 0, 0, 0, 0, 0, 0];
  for (var k = 0; k < 19; k++) tiff.push(when.charCodeAt(k)); tiff.push(0);
  var app1 = [0x45, 0x78, 0x69, 0x66, 0, 0].concat(tiff), len = app1.length + 2;
  return new Uint8Array([0xFF, 0xD8, 0xFF, 0xE1, len >> 8, len & 255].concat(app1, [0xFF, 0xDA, 0, 2])).buffer;
}
t('exifTakenAt reads DateTimeOriginal and ignores JPEGs without it', function () {
  assert.strictEqual(Logic.exifTakenAt(exifJpeg('2026:11:03 14:05:09')), Date.UTC(2026, 10, 3, 14, 5, 9));
  assert.ok(Logic.exifTakenAt(exifJpeg('2026:11:03 14:05:09')) < Logic.exifTakenAt(exifJpeg('2026:11:03 14:05:30')));
  assert.strictEqual(Logic.exifTakenAt(new Uint8Array([0xFF, 0xD8, 0xFF, 0xDA, 0, 2]).buffer), null);
  assert.strictEqual(Logic.exifTakenAt(new Uint8Array([1, 2, 3]).buffer), null);
});
t('exactIngredient only accepts the exact name or an alias', function () {
  var ings = [{ name: 'butter', aliases: ['salted butter'] }];
  assert.strictEqual(Logic.exactIngredient('Butter', ings).name, 'butter');
  assert.strictEqual(Logic.exactIngredient('salted butter', ings).name, 'butter');
  assert.strictEqual(Logic.exactIngredient('butternut squash', ings), null);
  assert.ok(Logic.ingredientMatch('butternut squash', ings)); // the fuzzy matcher would have taken it
});
/* ---------- fluid balance and weight ---------- */
var OZ = Logic.ML_PER.oz;
function at(h, m, dayOffset) { var d = new Date(2026, 10, 23 + (dayOffset || 0), h, m || 0); return d.toISOString(); }
t('units: oz, mL, grams and cups convert to mL', function () {
  assert.strictEqual(Math.round(Logic.toMl(16, 'oz')), 473);
  assert.strictEqual(Logic.toMl(235, 'g'), 235);
  assert.strictEqual(Math.round(Logic.toMl(1, 'cup')), 237);
  assert.strictEqual(Logic.toMl(-3, 'oz'), 0);
  assert.strictEqual(Math.round(Logic.fromMl(473, 'oz')), 16);
  assert.strictEqual(Math.round(Logic.toLb(70, 'kg') * 10) / 10, 154.3);
});
t('careDay: a 12:30 am entry belongs to the day before with a 6 am start', function () {
  assert.strictEqual(Logic.careDay(at(0, 30, 1), 6), '2026-11-23');
  assert.strictEqual(Logic.careDay(at(6, 0, 1), 6), '2026-11-24');
  assert.strictEqual(Logic.careDay(at(23, 59), 0), '2026-11-23');
});
t('fluidBalance: tonight\'s log (water, coffee, soup, water in; three outputs)', function () {
  var day = [
    { entry_kind: 'drink', volume_ml: 16 * OZ, portion_mult: 1, kcal: 0 },
    { entry_kind: 'drink', volume_ml: 16 * OZ, portion_mult: 1, kcal: 5 },
    { entry_kind: 'output', output_type: 'urine', output_color: 'dark_yellow', volume_ml: 19 * OZ, portion_mult: 1 },
    { entry_kind: 'meal', free_text: 'Progresso garden vegetable', fluid_ml: 8 * OZ, portion_mult: 1, kcal: 80 },
    { entry_kind: 'output', output_type: 'urine', volume_ml: 2 * OZ, portion_mult: 1 },
    { entry_kind: 'drink', volume_ml: 3 * OZ, portion_mult: 1 },
    { entry_kind: 'output', output_type: 'urine', output_color: 'pink_red', volume_ml: 4 * OZ, portion_mult: 1 },
    { entry_kind: 'drink', volume_ml: 99 * OZ, portion_mult: 1, deleted: true }
  ];
  var b = Logic.fluidBalance(day);
  assert.strictEqual(Math.round(b.inMl / OZ), 43);
  assert.strictEqual(Math.round(b.outMl / OZ), 25);
  assert.strictEqual(Math.round(b.netMl / OZ), 18);
  assert.strictEqual(Math.round(b.foodMl / OZ), 8);
  assert.strictEqual(b.flags.length, 1); assert.deepEqual(b.flags[0].reasons, ['pink or red']);
  // Outputs never add calories.
  assert.strictEqual(Logic.dayTotals(day.filter(function (e) { return !e.deleted; })).kcal, 85);
});
t('fluid from a meal follows servings and what was left on the plate', function () {
  assert.strictEqual(Logic.fluidIn({ fluid_ml: 200, portion_mult: 2 }), 400);
  assert.strictEqual(Logic.fluidIn({ fluid_ml: 200, portion_mult: 1, plate_status: 'leftovers', kcal: 50, served_kcal: 100 }), 100);
  assert.strictEqual(Logic.fluidIn({ entry_kind: 'drink', volume_ml: 240, portion_mult: 0.5 }), 120);
});
t('output flags: clots, cola color, could not go', function () {
  assert.deepEqual(Logic.outputFlags({ entry_kind: 'output', output_type: 'urine', output_color: 'cola', clots: true }), ['cola-colored', 'clots']);
  assert.deepEqual(Logic.outputFlags({ entry_kind: 'output', output_type: 'none' }), ['tried but could not go']);
  assert.deepEqual(Logic.outputFlags({ entry_kind: 'drink', output_color: 'cola' }), []);
});
t('weights: morning readings only, change since yesterday and over a week, alerts only when set', function () {
  var P = 'p1', ws = [
    { kind: 'weight', for_profile_id: P, standard: true, value: 150, unit: 'lb', taken_at: at(6, 30, -7) },
    { kind: 'weight', for_profile_id: P, standard: true, value: 151, unit: 'lb', taken_at: at(6, 40, -1) },
    { kind: 'weight', for_profile_id: P, standard: false, value: 160, unit: 'lb', taken_at: at(18, 0, -1) },
    { kind: 'weight', for_profile_id: P, standard: true, value: 154.5, unit: 'lb', taken_at: at(6, 35) },
    { kind: 'weight', for_profile_id: 'other', standard: true, value: 200, unit: 'lb', taken_at: at(6, 35) }
  ];
  var c = Logic.weightChange(ws, P, '2026-11-23', 6);
  assert.strictEqual(c.lb, 154.5); assert.strictEqual(c.sincePrev, 3.5); assert.strictEqual(c.prevDays, 1); assert.strictEqual(c.sinceWeek, 4.5);
  assert.deepEqual(Logic.weightFlags(c, {}), []);
  assert.deepEqual(Logic.weightFlags(c, { weight_alert_day_lb: 3, weight_alert_week_lb: 5 }), ['up 3.5 lb since yesterday morning']);
  assert.strictEqual(Logic.weightChange(ws, P, '2026-11-21', 6), null);
});
t('fluid suggestions for soup, Jell-O, ice chips; none for toast', function () {
  assert.strictEqual(Logic.suggestFluidMl('Progresso garden vegetable soup'), 237);
  assert.strictEqual(Logic.suggestFluidMl('lime Jell-O', 120), 120);
  assert.strictEqual(Logic.suggestFluidMl('ice chips', 240), 120);
  assert.strictEqual(Logic.suggestFluidMl('buttered toast'), 0);
});
t('medPlan: due, overdue, later, marked; stopped and not-started meds drop out; as-needed is separate', function () {
  var meds = [
    { id: 'a', kind: 'medication', title: 'Furosemide', fields: { slots: 'morning,evening' } },
    { id: 'b', kind: 'medication', title: 'Amlodipine', fields: { slots: 'morning', stop: '2026-11-20' } },
    { id: 'c', kind: 'medication', title: 'Insulin', fields: { slots: 'bedtime', start: '2026-11-30' } },
    { id: 'd', kind: 'medication', title: 'Tylenol', fields: { slots: 'prn' } }
  ];
  var doses = [{ id: 'x', kind: 'dose', updated_at: '2026-11-23T14:00:00Z', fields: { med_id: 'a', day: '2026-11-23', slot: 'morning', status: 'given' } },
    { id: 'y', kind: 'dose', fields: { med_id: 'd', day: '2026-11-23', slot: 'prn', status: 'given' } }];
  var p = Logic.medPlan(meds, [], '2026-11-23', 10.5);
  assert.deepEqual(p.map(function (r) { return r.med.id + ':' + r.slot + ':' + r.state; }), ['a:morning:overdue', 'a:evening:later']);
  assert.strictEqual(Logic.medPlan(meds, [], '2026-11-23', 7.5)[0].state, 'due');
  assert.strictEqual(Logic.medPlan(meds, doses, '2026-11-23', 10.5)[0].state, 'given');
  assert.strictEqual(Logic.medPlan(meds, [], '2026-11-30', 22).filter(function (r) { return r.med.id === 'c'; })[0].state, 'due');
  assert.strictEqual(Logic.prnDoses(doses, 'd', '2026-11-23').length, 1);
});
t('medPlan: a medicine set for 6:30 is due at 5:45 and overdue at 8:45; blank uses the slot hour', function () {
  var m = [{ id: 'a', title: 'Levothyroxine', fields: { slots: 'morning,evening', slot_times: { morning: '06:30' } } }];
  assert.strictEqual(Logic.slotHour(m[0], 'morning'), 6.5);
  assert.strictEqual(Logic.slotHour(m[0], 'evening'), 17);
  assert.strictEqual(Logic.medPlan(m, [], '2026-11-23', 5.75)[0].state, 'due');
  assert.strictEqual(Logic.medPlan(m, [], '2026-11-23', 8.75)[0].state, 'overdue');
  assert.strictEqual(Logic.medPlan(m, [], '2026-11-23', 8.75)[0].time, '06:30');
});
t('doseTiming: typical time, late (2h+), skipped and unmarked over a week', function () {
  var med = { id: 'a', fields: { slots: 'morning' } }, days = [], doses = [];
  for (var i = 0; i < 7; i++) days.push('2026-11-' + (16 + i));
  var times = [[8, 10], [9, 40], [10, 5], [8, 30], null, 'skipped', [10, 30]];
  times.forEach(function (t, i) {
    if (t === null) return;
    var d = new Date(2026, 10, 16 + i, t === 'skipped' ? 8 : t[0], t === 'skipped' ? 0 : t[1]);
    doses.push({ id: 'd' + i, updated_at: d.toISOString(), occurred_at: d.toISOString(), fields: { med_id: 'a', day: days[i], slot: 'morning', status: t === 'skipped' ? 'skipped' : 'given' } });
  });
  var r = Logic.doseTiming(med, doses, 'morning', days, 6);
  assert.deepEqual([r.scheduled, r.given, r.skipped, r.unmarked, r.late, r.typical, r.earliest, r.latest], ['08:00', 5, 1, 1, 2, '09:40', '08:10', '10:30']);
});
t('labelCues: finds timing rules in label text and keeps the sentence', function () {
  var c = Logic.labelCues('Take on an empty stomach, 30 to 60 minutes before breakfast. Take at least 4 hours before or after calcium or iron supplements. Take it at the same time every day.');
  assert.deepEqual(c.map(function (x) { return x.cue; }), ['empty_stomach', 'separate', 'same_time']);
  assert.ok(/empty stomach/.test(c[0].sentence));
  assert.deepEqual(Logic.labelCues('Take with food.').map(function (x) { return x.cue; }), ['with_food']);
  assert.deepEqual(Logic.labelCues(''), []);
});
t('patterns: BP after late evening doses only shows with 3+ mornings of each kind', function () {
  var med = { id: 'e', fields: { slots: 'evening' } }, days = [], doses = [], ms = [];
  for (var i = 0; i < 9; i++) days.push('2026-11-' + (10 + i));
  days.forEach(function (day, i) {
    var late = i % 2 === 1;
    var given = new Date(2026, 10, 10 + i, late ? 20 : 17, late ? 30 : 10);
    doses.push({ id: 'x' + i, updated_at: given.toISOString(), occurred_at: given.toISOString(), fields: { med_id: 'e', day: day, slot: 'evening', status: 'given' } });
    if (i < 8) ms.push({ kind: 'blood_pressure', value: late ? 160 : 140, value2: 80, taken_at: new Date(2026, 10, 11 + i, 8, 0).toISOString() });
  });
  var ps = Logic.patterns({ measurements: ms, meds: [med], doses: doses, diary: [] }, null, days, 6);
  var bp = ps.filter(function (p) { return p.key === 'bp_evening'; })[0];
  assert.strictEqual(bp.enough, true); assert.strictEqual(bp.diff, 20); assert.strictEqual(bp.n, 8);
  var few = Logic.patterns({ measurements: ms.slice(0, 3), meds: [med], doses: doses, diary: [] }, null, days, 6)[0];
  assert.strictEqual(few.enough, false);
});
t('parseBpMeasurement: standard Bluetooth reading with time, pulse, user and irregular pulse', function () {
  // flags 0x1E: mmHg, timestamp, pulse, user id, status. 142/80 (MAP 101), 2026-11-23 08:30:05, pulse 96, user 1, irregular pulse.
  var bytes = [0x1E, 142, 0x00, 80, 0x00, 101, 0x00, 0xEA, 0x07, 11, 23, 8, 30, 5, 96, 0x00, 1, 0x04, 0x00];
  var r = Logic.parseBpMeasurement(bytes);
  assert.deepEqual([r.sys, r.dia, r.map, r.pulse, r.user, r.irregular, r.movement, r.unit], [142, 80, 101, 96, 1, true, false, 'mmHg']);
  assert.deepEqual(r.time, { y: 2026, mo: 11, d: 23, h: 8, mi: 30, s: 5 });
  var plain = Logic.parseBpMeasurement([0x00, 120, 0x00, 70, 0x00, 87, 0x00]);
  assert.deepEqual([plain.sys, plain.dia, plain.time, plain.pulse, plain.irregular], [120, 70, null, null, false]);
  // kPa: 16.0 kPa = mantissa 160, exponent -1 (0xF0A0) -> 120 mmHg
  assert.strictEqual(Logic.parseBpMeasurement([0x01, 0xA0, 0xF0, 0x6C, 0xF0, 0x74, 0xF0]).sys, 120);
});
t('upcoming: visits, follow-ups, yearly and monthly days, refills, within the window only', function () {
  var day = function (iso) { return iso.slice(0, 10); };
  var rs = [
    { id: 'v', kind: 'visit', title: 'Kidney doctor', occurred_at: '2026-11-25T15:00:00Z', fields: { next_appt: '2026-12-30T15:00:00Z' } },
    { id: 'b', kind: 'event', title: 'Birthday', occurred_at: '1940-12-01T12:00:00Z', fields: { repeat: 'Every year' } },
    { id: 'm', kind: 'event', title: 'Labs', occurred_at: '2026-01-28T12:00:00Z', fields: { repeat: 'Every month' } },
    { id: 'o', kind: 'event', title: 'Old', occurred_at: '2026-11-01T12:00:00Z', fields: {} },
    { id: 'r', kind: 'medication', title: 'Furosemide', fields: { refill_on: '2026-11-24' } }
  ];
  var u = Logic.upcoming(rs, '2026-11-23', 14, day);
  assert.deepEqual(u.map(function (x) { return x.day + ' ' + x.title + ' ' + x.inDays; }), ['2026-11-24 Refill: Furosemide 1', '2026-11-25 Kidney doctor 2', '2026-11-28 Labs 5', '2026-12-01 Birthday 8']);
});

console.log(n + ' tests passed');
