// /lookup — free nutrition sources. Barcodes go to Open Food Facts (no key);
// generic ingredients go to USDA FoodData Central (free key: USDA_API_KEY, falls back to DEMO_KEY).
// Phone numbers (care team, pharmacy, family) go to Twilio Lookup v2 when TWILIO_ACCOUNT_SID and
// TWILIO_AUTH_TOKEN are set: validity, standard format and line type (mobile, landline, VoIP).
// Medicine names go to openFDA drug labels (no key): boxed warning, how to take, side effects.
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

// The official label text is long; keep the first few sentences of each section.
function clip(v: unknown, n = 700) {
  const t = (Array.isArray(v) ? v.join(" ") : String(v ?? "")).replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n).replace(/\s\S*$/, "") + "…" : t;
}
// The search's first hit can be another product that merely mentions the name ("ezetimibe" finds
// "ezetimibe and simvastatin", "probiotic" finds a sunscreen). Pick a label that is this medicine:
// its brand is the name, or every word of its generic name (salt words aside) is in the name.
const SALT = /^(hydrochloride|hcl|besylate|calcium|sodium|potassium|magnesium|hemihydrate|monohydrate|dihydrate|tartrate|succinate|maleate|mesylate|citrate|sulfate|acetate|phosphate|bromide|fumarate|er|xr|sr|extended|release)$/;
// deno-lint-ignore no-explicit-any
function fits(name: string, l: any) {
  const q = name.toLowerCase();
  const names: string[] = (l.openfda?.brand_name ?? []).concat(l.openfda?.generic_name ?? []);
  return names.some((g) => {
    const words = g.toLowerCase().split(/[\s,/]+/).filter((w) => w && !SALT.test(w));
    return words.length > 0 && words.every((w) => w === "and" ? / and |\/|\+/.test(q) : q.includes(w));
  });
}
async function drugLabel(q: string) {
  const name = String(q ?? "").trim().replace(/["\\]/g, "").split(/\s+\d/)[0].trim();
  if (name.length < 3) return { found: false };
  const search = `openfda.generic_name:"${name}"+openfda.brand_name:"${name}"`;
  const r = await fetch(`https://api.fda.gov/drug/label.json?search=${encodeURIComponent(search).replace(/%2B/g, "+")}&limit=10`);
  if (r.status === 404) return { found: false };
  const d = await r.json().catch(() => ({}));
  // deno-lint-ignore no-explicit-any
  const l = (d.results ?? []).find((x: any) => fits(name, x));
  if (!l) return { found: false };
  const eff = String(l.effective_time ?? "");
  return {
    found: true,
    brand: l.openfda?.brand_name?.[0] ?? null,
    generic: l.openfda?.generic_name?.[0] ?? null,
    boxed_warning: clip(l.boxed_warning, 500),
    how_to_take: clip(l.dosage_and_administration ?? l.directions),
    side_effects: clip(l.adverse_reactions ?? l.stop_use, 500),
    warnings: clip(l.warnings_and_cautions ?? l.warnings, 500),
    for_patients: clip(l.information_for_patients ?? l.patient_medication_information, 500),
    older_adults: clip(l.geriatric_use ?? l.use_in_specific_populations, 500),
    label_date: eff.length === 8 ? `${eff.slice(0, 4)}-${eff.slice(4, 6)}-${eff.slice(6)}` : null,
    source: l.set_id ? `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${l.set_id}` : "https://open.fda.gov",
  };
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
