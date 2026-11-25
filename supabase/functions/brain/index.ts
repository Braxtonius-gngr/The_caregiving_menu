// /brain — every AI call the app makes goes through here so the API key never
// reaches the browser. Each mode has a prompt and a JSON schema; the model's
// reply is constrained to that schema via structured outputs.
//
// Secrets (supabase secrets set ...):
//   ANTHROPIC_API_KEY   required
//   CLAUDE_MODEL        optional, defaults to claude-opus-5-5
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { corsHeaders, json } from "../_shared/cors.ts";

const MODEL = Deno.env.get("CLAUDE_MODEL") ?? "claude-opus-5-5";
const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

const num = { type: ["number", "null"] };
const str = { type: "string" };
const nutrition = {
  kcal: num, protein_g: num, carbs_g: num, fat_g: num, fiber_g: num,
  sodium_mg: num, sugar_g: num, potassium_mg: num,
};
const nutritionKeys = Object.keys(nutrition);

const ingredientLine = {
  type: "object",
  additionalProperties: false,
  required: ["qty", "unit", "name", "prep", "optional"],
  properties: {
    qty: num,
    unit: { type: "string", description: "g, kg, oz, lb, ml, l, tsp, tbsp, cup, each, clove, can, slice, or empty" },
    name: { type: "string", description: "Generic ingredient name, singular, lowercase, no brand" },
    prep: { type: "string", description: "Preparation note like 'diced', or empty" },
    optional: { type: "boolean" },
  },
};

const recipeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "servings", "cuisine", "meal_type", "prep_min", "cook_min", "ingredients", "steps", "notes", "confidence"],
  properties: {
    title: str,
    servings: num,
    cuisine: str,
    meal_type: { type: "array", items: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack", "dessert"] } },
    prep_min: num,
    cook_min: num,
    ingredients: { type: "array", items: ingredientLine },
    steps: { type: "array", items: str },
    notes: { type: "string", description: "Handwritten notes, tips, or attributions found on the card" },
    confidence: { type: "number", description: "0-1, how legible and complete the source was" },
  },
};

// Batch import reads each photo on its own first, so it also reports whether the page
// looks like part of a longer recipe; the app stitches likely pages and re-reads them together.
const recipePageSchema = {
  ...recipeSchema,
  required: [...recipeSchema.required, "starts_mid_recipe", "ends_incomplete", "issues"],
  properties: {
    ...recipeSchema.properties,
    starts_mid_recipe: { type: "boolean", description: "True if the page begins partway through a recipe: no title, or it opens mid ingredient list or mid steps" },
    ends_incomplete: { type: "boolean", description: "True if the recipe visibly carries on past this page: steps or ingredients cut off, 'continued', a list with no method, ends mid-sentence" },
    issues: { type: "array", items: { type: "string" }, description: "Specific things a person should check, e.g. an unreadable amount. Empty if none" },
  },
};

const receiptSchema = {
  type: "object",
  additionalProperties: false,
  required: ["store", "items"],
  properties: {
    store: str,
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["raw", "name", "qty", "unit", "price", "is_food", "confidence"],
        properties: {
          raw: { type: "string", description: "Line exactly as printed" },
          name: { type: "string", description: "Generic grocery ingredient name, lowercase. Reuse a name from the known list when it matches." },
          qty: num,
          unit: str,
          price: num,
          is_food: { type: "boolean" },
          confidence: { type: "number" },
        },
      },
    },
  },
};

const plateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items", ...nutritionKeys, "confidence"],
  properties: {
    items: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["name", "portion"], properties: { name: str, portion: str } },
    },
    ...nutrition,
    confidence: { type: "number" },
  },
};

const optionsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["options"],
  properties: {
    options: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "summary", "changes", "est_nutrition_per_serving"],
        properties: {
          title: str,
          summary: str,
          changes: { type: "array", items: str, description: "Concrete edits to the parent recipe: swaps, amount changes, step changes" },
          est_nutrition_per_serving: { type: "object", additionalProperties: false, required: nutritionKeys, properties: nutrition },
        },
      },
    },
  },
};

const canonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["matches"],
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["input", "existing", "new_name", "category"],
        properties: {
          input: str,
          existing: { type: ["string", "null"], description: "Exact name from the known list, or null" },
          new_name: { type: ["string", "null"] },
          category: { type: "string", enum: ["produce", "dairy", "meat", "pantry", "spice", "frozen", "bakery", "drink", "other"] },
        },
      },
    },
  },
};

const strList = (description: string) => ({ type: "array", items: str, description });
const summarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "patterns", "watch_items", "questions_for_clinician", "foods_that_fit", "caveats"],
  properties: {
    headline: { type: "string", description: "One plain-language sentence summarising the period" },
    patterns: strList("2-4 observations about what and how often they ate, grounded in the numbers given"),
    watch_items: strList("Averages notably above or below target, or repeated rule hits. Empty if none"),
    questions_for_clinician: strList("3-5 specific questions the caregiver could ask the doctor or dietitian"),
    foods_that_fit: strList("Dishes from the list given that already fit the current rules"),
    caveats: { type: "string", description: "One sentence on the limits of a home food diary" },
  },
};

const mealIdeasSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ideas", "caveat"],
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "why", "uses", "fluid_oz", "sodium_mg"],
        properties: {
          name: str,
          why: { type: "string", description: "One sentence on why it fits her rules and today's numbers" },
          uses: strList("Pantry items it uses"),
          fluid_oz: num,
          sodium_mg: num,
        },
      },
    },
    caveat: { type: "string", description: "One sentence: ideas to check against her diet plan" },
  },
};

