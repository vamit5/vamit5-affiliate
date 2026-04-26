// =====================================================================
// DAILY CHECKS — runs every day at 04:00 UTC
//   - Update challenge progress for all athletes (based on yesterday's data)
//   - Award XP for completed challenges
//   - Send "streak warning" emails to athletes whose streak is about to break
//   - Trigger promotion checks
//   - Send weekly summary on Sundays
// =====================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SITE_URL = Deno.env.get("SITE_URL") || "https://vamit5.app";

serve(async (_req) => {
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 24*3600*1000).toISOString().split("T")[0];

  // 1. Update challenge progress (for yesterday — the day they're being scored on)
  await updateChallengeProgress(yesterday);

  // 2. Streak warnings: athletes with active streak who haven't been active today
  await sendStreakWarnings(today);

  // 3. Promotion checks for all
  const { data: athletes } = await supabase
    .from("athletes")
    .select("id, tier")
    .eq("is_active", true)
    .eq("banned", false);

  for (const a of athletes || []) {
    const before = a.tier;
    await supabase.rpc("check_promotion", { p_athlete_id: a.id });
    const { data: after } = await supabase.from("athletes").select("tier").eq("id", a.id).single();
    if (after && after.tier !== before) {
      const tierNames: any = { recruit:"REGRUT", pro:"PRO ATHLETE", commando:"COMMANDO", elite:"ELITE ATHLETE" };
      const newPct: any = { recruit:"35%", pro:"40%", commando:"45%", elite:"50%" };
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-notification`, {
        method: "POST",
        headers: { "Content-Type":"application/json", "Authorization":`Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({
          athlete_id: a.id, type: "levelup",
          title: `🏆 Promocija u ${tierNames[after.tier]}!`,
          body: `Odsad zaradjujes ${newPct[after.tier]} po prodaji. Isplata 20. u mesecu.`,
          channels: ["push","telegram","email"],
        }),
      });
    }
  }

  // 4. Morning push: "Novi izazovi te cekaju"
  const morningHour = new Date().getUTCHours();
  if (morningHour >= 6 && morningHour < 8) {
    for (const a of athletes || []) {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-notification`, {
        method: "POST",
        headers: { "Content-Type":"application/json", "Authorization":`Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({
          athlete_id: a.id, type: "challenge",
          title: "⚡ Novi dnevni izazovi su tu",
          body: "5 izazova ceka — najlakši XP danas.",
          channels: ["push","telegram"],
        }),
      });
    }
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
});

// =====================================================================
async function updateChallengeProgress(date: string) {
  const { data: challenges } = await supabase
    .from("challenges")
    .select("*")
    .eq("challenge_date", date);

  if (!challenges?.length) return;

  const { data: athletes } = await supabase
    .from("athletes")
    .select("id, xp")
    .eq("is_active", true)
    .eq("banned", false);

  const dayStart = `${date}T00:00:00Z`;
  const dayEnd = `${date}T23:59:59Z`;

  for (const ath of athletes || []) {
    // Aggregate metrics for that day
    const [salesCnt, reelsCnt, storiesCnt, clicksCnt] = await Promise.all([
      supabase.from("sales").select("id", { count:"exact", head:true }).eq("athlete_id", ath.id).gte("created_at", dayStart).lte("created_at", dayEnd),
      supabase.from("posts").select("id", { count:"exact", head:true }).eq("athlete_id", ath.id).eq("post_type","reel").gte("posted_at", dayStart).lte("posted_at", dayEnd),
      supabase.from("posts").select("id", { count:"exact", head:true }).eq("athlete_id", ath.id).eq("post_type","story").gte("posted_at", dayStart).lte("posted_at", dayEnd),
      supabase.from("clicks").select("id", { count:"exact", head:true }).eq("athlete_id", ath.id).gte("created_at", dayStart).lte("created_at", dayEnd),
    ]);

    let xpEarned = 0;
    for (const c of challenges) {
      let progress = 0;
      switch (c.type) {
        case "first_sale": case "daily_sales": progress = salesCnt.count || 0; break;
        case "reels":      progress = reelsCnt.count || 0; break;
        case "stories":    progress = storiesCnt.count || 0; break;
        case "clicks":     progress = clicksCnt.count || 0; break;
        case "social_share": progress = (reelsCnt.count||0) + (storiesCnt.count||0) > 0 ? 1 : 0; break;
      }
      const completed = progress >= c.target;

      // Upsert progress
      const { data: existing } = await supabase
        .from("challenge_progress")
        .select("*")
        .eq("challenge_id", c.id).eq("athlete_id", ath.id).maybeSingle();

      if (existing) {
        if (!existing.completed && completed) {
          xpEarned += c.xp_reward;
          await supabase.from("challenge_progress").update({
            progress, completed: true, completed_at: new Date().toISOString(),
          }).eq("id", existing.id);
          await supabase.from("activity").insert({
            athlete_id: ath.id, type: "challenge_done",
            title: `Izazov zavrsen: <b>${c.title}</b>`,
            meta: { xp: c.xp_reward, challenge_id: c.id },
          });
        } else {
          await supabase.from("challenge_progress").update({ progress }).eq("id", existing.id);
        }
      } else {
        if (completed) xpEarned += c.xp_reward;
        await supabase.from("challenge_progress").insert({
          challenge_id: c.id, athlete_id: ath.id, progress, completed,
          completed_at: completed ? new Date().toISOString() : null,
        });
      }
    }

    if (xpEarned > 0) {
      await supabase.from("athletes").update({ xp: ath.xp + xpEarned }).eq("id", ath.id);
    }
  }
}

// =====================================================================
async function sendStreakWarnings(today: string) {
  const cutoff = new Date(Date.now() - 24*3600*1000 - 4*3600*1000).toISOString().split("T")[0];

  const { data: atRisk } = await supabase
    .from("athletes")
    .select("id, full_name, email, current_streak, last_activity_date")
    .gte("current_streak", 3)
    .lte("last_activity_date", cutoff)
    .eq("is_active", true)
    .eq("banned", false);

  for (const a of atRisk || []) {
    // Web Push + Telegram (universal)
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        ath