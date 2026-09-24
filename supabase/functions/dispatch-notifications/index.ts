// deno-lint-ignore-file no-explicit-any
import webpush from 'npm:web-push@3.6.7';

import { handleCors, jsonError, jsonResponse } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabaseAdmin.ts';
import { normalizeLocale, renderEmail, renderPush, renderSms, type ReservationNotificationPayload } from '../_shared/notificationTemplates.ts';

/**
 * Phase 24: lazily configures web-push with this project's VAPID keys (the
 * SAME keypair notify-waitlist already uses -- one VAPID identity per
 * project, shared across every Edge Function that sends Web Push) the
 * first time a row actually needs it, rather than failing the whole
 * request if they're unset -- a restaurant with only Android/Expo staff
 * devices registered must not be blocked by a missing web-push config that
 * literally nothing in that request needs.
 */
let vapidConfigured = false;
function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true;
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const subject = Deno.env.get('VAPID_SUBJECT');
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

/**
 * dispatch-notifications
 * ========================
 * Phase 22. The real sender for queued email/sms notifications (Phase 09,
 * 0016, left those channels queued-but-undelivered on purpose -- see that
 * migration's own header). Two callers, both authenticated the same way
 * (a shared x-webhook-secret header, same pattern as notify-waitlist/
 * stripe-webhook -- there is no Supabase session for either):
 *
 *   1. This project's own pg_net trigger (migration 0043,
 *      trg_dispatch_notifications_on_insert), firing right after an
 *      email/sms row is queued -- covers immediate sends (booking
 *      confirmations/cancellations) without waiting for a cron tick.
 *   2. A GitHub Actions scheduled workflow (.github/workflows/
 *      dispatch-notifications-cron.yml), firing every few minutes --
 *      covers scheduled_for-in-the-future rows (pre-arrival reminders)
 *      that nothing "happens" at except the clock reaching them, which a
 *      database trigger cannot react to on its own. See 0043's own header
 *      comment for why this is a GitHub Actions cron rather than pg_cron.
 *
 * Both callers converge on the exact same claim_notifications_for_dispatch
 * RPC, so there is exactly one place ("is this row actually due, has
 * nobody else claimed it") that decides what gets sent -- this function's
 * own job is only: claim a batch, render each row's template, call the
 * matching provider, report the result back.
 *
 * HONESTY NOTE: not exercised against a live Resend or Twilio account --
 * see 0043's own header for what IS verified here (the claim/retry state
 * machine, in scripts/verify_phase22_notification_dispatch.sql) versus
 * what can only be checked by hand once this is deployed with real
 * provider keys (the actual send).
 */

interface ClaimedNotification {
  id: string;
  restaurant_id: string;
  restaurant_name: string;
  restaurant_timezone: string;
  channel: 'email' | 'sms' | 'push';
  template_code: string;
  payload: ReservationNotificationPayload;
  recipient_type: 'customer' | 'guest' | 'staff';
  recipient_user_id: string | null;
  to_email: string | null;
  to_phone: string | null;
  locale: string | null;
  dispatch_attempts: number;
}

async function sendEmail(row: ClaimedNotification): Promise<{ providerMessageId?: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const fromAddress = Deno.env.get('NOTIFICATIONS_FROM_EMAIL');
  if (!apiKey || !fromAddress) {
    throw new Error('RESEND_API_KEY / NOTIFICATIONS_FROM_EMAIL not set in the function environment.');
  }
  if (!row.to_email) {
    throw new Error('No recipient email on this notification.');
  }

  const rendered = renderEmail(row.template_code, row.locale, row.restaurant_name, row.restaurant_timezone, row.payload);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromAddress,
      to: row.to_email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    }),
  });

  const body = await res.json().catch(() => ({}) as any);
  if (!res.ok) {
    throw new Error(`Resend API error (${res.status}): ${body?.message ?? JSON.stringify(body)}`);
  }
  return { providerMessageId: body?.id };
}

