/* Kitchen logic: coverage, restock, profile fit, nutrition roll-ups. Pure functions. */
var Logic = (function () {
  var DV = { kcal: 2000, protein_g: 50, carbs_g: 275, fat_g: 78, fiber_g: 28, sodium_mg: 2300, sugar_g: 50, potassium_mg: 4700 };
  var NUTRIENTS = ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sodium_mg', 'sugar_g', 'potassium_mg'];

  // Only an exact name or alias: safe to compute nutrition from without asking.
  function exactIngredient(name, ingredients) {
    var n = Units.normalizeName(name);
    if (!n) return null;
    return ingredients.find(function (ing) { return Units.normalizeName(ing.name) === n || (ing.aliases || []).some(function (a) { return Units.normalizeName(a) === n; }); }) || null;
  }

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


  /* ---------- fluid balance and weight (Phase 1) ---------- */
  // Fluid amounts are stored in mL. Grams count as mL: true for water, broth and most drinks.
  var ML_PER = { oz: 29.5735, ml: 1, g: 1, cup: 236.588 };
  var FLUID_UNITS = ['oz', 'ml', 'g', 'cup'];
  function toMl(value, unit) { var f = ML_PER[unit]; value = +value; return f && value > 0 ? value * f : 0; }
  function fromMl(ml, unit) { return (+ml || 0) / (ML_PER[unit] || ML_PER.oz); }
  var LB_PER_KG = 2.20462;
  function toLb(value, unit) { return unit === 'kg' ? value * LB_PER_KG : +value; }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  // The family's day runs from startHour to startHour the next day, in local time, so a
  // 12:30 am entry with a 6 am start belongs to the day before.
  function careDay(iso, startHour) {
    var d = iso ? new Date(iso) : new Date();
    d = new Date(d.getTime() - (startHour || 0) * 3600e3);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // How much of a meal was actually eaten: a plate marked "leftovers" keeps the calories
  // eaten next to the calories served, so the same share applies to the meal's fluid.
  function eatenShare(e) {
    if (e.plate_status === 'leftovers' && e.served_kcal > 0 && e.kcal != null) return Math.max(0, Math.min(1, (e.kcal * (e.portion_mult || 1)) / e.served_kcal));
    return 1;
  }
  function fluidIn(e) {
    if (e.deleted || e.entry_kind === 'output') return 0;
    if (e.entry_kind === 'drink') return (e.volume_ml || 0) * (e.portion_mult || 1);
    return (e.fluid_ml || 0) * (e.portion_mult || 1) * eatenShare(e);
  }
  function fluidOut(e) { return !e.deleted && e.entry_kind === 'output' ? (e.volume_ml || 0) * (e.portion_mult || 1) : 0; }

  var RED_COLORS = ['pink_red', 'cola'];
  // Reasons an output is worth a call to the care team. Never a diagnosis.
  function outputFlags(e) {
    if (e.deleted || e.entry_kind !== 'output') return [];
    var f = [];
    if (e.output_type === 'none') f.push('tried but could not go');
    if (RED_COLORS.indexOf(e.output_color) >= 0) f.push(e.output_color === 'cola' ? 'cola-colored' : 'pink or red');
    if (e.clots) f.push('clots');
    return f;
  }

  function fluidBalance(entries) {
    var r = { drinkMl: 0, foodMl: 0, inMl: 0, outMl: 0, netMl: 0, drinks: 0, foods: 0, outputs: 0, flags: [] };
    entries.forEach(function (e) {
      if (e.deleted) return;
      if (e.entry_kind === 'output') {
        r.outMl += fluidOut(e); r.outputs++;
        var fl = outputFlags(e); if (fl.length) r.flags.push({ entry: e, reasons: fl });
      } else if (e.entry_kind === 'drink') { r.drinkMl += fluidIn(e); r.drinks++; }
      else { var m = fluidIn(e); if (m > 0) { r.foodMl += m; r.foods++; } }
    });
    r.inMl = r.drinkMl + r.foodMl; r.netMl = r.inMl - r.outMl;
    return r;
  }

  // Morning ("standard") weights only, one per care day (the earliest), newest first, in lb.
  function standardWeights(measurements, profileId, startHour) {
    var byDay = {};
    measurements.forEach(function (m) {
      if (m.deleted || m.kind !== 'weight' || !m.standard || (m.for_profile_id || null) !== (profileId || null)) return;
      var day = careDay(m.taken_at, startHour);
      if (!byDay[day] || m.taken_at < byDay[day].taken_at) byDay[day] = m;
    });
    return Object.keys(byDay).sort().reverse().map(function (day) { var m = byDay[day]; return { day: day, lb: toLb(m.value, m.unit), m: m }; });
  }
  function dayDiff(a, b) { return Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 864e5); }
  // Change since the previous morning weight and over about a week, for the weight on `day`.
  function weightChange(measurements, profileId, day, startHour) {
    var all = standardWeights(measurements, profileId, startHour).filter(function (w) { return w.day <= day; });
    if (!all.length || all[0].day !== day) return null;
    var today = all[0], prev = all[1] || null;
    var week = all.filter(function (w) { var d = dayDiff(day, w.day); return d >= 6 && d <= 8; })[0] || null;
    return {
      lb: today.lb, m: today.m,
      sincePrev: prev ? today.lb - prev.lb : null, prevDays: prev ? dayDiff(day, prev.day) : null,
      sinceWeek: week ? today.lb - week.lb : null
    };
  }
  // Alert levels come from the care team (blank means no alert). A gain since the previous
  // morning counts only when that reading was the day before.
  function weightFlags(change, settings) {
    if (!change || !settings) return [];
    var f = [], day = +settings.weight_alert_day_lb, week = +settings.weight_alert_week_lb;
    if (day > 0 && change.sincePrev != null && change.prevDays === 1 && change.sincePrev >= day) f.push('up ' + change.sincePrev.toFixed(1) + ' lb since yesterday morning');
    if (week > 0 && change.sinceWeek != null && change.sinceWeek >= week) f.push('up ' + change.sinceWeek.toFixed(1) + ' lb in a week');
    return f;
  }

  // A suggested fluid amount for one serving of a food, or 0. Only ever a suggestion.
  var FLUID_FOODS = [
    [/\b(soup|broth|bouillon|stew|chili|chowder|bisque|gumbo|ramen|pho|consomm)/i, 1],
    [/\b(jell-?o|gelatin|ice cream|sherbet|sorbet|popsicle|ice pop|italian ice|frozen yogurt|milkshake|shake|smoothie|pudding)\b/i, 1],
    [/\bice chips\b/i, 0.5]
  ];
  function suggestFluidMl(text, portionMl) {
    text = String(text || '');
    for (var i = 0; i < FLUID_FOODS.length; i++) if (FLUID_FOODS[i][0].test(text)) return Math.round((portionMl || ML_PER.cup) * FLUID_FOODS[i][1]);
    return 0;
  }

  /* ---------- daily meds ---------- */
  // Medicines are `records` of kind medication; doses given are kind dose with
  // fields { med_id, day, slot, status }. `hour` is hours into the care day's calendar
  // (an hour before the day start counts as the next calendar day, e.g. 1 am = 25).
  var SLOT_HOURS = { morning: 8, noon: 12, evening: 17, bedtime: 21 };
  function medActive(med, day) { var f = med.fields || {}; return !med.deleted && (!f.start || f.start <= day) && (!f.stop || f.stop >= day); }
  function medSlots(med) { return String((med.fields || {}).slots || '').split(',').filter(Boolean); }
  function doseFor(doses, medId, day, slot) {
    var hit = doses.filter(function (d) { var f = d.fields || {}; return !d.deleted && f.med_id === medId && f.day === day && f.slot === slot; });
    return hit.sort(function (a, b) { return a.updated_at < b.updated_at ? 1 : -1; })[0] || null;
  }
  // In care elsewhere (hospital, rehab, respite): a stay is { org, from_at, to_at, until } with ISO
  // start, ISO end (null while it lasts) and the day she is expected home. Scheduled doses inside
  // a stay are the other place's to give, so they read as covered, never as missed.
  function carePoint(iso, startHour) { return { day: careDay(iso, startHour), hour: minuteOfDay(iso, startHour) / 60 }; }
  function beforePoint(day, hour, p) { return day < p.day || (day === p.day && hour < p.hour); }
  function stayOpen(stays) { return (stays || []).filter(function (s) { return s && s.from_at && !s.to_at; })[0] || null; }
  function stayAt(stays, day, hour, startHour) {
    return (stays || []).filter(function (s) {
      return s && s.from_at && !beforePoint(day, hour, carePoint(s.from_at, startHour)) && (!s.to_at || beforePoint(day, hour, carePoint(s.to_at, startHour)));
    })[0] || null;
  }
  function medPlan(meds, doses, day, hour, stays, startHour) {
    var rows = [];
    meds.filter(function (m) { return medActive(m, day); }).forEach(function (m) {
      medSlots(m).forEach(function (slot) {
        if (slot === 'prn') return;
        var h = slotHour(m, slot), d = doseFor(doses, m.id, day, slot);
        var stay = d ? null : stayAt(stays, day, h, startHour);
        var state = d ? (d.fields.status || 'given') : stay ? 'covered' : hour == null ? 'later' : hour >= h + 2 ? 'overdue' : hour >= h - 1 ? 'due' : 'later';
        rows.push({ med: m, slot: slot, hour: h, time: ((m.fields || {}).slot_times || {})[slot] || null, dose: d, state: state, stay: stay });
      });
    });
    return rows.sort(function (a, b) { return a.hour - b.hour || String(a.med.title).localeCompare(String(b.med.title)); });
  }
  // A medicine can set its own time for a slot ("07:30"); otherwise the slot's usual hour.
  function slotHour(med, slot) {
    var t = ((med.fields || {}).slot_times || {})[slot], m = /^(\d{1,2}):(\d{2})/.exec(t || '');
    return m ? +m[1] + +m[2] / 60 : SLOT_HOURS[slot];
  }
  function prnDoses(doses, medId, day) { return doses.filter(function (d) { var f = d.fields || {}; return !d.deleted && f.med_id === medId && f.day === day && f.slot === 'prn' && f.status === 'given'; }); }

  // Dates from now to `days` ahead: visits, follow-ups, important days (repeating yearly or
  // monthly) and refills due. day strings are local YYYY-MM-DD.
  function upcoming(records, fromDay, days, dayOfIso) {
    var out = [], end = addDays(fromDay, days);
    var push = function (day, title, kind, id, when) { if (day >= fromDay && day <= end) out.push({ day: day, title: title, kind: kind, id: id, when: when || null, inDays: dayDiff(day, fromDay) }); };
    records.forEach(function (r) {
      if (r.deleted) return;
      var f = r.fields || {};
      if (r.kind === 'visit') {
        if (r.occurred_at) push(dayOfIso(r.occurred_at), r.title || 'Visit', 'visit', r.id, r.occurred_at);
        if (f.next_appt) push(dayOfIso(f.next_appt), (r.title || 'Follow-up') + ' (follow-up)', 'visit', r.id, f.next_appt);
      } else if (r.kind === 'event' && r.occurred_at) {
        var d = dayOfIso(r.occurred_at);
        if (f.repeat === 'Every year') { var y = +fromDay.slice(0, 4); [y, y + 1].forEach(function (yy) { push(yy + d.slice(4), r.title, 'event', r.id); }); }
        else if (f.repeat === 'Every month') { for (var i = 0; i <= 1; i++) { var m = addMonths(fromDay.slice(0, 7) + '-01', i); push(m.slice(0, 8) + d.slice(8), r.title, 'event', r.id); } }
        else push(d, r.title, 'event', r.id);
      } else if (r.kind === 'medication' && f.refill_on && medActive(r, fromDay)) push(f.refill_on, 'Refill: ' + r.title, 'refill', r.id);
    });
    return out.sort(function (a, b) { return a.day < b.day ? -1 : a.day > b.day ? 1 : String(a.when || '').localeCompare(String(b.when || '')); });
  }
  function addDays(day, n) { var d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function addMonths(day, n) { var d = new Date(day + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); }

  /* ---------- timing review and patterns (plain math on her own data) ---------- */
  // Minutes after midnight of a local time; times before the day start count as the next day.
  function minuteOfDay(iso, startHour) { var d = new Date(iso), m = d.getHours() * 60 + d.getMinutes(); return m < (startHour || 0) * 60 ? m + 1440 : m; }
  function hhmm(min) { min = Math.round(min) % 1440; return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function median(xs) { if (!xs.length) return null; var s = xs.slice().sort(function (a, b) { return a - b; }), h = Math.floor(s.length / 2); return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; }
  function mean(xs) { return xs.length ? xs.reduce(function (a, b) { return a + b; }, 0) / xs.length : null; }
  // How a medicine's doses in one slot actually went over `days` (list of care days).
  function doseTiming(med, doses, slot, days, startHour, stays) {
    var sched = slotHour(med, slot) * 60, given = [], skipped = 0, unmarked = 0, late = 0, covered = 0;
    days.forEach(function (day) {
      if (!medActive(med, day)) return;
      var d = doseFor(doses, med.id, day, slot);
      if (!d) { if (stayAt(stays, day, sched / 60, startHour)) covered++; else unmarked++; return; }
      if (d.fields.status !== 'given') { skipped++; return; }
      var m = minuteOfDay(d.occurred_at, startHour); given.push(m); if (m - sched >= 120) late++;
    });
    var typ = median(given);
    return { scheduled: hhmm(sched), given: given.length, skipped: skipped, unmarked: unmarked, late: late, covered: covered,
      typical: typ == null ? null : hhmm(typ), offsetMin: typ == null ? null : Math.round(typ - sched),
      earliest: given.length ? hhmm(Math.min.apply(null, given)) : null, latest: given.length ? hhmm(Math.max.apply(null, given)) : null };
  }
  // Timing rules written in a label or the doctor's instructions, with the sentence they came from.
  var CUES = [
    ['empty_stomach', 'Empty stomach / before eating', /empty stomach|before (breakfast|a meal|meals|eating)|\d+\s*(to|-)\s*\d+\s*minutes before/i],
    ['with_food', 'With food', /with (food|meals?|a meal|breakfast|dinner)|after (meals|eating)|take with milk/i],
    ['bedtime', 'At bedtime / evening', /bedtime|at night|in the evening|before sleep/i],
    ['morning', 'In the morning', /in the morning|morning dose|early in the day|not later than|avoid (taking )?(it )?(late|in the evening)/i],
    ['separate', 'Keep apart from other medicines or foods', /separate|apart from|at least \d+\s*hours? (before|after)|(\d+\s*hours? )?(before|after) (taking )?(antacids|iron|calcium|binders?|phosphate)/i],
    ['same_time', 'Same time every day', /same time (each|every) day/i]
  ];
  function labelCues(text) {
    var out = [], sentences = String(text || '').split(/[.;!?]\s+|\n+/);
    CUES.forEach(function (c) {
      var hit = sentences.find(function (s) { return c[2].test(s); });
      if (hit) out.push({ cue: c[0], label: c[1], sentence: hit.trim().slice(0, 240) });
    });
    return out;
  }
  // Typical breakfast, lunch and dinner times from meal entries over `days`.
  function mealTimes(diary, profileId, days, startHour) {
    var set = {}, b = { breakfast: [], lunch: [], dinner: [] };
    days.forEach(function (d) { set[d] = true; });
    diary.forEach(function (e) {
      if (e.deleted || (e.entry_kind && e.entry_kind !== 'meal') || (e.for_profile_id || null) !== (profileId || null) || !set[careDay(e.eaten_at, startHour)]) return;
      var m = minuteOfDay(e.eaten_at, startHour), h = m / 60;
      if (h >= 4 && h < 11) b.breakfast.push(m); else if (h >= 11 && h < 15.5) b.lunch.push(m); else if (h >= 15.5 && h < 22) b.dinner.push(m);
    });
    var r = {}; Object.keys(b).forEach(function (k) { r[k] = b[k].length ? { typical: hhmm(median(b[k])), n: b[k].length } : null; });
    return r;
  }
  // Patterns. Each: { key, title, text, n, enough }. `enough` only when both sides have data.
  function bpAfterEveningDose(measurements, meds, doses, profileId, days, startHour, stays) {
    var groups = { ontime: [], off: [] }, evening = ['evening', 'bedtime'];
    days.forEach(function (day, i) {
      if (i === 0) return;
      var prev = days[i - 1], bp = measurements.filter(function (m) { return !m.deleted && m.kind === 'blood_pressure' && (m.for_profile_id || null) === (profileId || null) && careDay(m.taken_at, startHour) === day && minuteOfDay(m.taken_at, startHour) < 12 * 60; })
        .sort(function (a, b) { return a.taken_at < b.taken_at ? -1 : 1; })[0];
      if (!bp) return;
      var due = []; meds.forEach(function (m) { if (medActive(m, prev)) medSlots(m).forEach(function (s) { if (evening.indexOf(s) >= 0) due.push([m, s]); }); });
      if (!due.length) return;
      // An evening spent in care elsewhere says nothing about doses at home.
      if (due.some(function (x) { return !doseFor(doses, x[0].id, prev, x[1]) && stayAt(stays, prev, slotHour(x[0], x[1]), startHour); })) return;
      var off = due.some(function (x) { var d = doseFor(doses, x[0].id, prev, x[1]); return !d || d.fields.status !== 'given' || minuteOfDay(d.occurred_at, startHour) - slotHour(x[0], x[1]) * 60 >= 120; });
      groups[off ? 'off' : 'ontime'].push(+bp.value);
    });
    var a = mean(groups.ontime), b = mean(groups.off), n = groups.ontime.length + groups.off.length;
    var enough = groups.ontime.length >= 3 && groups.off.length >= 3;
    return { key: 'bp_evening', title: 'Morning blood pressure after evening meds', n: n, enough: enough, diff: enough ? Math.round(b - a) : null,
      text: enough ? 'Top number averaged ' + Math.round(b) + ' on ' + groups.off.length + ' mornings after an evening dose was late, missed or not marked, and ' + Math.round(a) + ' on ' + groups.ontime.length + ' mornings after it was on time.'
        : 'Needs at least 3 mornings of each kind (after on-time and after late or missed evening doses) with a morning BP. Has ' + groups.ontime.length + ' and ' + groups.off.length + '.' };
  }
  function weightVsSodium(measurements, diary, profileId, days, startHour) {
    var ws = {}; standardWeights(measurements, profileId, startHour).forEach(function (w) { ws[w.day] = w.lb; });
    var pairs = [];
    days.forEach(function (day, i) {
      if (i === 0 || ws[day] == null || ws[days[i - 1]] == null) return;
      var prev = days[i - 1], es = diary.filter(function (e) { return !e.deleted && (e.for_profile_id || null) === (profileId || null) && careDay(e.eaten_at, startHour) === prev; });
      if (!es.length) return;
      var na = es.reduce(function (s, e) { return s + (e.entry_kind === 'output' ? 0 : (e.sodium_mg || 0) * (e.portion_mult || 1)); }, 0);
      pairs.push({ na: na, inMl: fluidBalance(es).inMl, change: ws[day] - ws[prev] });
    });
    var enough = pairs.length >= 7, mid = median(pairs.map(function (p) { return p.na; }));
    var hi = pairs.filter(function (p) { return p.na > mid; }), lo = pairs.filter(function (p) { return p.na <= mid; });
    var a = mean(hi.map(function (p) { return p.change; })), b = mean(lo.map(function (p) { return p.change; }));
    return { key: 'weight_sodium', title: 'Weight the morning after salty days', n: pairs.length, enough: enough && hi.length >= 3 && lo.length >= 3,
      text: enough && hi.length >= 3 && lo.length >= 3 ? 'After days over ' + Math.round(mid) + ' mg sodium, her morning weight changed ' + fmtLb(a) + ' on average (' + hi.length + ' days); after lower-sodium days, ' + fmtLb(b) + ' (' + lo.length + ' days).'
        : 'Needs 7 pairs of back-to-back morning weights with the day before logged. Has ' + pairs.length + '.' };
  }
  function fmtLb(x) { return (x >= 0 ? '+' : '') + (Math.round(x * 10) / 10) + ' lb'; }
  function outVsIn(diary, profileId, days, startHour) {
    var rows = days.map(function (day) { var es = diary.filter(function (e) { return !e.deleted && (e.for_profile_id || null) === (profileId || null) && careDay(e.eaten_at, startHour) === day; }); return fluidBalance(es); })
      .filter(function (b) { return b.inMl > 0 && b.outMl > 0; });
    var enough = rows.length >= 5, ratio = enough ? mean(rows.map(function (b) { return b.outMl / b.inMl; })) : null;
    var lowDays = rows.filter(function (b) { return b.outMl < b.inMl * 0.5; }).length;
    return { key: 'out_in', title: 'Urine out compared with fluid in', n: rows.length, enough: enough,
      text: enough ? 'On ' + rows.length + ' days with both logged, output averaged ' + Math.round(ratio * 100) + '% of what went in' + (lowDays ? '; ' + lowDays + ' day' + (lowDays === 1 ? '' : 's') + ' under half.' : '.') : 'Needs 5 days with both drinks and output logged. Has ' + rows.length + '.' };
  }
  function byTimeOfDay(measurements, profileId, kind, days, startHour) {
    var set = {}; days.forEach(function (d) { set[d] = true; });
    var am = [], pm = [];
    measurements.forEach(function (m) { if (m.deleted || m.kind !== kind || (m.for_profile_id || null) !== (profileId || null) || !set[careDay(m.taken_at, startHour)]) return; (minuteOfDay(m.taken_at, startHour) < 12 * 60 ? am : pm).push(+m.value); });
    var enough = am.length >= 3 && pm.length >= 3, label = kind === 'glucose' ? 'Blood sugar' : 'Blood pressure (top number)';
    return { key: kind + '_tod', title: label + ', morning vs afternoon/evening', n: am.length + pm.length, enough: enough,
      text: enough ? 'Morning average ' + Math.round(mean(am)) + ' (' + am.length + ' readings); later in the day ' + Math.round(mean(pm)) + ' (' + pm.length + ').' : 'Needs 3 readings in the morning and 3 later in the day. Has ' + am.length + ' and ' + pm.length + '.' };
  }
  function rhythmCount(measurements, profileId, days, startHour) {
    var set = {}; days.forEach(function (d) { set[d] = true; });
    var rs = measurements.filter(function (m) { return !m.deleted && (m.for_profile_id || null) === (profileId || null) && m.rhythm && set[careDay(m.taken_at, startHour)]; });
    var odd = rs.filter(function (m) { return m.rhythm === 'afib' || m.rhythm === 'irregular'; });
    return { key: 'rhythm', title: 'Irregular heartbeat or AFib on the monitor', n: rs.length, enough: rs.length >= 3,
      text: rs.length ? odd.length + ' of ' + rs.length + ' readings with a rhythm marked showed AFib or an irregular heartbeat.' : 'No readings with a rhythm marked yet.' };
  }
  function patterns(data, profileId, days, startHour) {
    return [
      bpAfterEveningDose(data.measurements, data.meds, data.doses, profileId, days, startHour, data.stays),
      weightVsSodium(data.measurements, data.diary, profileId, days, startHour),
      outVsIn(data.diary, profileId, days, startHour),
      byTimeOfDay(data.measurements, profileId, 'blood_pressure', days, startHour),
      byTimeOfDay(data.measurements, profileId, 'glucose', days, startHour),
      rhythmCount(data.measurements, profileId, days, startHour)
    ];
  }

  /* ---------- Bluetooth blood pressure (standard Blood Pressure Service, 0x2A35) ---------- */
  // IEEE-11073 16-bit float: 4-bit signed exponent, 12-bit signed mantissa.
  function sfloat(lo, hi) {
    var raw = lo | (hi << 8), m = raw & 0x0fff, e = raw >> 12;
    if (m === 0x07ff || m === 0x0800 || m === 0x07fe || m === 0x0802 || m === 0x0801) return null; // NaN / NRes / +-INF / reserved
    if (m >= 0x0800) m -= 0x1000; if (e >= 0x8) e -= 0x10;
    return Math.round(m * Math.pow(10, e) * 100) / 100;
  }
  function parseBpMeasurement(bytes) {
    var b = Array.prototype.slice.call(bytes), flags = b[0], i = 7;
    var r = { unit: flags & 1 ? 'kPa' : 'mmHg', sys: sfloat(b[1], b[2]), dia: sfloat(b[3], b[4]), map: sfloat(b[5], b[6]), time: null, pulse: null, user: null, irregular: false, movement: false, cuffLoose: false };
    if (flags & 2) { r.time = { y: b[i] | (b[i + 1] << 8), mo: b[i + 2], d: b[i + 3], h: b[i + 4], mi: b[i + 5], s: b[i + 6] }; i += 7; }
    if (flags & 4) { r.pulse = sfloat(b[i], b[i + 1]); i += 2; }
    if (flags & 8) { r.user = b[i]; i += 1; }
    if (flags & 16) { var st = b[i] | (b[i + 1] << 8); r.movement = !!(st & 1); r.cuffLoose = !!(st & 2); r.irregular = !!(st & 4); }
    if (r.unit === 'kPa') ['sys', 'dia', 'map'].forEach(function (k) { if (r[k] != null) r[k] = Math.round(r[k] * 7.50062); });
    return r;
  }


  /* ---------- Medicine reconciliation: one medicine, several sources ----------
   * Each medicine record may carry fields.sources: [{type: list|discharge|bottle|form, label,
   * strength, dose, when, said, date}]. Older records only have lines in Instructions
   * ("From the medicine list: ...", "Bottle label ...: ...", "Label: ..."), read here as sources. */
  function medStrength(t) {
    var m = String(t || '').toLowerCase().replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(mcg|mg|g|ml|units?|iu|%)/);
    return m ? (+m[1]) + ' ' + m[2].replace(/s$/, '') : null;
  }
  // The word a medicine is matched by: its first real word, past store brands and marketing words
  // ("Low Dose Aspirin (H-E-B)" and "Aspirin" are both "aspirin"). Vitamins keep their letter.
  var MED_NOISE = /^(low|lo|dose|ultra|extra|regular|maximum|max|strength|adult|adults|childrens|children|baby|junior|chewable|coated|enteric|ec|safety|daily|generic|brand|otc|original|advanced|complete|plus|tablet|tablets|tab|tabs|capsule|capsules|cap|caps|caplet|caplets|softgel|softgels|liquid|oral|heb|cvs|walgreens|walgreen|equate|kirkland|kroger|target|walmart|riteaid|rite|aid|goodsense|good|sense|neighbor|members|mark|great|value|up|upup|amazon|basic|care|signature|sunmark|topcare|wellness|well|at)$/;
  function medKey(n) {
    var words = String(n || '').toLowerCase().replace(/[()]/g, ' ').split(/[\s,]+/).map(function (w) { return w.replace(/[^a-z0-9]/g, ''); })
      .filter(function (w) { return w && !/^\d/.test(w) && !MED_NOISE.test(w); });
    if (!words.length) return String(n || '').toLowerCase().split(/[\s,(]/)[0].replace(/[^a-z]/g, '');
    return (words[0] === 'vitamin' && words[1] ? 'vitamin' + words[1] : words[0]).replace(/[^a-z0-9]/g, '');
  }
  /* What the words say about how often ("twice a day", "BID", "every 8 hours"), as times a day. */
  function medFrequency(text) {
    var s = ' ' + String(text || '').toLowerCase().replace(/[.,;()]/g, ' ') + ' ', m;
    if ((m = s.match(/ every (\d+) ?(?:hours|hrs|hr|h) /))) { var n = 24 / +m[1]; return n >= 1 && n <= 6 && n === Math.round(n) ? n : null; }
    if (/ (four times|4 times|4x|4 x|qid) /.test(s)) return 4;
    if (/ (three times|3 times|3x|3 x|tid) /.test(s)) return 3;
    if (/ (twice|two times|2 times|2x|2 x|bid) /.test(s)) return 2;
    if (/ (once|one time|1 time|1x|qd|daily|every day|each day|a day|per day) /.test(s) && !/ (twice|times) /.test(s)) return 1;
    return null;
  }
  var FREQ_SLOTS = { 1: 'morning', 2: 'morning,evening', 3: 'morning,noon,evening', 4: 'morning,noon,evening,bedtime' };
  var FREQ_WORDS = { 1: 'once a day', 2: 'twice a day', 3: 'three times a day', 4: 'four times a day', 6: 'six times a day' };
  /* Where a medicine's times of day and its own words disagree, or no time is set at all.
   * Each: { key, text, fix } where fix is the slots that would settle it (when there is one answer). */
  // What the family has already looked at and chosen to keep: asked about once, not on every save.
  function medSig(f) { f = f || {}; return [f.slots || '', f.dose || '', f.when || '', f.per_dose == null ? '' : f.per_dose].join('|'); }
  function medGive(f) { return f && f.per_dose ? f.per_dose + ' each time' : ''; }
  function medTimingIssues(med) {
    var f = med.fields || {}, all = String(f.slots || '').split(',').filter(Boolean), timed = all.filter(function (s) { return s !== 'prn'; }), out = [];
    if (f.timing_ok && f.timing_ok === medSig(f)) return out;
    var freq = medFrequency([f.dose, f.when].filter(Boolean).join(' '));
    // "2 tablets" with two times of day: two each time, or two a day in total?
    var cnt = /(\d+(?:\.\d+)?)\s*(tablets?|tabs?|capsules?|caps?|caplets?|pills?|puffs?|drops?|sprays?|patch(?:es)?)\b/i.exec(f.dose || '');
    if (cnt && +cnt[1] > 1 && timed.length >= 2 && f.per_dose == null) {
      var n = +cnt[1], unit = cnt[2].toLowerCase().replace(/e?s$/, ''), each = n / timed.length;
      out.push({ key: 'per_dose', text: 'Is that ' + n + ' ' + cnt[2].toLowerCase() + ' each time, or ' + n + ' a day in total?', fix: null,
        options: [{ label: n + ' each time (' + n * timed.length + ' a day)', per_dose: n }].concat(each === Math.round(each) ? [{ label: each + ' each time (' + n + ' a day)', per_dose: each }] : []), unit: unit });
    }
    if (!all.length) out.push({ key: 'no_time', text: 'No time of day is picked, so it will not show in the daily medicines.', fix: freq && FREQ_SLOTS[freq] ? FREQ_SLOTS[freq] : null });
    else if (freq && timed.length && freq !== timed.length) {
      out.push({ key: 'freq', text: 'It says ' + (FREQ_WORDS[freq] || freq + ' times a day') + ', but ' + timed.length + ' time' + (timed.length === 1 ? ' of day is' : 's of day are') + ' picked.',
        fix: freq > timed.length && FREQ_SLOTS[freq] && timed.every(function (s) { return FREQ_SLOTS[freq].split(',').indexOf(s) >= 0; }) ? FREQ_SLOTS[freq] : null });
    }
    return out;
  }
  function medSources(rec) {
    var f = rec.fields || {}, out = (f.sources || []).slice();
    var have = function (type, said) { return out.some(function (s) { return s.type === type && (s.said || '') === (said || ''); }); };
    String(f.instructions || '').split('\n').forEach(function (line) {
      var m = line.match(/^From the medicine list: "(.*)"\s*$/);
      if (m && !out.some(function (s) { return s.type === 'list' || s.type === 'discharge'; }) && !have('list', m[1])) out.push({ type: 'list', label: 'Medicine list', strength: medStrength(m[1]), said: m[1] });
      var b = line.match(/^(?:Bottle label(?: \(filled ([^)]*)\))?|Label): (.*)$/);
      if (b && !out.some(function (s) { return s.type === 'bottle'; })) out.push({ type: 'bottle', label: 'Bottle', strength: null, said: b[2], date: b[1] || null });
    });
    return out;
  }
  var SOURCE_NAME = { list: 'list', discharge: 'discharge papers', bottle: 'bottle', form: 'typed in' };
  // The names one medicine goes by: the first word of its title, its generic, and names merged into it.
  function medKeys(x) { return [x.title, x.generic].concat(x.also || []).map(medKey).filter(Boolean); }
  function medSame(a, b) { var kb = medKeys(b); return medKeys(a).some(function (k) { return kb.indexOf(k) >= 0; }); }
  function medBrief(rec) { var f = rec.fields || {}; return { title: rec.title, generic: f.generic || null, also: f.also_called || [], dose: f.dose || null }; }
  /* Two saved medicines the family says are one. Returns the kept medicine's new fields:
   * blanks filled from the other, times of day and sources joined, the other name remembered
   * (so the duplicate check knows it next time), and a flag when the strengths differ.
   * `caught` says whether the duplicate check had paired them; when false the merge was forced. */
  /* ---------- Reading a typed note for things that belong elsewhere in the file ----------
   * A visit note or family update often holds a lab number ("HEMOGLOBIN @ 8 GFR @ 11"), a new
   * medicine ("added antibiotic") or a hospital admission. These are only ever offered back to
   * the person who typed them; nothing is saved from a note without a tap. No AI: plain patterns,
   * kept narrow so an ordinary sentence offers nothing. */
  var NOTE_LABS = [['eGFR', 'e?gfr'], ['Creatinine', 'creatinine|creat'], ['BUN', 'bun'], ['Potassium', 'potassium'], ['Sodium', 'sodium'], ['Phosphorus', 'phosphorus|phos'],
    ['Calcium', 'calcium'], ['Albumin', 'albumin'], ['Hemoglobin', 'hemoglobin|haemoglobin|hgb'], ['Hematocrit', 'hematocrit|hct'], ['A1c', 'hba1c|a1c'], ['Glucose', 'glucose|blood sugar'], ['PTH', 'pth']];
  var NOTE_MED_CLASS = /^(antibiotics?|steroids?|insulin|inhaler|nebulizer|patch|ointment|cream|eye ?drops|ear ?drops|drops|supplement|vitamin|probiotic|painkiller|laxative|stool softener|diuretic|antifungal|antiviral|antacid|blood thinner|water pill|sleeping pill|nausea medicine)$/;
  var NOTE_MED_SUFFIX = /(cillin|mycin|floxacin|oxacin|cycline|pril|sartan|olol|statin|prazole|dipine|azole|zepam|zolam|tidine|formin|gliptin|gliflozin|lukast|semide|thiazide|parin|xaban|setron|caine|sone|solone|terol|triptan|profen|cephalexin|nitrofurantoin|trimethoprim|bactrim|macrobid|keflex)$/;
  var NOTE_MED_VERB = '(added|started|start|starting|prescribed|began|begin|put (?:her|him|them|me) on|gave (?:her|him|them|me)|new (?:medicine|med|prescription)(?: is|:)?)';
  function noteOffers(text) {
    var t = String(text || ''), labs = [], meds = [], stay = null, seen = {};
    NOTE_LABS.forEach(function (L) {
      var re = new RegExp('(?:^|[^a-z0-9])(?:' + L[1] + ')\\s*(?:@|:|=|of|is|was|at|level|came back(?: at)?)?\\s*(\\d+(?:\\.\\d+)?)(?![\\d/:-])', 'i'), m = re.exec(t);
      if (m) labs.push({ test: L[0], value: +m[1] });
    });
    var re = new RegExp('\\b' + NOTE_MED_VERB + '\\s+(?:(?:an?|the|some|on|a new|new|taking|her|him|them|me)\\s+)*((?:blood thinner|water pill|sleeping pill|stool softener|nausea medicine|eye ?drops|ear ?drops|[a-z][a-z-]{2,}))(\\s+\\d+(?:\\.\\d+)?\\s*(?:mcg|mg|g|ml|units?))?', 'gi'), m;
    while ((m = re.exec(t))) {
      var name = m[2].toLowerCase(), strength = (m[3] || '').trim();
      if (!(NOTE_MED_CLASS.test(name) || NOTE_MED_SUFFIX.test(name) || strength || /^prescribed$/i.test(m[1]) && name.length > 4)) continue;
      if (/^(feeling|having|being|taking|getting|going|eating|drinking|walking|using|with|more|less|that|this|her|him|them|for|and|but)$/.test(name) || seen[name]) continue;
      seen[name] = 1; meds.push({ name: name.charAt(0).toUpperCase() + name.slice(1), strength: strength || null });
    }
    if (/\b(admitted|hospitali[sz]ed|inpatient|kept (?:her |him |them )?overnight)\b/i.test(t)) {
      var o = /\b(?:taken to|admitted to|admitted at|transferred to|transported to|went to|brought to|at)\s+((?:(?:the|of)\s+)?[A-Z][\w'&.-]*(?:\s+(?:of\s+)?[A-Z][\w'&.-]*){0,5})/.exec(t);
      var org = o ? o[1].replace(/^the\s+/i, '').replace(/[.,;]+$/, '') : null;
      if (!org) { // spoken words arrive without capitals: take the few words after "admitted to" / "taken to"
        var w = /\b(?:taken to|admitted to|admitted at|transferred to|transported to|brought to)\s+(?:the\s+)?((?:[a-z'&.-]+\s*){1,5})/i.exec(t);
        var words = w ? w[1].trim().split(/\s+/) : [], cut = words.findIndex(function (x) { return /^(and|for|with|because|after|where|last|this|on|at|in|overnight|today|yesterday|tonight|by|so|but|they|she|he|we|i)$/i.test(x); });
        if (cut >= 0) words = words.slice(0, cut);
        if (words.length && !/^(hospital|er|emergency|icu)$/i.test(words.join(' '))) org = words.map(function (x) { return x.charAt(0).toUpperCase() + x.slice(1); }).join(' ');
      }
      stay = { org: org };
    }
    return { labs: labs, meds: meds, stay: stay, any: !!(labs.length || meds.length || stay) };
  }
  // Offers in `now` that were not already in `before`, so editing a note does not ask again.
  function noteOffersNew(now, before) {
    var a = noteOffers(now), b = noteOffers(before);
    a.labs = a.labs.filter(function (x) { return !b.labs.some(function (y) { return y.test === x.test && y.value === x.value; }); });
    a.meds = a.meds.filter(function (x) { return !b.meds.some(function (y) { return y.name === x.name; }); });
    if (b.stay) a.stay = null;
    a.any = !!(a.labs.length || a.meds.length || a.stay);
    return a;
  }
  // A plan (pharmacist questions, or a drafted schedule) that names the merged-away medicine now
  // names the kept one. Returns the plan's new fields, or null when it never mentioned it.
  function repointPlan(fields, fromId, toId) {
    var hit = false, f = JSON.parse(JSON.stringify(fields || {}));
    var fix = function (o) { if (o && o.med_id === fromId) { o.med_id = toId; hit = true; } };
    (f.questions || []).forEach(function (q) { fix(q); fix(q && q.change); });
    (f.items || []).forEach(fix);
    return hit ? f : null;
  }
  function mergeMeds(keep, drop) {
    var f = JSON.parse(JSON.stringify(keep.fields || {})), d = drop.fields || {}, own = { slots: 1, slot_times: 1, instructions: 1, sources: 1, check: 1, start: 1, stop: 1, also_called: 1 };
    Object.keys(d).forEach(function (k) { if (!own[k] && (f[k] == null || f[k] === '') && d[k] != null && d[k] !== '') f[k] = d[k]; });
    var slots = String(f.slots || '').split(',').filter(Boolean);
    String(d.slots || '').split(',').filter(Boolean).forEach(function (s) { if (slots.indexOf(s) < 0) slots.push(s); });
    if (slots.length) f.slots = slots.join(',');
    if (d.slot_times || f.slot_times) f.slot_times = Object.assign({}, d.slot_times || {}, f.slot_times || {});
    var lines = String(f.instructions || '').split('\n').filter(Boolean);
    String(d.instructions || '').split('\n').filter(Boolean).forEach(function (l) { if (lines.indexOf(l) < 0) lines.push(l); });
    if (lines.length) f.instructions = lines.join('\n');
    var typed = [drop.title, d.dose].filter(Boolean).join(' ');
    f.sources = (f.sources || []).concat(d.sources && d.sources.length ? d.sources : medSources(drop).length ? [] : [{ type: 'form', label: 'Typed in', strength: medStrength(typed), said: typed }]);
    if (!f.sources.length) delete f.sources;
    // Active for as long as either one was.
    if (f.start && (!d.start || d.start < f.start)) { if (d.start) f.start = d.start; else delete f.start; }
    if (f.stop && (!d.stop || d.stop > f.stop)) { if (d.stop) f.stop = d.stop; else delete f.stop; }
    var names = (f.also_called || []).concat([drop.title], d.also_called || []).filter(function (n, i, all) {
      return n && String(n).toLowerCase() !== String(keep.title || '').toLowerCase() && all.map(function (x) { return String(x).toLowerCase(); }).indexOf(String(n).toLowerCase()) === i;
    });
    if (names.length) f.also_called = names;
    var named = function (title, st) { return medStrength(title) ? title : title + ' ' + st; };
    var sk = medStrength(keep.title) || medStrength((keep.fields || {}).dose), sd = medStrength(drop.title) || medStrength(d.dose);
    var clash = sk && sd && sk !== sd ? 'Strength differs: ' + named(keep.title, sk) + ', ' + named(drop.title, sd) + ' (merged by hand). Check with the pharmacist which is right.' : null;
    var checks = [f.check, d.check, clash].filter(Boolean).join('\n').split('\n').filter(function (l, i, all) { return l && all.indexOf(l) === i; });
    if (checks.length) f.check = checks.join('\n');
    return { fields: f, clash: clash, caught: medSame(medBrief(keep), medBrief(drop)) };
  }
  // meds: medication records (not deleted). Returns one item per medicine plus possible duplicates.
  function reconcileMeds(meds, today) {
    var active = meds.filter(function (r) { var f = r.fields || {}; return !(f.stop && today && f.stop < today); });
    var anyList = active.some(function (r) { return medSources(r).some(function (s) { return s.type === 'list' || s.type === 'discharge'; }); });
    var items = active.map(function (r) {
      var f = r.fields || {}, src = medSources(r), issues = [];
      var strengths = {};
      var saved = medStrength(r.title) || medStrength(f.dose);
      if (saved) strengths[saved] = ['saved'];
      src.forEach(function (s) { var st = medStrength(s.strength) || medStrength(s.said); if (st) (strengths[st] = strengths[st] || []).push(SOURCE_NAME[s.type] || s.type); });
      var keys = Object.keys(strengths);
      if (keys.length > 1) issues.push({ level: 'bad', text: 'Strength differs: ' + keys.map(function (k) { return strengths[k].join(' and ') + ' ' + k; }).join(', ') + '.' });
      var types = src.map(function (s) { return s.type; });
      if (anyList && types.indexOf('list') < 0 && types.indexOf('discharge') < 0) issues.push({ level: 'warn', text: 'Not on any medicine list or discharge papers.' });
      if ((types.indexOf('list') >= 0 || types.indexOf('discharge') >= 0) && types.indexOf('bottle') < 0) issues.push({ level: 'info', text: 'No bottle photographed yet.' });
      medTimingIssues(r).forEach(function (t) { issues.push(t.key === 'no_time' ? { level: 'info', text: 'No time of day set.' } : { level: 'warn', text: t.text + ' Open it and set which is right.' }); });
      if (f.check) issues.push({ level: 'bad', text: 'Flagged: ' + String(f.check).split('\n').join(' ') });
      return { id: r.id, title: r.title, generic: f.generic || null, also: f.also_called || [], dose: f.dose || null, sources: src, issues: issues };
    });
    var dups = [];
    for (var i = 0; i < items.length; i++) for (var j = i + 1; j < items.length; j++) {
      var a = items[i], b = items[j];
      if (medSame(a, b)) {
        dups.push([a.id, b.id]);
        var t = 'Possible duplicate of ' + b.title + ' (same medicine' + (a.generic && a.generic === b.generic ? ', ' + a.generic : '') + ').';
        a.issues.unshift({ level: 'bad', text: t }); b.issues.unshift({ level: 'bad', text: 'Possible duplicate of ' + a.title + '.' });
      }
    }
    return { items: items, duplicates: dups, problems: items.filter(function (x) { return x.issues.some(function (s) { return s.level !== 'info'; }); }).length };
  }


  /* ---------- Shift handoff: what happened between two times, for one person ----------
   * d: { diary, measurements, records } (all stores), pid, since and until as ISO strings.
   * Pure and factual: every line comes from a saved entry, so a summary can never invent. */
  function handoff(d, pid, since, until) {
    var mine = function (x) { return !x.deleted && (x.for_profile_id || null) === (pid || null); };
    var inWin = function (t) { return t && t >= since && t <= until; };
    var byTime = function (k) { return function (a, b) { return a[k] < b[k] ? -1 : 1; }; };
    var diary = (d.diary || []).filter(function (e) { return mine(e) && inWin(e.eaten_at); }).sort(byTime('eaten_at'));
    var fb = fluidBalance(diary);
    var meas = (d.measurements || []).filter(function (m) { return mine(m) && inWin(m.taken_at); }).sort(byTime('taken_at'));
    var recs = (d.records || []).filter(mine);
    var doses = recs.filter(function (r) { return r.kind === 'dose' && inWin(r.occurred_at); }).sort(byTime('occurred_at'));
    var status = function (s) { return doses.filter(function (r) { return ((r.fields || {}).status || 'given') === s; }); };
    var visits = recs.filter(function (r) { return r.kind === 'visit' && inWin(r.occurred_at); }).sort(byTime('occurred_at'));
    var updates = recs.filter(function (r) { return r.kind === 'update' && inWin(r.occurred_at); }).sort(byTime('occurred_at'));
    var exercises = recs.filter(function (r) { return r.kind === 'exercise_log' && inWin(r.occurred_at); }).sort(byTime('occurred_at'));
    var changed = recs.filter(function (r) { return ['medication', 'contact', 'document', 'lab', 'exercise', 'allergy', 'condition'].indexOf(r.kind) >= 0 && inWin(r.updated_at); });
    var todo = [];
    visits.forEach(function (v) { var m = String((v.fields || {}).changed || '').match(/To do: (.*)/); if (m) m[1].split(/;\s*/).forEach(function (t) { if (t) todo.push(t); }); });
    return {
      since: since, until: until,
      meds: { given: status('given'), skipped: status('skipped'), refused: status('refused') },
      fluids: { inMl: fb.inMl, outMl: fb.outMl, drinks: fb.drinks, outputs: fb.outputs, flags: fb.flags },
      meals: diary.filter(function (e) { return e.entry_kind !== 'output' && e.entry_kind !== 'drink'; }),
      vitals: meas.filter(function (m) { return m.kind !== 'weight'; }),
      weights: meas.filter(function (m) { return m.kind === 'weight'; }),
      visits: visits, updates: updates, changed: changed, todo: todo, exercises: exercises,
      checks: recs.filter(function (r) { return r.fields && r.fields.check; }),
      empty: !diary.length && !meas.length && !doses.length && !visits.length && !updates.length && !changed.length && !exercises.length
    };
  }

  // Family notes are one text box; stamp each new or changed line with the day it was written,
  // e.g. "[2026-11-24] Woke up damp...". Lines already dated, blank lines and headings are left alone.
  function datedNotes(oldText, newText, day) {
    var seen = {}; String(oldText || '').split('\n').forEach(function (l) { seen[l.trim()] = true; });
    return String(newText || '').split('\n').map(function (l) {
      var t = l.trim();
      if (!t || seen[t] || /^\[\d{4}-\d{2}-\d{2}\]/.test(t) || /^Questions \(\d{4}-\d{2}-\d{2}\):$/.test(t)) return l;
      return '[' + day + '] ' + t;
    }).join('\n');
  }
  // "twice a day" -> 2, "3 times daily" -> 3, "every morning" -> 1; 0 when it is not per day (e.g. 3x a week).
  function exerciseTarget(text) {
    var t = String(text || '').toLowerCase(), words = { once: 1, one: 1, twice: 2, two: 2, three: 3, thrice: 3, four: 4, five: 5 };
    if (!t.trim()) return 1;
    if (/week|hour|other day|every \d+ days/.test(t)) return 0;
    var m = t.match(/(\d+)\s*(x|times?)?\s*(a|per|each|\/)?\s*(day|daily)/) || t.match(/(once|twice|thrice|one|two|three|four|five)\s*(times?)?\s*(a|per|each)?\s*(day|daily)?/);
    if (m) return +m[1] || words[m[1]] || 1;
    return 1;
  }
  return { exerciseTarget: exerciseTarget, datedNotes: datedNotes, handoff: handoff, reconcileMeds: reconcileMeds, noteOffers: noteOffers, noteOffersNew: noteOffersNew, medSig: medSig, medGive: medGive, medKey: medKey, medFrequency: medFrequency, medTimingIssues: medTimingIssues, mergeMeds: mergeMeds, repointPlan: repointPlan, medSame: medSame, medBrief: medBrief, medSources: medSources, medStrength: medStrength, parseBpMeasurement: parseBpMeasurement, doseTiming: doseTiming, labelCues: labelCues, mealTimes: mealTimes, patterns: patterns, minuteOfDay: minuteOfDay, hhmm: hhmm,
    slotHour: slotHour, medActive: medActive, medSlots: medSlots, doseFor: doseFor, medPlan: medPlan, stayOpen: stayOpen, stayAt: stayAt, prnDoses: prnDoses, upcoming: upcoming, SLOT_HOURS: SLOT_HOURS, addDays: addDays,
    ML_PER: ML_PER, FLUID_UNITS: FLUID_UNITS, toMl: toMl, fromMl: fromMl, toLb: toLb, careDay: careDay, fluidIn: fluidIn, fluidOut: fluidOut, outputFlags: outputFlags, fluidBalance: fluidBalance, standardWeights: standardWeights, weightChange: weightChange, weightFlags: weightFlags, suggestFluidMl: suggestFluidMl, DV: DV, NUTRIENTS: NUTRIENTS, ingredientMatch: ingredientMatch, coverage: coverage, gramsFor: gramsFor, recipeNutrition: recipeNutrition, fitForProfile: fitForProfile, burnRate: burnRate, restockSuggestions: restockSuggestions, dayTotals: dayTotals, expiringSoon: expiringSoon, stitchPages: stitchPages, exifTakenAt: exifTakenAt, exactIngredient: exactIngredient };
})();
