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

type Mode = "parse_recipe" | "parse_receipt" | "pantry_photo" | "estimate_plate" | "variations" | "diet_swaps" | "canonicalize" | "appointment_summary" | "meal_ideas" | "schedule_draft" | "guidance" | "read_vitals";

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

async function ask(schema: object, content: Anthropic.ContentBlockParam[], effort: "low" | "medium" | "high") {
  // fallbacks:"default" re-runs a request on Anthropic's recommended model if a safety
  // classifier declines it, instead of returning a bare refusal.
  const params = {
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    output_config: { effort, format: { type: "json_schema", schema } },
    messages: [{ role: "user", content }],
  };
  // deno-lint-ignore no-explicit-any
  const res = await anthropic.beta.messages.create(params as any);
  if (res.stop_reason === "refusal") throw new Error("The model declined this request.");
  if (res.stop_reason === "max_tokens") throw new Error("Response was cut off; try a smaller input.");
  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("No structured output returned.");
  return JSON.parse(text.text);
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
    if (e instanceof Anthropic.APIError) return json({ error: `AI service error ${e.status}` }, 502);
    return json({ error: (e as Error).message }, 400);
  }
});