const SYSTEM = `You help a family caregiver run their kitchen: recipes, pantry, and a food diary, including for an older relative whose diet may need adjusting.
Return only what the schema asks for. Use generic, lowercase, singular ingredient names ("yellow onion", not "Vidalia Onions 3lb").
Nutrition numbers are estimates for decision support; be realistic, not precise-sounding.
Never present medical advice as fact. Diet suggestions are options to discuss with the person's doctor or dietitian.`;

type Mode = "parse_recipe" | "parse_receipt" | "pantry_photo" | "estimate_plate" | "variations" | "diet_swaps" | "canonicalize" | "appointment_summary" | "meal_ideas" | "schedule_draft" | "guidance" | "read_vitals" | "read_photo" | "fill_form" | "scribe";

/* ---------- current guidance: search trusted sites first, then answer in a fixed shape ---------- */
// Web search stays on public health sources; the answer step cites them by number.
const TRUSTED = ["fda.gov", "nih.gov", "medlineplus.gov", "kdigo.org", "kidney.org", "diabetes.org", "diabetesjournals.org", "heart.org", "ahajournals.org", "acc.org", "cdc.gov", "cancer.gov", "ashp.org", "drugs.com", "mayoclinic.org", "clevelandclinic.org"];
const RESEARCH_SYSTEM = `You research current medical guidance for a family caregiver, using only the search tool's results.
Prefer official labels (FDA, DailyMed), clinical guidelines (KDIGO, ADA Standards of Care, AHA/ACC) and NIH sources; note each source's year.
Never search for or mention the patient's name. Describe the person only by age range and conditions.
Write plain notes of what the sources say, with each claim tied to its source. Say clearly where sources disagree or where nothing was found.`;
type Source = { url: string; title: string; age: string | null };
async function research(question: string): Promise<{ notes: string; sources: Source[] }> {
  // deno-lint-ignore no-explicit-any
  let messages: any[] = [{ role: "user", content: question }];
  const sources: Source[] = [];
  let notes = "";
  for (let turn = 0; turn < 4; turn++) {
    const params = {
      model: MODEL, max_tokens: 16000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      system: RESEARCH_SYSTEM, output_config: { effort: "medium" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6, allowed_domains: TRUSTED }],
      messages,
    };
    // deno-lint-ignore no-explicit-any
    const res: any = await anthropic.beta.messages.create(params as any);
    if (res.stop_reason === "refusal") throw new Error("The model declined this request.");
    for (const b of res.content) {
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const r of b.content) if (r.url && !sources.some((x) => x.url === r.url)) sources.push({ url: r.url, title: r.title ?? r.url, age: r.page_age ?? null });
      }
      if (b.type === "text") notes += b.text;
    }
    if (res.stop_reason !== "pause_turn") break;
    messages = [...messages, { role: "assistant", content: res.content }];
  }
  return { notes: notes.slice(0, 30000), sources: sources.slice(0, 30) };
}
function numbered(sources: Source[]) { return sources.map((s, i) => `[${i + 1}] ${s.title} (${s.url})${s.age ? ", " + s.age : ""}`).join("\n"); }

