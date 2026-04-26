// =====================================================================
// TELEGRAM WEBHOOK
// Receives updates from Telegram. Handles:
//   /start <code>   → links the chat to athlete with that code
//   /unlink         → unlinks
//   /status         → shows current tier + stats
// =====================================================================
// Setup once after deploy:
//   curl -F "url=https://YOUR-PROJECT.supabase.co/functions/v1/telegram-webhook" \
//        https://api.telegram.org/bot<TOKEN>/setWebhook
// =====================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SITE_URL = Deno.env.get("SITE_URL") || "https://vamit5.app";

async function tgSend(chatId: string | number, text: string, opts: any = {}) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", ...opts }),
  });
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");

  try {
    const update = await req.json();
    const msg = update.message || update.edited_message;
    if (!msg) return new Response("ok");

    const chatId = msg.chat.id;
    const text = (msg.text || "").trim();
    const tgUsername = msg.from.username;

    // /start with optional code
    if (text.startsWith("/start")) {
      const code = text.split(" ")[1]?.trim();

      if (!code) {
        await tgSend(chatId,
          "🏆 *Dobrodosao u VAMIT-5 Athletes bot!*\n\n" +
          "Da povezes svoj atleta nalog, idi u dashboard:\n" +
          `${SITE_URL}/dashboard.html → Settings → "Connect Telegram"\n\n` +
          "Dobices kod, pa ga upiseš ovde kao `/start TVOJ-KOD`."
        );
        return new Response("ok");
      }

      // Find athlete by link code
      const { data: athlete } = await supabase
        .from("athletes")
        .select("id, full_name, tier, current_streak")
        .eq("telegram_link_code", code)
        .maybeSingle();

      if (!athlete) {
        await tgSend(chatId, "❌ Kod nije validan ili je istekao. Generiši novi u dashboard-u.");
        return new Response("ok");
      }

      // Link
      await supabase.from("athletes").update({
        telegram_chat_id: String(chatId),
        telegram_username: tgUsername,
        telegram_link_code: null, // single-use
      }).eq("id", athlete.id);

      const tierName = ({recruit:"REGRUT",pro:"PRO ATHLETE",commando:"COMMANDO",elite:"ELITE ATHLETE"})[athlete.tier];
      await tgSend(chatId,
        `✅ *Povezano sa @${athlete.full_name}!*\n\n` +
        `Tier: *${tierName}*\n` +
        `Streak: 🔥 ${athlete.current_streak} dana\n\n` +
        `Sad ces dobijati notifikacije ovde za:\n` +
        `💸 prodaje\n🔥 streak warning\n🏆 promocije\n⚡ izazove\n\n` +
        `Komande: /status /unlink`
      );
      return new Response("ok");
    }

    // /status
    if (text === "/status") {
      const { data: ath } = await supabase
        .from("athletes")
        .select("full_name, tier, xp, current_streak")
        .eq("telegram_chat_id", String(chatId))
        .maybeSingle();
      if (!ath) {
        await tgSend(chatId, "Nisi povezan. Koristi /start <kod> iz dashboard-a.");
        return new Response("ok");
      }
      const tn = ({recruit:"REGRUT",pro:"PRO",commando:"COMMANDO",elite:"ELITE"})[ath.tier];
      await tgSend(chatId,
        `*${ath.full_name}*\n` +
        `Tier: *${tn}*\n` +
        `XP: ${ath.xp.toLocaleString("sr-RS")}\n` +
        `Streak: 🔥 ${ath.current_streak}\n\n` +
        `Otvori dashboard: ${SITE_URL}/dashboard.html`
      );
      return new Response("ok");
    }

    // /unlink
    if (text === "/unlink") {
      await supabase.from("athletes").update({
        telegram_chat_id: null,
        telegram_username: null,
      }).eq("telegram_chat_id", String(chatId));
      await tgSend(chatId, "✅ Telegram nalog odvezan. Necu ti vise slati notifikacije.");
      return new Response("ok");
    }

    // Unknown command
    await tgSend(chatId, "Nepoznata komanda. Koristi /status, /unlink, ili /start <kod>");

  } catch (err) {
    console.error(err);
  }
  return new Response("ok");
});
