// =====================================================================
// STRIPE WEBHOOK HANDLER
// Compatible with EXISTING Payment Links + client_reference_id attribution
//
// Listens for:
//   - checkout.session.completed   → new purchase
//   - invoice.paid                 → recurring renewal
//   - charge.refunded              → reverse commission
//
// Attribution:
//   1) Read session.client_reference_id (set by /r/<username> redirect)
//   2) Format: "ath_<id>__prod_<id>__clk_<id>" (UUIDs without dashes)
//   3) Decode → look up athlete + product + click → record sale
// =====================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  httpClient: Stripe.createFetchHttpClient(),
  apiVersion: "2024-06-20",
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

serve(async (req) => {
  const sig = req.headers.get("Stripe-Signature")!;
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body, sig, STRIPE_WEBHOOK_SECRET, undefined, cryptoProvider
    );
  } catch (err) {
    console.error("Webhook signature failed:", err.message);
    return new Response(`Bad signature: ${err.message}`, { status: 400 });
  }

  console.log("Event:", event.type);

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case "charge.refunded":
        await handleRefund(event.data.object as Stripe.Charge);
        break;
      default:
        console.log("Unhandled:", event.type);
    }
    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Handler error:", err);
    return new Response(`Error: ${err.message}`, { status: 500 });
  }
});

// =====================================================================
// PARSE client_reference_id
// Format: "ath_<athleteId>__prod_<productId>__clk_<clickId>"
// (UUIDs without dashes, since Stripe limits character set)
// =====================================================================
function parseRefId(refId: string | null): { athleteIdRaw: string; productIdRaw: string; clickIdRaw: string } | null {
  if (!refId) return null;
  const m = refId.match(/^ath_([0-9a-f]{32})__prod_([0-9a-f]{32})__clk_([0-9a-fx]{1,32})$/i);
  if (!m) return null;
  return { athleteIdRaw: m[1], productIdRaw: m[2], clickIdRaw: m[3] };
}

// Convert raw 32-char hex back to UUID with dashes
function unHex(raw: string): string {
  if (raw.length !== 32) return raw;
  return `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20,32)}`;
}