const draftSchema = {
  type: "object", additionalProperties: false,
  required: ["summary", "items", "undecided", "questions_for_pharmacist", "caveat"],
  properties: {
    summary: { type: "string", description: "Two or three plain sentences: what the draft changes and why" },
    items: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["med_ref", "slot", "current_time", "proposed_slot", "proposed_time", "change", "reason", "sources", "confidence", "ask_pharmacist"],
        properties: {
          med_ref: { type: "string", description: "The medicine's ref from the input, e.g. m1" },
          slot: { type: "string", enum: ["morning", "noon", "evening", "bedtime", "prn"] },
          current_time: { type: "string", description: "HH:MM now scheduled" },
          proposed_slot: { type: "string", enum: ["morning", "noon", "evening", "bedtime", "prn"] },
          proposed_time: { type: "string", description: "HH:MM 24-hour; the same as current_time when no change" },
          change: { type: "boolean" },
          reason: { type: "string", description: "Why, in plain words, tied to the label, her meals/sleep or her readings" },
          sources: { type: "array", items: { type: "integer" }, description: "Numbers of the sources used, from the numbered list" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          ask_pharmacist: { type: "string", description: "The one question to confirm with the pharmacist for this item, or empty" },
        },
      },
    },
    undecided: strList("Things that need a clinician's judgement (doses, interactions, kidney adjustments) that this draft does not change"),
    questions_for_pharmacist: strList("3-6 overall questions"),
    caveat: { type: "string", description: "One sentence: a draft for her pharmacist or doctor to approve" },
  },
};
const vitalsSchema = {
  type: "object", additionalProperties: false,
  required: ["readable", "kind", "systolic", "diastolic", "pulse", "value", "irregular_symbol", "afib_symbol", "time_shown", "confidence", "notes"],
  properties: {
    readable: { type: "boolean", description: "False if the numbers cannot be read with confidence" },
    kind: { type: "string", enum: ["blood_pressure", "glucose", "oxygen", "temperature", "unknown"] },
    systolic: num, diastolic: num, pulse: num,
    value: { ...num, description: "For glucose, oxygen or temperature: the main number" },
    irregular_symbol: { type: "boolean", description: "The screen shows an irregular heartbeat symbol (heart with waves, IHB)" },
    afib_symbol: { type: "boolean", description: "The screen shows an AFib indicator" },
    time_shown: { type: ["string", "null"], description: "Date/time shown on the screen, as printed, or null" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    notes: { type: "string", description: "Short note if anything is unclear (glare, cut off, error code); else empty" },
  },
};
const nstr = { type: ["string", "null"] };
const photoSchema = {
  type: "object", additionalProperties: false,
  required: ["kind", "decision", "retake_reason", "retake_tip", "summary", "uncertain", "vitals", "weight", "medication", "labs", "appointment", "contacts", "document", "med_list", "exercises", "more_pages", "more_pages_hint"],
  properties: {
    kind: { type: "string", enum: ["bp_monitor", "glucose_meter", "pulse_oximeter", "thermometer", "scale", "med_label", "lab_report", "appointment", "care_team", "med_list", "therapy_plan", "document", "food_label", "other"] },
    decision: { type: "string", enum: ["use", "retake"], description: "retake unless every value you report is clearly legible" },
    retake_reason: { type: "string", description: "If retake: what is wrong, in plain words (glare over the top number, screen cut off, blurry). Else empty." },
    retake_tip: { type: "string", description: "If retake: one specific instruction for the next photo. Else empty." },
    summary: { type: "string", description: "One line: what the photo shows and what you read" },
    uncertain: strList("Fields you left empty because they were not clearly readable"),
    vitals: { type: "object", additionalProperties: false, required: ["systolic", "diastolic", "pulse", "value", "unit", "irregular_symbol", "afib_symbol", "time_shown"],
      properties: { systolic: num, diastolic: num, pulse: num, value: { ...num, description: "Glucose, oxygen % or temperature" }, unit: nstr, irregular_symbol: { type: "boolean" }, afib_symbol: { type: "boolean" }, time_shown: nstr } },
    weight: { type: "object", additionalProperties: false, required: ["value", "unit"], properties: { value: num, unit: { anyOf: [{ type: "string", enum: ["lb", "kg"] }, { type: "null" }] } } },
    medication: { type: "object", additionalProperties: false, required: ["name", "strength", "directions", "prescriber", "pharmacy", "filled_on", "refills", "quantity", "warnings"],
      properties: { name: nstr, strength: nstr, directions: { ...nstr, description: "Directions exactly as printed" }, prescriber: nstr, pharmacy: nstr, filled_on: { ...nstr, description: "YYYY-MM-DD" }, refills: nstr, quantity: nstr, warnings: strList("Warning stickers, as printed") } },
    labs: { type: "array", items: { type: "object", additionalProperties: false, required: ["test", "value", "value_text", "unit", "low", "high", "range_text", "flag", "date"],
      properties: { test: str, value: num, value_text: nstr, unit: nstr, low: num, high: num, range_text: nstr, flag: nstr, date: { ...nstr, description: "YYYY-MM-DD collected" } } } },
    appointment: { type: "object", additionalProperties: false, required: ["with_whom", "date", "time", "place", "reason", "notes"],
      properties: { with_whom: nstr, date: { ...nstr, description: "YYYY-MM-DD" }, time: { ...nstr, description: "HH:MM 24h" }, place: nstr, reason: nstr, notes: nstr } },
    contacts: { type: "array", description: "Every doctor, nurse, pharmacy, agency, insurer or family contact listed, on any kind of photo", items: { type: "object", additionalProperties: false, required: ["name", "role", "phone", "fax", "address", "notes"],
      properties: { name: { type: "string", description: "Person or place as written, e.g. Dr. Smith or HEB Pharmacy" }, role: { type: "string", description: "e.g. Cardiologist, Pharmacy, Home health agency, Insurance, Family" }, phone: nstr, fax: nstr, address: nstr, notes: { ...nstr, description: "Member/policy numbers, hours, anything else written for this contact" } } } },
    document: { type: "object", additionalProperties: false, required: ["doc_type", "title", "date", "details"],
      properties: { doc_type: { type: "string", enum: ["Discharge papers", "Report", "Insurance card", "ID", "Directive", "Bill", "Other"] }, title: { type: "string", description: "Short name for this paper, e.g. Emergency plan, Medicare card" },
        date: { ...nstr, description: "YYYY-MM-DD shown on the paper" }, details: { type: "string", description: "Everything else important on the paper in short lines (plans, levels, numbers, instructions), not repeating the contacts" },
        fields: { type: "array", description: "The paper's own key facts as label/value pairs, e.g. Member ID, Group number, Policy, Valid until, Triage level. Labels short; values exactly as written", items: { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: str, value: str } } } } },
    med_list: { type: "array", description: "For a handwritten or printed LIST of medicines: one row per line", items: { type: "object", additionalProperties: false, required: ["written", "name", "strength", "dose", "when", "notes", "is_medicine", "doubt"],
      properties: { written: { type: "string", description: "The line exactly as written" }, name: { type: "string", description: "Medicine name, corrected to the real spelling only if you are sure which medicine it is" }, strength: nstr, dose: { ...nstr, description: "How much per dose, e.g. 1 tablet" }, when: { ...nstr, description: "How often / what time, as written" }, notes: nstr,
        is_medicine: { type: "string", enum: ["yes", "unsure", "no"], description: "yes only if this is clearly a real medicine or supplement name" }, doubt: { type: "string", description: "If unsure or no: why (hard to read, not a medicine name you know, could be X or Y). Else empty" } } } },
    exercises: { type: "array", description: "For a physical or occupational therapy home exercise sheet: one row per exercise", items: { type: "object", additionalProperties: false, required: ["name", "how", "how_often", "notes"],
      properties: { name: str, how: { ...nstr, description: "Sets, reps, hold time, as written" }, how_often: { ...nstr, description: "e.g. twice a day" }, notes: { ...nstr, description: "How to do it, cautions, equipment" } } } },
    more_pages: { type: "boolean", description: "True if the paper clearly continues beyond what the photos show (Page 1 of 3, continued, text cut off at the bottom, a list that runs off the page)" },
    more_pages_hint: { type: "string", description: "If more_pages: what suggests it, e.g. Page 1 of 3. Else empty" },
  },
};
const formSchema = {
  type: "object", additionalProperties: false,
  required: ["decision", "retake_reason", "retake_tip", "summary", "values", "uncertain"],
  properties: {
    decision: { type: "string", enum: ["use", "retake"] },
    retake_reason: str, retake_tip: str,
    summary: { type: "string", description: "One line: what the photo shows and what you filled" },
    values: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "value"], properties: { id: str, value: str } } },
    uncertain: strList("Field labels left empty because the photo was not clear there"),
  },
};
const scribeSchema = {
  type: "object", additionalProperties: false,
  required: ["summary", "visit", "to_do", "double_check"],
  properties: {
    summary: { type: "string", description: "One or two plain sentences: the most important things from the visit" },
    visit: { type: "object", additionalProperties: false,
      required: ["who", "when", "where", "why", "said", "changed", "meds_changed", "tests", "next_appt", "questions"],
      properties: {
        who: { ...nstr, description: "Role and name if said, e.g. Home health nurse (Pat)" },
        when: { ...nstr, description: "Visit start, YYYY-MM-DDTHH:MM local, if known" },
        where: nstr, why: nstr,
        said: { ...nstr, description: "Findings and readings they reported, short lines, numbers exactly as said" },
        changed: { ...nstr, description: "Changes to care, diet, fluids, activity, equipment, with any warning signs to call about" },
        meds_changed: { ...nstr, description: "Each medicine started, stopped or changed: name, dose, when. Null if none" },
        tests: { ...nstr, description: "Tests or referrals ordered, with dates" },
        next_appt: { ...nstr, description: "Next visit, YYYY-MM-DDTHH:MM local, only if a date was said" },
        questions: { ...nstr, description: "Questions the family raised that were not answered, or worth asking next time" },
      } },
    to_do: strList("Concrete follow-ups for the family: calls, refills, appointments to book, things to watch"),
    double_check: strList("Anything unclear, contradictory or possibly misheard (odd drug names, doses, numbers), phrased so the family can confirm it"),
  },
};
/* read_photo works in two steps (Anthropic limits how large one schema may be): photoKindSchema
 * says what the photo is, then photoPartSchema(kind) reads it with only the sections that kind
 * uses. photoEmpty() fills the other sections so the app always gets the full shape. */
