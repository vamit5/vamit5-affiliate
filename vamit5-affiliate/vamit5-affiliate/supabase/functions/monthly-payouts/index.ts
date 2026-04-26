// =====================================================================
// MONTHLY PAYOUT JOB
// Run: 20th of every month at 09:00 UTC (cron via pg_cron or external scheduler)
// 1) Confirm sales whose 14d refund window has ended → status='confirmed'
// 2) For each athlete with confirmed sales not yet paid: create payout
// 3) Trigger Stripe Connect transfer
// 4) Mark sales as paid
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

const MIN_PAYOUT_CENTS = 5000; // €50 minimum

serve(async (_req) => {
  try {
    // 1. Confirm sales (refund window passed, no refund yet)
    await supabase
      .from("sales")
      .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
      .eq("status", "pending")
      .lt("refund_window_ends_at", new Date().toISOString());

    // 2. Group confirmed-but-not-paid sales by athlete
    const { data: pendingSales, error } = await supabase
      .from("sales")
      .select("athlete_id, commission_cents, id")
      .eq("status", "confirmed")
      .is("payout_id", null);

    if (error) throw error;

    const grouped = new Map<string, { total: number; ids: string[]; count: number }>();
    (pendingSales || []).forEach((s) => {
      const g = grouped.get(s.athlete_id) || { total: 0, ids: [], count: 0 };
      g.total += s.commission_cents;
      g.ids.push(s.id);
      g.count += 1;
      grouped.set(s.athlete_id, g);
    });

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split("T")[0];
    const periodEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split("T")[0];

    let processed = 0;
    let totalPaid = 0;

    for (const [athleteId, info] of grouped.entries()) {
      if (info.total < MIN_PAYOUT_CENTS) continue;

      const { data: athlete } = await supabase
        .from("athletes")
        .select("*")
        .eq("id", athleteId)
        .single();

      if (!athlete?.stripe_connect_account_id || !athlete.stripe_connect_onboarded) {
        console.log(`Skipping ${athlete?.username || athleteId}: Stripe Connect not setup`);
        continue;
      }

      // Create payout record
      const { data: payout, error: pErr } = await supabase.from("payouts").insert({
        athlete_id: athleteId,
        period_start: periodStart,
        period_end: periodEnd,
        total_cents: info.total,
        sales_count: info.count,
        status: "processing",
      }).select().single();

      if (pErr || !payout) { console.error("Payout insert failed", pErr); continue; }

      // Trigger Stripe Connect transfer
      try {
        const transfer = await stripe.transfers.create({
          amount: info.total,
          currency: "eur",
          destination: athlete.stripe_connect_account_id,
          description: `VAMIT-5 commission ${periodStart} → ${periodEnd}`,
          metadata: {
            athlete_id: athleteId,
            payout_id: payout.id,
            sales_count: String(info.count),
          },
        });

        await supabase.from("payouts").update({
          status: "paid",
          stripe_transfer_id: transfer.id,
          paid_at: new Date().toISOString(),
        }).eq("id", payout.id);

        // Link sales to payout
        await supabase.from("sales").update({ payout_id: payout.id }).in("id", info.ids);

        await supabase.from("activity").insert({
          athlete_id: athleteId,
          type: "sale",
          title: `Isplata zavrsena · €${(info.total/100).toFixed(2)} (${info.count} prodaja)`,
          meta: { amount_cents: info.total, payout_id: payout.id },
        });

        // Push + Telegram + Email notifikacija
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-notification`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            athlete_id: athleteId,
            type: "payout",
            title: `💰 Isplata: €${(info.total/100).toFixed(2)}`,
            body: `${info.count} prodaja iz proslog meseca. Pare na tvoj racun u 1-3 radna dana.`,
            channels: ["push","te