// =====================================================================
// INSTAGRAM SYNC — runs daily via cron (e.g. 03:00 UTC)
// For each athlete with IG connected:
//   - Fetch new media (Reels, Posts, Stories) since last sync
//   - Insert into posts table
//   - Update streak if new posts found
// =====================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serve(async (_req) => {
  const { data: athletes } = await supabase
    .from("athletes")
    .select("id, instagram_user_id, instagram_access_token, current_streak, longest_streak, last_activity_date")
    .not("instagram_user_id", "is", null)
    .eq("is_active", true)
    .eq("banned", false);

  let totalSynced = 0;
  let totalNewPosts = 0;

  for (const ath of athletes || []) {
    try {
      const result = await syncAthlete(ath);
      totalSynced++;
      totalNewPosts += result.newPosts;
    } catch (err) {
      console.error(`Sync failed for ${ath.id}:`, err.message);
    }
  }

  return new Response(JSON.stringify({
    syncedAthletes: totalSynced,
    newPosts: totalNewPosts,
  }), { headers: { "Content-Type": "application/json" } });
});

async function syncAthlete(ath: any): Promise<{ newPosts: number }> {
  const igUserId = ath.instagram_user_id;
  const token = ath.instagram_access_token;

  // 1. Fetch recent media
  const mediaUrl = `https://graph.facebook.com/v19.0/${igUserId}/media?` + new URLSearchParams({
    fields: "id,media_type,media_product_type,permalink,thumbnail_url,timestamp,caption,like_count,comments_count",
    limit: "50",
    access_token: token,
  });
  const mediaRes = await fetch(mediaUrl);
  const mediaJson = await mediaRes.json();

  if (mediaJson.error) throw new Error(`IG API error: ${mediaJson.error.message}`);

  const media = mediaJson.data || [];
  let newPosts = 0;

  for (const m of media) {
    // Determine post_type: REELS / FEED / STORY
    let postType = "post";
    if (m.media_product_type === "REELS") postType = "reel";
    else if (m.media_product_type === "STORY") postType = "story";

    const { error } = await supabase.from("posts").insert({
      athlete_id: ath.id,
      ig_post_id: m.id,
      post_type: postType,
      permalink: m.permalink,
      thumbnail_url: m.thumbnail_url,
      caption: m.caption,
      posted_at: m.timestamp,
      like_count: m.like_count,
      comment_count: m.comments_count,
      is_manual: false,
    });
    // Ignore unique constraint violations (already synced)
    if (!error) newPosts++;
  }

  // 2. Fetch stories (separate endpoint, only available 24h)
  const storiesUrl = `https://graph.facebook.com/v19.0/${igUserId}/stories?` + new URLSearchParams({
    fields: "id,media_type,permalink,thumbnail_url,timestamp",
    access_token: token,
  });
  const storiesRes = await fetch(storiesUrl);
  const storiesJson = await storiesRes.json();
  const stories = storiesJson.data || [];

  for (const s of stories) {
    const { error } = await supabase.from("posts").insert({
      athlete_id: ath.id,
      ig_post_id: s.id,
      post_type: "story",
      permalink: s.permalink,
      thumbnail_url: s.thumbnail_url,
      posted_at: s.timestamp,
      is_manual: false,
    });
    if (!error) newPosts++;
  }

  // 3. Update streak
  await updateStreak(ath, newPosts > 0);

  // 4. Trigger promotion check (criteria might now be met)
  if (newPosts > 0) {
    await supabase.rpc("check_promotion", { p_athlete_id: ath.id });
  }

  return { newPosts };
}

async function updateStreak(ath: any, hadActivityToday: boolean) {
  const today = new Date().toISOString().split("T")[0];
  if (ath.last_activity_date === today && !hadActivityToday) return;

  const last = ath.last_activity_date ? new Date(ath.last_activity_date) : null;
  const todayD = new Date(today);
  let newStreak = ath.current_streak;

  if (hadActivityToday) {
    if (!last) {
      newStreak = 1;
    } else {
      const daysDiff = Math.round((todayD.getTime() - last.getTime()) / (1000*60*60*24));
      if (daysDiff === 0) {
        // already counted today
      } else if (daysDiff === 1) {
        newStreak = ath.current_streak + 1;
      } else {
        newStreak = 1; // gap broke streak
      }
    }
    await supabase.from("athletes").update({
      current_streak: newStreak,
      longest_streak: Math.max(ath.longest_streak, newStreak),
      last_activity_date: today,
    }).eq("id", ath.id);

    // Check streak badges
    if (newStreak === 7) await unlockBadge(ath.id, "streak_7");
    if (newStreak === 14) await unlockBadge(ath.id, "streak_14");
    if (newStreak === 30) await unlockBadge(ath.id, "streak_30");
    if (newStreak === 100) await unlockBadge(ath.id, "streak_100");
  } else {
    // Check if streak should be broken (>1 day gap)
    if (last) {
      const daysDiff = Math.round((todayD.getTime() - last.getTime()) / (1000*60*60*24));
      if (daysDiff > 1 && ath.current_streak > 0) {
        await supabase.from("athletes").update({ current_streak: 0 }).eq("id", ath.id);
      }
    }
  }
}

async function unlockBadge(athleteId: string, code: string) {
  const { data: badge } = await supabase.from("badges").select("id, name, xp_reward").eq("code", code).single();
  if (!badge) return;
  const { error } = await supabase.from("athlete_badges").insert({ athlete_id: athleteId, badge_id: badge.id });
  if (error?.code === "23505") return;
  const { data: ath } = await supabase.from("athletes").select("xp").eq("id", athleteId).single();
  if (ath) await supabase.from("athletes").update({ xp: ath.xp + badge.xp_reward }).eq("id", athleteId);
  await supabase.from("activity").insert({
    athlete_id: athleteId,
    type: "badge",
    title: `Otkljucan bedz: <b>${badge.name}</b>`,
    meta: { badge_code: code, xp: badge.xp_reward },
  });
}
