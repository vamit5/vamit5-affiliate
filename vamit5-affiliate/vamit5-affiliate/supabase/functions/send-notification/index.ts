// =====================================================================
// SEND NOTIFICATION — universal multi-channel notifier
// Sends to: Web Push + Telegram + (optionally) Email
// Body: { athlete_id, type, title, body, url?, image?, channels? }
// =====================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "https://esm.sh/web-push@3.6.7";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:vamit5.team@gmail.com";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SITE_URL = Deno.env.get("SITE_URL") || "https://vamit5.app";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { athlete_id, type, title, body, url, image, channels } = await req.json();

    // Get athlete + preference + push subs
    const { data: athlete } = await supabase
      .from("athletes")
      .select("*, push_subscriptions(*)")
      .eq("id", athlete_id)
      .single();

    if (!athlete) return json({ error: "Athlete not found" }, 404);

    // Check athlete's preference per type
    const prefField = ({
      sale: "notify_sales",
      streak: "notify_streak",
      levelup: "notify_levelup",
      challenge: "notify_challenges",
      leaderboard: "notify_leaderboard",
    })[type];
    if (prefField && athlete[prefField] === false) {
      return json({ skipped: "user-preference" });
    }

    const wantedChannels = channels || ["push", "telegram"];
    const results: Record<string, any> = {};

    // 1. Web Push
    if (wantedChannels.includes("push") && athlete.push_subscriptions?.length) {
      const payload = JSON.stringify({
        title,
        body,
        url: url || `${SITE_URL}/dashboard.html`,
        image,
        tag: type,
        icon: "/icon-192.png",
      });

      const pushResults = await Promise.all(
        athlete.push_subscriptions.map(async (sub: any) => {
          try {
            await webpush.sendNotification({
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            }, payload);
            await supabase.from("push_subscriptions")
              .update({ last_used_at: new Date().toISOString() })
              .eq("id", sub.id);
            return { ok: true };
          } catch (err: any) {
            // Subscription expired or revoked — clean up
            if (err.statusCode === 404 || err.statusCode === 410) {
              await supabase.from("push_subscriptions").delete().eq("id", sub.id);
            }
            return { ok: false, error: err.message };
          }
        })
      );
      results.push = pushResults;
    }

    // 2. Telegram
    if (wantedChannels.includes("telegram") && athlete.telegram_chat_id && TELEGRAM_BOT_TOKEN) {
      const tgText = `*${title}*\n${body}` + (url ? `\n\n[Otvori dashboard](${url})` : "");
      try {
        const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: athlete.telegram_chat_id,
            text: tgText,
            parse_mode: "Markdown",
            disable_web_page_preview: true,
          }),
        });
        results.telegram = { ok: r.ok };
      } catch (err: any) {
        results.telegram = { ok: false, error: err.message };
      }
    }

    // 3. Email (only for important: levelup, payout)
    if (wantedChannels.includes("email") && RESEND_API_KEY && ["levelup","payout"].includes(type)) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "VAMIT-5 Athletes <athletes@vamit5.app>",
            to: athlete.email,
            subject: title,
            html: `<p>${body}</p><p><a href="${url || SITE_URL+'/dashboard.html'}">Otvori dashboard →</a></p>`,
          }),
        });
        results.email = { ok: true };
      } catch (err: any) {
        results.email = { ok: false, error: err.message };
      }
    }

    return json({ ok: true, results });

  } catch (err: any) {
    console.error(err);
    return json({ error: err.message }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
