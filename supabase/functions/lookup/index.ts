// /lookup — free nutrition sources. Barcodes go to Open Food Facts (no key);
// generic ingredients go to USDA FoodData Central (free key: USDA_API_KEY, falls back to DEMO_KEY).
// Phone numbers (care team, pharmacy, family) go to Twilio Lookup v2 when TWILIO_ACCOUNT_SID and
// TWILIO_AUTH_TOKEN are set: validity, standard format and line type (mobile, landline, VoIP).
// Medicine names go to openFDA drug labels (no key): boxed warning, how to take, side effects,
// warnings, interactions, patient information, older adults, what it is for.
import { corsHeaders, json } from "../_shared/cors.ts";

const USDA_KEY = Deno.env.get("USDA_API_KEY") ?? "DEMO_KEY";

async function barcode(upc: string) {
  const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(upc)}.json?fields=product_name,brands,nutriments,categories_tags`, {
    headers: { "User-Agent": "CaregivingMenu/0.1 (household app)" },
  });
  const d = await r.json();
  if (d.status !== 1) return { name: null };
  const n = d.product.nutriments ?? {};
  return {
    name: (d.product.product_name || "").toLowerCase(),
    brand: d.product.brands || "",
    nutrition: {
      kcal_100g: n["energy-kcal_100g"] ?? null,
      protein_g: n.proteins_100g ?? null,
      carbs_g: n.carbohydrates_100g ?? null,
      fat_g: n.fat_100g ?? null,
      fiber_g: n.fiber_100g ?? null,
      sodium_mg: n.sodium_100g != null ? Math.round(n.sodium_100g * 1000) : null,
      sugar_g: n.sugars_100g ?? null,
      potassium_mg: n.potassium_100g != null ? Math.round(n.potassium_100g * 1000) : null,
    },
  };
}

// USDA nutrient numbers: 1008 energy, 1003 protein, 1005 carbs, 1004 fat, 1079 fiber, 1093 sodium, 2000 sugars, 1092 potassium
const NUTRIENT_MAP: Record<string, string> = { "1008": "kcal_100g", "1003": "protein_g", "1005": "carbs_g", "1004": "fat_g", "1079": "fiber_g", "1093": "sodium_mg", "2000": "sugar_g", "1092": "potassium_mg" };

async function usda(q: string) {
  const r = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${USDA_KEY}&query=${encodeURIComponent(q)}&dataType=Foundation,SR%20Legacy&pageSize=1`);
  const d = await r.json();
  const f = d.foods?.[0];
  if (!f) return { kcal_100g: null };
  const out: Record<string, unknown> = { description: f.description, fdc_id: f.fdcId };
  for (const n of f.foodNutrients ?? []) {
    const key = NUTRIENT_MAP[String(n.nutrientNumber)];
    if (key && out[key] == null) out[key] = Math.round(n.value * 10) / 10;
  }
  return out;
}

const TW_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TW_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";

