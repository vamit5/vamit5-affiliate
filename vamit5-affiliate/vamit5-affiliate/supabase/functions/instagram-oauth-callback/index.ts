// =====================================================================
// INSTAGRAM OAUTH — CALLBACK
// 1) Exchange code for short-lived token
// 2) Exchange short for long-lived (60-day)
// 3) Get user's Facebook pages
// 4) Find IG Business account linked to a page
// 5) Save IG user_id, username, access_token to athlete row
// =====================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const FB_APP_ID = Deno.env.get("FB_APP_ID")!;
const FB_APP_SECRET = Deno.env.get("FB_APP_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SITE_URL = Deno.env.get("SITE_URL") || "https://vamit5.app";
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/instagram-oauth-callback`;

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // athlete id

  if (!code || !state) {
    return Response.redirect(`${SITE_URL}/dashboard.html?ig=error`, 302);
  }

  try {
    // 1. Short-lived token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?` + new URLSearchParams({
        client_id: FB_APP_ID,
        client_secret: FB_APP_SECRET,
        redirect_uri: REDIRECT_URI,
        code,
      })
    );
    const { access_token: shortToken } = await tokenRes.json();
    if (!shortToken) throw new Error("No short token");

    // 2. Long-lived token (60 days)
    const longRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?` + new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: FB_APP_ID,
        client_secret: FB_APP_SECRET,
        fb_exchange_token: shortToken,
      })
    );
    const { access_token: longToken, expires_in } = await longRes.json();
    if (!longToken) throw new Error("No long token");

    // 3. Get user's pages
    const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${longToken}`);
    const { data: pages } = await pagesRes.json();
    if (!pages?.length) throw new Error("No FB pages found");

    // 4. For each page, check for linked IG Business
    let igUser: { id: string; username: string; pageToken: string } | null = null;
    for (const page of pages) {
      const igRes = await fetch(
        `https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account{id,username}&access_token=${page.access_token}`
      );
      const igData = await igRes.json();
      if (igData.instagram_business_account) {
        igUser = {
          id: igData.instagram_business_account.id,
          username: igData.instagram_business_account.username,
          pageToken: page.access_token, // page tokens are long-lived if user token is
        };
        break;
      }
    }
    if (!igUser) throw new Error("No Instagram Business account linked");

    // 5. Save to athlete
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + (expires_in || 60 * 24 * 3600));

    await supabase.from("athletes").update({
      instagram_user_id: igUser.id,
      instagram_username: igUser.username,
      instagram_access_token: igUser.pageToken,
      instagram_token_expires_at: expiresAt.toISOString(),
      instagram_connected_at: new Date().toISOString(),
    }).eq("id", state);

    // Activity feed
    await supabase.from("activity").insert({
      athlete_id: state,
      type: "badge",
      title: `📷 Instagram <b>@${igUser.username}</b> povezan — auto tracking aktivan!`,
      meta: { ig_username: igUser.username },
    });

    return Response.redirect(`${SITE_URL}/dashboard.html?ig=success`, 302);

  } catch (err) {
    console.error("IG OAuth error:", err);
    return Response.redirect(`${SITE_URL}/dashboard.html?ig=error&msg=${encodeURIComponent(err.message)}`, 302);
  }
});
