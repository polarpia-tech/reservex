// deno-lint-ignore-file no-explicit-any
import { handleCors, jsonError, jsonResponse } from '../_shared/cors.ts';
import { AuthError, createAdminClient, createCallerClient, getAuthenticatedUser } from '../_shared/supabaseAdmin.ts';
import { getStripeClient } from '../_shared/stripe.ts';

/**
 * capture-noshow-deposit
 * =======================
 * Phase 12. Staff-only, and deliberately a SEPARATE, explicit action from
 * marking a reservation no_show -- capturing a guest's held deposit is
 * real money changing hands, and the blueprint's "AI must not act
 * destructively without confirmation" principle applies just as much to a
 * PLAIN STAFF ACTION here: no-show is set first (ordinary RLS-protected
 * UPDATE, Phase 07), and only if staff THEN chooses to, do they call this
 * to actually charge the held card. Nothing captures automatically.
 *
 * Authorization: is_restaurant_member(restaurantId) via the caller's own
 * RLS-scoped client -- capturing money is sensitive enough that ANY active
 * staff member being allowed (not owner/manager-only) matches how "mark
 * no-show" itself already works (reservations_staff_write, Phase 07): the
 * host who actually saw the empty table is usually the one who marks it.
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
      .select('id, restaurant_id, status')
      .eq('id', reservationId)
      .maybeSingle();
    if (reservationError) throw reservationError;
    if (!reservation) return jsonError('Reservation not found.', 404);

    const { data: isMember } = await callerClient.rpc('is_restaurant_member', { target_restaurant_id: reservation.restaurant_id });
    if (!isMember) return jsonError('Not a member of this restaurant.', 403);

    if (reservation.status !== 'no_show') {
      return jsonError('This reservation is not marked as a no-show. Mark it as no-show first.', 409);
    }

    const { data: payment, error: paymentError } = await adminClient
      .from('payments')
      .select('id, provider_payment_id, status')
      .eq('reservation_id', reservationId)
      .eq('payment_type', 'deposit')
      .maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment) return jsonError('There is no deposit on this reservation to capture.', 404);
    if (payment.status !== 'requires_capture') {
      return jsonError(`This deposit is ${payment.status}, not capturable.`, 409);
    }

    const stripe = getStripeClient();
    const captured = await stripe.capturePaymentIntent(payment.provider_payment_id as string);

    const { error: updateError } = await adminClient
      .from('payments')
      .update({ status: 'succeeded' })
      .eq('id', payment.id);
    if (updateError) throw updateError;

    return jsonResponse({ paymentId: payment.id, status: captured.status, capturedBy: user.id });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, 401);
    console.error('capture-noshow-deposit error', err);
    return jsonError('Internal error.', 500);
  }
});
