// /account — export log, family delete (7-day grace), cancel, leave, delete my account, and the
// daily erase of families past their date. Design: docs/private/product/design/step-c1-export-delete.md.
//
// Every check is made here with the caller's own token; writes use the server key.
// "Fresh" means the caller signed in (email code or Google) within the last 10 minutes.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { corsHeaders, json } from "../_shared/cors.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ZERO = "00000000-0000-0000-0000-000000000000";
const GRACE_DAYS = 7;
const FRESH_SECONDS = 600;

function admin(): SupabaseClient {
  return createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}

// The newest sign-in time in the token (seconds). The token itself is checked by getUser first.
function signedInAt(token: string): number {
  try {
    const p = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const ts = (p.amr ?? []).map((a: { timestamp?: number }) => Number(a.timestamp) || 0);
    return Math.max(0, ...ts);
  } catch { return 0; }
}

class Refusal extends Error { constructor(msg: string, public status = 403, public code = "") { super(msg); } }
const STALE = () => new Refusal("For safety, confirm it's you first: sign in again, then try once more.", 403, "reauth");

type Member = { household_id: string; role: string; display_name: string | null };

async function membership(db: SupabaseClient, uid: string): Promise<Member[]> {
  const { data, error } = await db.from("members").select("household_id, role, display_name").eq("user_id", uid);
  if (error) throw error;
  return data ?? [];
}

async function log(db: SupabaseClient, hid: string | null, uid: string | null, who: string | null, kind: string, detail: Record<string, unknown> = {}) {
  await db.from("data_requests").insert({ household_id: hid, user_id: uid, who, kind, detail });
}

// Leave one family: name kept (former_members) or replaced everywhere (redact_member).
async function leaveOne(db: SupabaseClient, m: Member, uid: string, who: string, keepName: boolean) {
  if (keepName) await db.from("former_members").upsert({ household_id: m.household_id, user_id: uid, display_name: who });
  else { const { error } = await db.rpc("redact_member", { hid: m.household_id, uid }); if (error) throw error; }
  await db.from("members").delete().eq("household_id", m.household_id).eq("user_id", uid);
}

// Why this person can't leave this family yet, or null.
async function blockLeaving(db: SupabaseClient, m: Member, uid: string): Promise<string | null> {
  const { data } = await db.from("members").select("user_id, role").eq("household_id", m.household_id);
  const others = (data ?? []).filter((x) => x.user_id !== uid);
  if (!others.length) return "You're the only person in this family. Use Delete family instead.";
  if (m.role === "owner" && !others.some((x) => x.role === "owner")) return "Make someone else an owner first. Every family needs one.";
  return null;
}

// Erase every family whose date has passed: photos, rows, then sign-ins nobody else needs.
async function purge(db: SupabaseClient) {
  const { data: due } = await db.from("households").select("id, erase_after, erase_requested_by").lt("erase_after", new Date().toISOString());
  const done = [];
  for (const h of due ?? []) {
    const { data: paths } = await db.rpc("household_photo_paths", { hid: h.id });
    const list: string[] = paths ?? [];
    for (let i = 0; i < list.length; i += 100) {
      const { error } = await db.storage.from("photos").remove(list.slice(i, i + 100));
      if (error) throw error;
    }
    const { data: mems } = await db.from("members").select("user_id").eq("household_id", h.id);
    const { error } = await db.rpc("erase_household_rows", { hid: h.id });
    if (error) throw error;
    let accounts = 0;
    for (const { user_id } of mems ?? []) {
      const { count } = await db.from("members").select("user_id", { count: "exact", head: true }).eq("user_id", user_id);
      if (!count) { const r = await db.auth.admin.deleteUser(user_id); if (!r.error) accounts++; }
    }
    await db.from("erasures").upsert({ household_id: h.id, requested_by: h.erase_requested_by, requested_at: h.erase_after, photos_removed: list.length, accounts_removed: accounts });
    done.push({ household: h.id, photos: list.length, accounts });
  }
  return { erased: done };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const db = admin();
    // The daily job. It only erases families already past their date, so anyone may trigger it.
    if (body.action === "purge") return json(await purge(db));

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await db.auth.getUser(token);
    if (!user) return json({ error: "Sign in first." }, 401);
    const uid = user.id;
    const fresh = Date.now() / 1000 - signedInAt(token) < FRESH_SECONDS;
    const mine = await membership(db, uid);
    const inFamily = (hid: string) => mine.find((m) => m.household_id === hid);
    const nameOf = (m?: Member) => (m && m.display_name) || (user.email ? user.email.split("@")[0] : "Someone");

    switch (body.action) {
      case "check": return json({ fresh });

      case "export": {
        const m = inFamily(String(body.hid));
        if (!m) throw new Refusal("You're not in that family.");
        const family = body.scope === "family";
        if (family && m.role !== "owner") throw new Refusal("Only an owner can export the whole family. You can export your own data.");
        if (family && !fresh) throw STALE();
        await log(db, m.household_id, uid, nameOf(m), family ? "export_family" : "export_mine");
        return json({ ok: true });
      }

      case "start_delete": {
        const m = inFamily(String(body.hid));
        if (!m || m.role !== "owner") throw new Refusal("Only an owner can delete the family.");
        if (!fresh) throw STALE();
        const { data: h } = await db.from("households").select("name, erase_after").eq("id", m.household_id).single();
        if (h?.erase_after) return json({ ok: true, erase_after: h.erase_after });
        const typed = String(body.confirm ?? "").trim().toLowerCase();
        if (!typed || typed !== String(h?.name ?? "").trim().toLowerCase()) throw new Refusal("The name doesn't match. Type the family's name exactly as shown.", 400);
        const when = new Date(Date.now() + GRACE_DAYS * 864e5).toISOString();
        await db.from("households").update({ erase_after: when, erase_requested_by: uid }).eq("id", m.household_id);
        await log(db, m.household_id, uid, nameOf(m), "delete_family", { erase_after: when });
        return json({ ok: true, erase_after: when });
      }

      case "cancel_delete": {
        const m = inFamily(String(body.hid));
        if (!m || m.role !== "owner") throw new Refusal("Only an owner can cancel.");
        await db.from("households").update({ erase_after: null, erase_requested_by: null }).eq("id", m.household_id);
        await log(db, m.household_id, uid, nameOf(m), "cancel_delete");
        return json({ ok: true });
      }

      case "leave": {
        const m = inFamily(String(body.hid));
        if (!m) throw new Refusal("You're not in that family.");
        const why = await blockLeaving(db, m, uid);
        if (why) throw new Refusal(why, 409);
        const keep = !!body.keep_name;
        await leaveOne(db, m, uid, nameOf(m), keep);
        await log(db, m.household_id, keep ? uid : ZERO, keep ? nameOf(m) : null, "leave", { kept_name: keep });
        return json({ ok: true });
      }

      case "delete_me": {
        if (!fresh) throw STALE();
        for (const m of mine) { const why = await blockLeaving(db, m, uid); if (why) throw new Refusal(why, 409); }
        const keep = !!body.keep_name;
        for (const m of mine) {
          await leaveOne(db, m, uid, nameOf(m), keep);
          await log(db, m.household_id, ZERO, keep ? nameOf(m) : null, "delete_me", { kept_name: keep });
        }
        const { error } = await db.auth.admin.deleteUser(uid);
        if (error) throw error;
        return json({ ok: true });
      }
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    if (e instanceof Refusal) return json({ error: e.message, code: e.code || undefined }, e.status);
    return json({ error: (e as Error).message }, 400);
  }
});
