import type { WebPushSubscriptionJSON } from '@reservex/core';

/**
 * Phase 6, Part 2c of the Live Availability upgrade: the browser-side half
 * of Web Push for the self-service waitlist (Parts 2a/2b already built the
 * database side -- join_public_waitlist, migration 0029 -- and the delivery
 * side -- the pg_net trigger + notify-waitlist Edge Function, migrations
 * 0030-0032). Nothing here talks to Supabase directly; this is purely
 * "does this browser support push, and if the visitor explicitly agrees,
 * what PushSubscription do we hand to joinPublicWaitlist()".
 *
 * DELIBERATELY explicit, not automatic: this is only ever called from a
 * click handler the guest themselves triggered (the "Notify me" / "Enable
 * notifications" button in BookingForm.tsx), never from a page-load effect.
 * A browser's own native permission prompt can only be triggered by a user
 * gesture anyway (calling Notification.requestPermission() outside one is
 * either a silent no-op or auto-denied, depending on the browser), so this
 * isn't just good manners -- automatic prompting could not work even if it
 * were desired.
 */

/** True only when every API this flow needs actually exists on `window`/`navigator`. Safari on iOS < 16.4 and some older browsers lack one or more of these. */
export function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Converts the VAPID public key (the standard URL-safe base64 string
 * `web-push generate-vapid-keys` prints, and the exact value already
 * configured as NEXT_PUBLIC_VAPID_PUBLIC_KEY) into the raw Uint8Array
 * PushManager.subscribe()'s applicationServerKey option requires. Standard
 * technique (the one documented in MDN's own Push API guide) -- there is no
 * browser API that does this conversion for you.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export type WebPushOptInResult =
  | { status: 'subscribed'; subscription: WebPushSubscriptionJSON }
  | { status: 'unsupported' }
  | { status: 'denied' }
  | { status: 'error'; error: unknown };

/**
 * The one entry point BookingForm.tsx calls, from a click handler only.
 * Requests OS/browser notification permission (the native prompt), and on
 * "granted" registers (or re-uses an existing) PushManager subscription
 * against the app's own service worker (public/sw.js). Returns a plain
 * result instead of throwing for the two expected non-happy paths
 * ('unsupported', 'denied') so the caller can show a specific, honest
 * message for each rather than a generic error -- see the
 * public.booking.waitlist.notify* / errors.* i18n keys.
 *
 * Never subscribes without asking: if `NEXT_PUBLIC_VAPID_PUBLIC_KEY` isn't
 * configured (e.g. a local/dev environment that hasn't set it up yet), this
 * reports 'unsupported' rather than calling subscribe() with a missing key,
 * which would just throw inside the browser's own Push implementation.
 */
export async function requestWebPushSubscription(): Promise<WebPushOptInResult> {
  if (!isWebPushSupported()) return { status: 'unsupported' };

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) return { status: 'unsupported' };

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { status: 'denied' };

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // `as BufferSource`: a real, narrowly-scoped TS/DOM lib mismatch
        // (not a runtime concern) -- with @types/node loaded alongside
        // lib.dom, the global `Uint8Array` type widens to
        // `Uint8Array<ArrayBufferLike>` (which also covers SharedArrayBuffer),
        // while PushManager.subscribe()'s `applicationServerKey` option
        // expects the stricter DOM `BufferSource` (ArrayBufferView<ArrayBuffer>).
        // The actual value here is always a plain Uint8Array backed by a
        // fresh ArrayBuffer (see urlBase64ToUint8Array above), which the
        // browser's real Push API has always accepted -- this cast only
        // tells TypeScript what's already true at runtime.
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      });
    }

    // Read every field into a plain local const first, rather than
    // narrowing through `json.keys?.p256dh` inline below -- keeps the
    // null-check trustworthy for TypeScript's control-flow analysis (and
    // for a human skimming this) regardless of how PushSubscriptionJSON's
    // own (all-optional) lib.dom.d.ts type is shaped.
    const json = subscription.toJSON();
    const endpoint = json.endpoint;
    const p256dh = json.keys?.p256dh;
    const auth = json.keys?.auth;
    if (!endpoint || !p256dh || !auth) {
      // Genuinely shouldn't happen (this is the browser's own subscribe()
      // result), but the wrapper's return type promises a complete
      // WebPushSubscriptionJSON -- never hand joinPublicWaitlist() a value
      // with a missing key rather than trusting the shape blindly.
      return { status: 'error', error: new Error('Browser returned an incomplete push subscription.') };
    }

    return { status: 'subscribed', subscription: { endpoint, keys: { p256dh, auth } } };
  } catch (error) {
    return { status: 'error', error };
  }
}