async function sendSms(row: ClaimedNotification): Promise<{ providerMessageId?: string }> {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
  const fromNumber = Deno.env.get('TWILIO_FROM_NUMBER');
  if (!accountSid || !authToken || !fromNumber) {
    throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER not set in the function environment.');
  }
  if (!row.to_phone) {
    throw new Error('No recipient phone number on this notification.');
  }

  const body = renderSms(row.template_code, row.locale, row.restaurant_name, row.restaurant_timezone, row.payload);

  const form = new URLSearchParams({ From: fromNumber, To: row.to_phone, Body: body });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });

  const json = await res.json().catch(() => ({}) as any);
  if (!res.ok) {
    throw new Error(`Twilio API error (${res.status}): ${json?.message ?? JSON.stringify(json)}`);
  }
  return { providerMessageId: json?.sid };
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Sends one push notification to EVERY device (push_tokens row) currently
 * registered for this staff member -- a staff member signed in on both
 * their personal phone and the shop's tablet gets woken up on both.
 * push_tokens has no restaurant scoping of its own (Phase 23, 0044): a
 * token belongs to a user, not a (user, restaurant) pair, which is
 * correct -- the same person gets notified the same way regardless of
 * which of their restaurants the reservation belongs to.
 *
 * Expo's push endpoint accepts a batch (array) in one request -- one HTTP
 * call per notification here, covering however many of this person's
 * devices are registered, rather than one call per device.
 *
 * A `DeviceNotRegistered` ticket error means the OS itself told Expo this
 * install no longer exists (app uninstalled, or a stale token from before
 * a reinstall) -- that token is deleted here so this staff member is never
 * retried against a device that can never receive it again. Any other
 * per-ticket error is left alone (logged, not treated as fatal for the
 * whole notification) -- a single bad token must not block delivery to
 * this person's other devices.
 */
