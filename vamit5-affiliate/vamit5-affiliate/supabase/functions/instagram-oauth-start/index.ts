// =====================================================================
// INSTAGRAM OAUTH — START
// Redirects athlete to Facebook/Meta OAuth dialog
// User authorizes, gets bounced back to /instagram-oauth-callback
// =====================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const FB_APP_ID = Deno.env.get("FB_APP_ID")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/instagram-oauth-callback`;

serve((req) => {
  const url = new URL(req.url);
  const userId = url.searchParams.get("user_id");
  if (!userId) return new Response("Missing user_id", { status: 400 });

  // Required scopes for Instagram Graph API on Business/Creator accounts
  const scopes = [
    "instagram_basic",
    "instagram_manage_insights",
    "pages_show_list",
    "pages_read_engagement",
    "business_management",
  ].join(",");

  const authUrl = new URL("https://www.facebook.com/v19.0/dialog/oauth");
  authUrl.searchParams.set("client_id", FB_APP_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", userId); // pass athlete id through state

  return Response.redirect(authUrl.toString(), 302);
});
