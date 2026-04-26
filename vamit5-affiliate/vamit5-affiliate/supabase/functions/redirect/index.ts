// =====================================================================
// REFERRAL LINK REDIRECT
// URL formats:
//   /r/<username>            → defaults to first product (1mo)
//   /r/<username>?p=12mo     → uses slug
//   /r/<username>/12mo       → cleaner alternative
//
// Flow:
//   1) Logs the click in DB
//   2) Sets attribution cookie (90 days)
//   3) Redirects to existing Stripe Payment Link with:
//        ?client_reference_id=<encoded athlete+product+click>
//        ?prefilled_email=<if known>
//        ?utm_source=<channel>
//
// Money flow stays identical — same Stripe account, same Payment Links.
// Webhook reads client_reference_id to attribute commission.
// =====================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const SITE_URL = Deno.env.get("SITE_URL") || "https://vamit5.app";

serve(async (req) => {
  const url = new URL(req.url);
  // Path can be /r/<username> or /r/<username>/<slug>
  const parts = url.pathname.split("/").filter(Boolean);
  const rIdx = parts.indexOf("r");
  if (rIdx === -1) return Response.redirect(SITE_URL, 302);

  const username = parts[rIdx + 1];
  // Slug can come from path (parts[rIdx+2]) or query (?p=)
  const slug = parts[rIdx + 2] || url.searchParams.get("p") || null;

  if (!username) return Response.redirect(SITE_URL, 302);

  // 1. Find athlete by username
  const { data: athlete } = await supabase
    .from("athletes")
    .select("id, full_name, username, banned, is_active")
    .eq("username", username.toLowerCase())
    .maybeSingle();

  if (!athlete || athlete.banned || !athlete.is_active) {
    return Response.redirect(SITE_URL, 302);
  }

  // 2. Find product (by slug, or default to first one)
  let product;
  if (slug) {
    const { data } = await supabase
      .from("products")
      .select("*")
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle();
    product = data;
  }
  if (!product) {
    const { data } = await supabase
      .from("products")
      .select("*")
      .eq("is_active", true)
      .order("display_order")
      .limit(1)
      .single();
    product = data;
  }
  if (!product) return Response.redirect(SITE_URL, 302);

  // 3. Log click
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "0.0.0.0";
  const ua = req.headers.get("user-agent") || "";
  const referrer = req.headers.get("referer") || "";
  const utmSource = url.searchParams.get("utm_source") || guessSource(referrer);
  const utmCampaign = url.searchParams.get("utm_campaign");
  const cookieIdHeader = req.headers.get("cookie")?.match(/v5ref=([^;]+)/)?.[1];
  const cookieId = cookieIdHeader || crypto.randomUUID();
  const device = /mobile|android|iphone/i.test(ua) ? "mobile" : "desktop";

  const { data: click } = await supabase.from("clicks").insert({
    athlete_id: athlete.id,
    product_id: product.id,
    ip_address: ip,
    user_agent: ua,
    referrer,
    utm_source: utmSource,
    cookie_id: cookieId,
    device,
  }).select().single();

  // 4. Build redirect URL using EXISTING Payment Link + attribution
  // Format of client_reference_id: "ath_<athleteId>__prod_<productId>__clk_<clickId>"
  // Stripe accepts up to 200 chars, alphanumeric + hyphens + underscores
  const refId = `ath_${athlete.id.replace(/-/g,'')}__prod_${product.id.replace(/-/g,'')}__clk_${(click?.id || 'x').replace(/-/g,'')}`;

  const paymentUrl = new URL(product.stripe_payment_link);
  paymentUrl.searchParams.set("client_reference_id", refId);
  // Attach UTM as well so it surfaces in Stripe's metadata
  if (utmSource) paymentUrl.searchParams.set("utm_source", utmSource);
  if (utmCampaign) paymentUrl.searchParams.set("utm_campaign", utmCampaign);
  paymentUrl.sea