// =====================================================================
// HANDLE CHECKOUT COMPLETED
// =====================================================================
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const parsed = parseRefId(session.client_reference_id);
  if (!parsed) {
    console.log("No client_reference_id — direct sale (not attributed to athlete)");
    return;
  }

  const athleteId = unHex(parsed.athleteIdRaw);
  const productId = unHex(parsed.productIdRaw);
  const clickId = parsed.clickIdRaw === 'x' ? null : unHex(parsed.clickIdRaw);

  // Look up athlete & product
  const { data: athlete } = await supabase
    .from("athletes")
    .select("*")
    .eq("id", athleteId)
    .maybeSingle();

  if (!athlete || athlete.banned) {
    console.log("Athlete not found or banned — skipping");
    return;
  }

  const { data: product } = await supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .maybeSingle();

  if (!product) {
    console.log("Product not found — skipping");
    return;
  }

  // Calculate commission
  const grossCents = session.amount_total!;
  const netCents = Math.round(grossCents * 0.75); // ~75% after Stripe fee + VAT
  const commissionRate = commissionForTier(athlete.tier);
  const commissionCents = Math.round(netCents * commissionRate);

  const refundWindowEnds = new Date();
  refundWindowEnds.setDate(refundWindowEnds.getDate() + 14);

  // Insert sale (idempotent on stripe_session_id)
  const { data: existingSale } = await supabase
    .from("sales").select("id")
    .eq("stripe_session_id", session.id).maybeSingle();
  if (existingSale) {
    console.log("Sale already recorded:", session.id);
    return;
  }

  const { data: sale, error } = await supabase.from("sales").insert({
    athlete_id: athleteId,
    product_id: productId,
    click_id: clickId,
    stripe_session_id: session.id,
    stripe_invoice_id: session.invoice as string,
    stripe_customer_id: session.customer as string,
    gross_amount_cents: grossCents,
    net_amount_cents: netCents,
    commission_rate: commissionRate,
    commission_cents: commissionCents,
    status: "pending",
    refund_window_ends_at: refundWindowEnds.toISOString(),
    customer_email: session.customer_email || session.customer_details?.email,
    customer_country: session.customer_details?.address?.country,
  }).select().single();

  if (error) throw error;

  // Mark click as converted
  if (clickId) {
    await supabase.from("clicks").update({ converted: true }).eq("id", clickId);
  }

  // Activity feed
  await supabase.from("activity").insert({
    athlete_id: athleteId,
    type: "sale",
    title: `<b>${athlete.full_name}</b> <span>je zatvorio prodaju</span> <b>${product.name}</b>`,
    meta: { amount_cents: commissionCents, product_id: productId, sale_id: sale.id, customer_country: session.customer_details?.address?.country },
  });

  // Award XP (300 per sale base)
  const xpReward = 300 * Math.max(1, product.duration_months);
  await supabase.from("athletes").update({
    xp: athlete.xp + xpReward,
    last_activity_date: new Date().toISOString().split("T")[0],
  }).eq("id", athleteId);

  // Badge checks
  const { count } = await supabase
    .from("sales").select("id", { count: "exact", head: true }).eq("athlete_id", athleteId);
  if (count === 1) await unlockBadge(athleteId, "first_sale");
  if (count === 10) await unlockBadge(athleteId, "sales_10");
  if (count === 100) await unlockBadge(athleteId, "sales_100");
  if (count === 500) await unlockBadge(athleteId, "sales_500");

  // Country-diversity badge
  const { data: countries } = await supabase
    .from("sales").select("customer_country").eq("athlete_id", athleteId).not("customer_country","is",null);
  const uniqueCountries = new Set((countries||[]).map(c=>c.customer_country));
  if (uniqueCountries.size >= 3) await unlockBadge(athleteId, "three_countries");

  // Trigger promotion check (and capture if tier changed)
  const tierBefore = athlete.tier;
  await supabase.rpc("check_promotion", { p_athlete_id: athleteId });
  const { data: athAfter } = await supabase.from("athletes").select("tier").eq("id", athleteId).single();
  const promoted = athAfter && athAfter.tier !== tierBefore;

  // PUSH NOTIFICATION — sale
  await sendNotification(athleteId, "sale",
    `💸 +€${(commissionCents/100).toFixed(2)}`,
    `${product.name} · provizija pripisana. Kupac iz ${session.customer_details?.address?.country || 'inostranstva'}.`
  );

  // PUSH NOTIFICATION — promotion
  if (promoted) {
    const tierNames: any = { recruit:"REGRUT", pro:"PRO ATHLETE", commando:"COMMANDO", elite:"ELITE ATHLETE" };
    const newPct: any = { recruit:"35%", pro:"40%", commando:"45%", elite:"50%" };
    await sendNotification(athleteId, "levelup",
      `🏆 Promocija u ${tierNames[athAfter!.tier]}!`,
      `Odsad zaradjujes ${newPct[athAfter!.tier]} po svakoj prodaji. Idi dalje.`
    );
  }

  console.log(`✅ Attributed sale to @${athlete.username}: €${(commissionCents/100).toFixed(2)} (${product.name})`);
}

// Helper to call the send-notification function
async function sendNotification(athlete_id: string, type: string, title: string, body: string, url?: string) {
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ athlete_id, type, title, body, url }),
    });
  } catch (err) {
    console.error("Notification send failed:", err);
  }
}

// =====================================================================
// HANDLE INVOICE PAID — recurring (1-month subscription renewals)
// =====================================================================
async function handleInvoicePaid(invoice: Stripe.Invoice) {
  // Skip the FIRST invoice of a subscription — that's already covered by checkout.session.completed
  if (invoice.billing_reason === "subscription_create") return;

  // Find the original sale by customer_id
  const { data: originalSale } = await supabase
    .from("sales")
    .select("*, athletes(*), products(*)")
    .eq("stripe_customer_id", invoice.customer as string)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!originalSale) {
    console.log("No original sale — skipping (not an affiliate purchase)");
    return;
  }

  const grossCents = invoice.amount_paid;
  const netCents = Math.round(grossCents * 0.75);
  const commissionRate = originalSale.commission_rate; // lock-in original rate
  const commissionCents = Math.round(netCents * commissionRate);
