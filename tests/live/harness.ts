// Runs one Edge Function for real on Deno, with outside services replaced:
// Anthropic -> schema-driven fake that records requests; OFF/USDA/recipe site -> fixtures.
// Supabase auth calls go to the real local stack.
const fn = Deno.args[0], port = Number(Deno.args[1]);
const log: unknown[] = [];
// deno-lint-ignore no-explicit-any
function fake(schema: any): any {
  if (!schema) return null;
  const t = Array.isArray(schema.type) ? schema.type.find((x: string) => x !== "null") : schema.type;
  if (schema.enum) return schema.enum[0];
  if (t === "object") { const o: Record<string, unknown> = {}; for (const k of schema.required ?? []) o[k] = fake(schema.properties[k]); return o; }
  if (t === "array") return [fake(schema.items)];
  if (t === "number") return 1;
  if (t === "boolean") return false;
  return "x";
}
const RECIPE_HTML = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"Recipe","name":"Lemon Chicken","recipeIngredient":["1 lb chicken thighs","1 lemon"]}]}</script></head><body>Lemon chicken</body></html>`;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  const url = req.url;
  if (url.startsWith("https://api.anthropic.com/")) {
    const body = await req.json();
    log.push({ url, beta: req.headers.get("anthropic-beta"), version: req.headers.get("anthropic-version"), auth: req.headers.get("authorization") || req.headers.get("x-api-key"), body });
    const text = JSON.stringify(fake(body.output_config?.format?.schema));
    return new Response(JSON.stringify({ id: "msg_test", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }), { headers: { "content-type": "application/json", "request-id": "req_test" } });
  }
  if (url.startsWith("https://world.openfoodfacts.org/")) {
    return Response.json(url.includes("0000000000000") ? { status: 0 } : { status: 1, product: { product_name: "Rolled Oats", brands: "Acme", nutriments: { "energy-kcal_100g": 379, proteins_100g: 13, sodium_100g: 0.006, potassium_100g: 0.362 } } });
  }
  if (url.startsWith("https://api.nal.usda.gov/")) {
    return Response.json({ foods: [{ description: "Oats, raw", fdcId: 173904, foodNutrients: [{ nutrientNumber: "1008", value: 379 }, { nutrientNumber: "1093", value: 6 }, { nutrientNumber: "1003", value: 13.15 }] }] });
  }
  if (url.startsWith("https://recipes.example/")) return new Response(RECIPE_HTML, { headers: { "content-type": "text/html" } });
  return realFetch(input, init);
};
const realServe = Deno.serve;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (handler: any) => realServe({ port, onListen() {} }, async (req: Request) => {
  if (new URL(req.url).pathname === "/__log") return Response.json(log);
  return handler(req);
});
await import(`./functions/${fn}/index.ts`);
