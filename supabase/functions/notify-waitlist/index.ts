// deno-lint-ignore-file no-explicit-any
import webpush from 'npm:web-push@3.6.7';

import { jsonError, jsonResponse } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabaseAdmin.ts';

/**
 * notify-waitlist
 * ================
 * Phase 6, Part 2b of the Live Availability upgrade. The one piece of the
 * self-service waitlist (0029) that could not live in plain SQL: actually
 * delivering a Web Push message to a guest's browser the instant a table
 * they're waiting for opens up.
 *
 * How this gets called: a Supabase Database Webhook (configured once, by
 * hand, from the Dashboard -- see this project's own delivery notes for
 * why that one step is deliberately NOT in a migration) on INSERT/UPDATE of
 * `restaurant_availability_versions` (the Phase 3 heartbeat table, 0025)
 * POSTs the changed row here. This function does NOT decide who to notify
 * itself -- it delegates that entirely to claim_waitlist_matches_for_
 * restaurant() (0030), a SECURITY DEFINER SQL function that atomically
 * finds every 'waiting', push-subscribed entry whose exact desired slot is
 * now available and marks it 'notified' in the same statement (so two
 * near-simultaneous webhook deliveries for the same restaurant can never
 * double-push the same guest). This function's only job is: verify the
 * request is genuinely from our own webhook, call that function, and for
 * each match it returns, actually send the push.
 *
 * Auth: a Database Webhook has no user session at all (there is no guest,
 * no staff member, nobody to check is_restaurant_member against) -- so this
 * checks a shared secret header instead, the same "does this request prove
 * it's genuinely our own trigger, not a stranger POSTing to a guessable
 * public URL" concern stripe-webhook (0019) solves with an HMAC signature.
 * A plain shared secret is enough here (unlike Stripe, we control both
 * sides), but it is still REQUIRED -- without it, anyone who found this
 * URL could force-claim (and burn) real waitlist entries.
 *
 * HONESTY NOTE, same spirit as stripe-webhook's own header comment: the
 * claiming logic (claim_waitlist_matches_for_restaurant) is verified
 * against real local data (see 0030's migration comment and the RLS test
 * matrix run before this shipped). The actual web-push send below is NOT
 * something a migration or a SQL test script can verify -- it needs a real
 * deployed function, real VAPID keys, and a real browser subscription. That
 * end-to-end delivery must be checked by hand once this is deployed, not
 * assumed to work because the code looks right.
 */

interface DatabaseWebhookPayload {
  type?: string;
  table?: string;
  record?: { restaurant_id?: string };
}

interface WaitlistMatch {
  entry_id: string;
  push_subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  party_size: number;
  guest_name: string | null;
  slot_starts_at: string;
  slot_ends_at: string;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonError('Method not allowed.', 405);

  const expectedSecret = Deno.env.get('WAITLIST_WEBHOOK_SECRET');
  const providedSecret = req.headers.get('x-webhook-secret');
  if (!expectedSecret) {
    console.error('notify-waitlist: WAITLIST_WEBHOOK_SECRET is not set in the function environment.');
    return jsonError('Server misconfigured.', 500);
  }
  if (providedSecret !== expectedSecret) {
    return jsonError('Unauthorized.', 401);
  }

  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT');
  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    console.error('notify-waitlist: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT missing in the function environment.');
    return jsonError('Server misconfigured.', 500);
  }
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const body = (await req.json().catch(() => ({}))) as DatabaseWebhookPayload;
  const restaurantId = body.record?.restaurant_id;
  if (!restaurantId) {
    // Not necessarily an error -- a malformed or unrelated payload should
    // not make Supabase's webhook delivery retry forever. Log and 200.
    console.warn('notify-waitlist: payload had no record.restaurant_id, ignoring.', body);
    return jsonResponse({ claimed: 0, sent: 0, note: 'no restaurant_id in payload' });
  }

  const adminClient = createAdminClient();
  const { data: matches, error } = await adminClient.rpc('claim_waitlist_matches_for_restaurant', {
    p_restaurant_id: restaurantId,
  });
  if (error) {
    console.error('notify-waitlist: claim_waitlist_matches_for_restaurant failed', error);
    return jsonError('Failed to claim waitlist matches.', 500);
  }

  const claimed = (matches ?? []) as WaitlistMatch[];
  let sent = 0;
  let failed = 0;

  for (const match of claimed) {
    try {
      await webpush.sendNotification(
        match.push_subscription as any,
        JSON.stringify({
          title: 'A table just opened up!',
          body: match.guest_name
            ? `${match.guest_name}, a table for ${match.party_size} is now available for your requested time.`
            : `A table for ${match.party_size} is now available for your requested time.`,
          slotStartsAt: match.slot_starts_at,
          slotEndsAt: match.slot_ends_at,
        }),
      );
      sent += 1;
    } catch (pushErr) {
      // A dead/expired subscription (HTTP 404/410 from the push service) is
      // expected over time and NOT a reason to fail the whole request --
      // the entry is already marked 'notified' by the claim step (see this
      // function's header comment for the accepted, documented gap this
      // creates: that one guest simply never gets a real notification, but
      // staff still see the entry on the existing waitlist screen either
      // way). Every other guest in this same batch must still get theirs.
      failed += 1;
      console.error(`notify-waitlist: push send failed for entry ${match.entry_id}`, pushErr);
    }
  }

  return jsonResponse({ claimed: claimed.length, sent, failed });
});
