// deno-lint-ignore-file no-explicit-any
import { handleCors, jsonError, jsonResponse } from '../_shared/cors.ts';
import { AuthError, createAdminClient, createCallerClient, getAuthenticatedUser } from '../_shared/supabaseAdmin.ts';
import { getStripeClient } from '../_shared/stripe.ts';

/**
 * refund-deposit
 * ===============
 * Phase 12. Resolves the money side of an ALREADY-cancelled reservation
 * (this function never changes reservations.status itself -- single
 * responsibility, same split as capture-noshow-deposit). Called either by
 * staff, or by the reservation's own signed-in customer right after they
 * self-cancel via the existing reservations_customer_cancel RLS policy
 * (Phase 08) -- a guest reservation has no self-service cancellation at
 * all, so this function has no anonymous path (unlike create-deposit-
 * payment-intent).
 *
 * Business rule, straight from the blueprint's own example ("ακύρωση έως
 * 24 ώρες πριν χωρίς χρέωση" -- cancel up to 24h before, no charge):
 * evaluate_reservation_cancellation_refund() (0019) says whether NOW, using
 * the window FROZEN on the payment at creation time, is inside or outside
 * that policy's window.
 *   - refund_eligible = true  (cancelled early enough): release the money.
 *     requires_capture -> cancelPaymentIntent (void; the guest is never
 *     charged at all). succeeded -> createRefund (money is given back).
 *   - refund_eligible = false (cancelled too late): the deposit becomes the
 *     cancellation fee. requires_capture -> capturePaymentIntent (charge it
 *     NOW, this is the moment it stops being a hold and becomes real money
 *     taken). succeeded -> already captured, nothing to do.
 */

interface RequestBody {
  reservationId?: string;
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  try {
    const user = await getAuthenticatedUser(req);
    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const reservationId = body.reservationId?.trim();
    if (!reservationId) return jsonError('reservationId is required.', 400);

    const adminClient = createAdminClient();
    const callerClient = createCallerClient(req);

    const { data: reservation, error: reservationError } = await adminClient
      .from('reservations')
      .select('id, restaurant_id, customer_id, status')
      .eq('id', reservationId)
      .maybeSingle();
    if (reservationError) throw reservationError;
    if (!reservation) return jsonError('Reservation not found.', 404);

    let authorized = false;
    if (reservation.customer_id) {
      const { data: ownsCustomer } = await callerClient.rpc('owns_customer', { target_customer_id: reservation.customer_id });
      authorized = Boolean(ownsCustomer);
    }
    if (!authorized) {
      const { data: isMember } = await callerClient.rpc('is_restaurant_member', { target_restaurant_id: reservation.restaurant_id });
      authorized = Boolean(isMember);
    }
    if (!authorized) return jsonError('Not authorized for this reservation.', 403);

    if (reservation.status !== 'cancelled') {
      return jsonError('This reservation is not cancelled. Cancel it first.', 409);
    }

    const { data: evaluations, error: evalError } = await adminClient.rpc('evaluate_reservation_cancellation_refund', {
      p_reservation_id: reservationId,
    });
    if (evalError) throw evalError;
    if (!evaluations || evaluations.length === 0) {
      return jsonResponse({ results: [], message: 'No capturable or captured deposit on this reservation.' });
    }

    const stripe = getStripeClient();
    const results: Array<Record<string, any>> = [];

    for (const evaluation of evaluations as any[]) {
      const { data: payment } = await adminClient
        .from('payments')
        .select('id, provider_payment_id, status')
        .eq('id', evaluation.payment_id)
        .single();
      if (!payment) continue;

      let newStatus: string;
      if (evaluation.refund_eligible) {
        if (payment.status === 'requires_capture') {
          await stripe.cancelPaymentIntent(payment.provider_payment_id as string);
          newStatus = 'cancelled';
        } else {
          await stripe.createRefund(payment.provider_payment_id as string);
          newStatus = 'refunded';
        }
      } else {
        if (payment.status === 'requires_capture') {
          await stripe.capturePaymentIntent(payment.provider_payment_id as string);
          newStatus = 'succeeded';
        } else {
          newStatus = payment.status; // already succeeded -- nothing further to do
        }
      }

      await adminClient.from('payments').update({ status: newStatus }).eq('id', payment.id);
      results.push({ paymentId: payment.id, refundEligible: evaluation.refund_eligible, newStatus });
    }

    return jsonResponse({ results, resolvedBy: user.id });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, 401);
    console.error('refund-deposit error', err);
    return jsonError('Internal error.', 500);
  }
});
