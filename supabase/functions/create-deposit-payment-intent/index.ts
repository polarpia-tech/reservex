// deno-lint-ignore-file no-explicit-any
import { handleCors, jsonError, jsonResponse } from '../_shared/cors.ts';
import { AuthError, createAdminClient, createCallerClient, tryGetAuthenticatedUser } from '../_shared/supabaseAdmin.ts';
import { getStripeClient } from '../_shared/stripe.ts';

/**
 * create-deposit-payment-intent
 * ==============================
 * Phase 12. Creates the manual-capture Stripe PaymentIntent for a
 * reservation's required deposit, if any, and returns its client_secret so
 * the browser/app can complete card entry with Stripe Elements/PaymentSheet
 * -- we never see card data ourselves (blueprint, Part 05).
 *
 * Why this serves BOTH signed-in staff AND a fully anonymous guest, unlike
 * every earlier payments-adjacent function: a guest reservation (Phase 08)
 * has no RLS identity at all, and per that phase's own design constraint, a
 * guest cannot come back later and authenticate as "the owner of
 * reservation X" -- so the deposit MUST be collected synchronously, in the
 * same round trip as booking, using nothing but the reservation id the
 * booking call just returned. tryGetAuthenticatedUser() (added this phase)
 * resolves whoever is calling without throwing when there is no session at
 * all, and the authorization rule below is deliberately narrow about what
 * an anonymous caller may do with that.
 *
 * Authorization:
 *  - signed-in staff: must be is_restaurant_member(restaurantId).
 *  - signed-in customer: must own the reservation (customer_id matches).
 *  - anonymous: allowed ONLY if the reservation has NO customer_id at all
 *    (a genuine guest booking) -- an anonymous caller can never touch a
 *    reservation that belongs to a signed-in customer or was staff-created.
 * The amount is ALWAYS recomputed here via compute_deposit_amount() -- a
 * client-supplied amount is never trusted, for any caller.
 * Idempotency: refuses if a payment already exists for this reservation
 * (one deposit attempt per reservation), so retrying a flaky network
 * request can never create two competing holds on a guest's card.
 *
 * HONESTY NOTE: like every Stripe-calling function in this phase, this has
 * not been exercised against a live Stripe account (no network, no
 * STRIPE_SECRET_KEY in this sandbox).
 */

interface RequestBody {
  reservationId?: string;
  restaurantId?: string;
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  try {
    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const reservationId = body.reservationId?.trim();
    const restaurantId = body.restaurantId?.trim();
    if (!reservationId || !restaurantId) return jsonError('reservationId and restaurantId are required.', 400);

    const adminClient = createAdminClient();

    const { data: reservation, error: reservationError } = await adminClient
      .from('reservations')
      .select('id, restaurant_id, customer_id, party_size, event_id')
      .eq('id', reservationId)
      .eq('restaurant_id', restaurantId)
      .maybeSingle();
    if (reservationError) throw reservationError;
    if (!reservation) return jsonError('Reservation not found.', 404);

    // --- Authentication + Authorization ---
    const user = await tryGetAuthenticatedUser(req);
    if (user) {
      const callerClient = createCallerClient(req);
      let authorized = false;
      if (reservation.customer_id) {
        const { data: ownsCustomer } = await callerClient.rpc('owns_customer', { target_customer_id: reservation.customer_id });
        authorized = Boolean(ownsCustomer);
      }
      if (!authorized) {
        const { data: isMember } = await callerClient.rpc('is_restaurant_member', { target_restaurant_id: restaurantId });
        authorized = Boolean(isMember);
      }
      if (!authorized) return jsonError('Not authorized for this reservation.', 403);
    } else if (reservation.customer_id) {
      // Anonymous caller, but this reservation belongs to a signed-in
      // customer or was staff-created -- refuse.
      return jsonError('Authentication required for this reservation.', 401);
    }

    // --- Idempotency: at most one payment per reservation ---
    const { data: existingPayment } = await adminClient
      .from('payments')
      .select('id')
      .eq('reservation_id', reservationId)
      .maybeSingle();
    if (existingPayment) return jsonError('A payment already exists for this reservation.', 409);

    // --- Business rules: is a deposit even required, and how much? ---
    // (restaurants has no `currency` column -- see this file's own comment
    // further down on the deliberate EUR-only assumption for this phase.)
    const { data: restaurant } = await adminClient.from('restaurants').select('id').eq('id', restaurantId).maybeSingle();
    if (!restaurant) return jsonError('Restaurant not found.', 404);

    let isVip = false;
    if (reservation.customer_id) {
      const { data: rc } = await adminClient
        .from('restaurant_customers')
        .select('is_vip')
        .eq('restaurant_id', restaurantId)
        .eq('customer_id', reservation.customer_id)
        .maybeSingle();
      isVip = Boolean(rc?.is_vip);
    }

    const { data: depositRows, error: depositError } = await adminClient.rpc('compute_deposit_amount', {
      p_restaurant_id: restaurantId,
      p_party_size: reservation.party_size,
      p_is_vip: isVip,
      p_event_id: reservation.event_id,
    });
    if (depositError) throw depositError;
    const deposit = Array.isArray(depositRows) ? depositRows[0] : depositRows;
    if (!deposit || !deposit.policy_id || !deposit.amount_cents || deposit.amount_cents <= 0) {
      return jsonError('No deposit is required for this reservation.', 400);
    }

    const { data: policy } = await adminClient
      .from('deposit_policies')
      .select('cancellation_window_hours')
      .eq('id', deposit.policy_id)
      .single();

    // --- DB operation + external call ---
    const stripe = getStripeClient();
    const intent = await stripe.createPaymentIntent({
      amountCents: deposit.amount_cents,
      currency: 'eur', // EUR-only for the Germany/Greece launch (blueprint scope) -- see README's Phase 12 note.
      metadata: { reservation_id: reservationId, restaurant_id: restaurantId, deposit_policy_id: deposit.policy_id },
    });

    const { data: payment, error: paymentError } = await adminClient
      .from('payments')
      .insert({
        restaurant_id: restaurantId,
        reservation_id: reservationId,
        customer_id: reservation.customer_id,
        provider: 'stripe',
        provider_payment_id: intent.id,
        payment_type: 'deposit',
        status: 'requires_action',
        amount_cents: deposit.amount_cents,
        currency: 'EUR',
        deposit_policy_id: deposit.policy_id,
        cancellation_window_hours_snapshot: (policy as any)?.cancellation_window_hours ?? 24,
      })
      .select('id')
      .single();
    if (paymentError) throw paymentError;

    return jsonResponse({ paymentId: payment.id, clientSecret: intent.client_secret, amountCents: deposit.amount_cents, currency: 'EUR' });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, 401);
    console.error('create-deposit-payment-intent error', err);
    return jsonError('Internal error.', 500);
  }
});
