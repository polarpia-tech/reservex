// deno-lint-ignore-file no-explicit-any
import { jsonError, jsonResponse } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabaseAdmin.ts';
import { verifyStripeSignature } from '../../../packages/payments/src/stripeSignature.ts';

/**
 * stripe-webhook
 * ===============
 * Phase 12. The one place Stripe talks back to us -- keeps `payments` and
 * `subscriptions` in sync with what actually happened on Stripe's side
 * (a card can fail 3DS, a dispute can reverse a refund, a subscription can
 * lapse -- none of that is something our own Edge Functions decide, Stripe
 * tells us). Uses the SERVICE ROLE, like every write to payments/
 * subscriptions must (0011: no client-role write policy exists for either
 * table on purpose) -- and re-derives every row it touches from data
 * already in Stripe's event payload, never trusts anything else.
 *
 * Body handling is deliberate: `await req.text()` FIRST, before anything
 * else touches the request, and the signature is verified against that
 * EXACT raw text -- re-serializing parsed JSON would produce different
 * bytes and silently break every signature check. Only after verification
 * passes is the text JSON.parse()'d.
 *
 * HONESTY NOTE: same as every Stripe-calling function in this phase -- not
 * exercised against a live Stripe account. What scripts/verify_phase12_
 * payments_billing.mjs DOES verify is verifyStripeSignature() itself (see
 * that file's own header comment) and, in
 * scripts/verify_phase12_payments_billing.sql, that feeding this handler's
 * OWN state-transition logic a syntactically valid simulated event object
 * produces the right database state -- not that a real Stripe delivery
 * would reach this function correctly formed.
 */

const SUBSCRIPTION_STATUS_MAP: Record<string, string> = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  canceled: 'cancelled',
  paused: 'paused',
  // Stripe has a few more transient statuses (incomplete, incomplete_expired,
  // unpaid) with no clean equivalent in our 5-value enum -- folded into
  // past_due as the safe "something needs attention, not yet cancelled"
  // default rather than inventing new enum values for edge cases this
  // product doesn't act on differently yet.
};

function toIsoOrNull(unixSeconds: number | null | undefined): string | null {
  return typeof unixSeconds === 'number' ? new Date(unixSeconds * 1000).toISOString() : null;
}

async function handlePaymentIntentEvent(adminClient: any, eventType: string, paymentIntent: any) {
  const statusByEvent: Record<string, string> = {
    'payment_intent.amount_capturable_updated': 'requires_capture',
    'payment_intent.succeeded': 'succeeded',
    'payment_intent.canceled': 'cancelled',
  };

  if (eventType === 'payment_intent.payment_failed') {
    await adminClient
      .from('payments')
      .update({ status: 'failed', failure_reason: paymentIntent.last_payment_error?.message ?? 'unknown' })
      .eq('provider', 'stripe')
      .eq('provider_payment_id', paymentIntent.id);
    return;
  }

  const newStatus = statusByEvent[eventType];
  if (!newStatus) return;
  await adminClient.from('payments').update({ status: newStatus }).eq('provider', 'stripe').eq('provider_payment_id', paymentIntent.id);
}

async function handleChargeRefunded(adminClient: any, charge: any) {
  if (!charge.payment_intent) return;
  await adminClient.from('payments').update({ status: 'refunded' }).eq('provider', 'stripe').eq('provider_payment_id', charge.payment_intent);
}

async function upsertSubscriptionFromStripeObject(adminClient: any, subscription: any) {
  const organizationId = subscription.metadata?.organization_id;
  const planCode = subscription.metadata?.plan_code;
  if (!organizationId) {
    console.error('stripe-webhook: subscription event with no organization_id metadata -- cannot sync', subscription.id);
    return;
  }

  let planId: string | null = null;
  if (planCode) {
    const { data: plan } = await adminClient.from('subscription_plans').select('id').eq('code', planCode).maybeSingle();
    planId = plan?.id ?? null;
  }

  const status = SUBSCRIPTION_STATUS_MAP[subscription.status] ?? 'past_due';
  const patch: Record<string, any> = {
    status,
    provider_subscription_id: subscription.id,
    trial_ends_at: toIsoOrNull(subscription.trial_end),
    current_period_start: toIsoOrNull(subscription.current_period_start),
    current_period_end: toIsoOrNull(subscription.current_period_end),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
  };
  if (planId) patch.plan_id = planId;

  const { data: existing } = await adminClient
    .from('subscriptions')
    .select('id')
    .eq('provider_subscription_id', subscription.id)
    .maybeSingle();

  if (existing) {
    await adminClient.from('subscriptions').update(patch).eq('id', existing.id);
    return;
  }

  // No row yet for this Stripe subscription id -- this is the org's first
  // ever paid subscription (their trial row, if any, was created directly
  // by bootstrap-restaurant with no provider_subscription_id at all). Only
  // one non-terminal subscription per org is allowed (uidx_subscriptions_
  // active_per_org, 0007) -- retire any existing trial/active row first.
  await adminClient
    .from('subscriptions')
    .update({ status: 'cancelled' })
    .eq('organization_id', organizationId)
    .in('status', ['trialing', 'active', 'past_due']);

  if (!planId) {
    console.error('stripe-webhook: cannot create subscription row without a resolvable plan_id', subscription.id);
    return;
  }
  await adminClient.from('subscriptions').insert({ organization_id: organizationId, plan_id: planId, ...patch });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!webhookSecret) {
    console.error('stripe-webhook: STRIPE_WEBHOOK_SECRET is not configured -- refusing to process anything unverified.');
    return jsonError('Not configured.', 500);
  }

  const rawBody = await req.text();
  const signatureHeader = req.headers.get('Stripe-Signature');
  const verification = await verifyStripeSignature(rawBody, signatureHeader, webhookSecret);
  if (!verification.valid) {
    console.error('stripe-webhook: signature verification failed', verification.reason);
    return jsonError('Invalid signature.', 400);
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonError('Malformed JSON.', 400);
  }

  const adminClient = createAdminClient();

  try {
    switch (event.type) {
      case 'payment_intent.amount_capturable_updated':
      case 'payment_intent.succeeded':
      case 'payment_intent.canceled':
      case 'payment_intent.payment_failed':
        await handlePaymentIntentEvent(adminClient, event.type, event.data.object);
        break;
      case 'charge.refunded':
        await handleChargeRefunded(adminClient, event.data.object);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await upsertSubscriptionFromStripeObject(adminClient, event.data.object);
        break;
      default:
        // Unhandled event types are acknowledged, not errored -- Stripe
        // retries on non-2xx, and we deliberately subscribe to a broader
        // event set than we act on today rather than maintaining an
        // exact allowlist in the Stripe dashboard.
        break;
    }
  } catch (err) {
    console.error('stripe-webhook: handler error', event.type, err);
    return jsonError('Handler error.', 500);
  }

  return jsonResponse({ received: true });
});
