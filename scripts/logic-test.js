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
console.log(n + ' tests passed');
