/* Kitchen logic: coverage, restock, profile fit, nutrition roll-ups. Pure functions. */
var Logic = (function () {
  var DV = { kcal: 2000, protein_g: 50, carbs_g: 275, fat_g: 78, fiber_g: 28, sodium_mg: 2300, sugar_g: 50, potassium_mg: 4700 };
  var NUTRIENTS = ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sodium_mg', 'sugar_g', 'potassium_mg'];

  function ingredientMatch(name, ingredients) {
    var n = Units.normalizeName(name);
    if (!n) return null;
    for (var i = 0; i < ingredients.length; i++) {
      var ing = ingredients[i];
      if (Units.normalizeName(ing.name) === n) return ing;
      if ((ing.aliases || []).some(function (a) { return Units.normalizeName(a) === n; })) return ing;
    }
    for (var j = 0; j < ingredients.length; j++) {
      var nm = Units.normalizeName(ingredients[j].name);
      if (nm && (n.indexOf(nm) > -1 || nm.indexOf(n) > -1)) return ingredients[j];
    }
    return null;
  }

  // pantryByIng: {ingredient_id: [pantry_item,...]}
  function coverage(recipeLines, pantryByIng) {
    var required = recipeLines.filter(function (l) { return !l.optional; });
    var have = 0, missing = [];
    required.forEach(function (l) {
      var items = pantryByIng[l.ingredient_id] || [];
      var ok = items.some(function (p) { return Units.covers(p.qty, p.unit, l.qty, l.unit); });
      if (ok) have++; else missing.push(l);
    });
    return { pct: required.length ? Math.round(100 * have / required.length) : 100, have: have, total: required.length, missing: missing };
  }

  // Gram estimate for a recipe line, for nutrition. Count units use a rough per-piece weight.
  var PIECE_G = { egg: 50, onion: 110, clove: 5, potato: 170, tomato: 120, carrot: 60, apple: 180, banana: 120, lemon: 60, lime: 45, 'bell pepper': 120, slice: 28, can: 400 };
  function gramsFor(line, ing) {
    if (line.qty == null) return 0;
    var b = Units.toBase(line.qty, line.unit);
    if (b.kind === 'mass') return b.qty;
    if (b.kind === 'vol') return b.qty * densityFor(ing, line);
    var key = Object.keys(PIECE_G).find(function (k) { return Units.normalizeName(ing ? ing.name : line.name).indexOf(k) > -1 || (line.unit || '').indexOf(k) > -1; });
    return line.qty * (key ? PIECE_G[key] : 100);
  }

  // grams per ml for things commonly measured by volume; water-like liquids default to 1.
  var DENSITY = [[/oat/, 0.34], [/flour/, 0.53], [/cooked rice|rice/, 0.67], [/sugar/, 0.85], [/brown sugar/, 0.93], [/honey|syrup|molasses/, 1.42],
    [/oil/, 0.92], [/butter/, 0.96], [/milk|broth|stock|water|juice|vinegar|soy sauce/, 1.03], [/cheese/, 0.45], [/salt/, 1.2], [/pepper|cinnamon|paprika|cumin|spice|powder/, 0.5],
    [/broccoli|spinach|lettuce|kale|cabbage/, 0.38], [/bean|lentil|pea|corn/, 0.75], [/nut|almond|walnut|pecan/, 0.55], [/yogurt|sour cream|cream/, 1.0]];
  function densityFor(ing, line) {
    if (ing && ing.density) return ing.density;
    var n = Units.normalizeName(ing ? ing.name : line.name);
    for (var i = 0; i < DENSITY.length; i++) if (DENSITY[i][0].test(n)) return DENSITY[i][1];
    return 1;
  }

  function recipeNutrition(recipe, lines, ingById) {
    var totals = {}, known = 0;
    NUTRIENTS.forEach(function (k) { totals[k] = 0; });
    lines.forEach(function (l) {
      var ing = ingById[l.ingredient_id];
      if (!ing || ing.kcal_100g == null) return;
      known++;
      var g = gramsFor(l, ing) / 100;
      NUTRIENTS.forEach(function (k) { totals[k] += (ing[k === 'kcal' ? 'kcal_100g' : k] || 0) * g; });
    });
    var s = recipe.servings || 1;
    var per = {};
    NUTRIENTS.forEach(function (k) { per[k] = Math.round(totals[k] / s); });
    return { perServing: per, knownLines: known, totalLines: lines.length };
  }

  function fitForProfile(lines, nutritionPer, rules, ingById) {
    var worst = 'ok', reasons = [];
    (rules || []).forEach(function (r) {
      var hit = false, why = '';
      if (r.kind === 'avoid_ingredient' && r.ingredient_id) {
        hit = lines.some(function (l) { return l.ingredient_id === r.ingredient_id; });
        why = 'contains ' + ((ingById[r.ingredient_id] || {}).name || 'avoided ingredient');
      } else if (r.kind === 'limit_nutrient' && r.nutrient && nutritionPer && r.max_per_serving != null) {
        hit = (nutritionPer[r.nutrient] || 0) > r.max_per_serving;
        why = r.nutrient.replace('_', ' ') + ' ' + nutritionPer[r.nutrient] + ' > ' + r.max_per_serving + ' per serving';
      }
      if (hit) {
        reasons.push((r.severity === 'hard' ? 'Avoid: ' : 'Watch: ') + why + (r.reason ? ' (' + r.reason + ')' : ''));
        if (r.severity === 'hard') worst = 'bad'; else if (worst !== 'bad') worst = 'warn';
      }
    });
    return { level: worst, reasons: reasons };
  }

  // Recency-weighted daily usage over the last 8 weeks: each use is weighted
  // 0.8^(age in weeks), normalised by the total weight of every day in the window,
  // so a burst of recent use moves the rate quickly while old habits fade.
  var DAY_WEIGHT_SUM = (function () { var s = 0; for (var d = 0; d < 56; d++) s += Math.pow(0.8, d / 7); return s; })();
  function burnRate(usageRows, now) {
    now = now || Date.now();
    var score = 0, uses = 0;
    usageRows.forEach(function (u) {
      if (u.event !== 'cooked' && u.event !== 'logged') return;
      var ageDays = (now - new Date(u.at).getTime()) / 864e5;
      if (ageDays > 56 || ageDays < 0) return;
      score += (u.qty || 1) * Math.pow(0.8, ageDays / 7); uses++;
    });
    return { perDay: score / DAY_WEIGHT_SUM, uses: uses };
  }

  function restockSuggestions(pantry, usageByIng, ingById) {
    var out = [];
    var seen = {};
    pantry.forEach(function (p) {
      seen[p.ingredient_id] = true;
      var b = burnRate(usageByIng[p.ingredient_id] || []);
      var days = b.perDay > 0 ? p.qty / b.perDay : Infinity;
      if (p.par_qty != null && p.qty < p.par_qty) out.push({ ingredient_id: p.ingredient_id, why: 'below par (' + p.qty + ' < ' + p.par_qty + ' ' + (p.unit || '') + ')' });
      else if (days <= 5 && b.uses >= 2) out.push({ ingredient_id: p.ingredient_id, why: 'used ' + b.uses + 'x recently, ~' + Math.max(0, Math.round(days)) + ' days left' });
    });
    Object.keys(usageByIng).forEach(function (id) {
      if (seen[id]) return;
      var b = burnRate(usageByIng[id]);
      if (b.uses >= 3) out.push({ ingredient_id: id, why: 'out, but used ' + b.uses + 'x recently' });
    });
    return out.filter(function (s) { return ingById[s.ingredient_id]; });
  }

  function dayTotals(entries) {
    var t = {};
    NUTRIENTS.forEach(function (k) { t[k] = 0; });
    entries.forEach(function (e) { NUTRIENTS.forEach(function (k) { t[k] += (e[k] || 0) * (e.portion_mult || 1); }); });
    return t;
  }

  function expiringSoon(pantry, days) {
    var limit = Date.now() + (days || 4) * 864e5;
    return pantry.filter(function (p) { return p.expires_on && new Date(p.expires_on).getTime() <= limit; });
  }

  // Batch import: group page reads into recipes. pages[i] = { starts_mid, ends_incomplete }
  // in the order the photos were picked. A page that ends incomplete is joined to an
  // unused page that starts mid-recipe: the next photo first, then the one before it.
  // Leftover pieces are joined anywhere in the batch only when the match is unambiguous
  // (one open recipe, one loose page). A page with skip (unreadable, or no recipe) keeps
  // its position but joins nothing. Returns [{ pages: [i...], complete: bool }].
  function stitchPages(pages) {
    var used = pages.map(function (p) { return !!p.skip; }), groups = [];
    function isLoose(i) { return i >= 0 && i < pages.length && !used[i] && pages[i].starts_mid; }
    function extend(g) {
      var last = g.pages[g.pages.length - 1];
      while (pages[last].ends_incomplete) {
        var next = isLoose(last + 1) ? last + 1 : isLoose(last - 1) ? last - 1 : -1;
        if (next < 0) break;
        used[next] = true; g.pages.push(next); last = next;
      }
    }
    pages.forEach(function (p, i) {
      if (used[i] || p.starts_mid) return;
      used[i] = true; var g = { pages: [i] }; extend(g); groups.push(g);
    });
    var open = groups.filter(function (g) { return pages[g.pages[g.pages.length - 1]].ends_incomplete; });
    var loose = pages.map(function (p, i) { return i; }).filter(function (i) { return !used[i]; });
    if (open.length === 1 && loose.length === 1) { used[loose[0]] = true; open[0].pages.push(loose[0]); extend(open[0]); }
    // Whatever is left starts mid-recipe. Pages that carry on start their chains first,
    // so a middle page still collects the last page even when the first page is missing.
    var rest = pages.map(function (p, i) { return i; }).filter(function (i) { return !used[i]; });
    rest.sort(function (a, b) { return (pages[b].ends_incomplete ? 1 : 0) - (pages[a].ends_incomplete ? 1 : 0) || a - b; });
    rest.forEach(function (i) { if (!used[i]) { used[i] = true; var g = { pages: [i] }; extend(g); groups.push(g); } });
    groups.forEach(function (g) { g.complete = !pages[g.pages[0]].starts_mid && !pages[g.pages[g.pages.length - 1]].ends_incomplete; });
    return groups.sort(function (a, b) { return a.pages[0] - b.pages[0]; });
  }

  // When a JPEG was taken, from its EXIF DateTimeOriginal (or DateTime), as a sortable
  // number; null when there is no EXIF date. Reads only the bytes given (the file's start).
  function exifTakenAt(buf) {
    try {
      var v = new DataView(buf), off = 2;
      if (v.getUint16(0) !== 0xFFD8) return null;
      while (off + 4 <= v.byteLength) {
        var marker = v.getUint16(off), size = v.getUint16(off + 2);
        if (marker === 0xFFDA) return null;
        if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) return tiffDate(v, off + 10);
        off += 2 + size;
      }
    } catch (e) { /* truncated or not a JPEG */ }
    return null;
  }
  function tiffDate(v, t) {
    var le = v.getUint16(t) === 0x4949;
    var u16 = function (o) { return v.getUint16(o, le); }, u32 = function (o) { return v.getUint32(o, le); };
    function find(ifd, tag) { var n = u16(ifd); for (var k = 0; k < n; k++) { var e = ifd + 2 + k * 12; if (u16(e) === tag) return e; } return -1; }
    function text(e) { var s = ''; for (var k = 0; k < 19; k++) s += String.fromCharCode(v.getUint8(t + u32(e + 8) + k)); return s; }
    var ifd0 = t + u32(t + 4), when = null, exifPtr = find(ifd0, 0x8769);
    if (exifPtr > -1) { var e = find(t + u32(exifPtr + 8), 0x9003); if (e > -1) when = text(e); }
    if (!when) { var d = find(ifd0, 0x0132); if (d > -1) when = text(d); }
    var m = when && when.match(/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)$/);
    return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
  }

  return { DV: DV, NUTRIENTS: NUTRIENTS, ingredientMatch: ingredientMatch, coverage: coverage, gramsFor: gramsFor, recipeNutrition: recipeNutrition, fitForProfile: fitForProfile, burnRate: burnRate, restockSuggestions: restockSuggestions, dayTotals: dayTotals, expiringSoon: expiringSoon, stitchPages: stitchPages, exifTakenAt: exifTakenAt };
})();