const PHOTO_COMMON = ["decision", "retake_reason", "retake_tip", "summary", "uncertain", "more_pages", "more_pages_hint"];
const PHOTO_PARTS: Record<string, string[]> = {
  bp_monitor: ["vitals"], glucose_meter: ["vitals"], pulse_oximeter: ["vitals"], thermometer: ["vitals"],
  scale: ["weight"], med_label: ["medication"], lab_report: ["labs"], appointment: ["appointment"],
  care_team: ["contacts", "document"], document: ["contacts", "document"], med_list: ["med_list"], therapy_plan: ["exercises", "document"],
};
// deno-lint-ignore no-explicit-any
const PP: Record<string, any> = (photoSchema as any).properties;
const photoKindSchema = { type: "object", additionalProperties: false, required: ["kind", "summary"], properties: { kind: PP.kind, summary: { type: "string", description: "One line: what the photo shows" } } };
function photoPartSchema(keys: string[]) {
  const req = [...PHOTO_COMMON, ...keys];
  // deno-lint-ignore no-explicit-any
  const props: Record<string, any> = {}; for (const k of req) props[k] = PP[k];
  return { type: "object", additionalProperties: false, required: req, properties: props };
}
function photoEmpty() {
  return {
    decision: "use", retake_reason: "", retake_tip: "", summary: "", uncertain: [], more_pages: false, more_pages_hint: "",
    vitals: { systolic: null, diastolic: null, pulse: null, value: null, unit: null, irregular_symbol: false, afib_symbol: false, time_shown: null },
    weight: { value: null, unit: null },
    medication: { name: null, strength: null, directions: null, prescriber: null, pharmacy: null, filled_on: null, refills: null, quantity: null, warnings: [] },
    labs: [], appointment: { with_whom: null, date: null, time: null, place: null, reason: null, notes: null },
    contacts: [], document: { doc_type: "Other", title: "", date: null, details: "", fields: [] }, med_list: [], exercises: [],
  };
}
const PHOTO_RULES = `You read photos for a family caring for an elderly relative. Wrong numbers are worse than no numbers: the family would rather take another photo.
- First decide what the photo is (kind).
- Read only what is clearly printed or lit. Never guess or "correct" a digit. Seven-segment displays: check each segment (a 1 vs 7, 3 vs 8, 5 vs 6).
- decision = "retake" if ANY value the family needs is unclear, partly cut off, under glare, blurry, or if it is unclear which number is which. Say exactly what was wrong and give one specific tip (move closer, tilt to remove the reflection, include the whole label, turn on a light, hold still).
- If several photos are given, they are tries of the same thing; combine them and only report a value that at least one photo shows clearly. If photos disagree, retake.
- Blood pressure cuff: SYS top, DIA middle, pulse bottom. Report the irregular-heartbeat or AFib symbol only if it is lit. Ignore memory averages.
- Medicine label: the drug name and strength must be clearly readable, else retake.
- Care team: a list of doctors, pharmacy, agencies or emergency contacts (an emergency plan, a care team sheet, business cards). kind = care_team; put each one in contacts with whatever phone, fax and address is written. Handwriting: copy names as written; list a contact even if its phone is unreadable, and note that in uncertain. Do not ask for a retake just because some numbers are unclear.
- Other papers worth keeping (insurance card, ID, directive, discharge papers, bills, plans): kind = document; fill document, and contacts if any are listed. A care team sheet with other information on it also fills document (title and details).
- A LIST of medicines (handwritten or printed, several medicines, not a single pharmacy label): kind = med_list. One row per line. Copy each line in written. Never invent a medicine: if a word is hard to read or is not a medicine name you know, set is_medicine to unsure (or no) and say why in doubt, e.g. "could be metoprolol or metolazone". Do not retake just because one line is unclear.
- A therapy home exercise sheet (physical, occupational or speech therapy): kind = therapy_plan; fill exercises, and document (title, details) for anything else on it.
- Papers that fit nowhere else: kind = document. In document.fields list the paper's own key facts as label/value pairs, so the family can find them later.
- Several photos may be retakes of the same page OR further pages of one document; combine them into one answer. Set more_pages when the paper clearly continues past what you have.
- Lab report: report every test row you can read clearly; leave unreadable rows out and list them in uncertain. Retake only if the main results are unreadable.
- Fill only the sections asked for.`;
const guidanceSchema = {
  type: "object", additionalProperties: false,
  required: ["answer", "key_points", "sources", "questions_for_care_team", "caveat"],
  properties: {
    answer: { type: "string", description: "Plain-language answer, 3-6 sentences, as currently recommended" },
    key_points: { type: "array", items: { type: "object", additionalProperties: false, required: ["point", "sources"], properties: { point: str, sources: { type: "array", items: { type: "integer" } } } } },
    sources: { type: "array", items: { type: "integer" }, description: "All source numbers relied on" },
    questions_for_care_team: strList("2-5 questions to ask her doctors"),
    caveat: str,
  },
};

