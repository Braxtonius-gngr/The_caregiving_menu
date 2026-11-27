// /notify — phone notifications (design: product/design/step-notifications.md, decision P-027).
// action "run": called every 10 minutes by pg_cron. For each family with a subscribed phone it works
//   out what is due with the app's own rules (_shared/carelogic.ts = assets/js/logic.js) and sends
//   each alert once per person (notifications_sent). Calling it again sends nothing new, so it
//   needs no key, like the daily erase job.
// action "test": a signed-in person sends a test to their own phones.
// Secrets: VAPID_PRIVATE_JWK (JSON), VAPID_PUBLIC_KEY. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are built in.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { corsHeaders, json } from "../_shared/cors.ts";
import { sendPush, type Subscription, type Vapid } from "../_shared/webpush.ts";
import { Logic } from "../_shared/carelogic.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP = "https://braxtonius-gngr.github.io/The_caregiving_menu/";
const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });

function vapid(): Vapid {
  return { publicKey: Deno.env.get("VAPID_PUBLIC_KEY") ?? "", privateJwk: JSON.parse(Deno.env.get("VAPID_PRIVATE_JWK") ?? "{}"), subject: APP };
}

// Minutes a time zone is ahead of UTC at a moment ("America/Chicago" in November: -360).
function tzOffset(tz: string, at: Date): number {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at).map((x) => [x.type, x.value]));
    return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - at.getTime()) / 60000);
  } catch { return 0; }
}
// The rules read clock times with getHours(); this server runs on UTC. Shifting every time by the
// family's offset makes UTC read as their wall clock, so the rules see the day the family sees.
const shiftIso = (iso: string | null | undefined, off: number) => iso ? new Date(Date.parse(iso) + off * 60000).toISOString() : iso;
// deno-lint-ignore no-explicit-any
function shiftRows(rows: any[], keys: string[], off: number) { return rows.map((r) => { const c = { ...r }; for (const k of keys) if (c[k]) c[k] = shiftIso(c[k], off); return c; }); }

type Prefs = { tz?: string; kinds?: Record<string, boolean>; quiet_from?: number; quiet_to?: number; urgent_in_quiet?: boolean; details?: boolean; summary?: boolean; summary_at?: number };
const KIND_PREF: Record<string, string> = { dose: "doses", reading: "readings", trend: "readings", supply: "refills" };
function inQuiet(p: Prefs, hour: number) {
  const a = p.quiet_from ?? 22, b = p.quiet_to ?? 7;
  return a === b ? false : a < b ? hour >= a && hour < b : hour >= a || hour < b;
}

