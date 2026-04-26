// =====================================================================
// STRIPE CONNECT EXPRESS ONBOARDING
// Creates a Connect account for athlete + returns onboarding URL
// =====================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  httpClient: Stripe.createFetchHttpClient(),
  apiVersion: "2024-06-20",
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const SITE_URL = Deno.env.get("SITE_URL") || "https://vamit5.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!auth) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

    // Verify user
    const { data: { user } } = await supabase.auth.getUser(auth);
    if (!user) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

    // Get athlete
    const { data: athlete } = await supabase.from("athletes").select("*").eq("id", user.id).single();
    if (!athlete) return new Response("Athlete not found", { status: 404, headers: corsHeaders });

    let accountId = athlete.stripe_connect_account_id;

    // Create Connect Express account if not exists
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: athlete.country || "RS",
        email: athlete.email,
        capabilities: {
          transfers: { requested: true },
        },
        business_type: "individual",
        business_profile: {
          mcc: "7299", // Other personal services
          product_description: "VAMIT-5 Athlete Affiliate Commission",
          url: SITE_URL,
        },
        metadata: {
          athlete_id: athlete.id,
          username: athlete.username,
        },
      });

      accountId = account.id;
      await supabase.from("athletes").update({ stripe_connect_account_id: accountId }).eq("id", athlete.id);
    }

    // Generate onboarding link
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${SITE_URL}/dashboard.html?stripe=refresh`,
      return_url: `${SITE_URL}/dashboard.html?stripe=success`,
      type: "account_onboarding",
    });

    return new Response(JSON.stringify({ url: link.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
