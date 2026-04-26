// =====================================================================
// GENERATE DAILY CHALLENGES
// Run: every day at 00:01 UTC via cron
// Picks 4-5 random challenges from a pool, customized by tier
// =====================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Challenge templates pool
const POOL = [
  { type: "first_sale",   title: "Prva prodaja dana",      description: "Zatvori barem 1 prodaju pre 14h",       target: 1,  xp: 250, emoji: "🎯" },
  { type: "daily_sales",  title: "3 prodaje danas",        description: "Zatvori 3 prodaje do 23:59",            target: 3,  xp: 500, emoji: "⚡" },
  { type: "daily_sales",  title: "5 prodaja danas",        description: "Razvali normu — +bonus na sutra",        target: 5,  xp: 1000, emoji: "🚀" },
  { type: "reels",        title: "Reel maraton",           description: "Postavi 3 Reel-a danas",                 target: 3,  xp: 600, emoji: "🎬" },
  { type: "stories",      title: "Story napad",            description: "Postavi 6 Story-ja danas",               target: 6,  xp: 400, emoji: "📸" },
  { type: "clicks",       title: "100 klikova",            description: "Dovedi 100 klikova preko tvog linka",    target: 100,xp: 350, emoji: "👀" },
  { type: "clicks",       title: "500 klikova",            description: "Veliki dan — 500 klikova",               target: 500,xp: 1500, emoji: "🌊" },
  { type: "social_share", title: "Cross-platform",         description: "Postavi sadrzaj na 2 razlicite mreze",  target: 2,  xp: 300, emoji: "📱" },
  { type: "first_sale",   title: "Rana ptica",             description: "Prva prodaja pre 11h ujutru",            target: 1,  xp: 400, emoji: "🌅" },
  { type: "first_sale",   title: "Nocna smena",            description: "Prodaja izmedju 22h i 02h",              target: 1,  xp: 350, emoji: "🌙" },
];

serve(async (_req) => {
  const today = new Date().toISOString().split("T")[0];

  // Check if we already generated for today
  const { count } = await supabase
    .from("challenges")
    .select("id", { count: "exact", head: true })
    .eq("challenge_date", today);

  if (count && count > 0) {
    return new Response(JSON.stringify({ message: "Already generated", count }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Pick 4-5 random + always include "first_sale" early bird
  const shuffled = [...POOL].sort(() => Math.random() - 0.5);
  const picked = [shuffled[0]]; // first_sale or whatever
  for (const c of shuffled) {
    if (picked.length >= 5) break;
    if (!picked.find(p => p.title === c.title)) picked.push(c);
  }

  const inserted = [];
  for (const c of picked) {
    const { data, error } = await supabase.from("challenges").insert({
      challenge_date: today,
      type: c.type,
      title: c.title,
      description: c.description,
      target: c.target,
      xp_reward: c.xp,
      emoji: c.emoji,
    }).select().single();
    if (data) inserted.push(data);
  }

  return new Response(JSON.stringify({ generated: inserted.length, challenges: inserted }), {
    headers: { "Content-Type": "application/json" },
  });
});