function imageBlock(dataUrl: string): Anthropic.ImageBlockParam {
  const m = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.*)$/);
  if (!m) throw new Error("image must be a base64 data URL");
  return { type: "image", source: { type: "base64", media_type: m[1] as "image/jpeg", data: m[2] } };
}

/* Anthropic allows at most 16 union-typed ("may be null") fields per schema. relax() keeps the
 * schemas readable here and rewrites them before sending: nullable strings become plain strings
 * ("" = unknown), nullable enums gain "", and nullable numbers stay nullable until the budget runs
 * out, after which they use -1 for unknown. restore() turns ""/-1 back into null in the answer, so
 * the app sees the same shape as before. */
const UNION_BUDGET = 14;
// deno-lint-ignore no-explicit-any
type J = any;
function nullableOf(n: J): "string" | "number" | "enum" | null {
  if (!n || typeof n !== "object") return null;
  if (Array.isArray(n.type) && n.type.includes("null")) { const t = n.type.find((x: string) => x !== "null"); return t === "string" ? "string" : (t === "number" || t === "integer") ? "number" : null; }
  if (Array.isArray(n.anyOf) && n.anyOf.length === 2 && n.anyOf.some((x: J) => x.type === "null") && n.anyOf.some((x: J) => x.type === "string" && Array.isArray(x.enum))) return "enum";
  return null;
}
function relax(n: J, budget = { left: UNION_BUDGET }): J {
  if (!n || typeof n !== "object" || Array.isArray(n)) return n;
  const kind = nullableOf(n);
  const note = (d: string | undefined, add: string) => (d ? d + " " : "") + add;
  if (kind === "string") { const { type: _t, ...rest } = n; return { ...rest, type: "string", description: note(n.description, "Empty string if unknown.") }; }
  if (kind === "enum") { const e = n.anyOf.find((x: J) => x.type === "string"); return { type: "string", enum: [...e.enum, ""], description: note(n.description ?? e.description, "Empty string if unknown.") }; }
  if (kind === "number") {
    if (budget.left > 0) { budget.left--; return n; }
    const base = n.type.find((x: string) => x !== "null"); const { type: _t, ...rest } = n;
    return { ...rest, type: base, description: note(n.description, "Use -1 if unknown or not shown.") };
  }
  const out: J = { ...n };
  if (n.properties) { out.properties = {}; for (const k of Object.keys(n.properties)) out.properties[k] = relax(n.properties[k], budget); }
  if (n.items) out.items = relax(n.items, budget);
  if (n.anyOf) out.anyOf = n.anyOf.map((x: J) => relax(x, budget));
  return out;
}
function restore(orig: J, v: J): J {
  if (v == null || !orig || typeof orig !== "object") return v;
  const kind = nullableOf(orig);
  if ((kind === "string" || kind === "enum") && v === "") return null;
  if (kind === "number" && v === -1) return null;
  if (Array.isArray(v) && orig.items) return v.map((x) => restore(orig.items, x));
  if (typeof v === "object" && !Array.isArray(v) && orig.properties) { const o: J = {}; for (const k of Object.keys(v)) o[k] = restore(orig.properties[k], v[k]); return o; }
  return v;
}

