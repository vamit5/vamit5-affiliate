// =====================================================================
// APPROVE APPLICATION
// 1) Updates application status to 'approved'
// 2) Creates auth user (passwordless, sends magic link)
// 3) Creates athlete row
// 4) Sends welcome email via Resend
// =====================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const SITE_URL = Deno.env.get("SITE_URL") || "https://vamit5.app";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!auth) return json({ error: "Unauthorized" }, 401);

    const { data: { user } } = await supabase.auth.getUser(auth);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { data: admin } = await supabase.from("admins").select("id").eq("id", user.id).maybeSingle();
    if (!admin) return json({ error: "Not admin" }, 403);

    const { application_id, username } = await req.json();

    // Get application
    const { data: app } = await supabase.from("applications").select("*").eq("id", application_id).single();
    if (!app) return json({ error: "Application not found" }, 404);
    if (app.status === "approved") return json({ error: "Already approved" }, 400);

    // Create auth user (or get existing)
    let authUserId: string;
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existing = existingUsers?.users.find((u: any) => u.email === app.email);
    if (existing) {
      authUserId = existing.id;
    } else {
      const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
        email: app.email,
        email_confirm: true,
      });
      if (createErr || !newUser.user) throw createErr || new Error("User creation failed");
      authUserId = newUser.user.id;
    }

    // Ensure unique username
    let finalUsername = username || app.full_name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    let counter = 1;
    while (true) {
      const { data: exists } = await supabase.from("athletes").select("id").eq("username", finalUsername).maybeSingle();
      if (!exists) break;
      finalUsername = `${username}-${counter++}`;
    }

    // Create athlete row
    await supabase.from("athletes").insert({
      id: authUserId,
      email: app.email,
      full_name: app.full_name,
      username: finalUsername,
      phone: app.phone,
      country: app.country,
      instagram_username: app.instagram_handle,
      tier: "recruit",
      tier_started_at: new Date().toISOString(),
    });

    // Award welcome XP and badges
    await supabase.from("athletes").update({ xp: 100 }).eq("id", authUserId);
    const { data: badge } = await supabase.from("badges").select("id").eq("code", "first_recruit").single();
    if (badge) await supabase.from("athlete_badges").insert({ athlete_id: authUserId, badge_id: badge.id });

    // Update application
    await supabase.from("applications").update({
      status: "approved",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    }).eq("id", application_id);

    // Activity feed (welcome event)
    await supabase.from("activity").insert({
      athlete_id: authUserId,
      type: "levelup",
      title: `Dobrodosao u VAMIT-5 Athletes — <b>${app.full_name}</b> je u programu! 🎉`,
      meta: {},
    });

    // Generate magic link
    const { data: linkData } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: app.email,
      options: { redirectTo: `${SITE_URL}/dashboard.html` },
    });
    const magicLink = linkData.properties?.action_link;

    // Send welcome email via Resend
    if (RESEND_API_KEY && magicLink) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "VAMIT-5 Athletes <athletes@vamit5.app>",
          to: app.email,
          subject: "🎯 Odobren si — dobrodosao u VAMIT-5 Athletes",
          html: welcomeEmail(app.full_name, magicLink, finalUsername),
        }),
      });
    }

    return json({ success: true, athlete_id: authUserId, username: finalUsername, magic_link: magicLink });

  } catch (err) {
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

function welcomeEmail(name: string, link: string, username: string) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#05060a;color:#e9ecff;margin:0;padding:30px">
  <table align="center" style="max-width:560px;width:100%;background:#0f1220;border-radius:18px;padding:36px;border:1px solid rgba(0,240,255,0.2)">
    <tr><td>
      <div style="text-align:center;margin-bottom:24px">
        <div style="display:inline-block;width:48px;height:48px;border-radius:14px;background:linear-gradient(135deg,#00f0ff,#7a5bff,#ff3b9a);text-align:center;line-height:48px;color:#fff;font-weight:900;font-size:14px">V5</div>
      </div>
      <h1 style="font-size:28px;font-weight:900;letter-spacing:-0.02em;text-align:center;margin:0 0 14px;color:#fff">Odobren si, ${name}! 🎯</h1>
      <p style="text-align:center;color:#9aa0c4;font-size:15px;line-height:1.6;margin:0 0 30px">
        Postao si <b style="color:#a6ff3b">REGRUT ATHLETE</b> u VAMIT-5 programu. Tvoj username: <b style="color:#00f0ff">${username}</b>
      </p>
      <div style="text-align:center;margin:30px 0">
        <a href="${link}" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#00f0ff,#7a5bff);color:#0a0c14;text-decoration:none;border-radius:11px;font-weight:800;font-size:15px">
          Login → Tvoj Dashboard
        </a>
      </div>
      <p style="color:#626890;font-size:13px;text-align:center;margin:20px 0 0;line-height:1.5">
        Link je vazio 24h. Ako istekne, idi na <a href="${SITE_URL_PLACEHOLDER}/login.html" style="color:#00f0ff">login</a> i unesi email.
      </p>
      <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:30px 0" />
      <h3 style="color:#fff;font-size:16px;margin:0 0 12px">Sta sad?</h3>
      <ul style="color:#9aa0c4;font-size:13.5px;line-height:1.8;padding-left:20px;margin:0">
        <li>Login → poveži Instagram Business nalog</li>
        <li>Postavi Stripe Connect za auto isplate</li>
        <li>Kopiraj svoje 4 affiliate linka i pocni da postavljaš</li>
        <li>Dnevni izazovi krecu odmah — prvi XP danas</li>
      </ul>
      <p style="color:#626890;font-size:11.5px;text-align:center;margin-top:30px;line-height:1.5">
        VAMIT-5 Athletes · Napravljeno da pobedis<br>
        Pitanja? <a href="mailto:athletes@vamit5.app" style="color:#00f0ff">athletes@vamit5.app</a>
      </p>
    </td></tr>
  </table>
</body></html>`.replace(/SITE_URL_PLACEHOLDER/g, SITE_URL);
}