// One number per call. A number without a country code is read as a US number.
async function phone(q: string) {
  const raw = String(q ?? "").trim();
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.replace("+", "").length < 7 || digits.length > 16) return { available: true, valid: false, error: "That doesn't look like a phone number." };
  if (!TW_SID || !TW_TOKEN) return { available: false };
  const international = digits.startsWith("+");
  const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(digits)}?Fields=line_type_intelligence` + (international ? "" : "&CountryCode=US");
  const r = await fetch(url, { headers: { Authorization: "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { available: true, valid: false, error: d.message || `Number check failed (${r.status})` };
  const lti = d.line_type_intelligence ?? {};
  return {
    available: true,
    valid: !!d.valid,
    e164: d.phone_number ?? null,
    national: d.national_format ?? null,
    country: d.country_code ?? null,
    line_type: lti.type ?? null,
    carrier: lti.carrier_name ?? null,
    errors: d.validation_errors ?? [],
  };
}

// The official label text is long. Keep whole sentences up to about n characters and never stop
// mid-sentence; section numbers and headings ("2.1 Dosage", "DOSAGE AND ADMINISTRATION") are
// dropped. `more` says some was left out, so the app can link to the full label.
function clip(v: unknown, n = 1600) {
  let t = (Array.isArray(v) ? v.join(" ") : String(v ?? "")).replace(/\s+/g, " ").trim();
  t = t.replace(/^(\d+(\.\d+)*\s+)?[A-Z][A-Z &,/()-]{6,}(\s+\d+(\.\d+)*)?\s+/, "").replace(/\s\d+(\.\d+)+\s(?=[A-Z])/g, " ").trim();
  t = t.replace(/^(directions|warnings|purpose|uses|indications and usage|adverse reactions|drug interactions|geriatric use|information for patients|dosage and administration|boxed warning|warning)\b[:.]?\s+/i, "").trim();
  if (t.length <= n) return { text: t, more: false };
  const cut = t.slice(0, n), end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return { text: (end > n * 0.4 ? cut.slice(0, end + 1) : cut.replace(/\s\S*$/, "") + " …").trim(), more: true };
}
function joinSections(...vs: unknown[]) { return vs.filter((v) => v != null && String(v).trim()).map((v) => Array.isArray(v) ? v.join(" ") : String(v)).join(" "); }
// The search's first hit can be another product that merely mentions the name ("ezetimibe" finds
// "ezetimibe and simvastatin", "probiotic" finds a sunscreen). Pick a label that is this medicine:
// its brand is the name, or every word of its generic name (salt words aside) is in the name.
const SALT = /^(hydrochloride|hcl|besylate|calcium|sodium|potassium|magnesium|hemihydrate|monohydrate|dihydrate|tartrate|succinate|succ|maleate|mesylate|citrate|sulfate|acetate|phosphate|bromide|fumarate|er|xr|sr|xl|dr|ec|extended|release|delayed)$/;
// deno-lint-ignore no-explicit-any
function fits(name: string, l: any, raw = "") {
  const q = (name + " " + raw).toLowerCase().replace(/[^a-z0-9\s/+]/g, " ");
  const names: string[] = (l.openfda?.brand_name ?? []).concat(l.openfda?.generic_name ?? []);
  return names.some((g) => {
    const words = g.toLowerCase().split(/[\s,/]+/).filter((w) => w && !SALT.test(w));
    return words.length > 0 && words.every((w) => w === "and" ? / and |\/|\+/.test(q) : q.includes(w));
  });
}
// A bottle or list says "Low Dose Aspirin (H-E-B) 81 mg EC tablets"; the label database knows
// "aspirin". Try the cleaned full name first, then each word that could be a medicine name.
const NOISE = /^(low|dose|ultra|extra|regular|maximum|max|strength|adult|adults|children|childrens|chewable|coated|enteric|safety|daily|generic|brand|otc|original|advanced|plus|tablet|tablets|tab|tabs|capsule|capsules|cap|caps|caplet|caplets|softgel|softgels|liquid|oral|solution|suspension|cream|ointment|patch|drops|spray|inhaler|mg|mcg|ml|iu|units?|take|by|mouth|once|twice|a|day|the|of|for|and|with|heb|cvs|walgreens|equate|kirkland|signature|kroger|walmart|target|up|rite|aid|goodsense|members|mark|care|health|leader|basics|amazon|sunmark|topcare|meijer|publix)$/;
function nameTries(raw: string) {
  const base = String(raw ?? "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/["\\]/g, "").replace(/[^a-z0-9\s/+-]/g, " ");
  const words = base.split(/[\s/+-]+/).filter((w) => w && !/^\d/.test(w));
  const keep = words.filter((w) => !NOISE.test(w) && !SALT.test(w));
  const tries = [words.filter((w) => !NOISE.test(w)).join(" "), keep.join(" ")].concat(keep.filter((w) => w.length >= 4));
  return tries.map((t) => t.trim()).filter((t, i, all) => t.length >= 3 && all.indexOf(t) === i).slice(0, 5);
}
// deno-lint-ignore no-explicit-any
const SALT_HINT: Record<string, string> = { succ: "succinate", succinate: "succinate", tart: "tartrate", tartrate: "tartrate", hcl: "hydrochloride", hydrochloride: "hydrochloride", mesylate: "mesylate", sodium: "sodium", potassium: "potassium", besylate: "besylate", calcium: "calcium", er: "extended", xl: "extended", xr: "extended", sr: "extended" };
async function labelFor(name: string, raw = ""): Promise<any> {
  const q = `"${name}"`;
  const search = `openfda.generic_name:${q}+openfda.brand_name:${q}+openfda.substance_name:${q}`;
  const r = await fetch(`https://api.fda.gov/drug/label.json?search=${encodeURIComponent(search).replace(/%2B/g, "+")}&limit=25`);
  if (!r.ok) return null;
  const d = await r.json().catch(() => ({}));
  // deno-lint-ignore no-explicit-any
  const hits = (d.results ?? []).filter((x: any) => fits(name, x, raw));
  const want = String(name + " " + raw).toLowerCase().split(/[^a-z]+/).map((w) => SALT_HINT[w]).filter(Boolean);
  // deno-lint-ignore no-explicit-any
  const saltOk = (x: any) => want.filter((w) => JSON.stringify([x.openfda?.generic_name, x.openfda?.brand_name, x.title, x.description]).toLowerCase().includes(w)).length;
  // Prefer a label that has the sections families read (patient info, how to take), then the newest.
  // deno-lint-ignore no-explicit-any
  const score = (x: any) => (x.information_for_patients || x.patient_medication_information || x.directions ? 2 : 0) + (x.dosage_and_administration || x.directions ? 1 : 0);
  // deno-lint-ignore no-explicit-any
  const mg = (String(raw).toLowerCase().match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|units?|iu)\b/) || [])[1];
  // deno-lint-ignore no-explicit-any
  const strengthOk = (x: any) => mg && new RegExp("\\b" + mg.replace(".", "\\.") + "\\s*(mg|mcg|g|ml|unit|iu)", "i").test(JSON.stringify([x.openfda?.brand_name, x.active_ingredient, x.package_label_principal_display_panel, x.spl_product_data_elements, x.title])) ? 1 : 0;
  hits.sort((x: any, y: any) => saltOk(y) - saltOk(x) || strengthOk(y) - strengthOk(x) || score(y) - score(x) || String(y.effective_time ?? "").localeCompare(String(x.effective_time ?? "")));
  return hits[0] ?? null;
}
// RxNorm (US National Library of Medicine, free, no key) knows brand names, store brands and
// near-misspellings: "Bayer Aspirin 81" -> aspirin, "metoprolol succ er" -> metoprolol succinate.
async function rxIngredients(term: string): Promise<string[]> {
  try {
    const a = await fetch(`https://rxnav.nlm.nih.gov/REST/approximateTerm.json?term=${encodeURIComponent(term)}&maxEntries=8`).then((r) => r.json());
    // deno-lint-ignore no-explicit-any
    const c = (a.approximateGroup?.candidate ?? []).find((x: any) => x.source === "RXNORM");
    if (!c) return [];
    const rel = await fetch(`https://rxnav.nlm.nih.gov/REST/rxcui/${c.rxcui}/related.json?tty=PIN+IN`).then((r) => r.json());
    const out: string[] = [];
    // PIN (precise, with the salt) first, then IN (the plain ingredient).
    for (const tty of ["PIN", "IN"]) {
      // deno-lint-ignore no-explicit-any
      const g = (rel.relatedGroup?.conceptGroup ?? []).find((x: any) => x.tty === tty);
      // deno-lint-ignore no-explicit-any
      for (const p of g?.conceptProperties ?? []) { const n = String(p.name ?? "").toLowerCase(); if (n && !out.includes(n)) out.push(n); }
    }
    return out.slice(0, 4);
  } catch { return []; }
}
async function drugLabel(q: string) {
  let l = null, used = "";
  const tries = nameTries(q);
  const raw = String(q ?? "");
  if (tries[0]) { l = await labelFor(tries[0], raw); if (l) used = tries[0]; }
  // A short form ("succ", "tart") or a brand the label search does not know goes through RxNorm first.
  const rx = await rxIngredients(raw.replace(/\([^)]*\)/g, " ").trim());
  const wrongSalt = l && rx[0] && rx[0].includes(" ") && !JSON.stringify(l.openfda?.generic_name ?? []).toLowerCase().includes(rx[0].split(" ").slice(1).join(" "));
  if (!l || wrongSalt) { const first = l; l = null; for (const name of rx.concat(tries.slice(1))) { l = await labelFor(name, raw); if (l) { used = name; break; } } if (!l) l = first; }
  if (!l) return { found: false, tried: tries, ingredients: rx };
  const eff = String(l.effective_time ?? "");
  const sec = {
    boxed_warning: clip(l.boxed_warning, 900),
    how_to_take: clip(joinSections(l.dosage_and_administration ?? l.directions), 1600),
    side_effects: clip(joinSections(l.adverse_reactions ?? null, l.adverse_reactions ? null : l.stop_use), 1200),
    warnings: clip(joinSections(l.warnings_and_cautions ?? l.warnings ?? l.precautions, l.warnings_and_cautions || l.warnings ? null : joinSections(l.do_not_use, l.ask_doctor, l.ask_doctor_or_pharmacist, l.when_using)), 1600),
    for_patients: clip(l.information_for_patients ?? l.patient_medication_information ?? l.spl_patient_package_insert, 1600),
    older_adults: clip(l.geriatric_use ?? l.use_in_specific_populations, 900),
    interactions: clip(l.drug_interactions ?? l.ask_doctor_or_pharmacist, 1200),
    purpose: clip(l.purpose ?? l.indications_and_usage, 300),
  };
  const out: Record<string, unknown> = {
    found: true, matched: used, ingredients: rx,
    brand: l.openfda?.brand_name?.[0] ?? null,
    generic: l.openfda?.generic_name?.[0] ?? null,
    label_date: eff.length === 8 ? `${eff.slice(0, 4)}-${eff.slice(4, 6)}-${eff.slice(6)}` : null,
    source: l.set_id ? `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${l.set_id}` : "https://open.fda.gov",
    shortened: [] as string[],
  };
  for (const [k, v] of Object.entries(sec)) { out[k] = v.text || null; if (v.more) (out.shortened as string[]).push(k); }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { kind, q } = await req.json();
    if (kind === "barcode") return json(await barcode(String(q)));
    if (kind === "usda") return json(await usda(String(q)));
    if (kind === "phone") return json(await phone(String(q)));
    if (kind === "drug_label") return json(await drugLabel(String(q)));
    return json({ error: "unknown kind" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