async function ask(schema: object, content: Anthropic.ContentBlockParam[], effort: "low" | "medium" | "high") {
  // fallbacks:"default" re-runs a request on Anthropic's recommended model if a safety
  // classifier declines it, instead of returning a bare refusal.
  const params = {
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    output_config: { effort, format: { type: "json_schema", schema: relax(schema) } },
    messages: [{ role: "user", content }],
  };
  // deno-lint-ignore no-explicit-any
  const res = await anthropic.beta.messages.create(params as any);
  if (res.stop_reason === "refusal") throw new Error("The model declined this request.");
  if (res.stop_reason === "max_tokens") throw new Error("Response was cut off; try a smaller input.");
  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("No structured output returned.");
  return restore(schema, JSON.parse(text.text));
}

// Most recipe sites embed schema.org/Recipe as JSON-LD; read it directly when present.
function jsonLdRecipe(html: string): Record<string, unknown> | null {
  const blocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    try {
      const data = JSON.parse(b[1].trim());
      const queue = Array.isArray(data) ? [...data] : [data];
      while (queue.length) {
        const n = queue.shift();
        if (!n || typeof n !== "object") continue;
        if (n["@graph"]) queue.push(...n["@graph"]);
        const t = n["@type"];
        if (t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"))) return n;
      }
    } catch { /* malformed block, try the next */ }
  }
  return null;
}

function stripHtml(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").slice(0, 60000);
}

