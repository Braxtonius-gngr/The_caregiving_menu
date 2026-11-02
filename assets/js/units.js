/* Unit conversion and ingredient-name normalisation. Pure functions, no DOM. */
var Units = (function () {
  // Everything converts to grams (mass) or millilitres (volume). Count stays count.
  var MASS = { g: 1, gram: 1, grams: 1, kg: 1000, oz: 28.35, ounce: 28.35, ounces: 28.35, lb: 453.6, lbs: 453.6, pound: 453.6, pounds: 453.6 };
  var VOL = { pinch: 0.36, pinches: 0.36, dash: 0.6, dashes: 0.6, ml: 1, l: 1000, liter: 1000, litre: 1000, tsp: 4.93, teaspoon: 4.93, teaspoons: 4.93, tbsp: 14.79, tablespoon: 14.79, tablespoons: 14.79, cup: 236.6, cups: 236.6, 'fl oz': 29.57, pint: 473.2, pints: 473.2, quart: 946.4, quarts: 946.4, gallon: 3785, gallons: 3785 };
  var COUNT = { '': 1, each: 1, ea: 1, piece: 1, pieces: 1, count: 1, ct: 1, clove: 1, cloves: 1, can: 1, cans: 1, bunch: 1, bunches: 1, slice: 1, slices: 1, large: 1, medium: 1, small: 1 };

  function kind(unit) {
    var u = (unit || '').toLowerCase().trim();
    if (MASS[u] != null) return 'mass';
    if (VOL[u] != null) return 'vol';
    if (COUNT[u] != null) return 'count';
    return 'unknown';
  }

  function toBase(qty, unit) {
    var u = (unit || '').toLowerCase().trim();
    var k = kind(u);
    if (k === 'mass') return { qty: qty * MASS[u], kind: k };
    if (k === 'vol') return { qty: qty * VOL[u], kind: k };
    return { qty: qty, kind: k };
  }

  // Returns true when `have` (qty, unit) covers `need` (qty, unit). Unknown or
  // mismatched kinds fall back to "present at all" so we never block on units.
  function covers(haveQty, haveUnit, needQty, needUnit) {
    if (haveQty == null || haveQty <= 0) return false;
    if (needQty == null || needQty <= 0) return true;
    var h = toBase(haveQty, haveUnit);
    var n = toBase(needQty, needUnit);
    if (h.kind !== n.kind || h.kind === 'unknown') return true;
    return h.qty + 1e-9 >= n.qty;
  }

  // Subtract need from have in have's unit; returns new have qty (>= 0).
  function subtract(haveQty, haveUnit, needQty, needUnit) {
    var h = toBase(haveQty, haveUnit);
    var n = toBase(needQty, needUnit);
    if (h.kind !== n.kind || h.kind === 'unknown') return Math.max(0, haveQty - (needQty || 0));
    var factor = h.qty / (haveQty || 1);
    return Math.max(0, (h.qty - n.qty) / factor);
  }

  var STOP = /\b(fresh|chopped|diced|minced|sliced|large|medium|small|of|the|a|to taste|optional|organic|raw|cooked|peeled|whole|ground|finely|roughly)\b/g;
  function normalizeName(name) {
    return (name || '').toLowerCase().replace(/\(.*?\)/g, '').replace(STOP, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().replace(/s$/, '');
  }

  // "2 1/2 cups flour, sifted" -> {qty: 2.5, unit: 'cups', name: 'flour', prep: 'sifted'}
  function parseLine(line) {
    var s = (line || '').trim();
    var m = s.match(/^([\d.\/\s]+)?\s*([a-zA-Z]+)?\s*(.*)$/);
    var qty = null;
    if (m && m[1]) {
      qty = m[1].trim().split(/\s+/).reduce(function (acc, part) {
        if (part.indexOf('/') > -1) { var f = part.split('/'); return acc + (parseFloat(f[0]) / parseFloat(f[1] || 1)); }
        return acc + parseFloat(part);
      }, 0);
    }
    var unit = m && m[2] ? m[2] : '';
    var rest = m ? m[3] : s;
    if (kind(unit) === 'unknown' && unit) { rest = unit + ' ' + rest; unit = ''; }
    var parts = rest.split(',');
    return { qty: qty, unit: unit.toLowerCase(), name: parts[0].trim(), prep: parts.slice(1).join(',').trim() };
  }

  return { kind: kind, toBase: toBase, covers: covers, subtract: subtract, normalizeName: normalizeName, parseLine: parseLine };
})();