async function sendPush(adminClient: ReturnType<typeof createAdminClient>, row: ClaimedNotification): Promise<{ providerMessageId?: string }> {
  if (!row.recipient_user_id) {
    throw new Error('Push notification has no recipient_user_id.');
  }

  const { data: tokenRows, error: tokenError } = await adminClient
    .from('push_tokens')
    .select('expo_push_token')
    .eq('user_id', row.recipient_user_id);
  if (tokenError) {
    throw new Error(`Failed to look up push tokens: ${tokenError.message}`);
  }
  const tokens = (tokenRows ?? []).map((r: { expo_push_token: string }) => r.expo_push_token);

  // Phase 24: also fan out to every Web Push subscription this staff
  // member has registered (the iPhone/desktop /staff PWA) -- a device
  // fanout, exactly like the Expo tokens above, not a separate channel.
  const { data: webSubRows, error: webSubError } = await adminClient
    .from('staff_web_push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', row.recipient_user_id);
  if (webSubError) {
    throw new Error(`Failed to look up web push subscriptions: ${webSubError.message}`);
  }
  const webSubs = (webSubRows ?? []) as { endpoint: string; p256dh: string; auth: string }[];

  if (tokens.length === 0 && webSubs.length === 0) {
    // Nobody's fault in particular (the staff member may simply never have
    // opened the app / installed the PWA on a device, or granted
    // permission) -- but there is genuinely nothing to send, so this is a
    // real failure for this row, same as "no recipient email" is for
    // sendEmail.
    throw new Error('No push token or web push subscription registered for this staff member.');
  }

  const rendered = renderPush(row.template_code, row.locale, row.restaurant_name, row.restaurant_timezone, row.payload);

  let firstOkId: string | undefined;
  let firstError: string | undefined;

  if (tokens.length > 0) {
    const messages = tokens.map((token) => ({
      to: token,
      title: rendered.title,
      body: rendered.body,
      sound: 'default',
      priority: 'high',
      channelId: 'reservations',
      data: { reservationId: (row.payload as Record<string, unknown>).reservationId ?? null, templateCode: row.template_code },
    }));

    const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        ...(expoAccessToken ? { Authorization: `Bearer ${expoAccessToken}` } : {}),
      },
      body: JSON.stringify(messages),
    });

    const body = await res.json().catch(() => ({}) as any);
    if (!res.ok) {
      firstError ??= `Expo push API error (${res.status}): ${JSON.stringify(body)}`;
    } else {
      const tickets: ExpoPushTicket[] = body?.data ?? [];
      const staleTokens: string[] = [];

      tickets.forEach((ticket, index) => {
        if (ticket.status === 'ok') {
          firstOkId ??= ticket.id;
          return;
        }
        if (ticket.details?.error === 'DeviceNotRegistered') {
          const staleToken = tokens[index];
          if (staleToken) staleTokens.push(staleToken);
        }
        firstError ??= ticket.message ?? ticket.details?.error ?? 'Unknown Expo push error';
      });

      if (staleTokens.length > 0) {
        const { error: deleteError } = await adminClient.from('push_tokens').delete().in('expo_push_token', staleTokens);
        if (deleteError) console.error('sendPush: failed to prune stale push token(s)', deleteError);
      }
    }
  }

  if (webSubs.length > 0) {
    const vapidOk = ensureVapidConfigured();
    console.log('sendPush: web push section entered', { webSubsCount: webSubs.length, vapidOk });
    if (!vapidOk) {
      console.error('sendPush: VAPID env vars missing, skipping web push entirely', {
        hasPublicKey: !!Deno.env.get('VAPID_PUBLIC_KEY'),
        hasPrivateKey: !!Deno.env.get('VAPID_PRIVATE_KEY'),
        hasSubject: !!Deno.env.get('VAPID_SUBJECT'),
      });
      firstError ??= 'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT not set in the function environment.';
    } else {
      const staleEndpoints: string[] = [];
      const payload = JSON.stringify({ title: rendered.title, body: rendered.body, url: '/' });

      for (const sub of webSubs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
          );
          console.log('sendPush: web push sent OK', { endpoint: sub.endpoint });
          firstOkId ??= sub.endpoint;
        } catch (webErr: any) {
          // Always log the raw error -- previously this was only ever
          // captured into firstError, which gets silently discarded
          // whenever an Expo (Android) send already succeeded for this
          // same row, making web-push failures invisible in the function
          // logs even though the staff member's phone never received
          // anything. Logging unconditionally here is the only way to
          // diagnose web-push-only staff (iPhone/desktop) going forward.
          console.error('sendPush: web push send failed', {
            endpoint: sub.endpoint,
            statusCode: webErr?.statusCode,
            body: webErr?.body,
            message: webErr?.message,
          });
          // 404/410 -- the browser/OS itself invalidated this subscription
          // (uninstalled, permission revoked, endpoint expired). Prune it,
          // same as a stale Expo token above, rather than retrying it
          // forever.
          if (webErr?.statusCode === 404 || webErr?.statusCode === 410) {
            staleEndpoints.push(sub.endpoint);
          }
          firstError ??= webErr?.body || webErr?.message || 'Unknown Web Push error';
        }
      }

      if (staleEndpoints.length > 0) {
        const { error: deleteError } = await adminClient.from('staff_web_push_subscriptions').delete().in('endpoint', staleEndpoints);
        if (deleteError) console.error('sendPush: failed to prune stale web push subscription(s)', deleteError);
      }
    }
  }

  // At least one device (Expo or Web Push) received it successfully ->
  // this notification counts as sent, even if another device failed
  // (already pruned above where applicable). Only throw when EVERY
  // destination failed.
  if (!firstOkId && firstError) {
    throw new Error(firstError);
  }

  return { providerMessageId: firstOkId };
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== 'POST') return jsonError('Method not allowed.', 405);

  const expectedSecret = Deno.env.get('NOTIFICATIONS_WEBHOOK_SECRET');
  const providedSecret = req.headers.get('x-webhook-secret');
  if (!expectedSecret) {
    console.error('dispatch-notifications: NOTIFICATIONS_WEBHOOK_SECRET is not set in the function environment.');
    return jsonError('Server misconfigured.', 500);
  }
  if (providedSecret !== expectedSecret) {
    return jsonError('Unauthorized.', 401);
  }

  // Body is informational only (see header comment) -- never required, never trusted.
  await req.json().catch(() => ({}));

  const adminClient = createAdminClient();
  const { data: claimed, error: claimError } = await adminClient.rpc('claim_notifications_for_dispatch', { p_limit: 25 });
  if (claimError) {
    console.error('dispatch-notifications: claim_notifications_for_dispatch failed', claimError);
    return jsonError('Failed to claim notifications.', 500);
  }

  const rows = (claimed ?? []) as ClaimedNotification[];
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const result = row.channel === 'email' ? await sendEmail(row) : row.channel === 'sms' ? await sendSms(row) : await sendPush(adminClient, row);
      const { error } = await adminClient.rpc('mark_notification_dispatched', {
        p_id: row.id,
        p_success: true,
        p_provider_message_id: result.providerMessageId ?? null,
        p_error_message: null,
      });
      if (error) console.error(`dispatch-notifications: mark_notification_dispatched (success) failed for ${row.id}`, error);
      sent += 1;
    } catch (sendErr) {
      // A provider failure (invalid number, rate limit, transient network
      // issue) is expected over time and must not fail the whole batch --
      // every other claimed row still deserves its own attempt.
      const message = sendErr instanceof Error ? sendErr.message : String(sendErr);
      console.error(`dispatch-notifications: send failed for notification ${row.id} (${row.channel})`, message);
      const { error } = await adminClient.rpc('mark_notification_dispatched', {
        p_id: row.id,
        p_success: false,
        p_provider_message_id: null,
        p_error_message: message.slice(0, 500),
      });
      if (error) console.error(`dispatch-notifications: mark_notification_dispatched (failure) failed for ${row.id}`, error);
      failed += 1;
    }
  }

  return jsonResponse({ claimed: rows.length, sent, failed });
});