async function handle(mode: Mode, body: Record<string, any>) {
  const known = (body.ingredients ?? []).slice(0, 400).join(", ");
  switch (mode) {
    case "parse_recipe": {
      if (body.url) {
        const page = await fetch(body.url, { headers: { "User-Agent": "Mozilla/5.0 CaregivingMenu" } }).then((r) => r.text());
        const ld = jsonLdRecipe(page);
        const source = ld ? "JSON-LD recipe data:\n" + JSON.stringify(ld).slice(0, 40000) : "Page text:\n" + stripHtml(page);
        return { ...(await ask(recipeSchema, [{ type: "text", text: `Extract the recipe from this web page (${body.url}).\n${source}` }], "low")), source_ref: body.url };
      }
      const images: string[] = Array.isArray(body.images) ? body.images.slice(0, 6) : body.image ? [body.image] : [];
      const content: Anthropic.ContentBlockParam[] = images.map(imageBlock);
      const intro = images.length > 1
        ? `These ${images.length} photos are consecutive pages of ONE recipe, in order. Transcribe it as a single recipe into the schema, joining any step or ingredient split across a page break. Keep handwritten notes in notes.`
        : images.length ? "This is a photo of a recipe (card, cookbook page, or handwriting). Transcribe it into the schema. Keep handwritten notes in notes." : "Parse this recipe text:\n" + body.text;
      const pageNote = body.batch ? "\nThis came from a batch of saved photos, so it may be only part of a recipe. Report whether it starts partway through or carries on past what is shown. If there is no recipe at all, return an empty title, ingredients and steps with confidence 0." : "";
      content.push({ type: "text", text: intro + pageNote + (known ? `\nKnown pantry ingredient names to reuse when they match: ${known}` : "") });
      return await ask(body.batch ? recipePageSchema : recipeSchema, content, images.length ? "medium" : "low");
    }
    case "parse_receipt":
      return await ask(receiptSchema, [imageBlock(body.image), { type: "text", text: `Read this grocery receipt. Decode abbreviations (GV = Great Value, YEL = yellow). Skip tax, totals, bags and coupons, or mark non-food lines is_food=false. qty is the amount bought in the item's natural unit (3 lb onions => qty 3, unit lb).${known ? "\nKnown names: " + known : ""}` }], "medium");
    case "pantry_photo": {
      // Photos of food on hand (fridge, shelf, counter, shopping bags), up to 6 at once.
      const images: string[] = (Array.isArray(body.images) ? body.images : [body.image]).filter(Boolean);
      if (!images.length || images.length > 6) throw new Error("send 1 to 6 photos");
      return await ask(receiptSchema, [...images.map(imageBlock), { type: "text", text: `These photos show food someone has on hand (fridge, pantry shelf, counter or shopping bags). List each distinct food item you can identify, once, even if it appears in several photos. qty is your best count or amount in the item's natural unit (3 each apples, 1 gal milk, 1 box cereal). raw is a short description of what you saw. Set store to an empty string and price to null. Mark anything that is not food is_food=false. Lower confidence for items you can only partly see.${known ? "\nKnown names: " + known : ""}` }], "medium");
    }
    case "estimate_plate": {
      // compare: photos of the plate before and after the meal (or only after), to estimate
      // just what was actually eaten rather than what was served.
      const images: string[] = (Array.isArray(body.images) ? body.images.slice(0, 2) : [body.image]).filter(Boolean);
      const content: Anthropic.ContentBlockParam[] = images.map(imageBlock);
      const lead = !body.compare ? "Estimate what was eaten and total nutrition for the whole plate."
        : images.length > 1 ? "Photo 1 is the plate as served; photo 2 is the same plate after the meal. Estimate only what was actually eaten (what was served minus what is left), and its nutrition. Apply any note about what was eaten or added."
        : body.after_only ? "The photo shows what was LEFT on the plate after the meal. Use the description for what was served, and estimate only what was actually eaten and its nutrition. Apply any note about what was eaten or added."
        : `${images.length ? "The photo shows the plate as served. " : ""}Use the description of what was served and the caregiver's note on what was actually eaten (and anything added, such as salt) to estimate only what was eaten and its nutrition.`;
      content.push({ type: "text", text: lead + (body.text ? `\nDescription: ${body.text}` : "") });
      return await ask(plateSchema, content, body.compare ? "medium" : "low");
    }
    case "variations":
      return await ask(optionsSchema, [{ type: "text", text: `Give 3 "${body.angle}" takes on this recipe, as edits to it rather than whole new recipes.\nRecipe: ${JSON.stringify(body.recipe)}\nOn hand: ${(body.pantry ?? []).join(", ")}` }], "medium");
    case "diet_swaps":
      return await ask(optionsSchema, [{ type: "text", text: `Suggest 2-3 versions of this recipe adjusted for ${body.profile?.name}. Keep it recognisably the same dish; say what each change saves (e.g. "~600 mg sodium per serving").\nTheir rules: ${JSON.stringify(body.profile?.rules ?? [])}\nDaily targets: ${JSON.stringify(body.profile?.targets ?? {})}\nRecipe: ${JSON.stringify(body.recipe)}` }], "medium");
    case "canonicalize":
      return await ask(canonSchema, [{ type: "text", text: `Map each input to an existing ingredient name if it is the same thing, otherwise propose a new generic name.\nInputs: ${JSON.stringify(body.inputs)}\nKnown: ${known}` }], "low");
    case "appointment_summary":
      return await ask(summarySchema, [{ type: "text", text: `Draft a short brief a family caregiver can bring to an appointment, from this home food diary summary. Use only the data given; do not diagnose or recommend treatment. Frame concerns as questions for the clinician. Write in plain language.\n${JSON.stringify(body.digest)}` }], "medium");
    case "meal_ideas":
      return await ask(mealIdeasSchema, [{ type: "text", text: `Suggest 3 simple meal ideas for ${body.profile?.name ?? "this person"} for ${body.meal ?? "the next meal"}. Prefer what is on hand. Respect their diet rules strictly (sodium, potassium, phosphorus, fluid). Count soups, gelatin, ice and sauces as fluid. Keep each idea easy for a tired caregiver.
Their rules: ${JSON.stringify(body.profile?.rules ?? [])}
Daily targets: ${JSON.stringify(body.profile?.targets ?? {})}
Fluid left today (oz): ${body.fluid_left_oz ?? "no limit set"}
Eaten so far today: ${JSON.stringify(body.today ?? [])}
On hand: ${(body.pantry ?? []).join(", ")}` }], "low");
    case "schedule_draft": {
      // body.context: meds (with refs, slots, times, label timing text), actual timings,
      // meals, wake/bed times, conditions, kidney labs, patterns. No names.
      const ctx = JSON.stringify(body.context ?? {}).slice(0, 40000);
      const found = await research(`Find current guidance on WHEN to take each of these medicines (time of day, with or without food, spacing from other medicines or binders, bedtime vs morning) for an older adult with: ${(body.context?.conditions ?? []).join(", ") || "chronic illness"}. Note anything about kidney disease. Medicines: ${(body.context?.meds ?? []).map((m: { name: string }) => m.name).join(", ")}.`);
      const out = await ask(draftSchema, [{ type: "text", text: `Draft a medicine TIMING schedule for a family caregiver to take to her pharmacist. Change only times and slots, never doses or which medicines. Fit times to her day (wake, meals, bed) and her real dose times; keep a time when there is no clear reason to move it. Use the research notes and cite the numbered sources. If the research does not support a change, do not make it.\n\nHer data:\n${ctx}\n\nResearch notes:\n${found.notes}\n\nNumbered sources:\n${numbered(found.sources)}` }], "high");
      return { ...out, source_list: found.sources };
    }
    case "read_vitals":
      return await ask(vitalsSchema, [imageBlock(body.image), { type: "text", text: "This is a photo of a home health monitor's screen (usually a blood pressure cuff: SYS top, DIA middle, pulse bottom). Read exactly what the screen shows. Do not guess digits you cannot see; set readable=false instead. Report whether an irregular heartbeat or AFib symbol is lit. Ignore stored-memory averages unless they are the only reading shown, and say so in notes." }], "low");
    case "fill_form": {
      const images: string[] = (body.images ?? []).filter(Boolean).slice(-3);
      if (!images.length) throw new Error("No photo sent.");
      const fields = (body.fields ?? []).slice(0, 50).map((f: Record<string, unknown>) =>
        `- id=${String(f.id).slice(0, 40)} | ${String(f.label ?? "").slice(0, 120)} | type=${String(f.type ?? "text").slice(0, 20)}` +
        (Array.isArray(f.options) && f.options.length ? ` | one of: ${f.options.slice(0, 30).map((o) => String(o).slice(0, 40)).join(" / ")}` : "")).join("\n");
      const text = PHOTO_RULES.split("\n- First decide")[0] + `
The family is filling in a form called "${String(body.form ?? "").slice(0, 80)}". Fill its fields from the photo(s).
Fields:
${fields}
- Fill only fields the photo clearly answers; leave the rest out. Never guess a digit or a word you cannot read.
- Formats: date YYYY-MM-DD, datetime-local YYYY-MM-DDTHH:MM, time HH:MM, number = digits only (convert units only if the field label names a unit and the photo uses another, and say so in summary). A field with "one of" must use one of those options exactly.
- If several photos are given they are tries of the same thing; combine them. If they disagree on a value, leave it out and retake.
- decision = "retake" if the main thing this form needs is unclear (glare, cut off, blurry), with the reason and one specific tip. Use "use" when everything you report is clear, even if some fields stay empty.
- If the photo has nothing to do with this form, decision = "use", no values, and say so in summary.
Today is ${new Date().toISOString().slice(0, 10)}.`;
      return await ask(formSchema, [...images.map(imageBlock), { type: "text", text }], "medium");
    }
    case "scribe": {
      // body.text: the family's notes or a speech-to-text transcript of the visit (may be messy).
      const text = String(body.text ?? "").slice(-80000);
      if (text.trim().length < 15) throw new Error("No notes sent.");
      const meds = (body.meds ?? []).slice(0, 60).map((m: unknown) => String(m).slice(0, 80)).join(", ");
      const focus = String(body.focus ?? "").slice(0, 1500).trim();
      return await ask(scribeSchema, [{ type: "text", text: `You are a careful medical scribe for a family caring for an elderly relative at home. Below are notes about a care visit (home health nurse, doctor, therapist, hospice, pharmacist): either typed by the family or an automatic speech-to-text transcript of the whole visit, with no speaker labels and possible mishearings.
This is care talk. Pull out what matters for her care, in short plain lines a tired family member can act on: findings and readings, what the clinician said to do or watch for, when to call them, changes to medicines, diet, fluids, activity, wound care or equipment, tests and referrals, the next visit. Leave out small talk, greetings and chatter about other things.
The family's own instructions to you come first and override the defaults below, as long as they do not ask you to invent anything.
- Sentences in the notes that speak to you directly ("scribe, note that...", "make a note...", "remind me to...", "put down that...", "don't include...") are the family's instructions or to-dos, not things the clinician said. Follow them.${focus ? `
The family's instructions: ${focus}` : ""}
- Use only what the notes say. Never add advice, diagnoses or doses that were not said.
- Keep numbers (blood pressure, weight, doses, dates) exactly as said. If a number or drug name may have been misheard, still record it as heard and add it to double_check.
- Speech-to-text often garbles drug names; compare with her current medicines and say in double_check if a heard name probably means one of them.
- Medicine changes go in meds_changed, never only in changed.
- Relative dates ("next Tuesday") become real dates using today; if unsure, keep the words and add to double_check.
- Fields with nothing in the notes are null.
Today is ${String(body.today ?? new Date().toISOString().slice(0, 10)).slice(0, 10)}. Notes started ${String(body.started ?? "").slice(0, 25)} (UTC).
Her current medicines: ${meds || "none listed"}.

Notes:
${text}` }], "medium");
    }
    case "read_photo": {
      const images: string[] = (body.images ?? [body.image]).filter(Boolean).slice(-6);
      if (!images.length) throw new Error("No photo sent.");
      const expect = body.expect ? `
The family expects: ${String(body.expect).slice(0, 40)}.` : "";
      const blocks = images.map(imageBlock), today = `
Today is ${new Date().toISOString().slice(0, 10)}.`;
      // Step 1: what is it? A tiny schema, so the full reader never has to describe every kind at once.
      const first = await ask(photoKindSchema, [...blocks, { type: "text", text: PHOTO_RULES + expect + "\nStep 1 of 2: only say what kind of photo this is, in one line of summary." }], "low");
      const kind = String(first.kind);
      const part = PHOTO_PARTS[kind];
      if (!part) return { ...photoEmpty(), kind, decision: "use", summary: first.summary };
      // Step 2: read it with only the sections this kind needs.
      const out = await ask(photoPartSchema(part), [...blocks, { type: "text", text: PHOTO_RULES + expect + `\nStep 2 of 2: this photo is a ${kind.replace(/_/g, " ")}. Read it.` + today }], "medium");
      return { ...photoEmpty(), ...out, kind };
    }
    case "guidance": {
      const q = String(body.question ?? "").slice(0, 600);
      const found = await research(`${q}\nContext (no names): ${JSON.stringify(body.context ?? {}).slice(0, 4000)}`);
      const out = await ask(guidanceSchema, [{ type: "text", text: `Answer the caregiver's question from the research notes, as currently recommended, citing the numbered sources. If the sources do not answer it, say so. Do not tell them to change treatment; turn anything treatment-related into questions for her care team.\nQuestion: ${q}\n\nResearch notes:\n${found.notes}\n\nNumbered sources:\n${numbered(found.sources)}` }], "medium");
      return { ...out, source_list: found.sources };
    }
    default:
      throw new Error("unknown mode");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // Only signed-in household members may spend API credit.
    const auth = req.headers.get("Authorization") ?? "";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: "sign in first" }, 401);
    const body = await req.json();
    return json(await handle(body.mode, body));
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: "Busy, try again in a minute." }, 429);
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return json({ error: "The AI key was rejected (" + e.status + "). The app owner needs to put a new Anthropic API key in Supabase (ANTHROPIC_API_KEY)." }, 502);
    if (e instanceof Anthropic.APIError) {
      // Anthropic's own message says what was wrong with the request (never contains the key).
      // deno-lint-ignore no-explicit-any
      const detail = String((e as any).error?.error?.message ?? e.message ?? "").slice(0, 300);
      console.error("anthropic", e.status, detail);
      return json({ error: `AI service error ${e.status}${detail ? ": " + detail : ""}` }, 502);
    }
    return json({ error: (e as Error).message }, 400);
  }
});