// deno-lint-ignore no-explicit-any
async function runHousehold(hid: string, subs: any[], now: Date) {
  const tz = subs.map((s) => (s.prefs as Prefs)?.tz).find(Boolean) || "America/Chicago";
  const off = tzOffset(tz, now);
  const since = new Date(now.getTime() - 12 * 864e5).toISOString(), doseSince = new Date(now.getTime() - 45 * 864e5).toISOString();
  const [hh, profs, recs, meas, diary] = await Promise.all([
    db.from("households").select("day_start_hour").eq("id", hid).single(),
    db.from("diet_profiles").select("id, person_name, care_settings, deleted").eq("household_id", hid),
    db.from("records").select("id, kind, title, for_profile_id, occurred_at, fields, deleted").eq("household_id", hid).in("kind", ["medication", "dose"]).or(`kind.eq.medication,updated_at.gte.${doseSince}`),
    db.from("measurements").select("id, kind, value, value2, pulse, rhythm, unit, taken_at, standard, for_profile_id, deleted").eq("household_id", hid).gte("taken_at", since),
    db.from("diary_entries").select("id, for_profile_id, eaten_at, entry_kind, volume_ml, fluid_ml, portion_mult, output_type, output_color, clots, deleted").eq("household_id", hid).gte("eaten_at", since),
  ]);
  const startHour = hh.data?.day_start_hour ?? 6;
  const local = new Date(now.getTime() + off * 60000);
  const day = Logic.careDay(local.toISOString(), startHour);
  let hour = local.getUTCHours() + local.getUTCMinutes() / 60; if (hour < startHour) hour += 24;
  const records = shiftRows(recs.data ?? [], ["occurred_at"], off);
  const people = (profs.data ?? []).filter((p) => !p.deleted);
  const several = people.length > 1;
  // deno-lint-ignore no-explicit-any
  const alerts: any[] = [], summaries: Record<string, string> = {};
  for (const p of people) {
    const cs = { ...(p.care_settings ?? {}) };
    cs.care_stays = (cs.care_stays ?? []).map((s: Record<string, string>) => ({ ...s, from_at: shiftIso(s.from_at, off), to_at: shiftIso(s.to_at, off) }));
    const mine = (r: { for_profile_id: string | null }) => (r.for_profile_id ?? null) === p.id;
    const data = {
      pid: p.id, name: several ? p.person_name : "", settings: cs,
      meds: records.filter((r) => r.kind === "medication" && mine(r)), doses: records.filter((r) => r.kind === "dose" && mine(r)),
      measurements: shiftRows((meas.data ?? []).filter(mine), ["taken_at"], off), diary: shiftRows((diary.data ?? []).filter(mine), ["eaten_at"], off),
    };
    alerts.push(...Logic.dueAlerts(data, day, hour, startHour, 3));
    const s = Logic.daySummary(data, day, startHour);
    const oz = (ml: number) => Math.round(ml / 29.5735);
    summaries[p.id] = (several ? p.person_name + ": " : "") + `Today ${s.given} of ${s.due} doses marked, ${oz(s.inMl)} oz in, ${oz(s.outMl)} oz out.`;
  }
  // Already sent to these people in the last two weeks.
  const users = [...new Set(subs.map((s) => s.user_id))];
  const sent = await db.from("notifications_sent").select("user_id, key").in("user_id", users).gte("sent_at", new Date(now.getTime() - 14 * 864e5).toISOString());
  const had = new Set((sent.data ?? []).map((r) => r.user_id + "|" + r.key));
  const v = vapid();
  let pushed = 0;
  for (const uid of users) {
    const mySubs = subs.filter((s) => s.user_id === uid);
    const prefs: Prefs = mySubs[0].prefs ?? {};
    const uLocal = new Date(now.getTime() + tzOffset(prefs.tz || tz, now) * 60000), uHour = uLocal.getUTCHours();
    const quiet = inQuiet(prefs, uHour);
    const kinds = prefs.kinds ?? {};
    const mine = alerts.filter((a) => kinds[KIND_PREF[a.kind]] !== false && !had.has(uid + "|" + a.key) && (!quiet || (a.urgent && prefs.urgent_in_quiet !== false)));
    if (prefs.summary && !quiet && uHour >= (prefs.summary_at ?? 20)) {
      for (const p of people) { const key = "summary:" + p.id + ":" + day; if (!had.has(uid + "|" + key)) mine.push({ key, kind: "summary", urgent: false, screen: "diary", text: summaries[p.id] }); }
    }
    if (!mine.length) continue;
    // Several at once arrive as one notification; the app shows them all on Today.
    const urgent = mine.some((a) => a.urgent);
    const body = prefs.details ? (mine.length === 1 ? mine[0].text : mine[0].text + ` (+${mine.length - 1} more)`) : (mine.length === 1 ? "Something needs a look." : `${mine.length} things need a look.`);
    const payload = { title: "The Caregiving Menu", body, url: APP + "?open=" + mine[0].screen, tag: urgent ? "tcm-urgent" : "tcm", urgent };
    let delivered = false;
    for (const s of mySubs) {
      const st = await sendPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth } as Subscription, payload, v, { urgency: urgent ? "high" : "normal", ttl: urgent ? 4 * 3600 : 12 * 3600, topic: urgent ? "urgent" : "routine" }).catch(() => 0);
      if (st === 404 || st === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
      else if (st >= 200 && st < 300) { delivered = true; pushed++; }
    }
    if (delivered) await db.from("notifications_sent").upsert(mine.map((a) => ({ user_id: uid, household_id: hid, key: a.key })), { onConflict: "user_id,key", ignoreDuplicates: true });
  }
  return pushed;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "test") {
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data: u } = await db.auth.getUser(token);
      if (!u?.user) return json({ error: "sign in first" }, 401);
      const { data: subs } = await db.from("push_subscriptions").select("*").eq("user_id", u.user.id);
      if (!subs?.length) return json({ error: "no phone is set up for notifications yet" }, 400);
      const results = [];
      for (const s of subs) {
        const st = await sendPush(s as Subscription, { title: "The Caregiving Menu", body: "Test: notifications work on this phone.", url: APP, tag: "tcm-test" }, vapid(), { urgency: "high", ttl: 600 }).catch(() => 0);
        if (st === 404 || st === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
        results.push(st);
      }
      return json({ sent: results.filter((s) => s >= 200 && s < 300).length, results });
    }
    if (body.action !== "run") return json({ error: "unknown action" }, 400);
    const now = new Date();
    const { data: subs } = await db.from("push_subscriptions").select("*");
    // deno-lint-ignore no-explicit-any
    const byHouse: Record<string, any[]> = {};
    for (const s of subs ?? []) (byHouse[s.household_id] ??= []).push(s);
    let pushed = 0;
    for (const [hid, list] of Object.entries(byHouse)) pushed += await runHousehold(hid, list, now).catch((e) => { console.error("notify", hid, (e as Error).message); return 0; });
    // Keep the "already sent" list short.
    await db.from("notifications_sent").delete().lt("sent_at", new Date(now.getTime() - 30 * 864e5).toISOString());
    return json({ households: Object.keys(byHouse).length, pushed });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
