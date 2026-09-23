'use client';

import { deleteStaffWebPushSubscription, upsertStaffWebPushSubscription } from '@reservex/core';
import type { Session } from '@supabase/supabase-js';
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';

import { getSupabaseBrowserClient } from '@/lib/supabase';
import { buttonStyle, cardStyle } from '@/lib/ui';
import { isWebPushSupported, requestWebPushSubscription } from '@/lib/webPush';

/**
 * Phase 24: the iPhone/desktop half of staff push notifications (see
 * migration 0045's own header comment for the full reasoning -- native
 * iOS needs an Apple Developer account + Mac + App Store/TestFlight,
 * which don't exist for this project; this route is the alternative).
 *
 * Deliberately a top-level route (/staff), not nested under app/[locale]/:
 * this is an internal tool for restaurant staff, not part of the public,
 * localized guest-facing site, and Next.js resolves a literal segment
 * ('staff') before a dynamic one ('[locale]') at the same level, so this
 * never collides with a locale value. Unlocalized on purpose, same
 * reasoning as app/manifest.ts's name/short_name.
 *
 * Deliberately login-only (no sign-up mode, unlike account/page.tsx): a
 * staff account is created by an owner/manager (or via the mobile app),
 * never self-service here. Deliberately no restaurant/membership lookup
 * either -- dispatch-notifications (0044/0045) already decides who gets
 * notified about what per-restaurant; this page's only job is "does this
 * signed-in user's browser have a live Web Push subscription on file".
 */
export default function StaffPushPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  const [subscribed, setSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [subscribeMessage, setSubscribeMessage] = useState<string | null>(null);
  const [checkedExistingSubscription, setCheckedExistingSubscription] = useState(false);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    void client.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoaded(true);
    });
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  // Reflect whether THIS browser already has a live push subscription
  // (e.g. the staff member enabled it on a previous visit) -- purely a
  // local browser check (PushManager), not a round-trip to the database,
  // so it works even before we know whether that endpoint is still saved
  // server-side.
  useEffect(() => {
    if (!session || !isWebPushSupported()) {
      setCheckedExistingSubscription(true);
      return;
    }
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((existing) => setSubscribed(Boolean(existing)))
      .finally(() => setCheckedExistingSubscription(true));
  }, [session]);

  async function handleAuthSubmit(event: FormEvent) {
    event.preventDefault();
    setAuthError(null);
    setAuthBusy(true);
    const client = getSupabaseBrowserClient();
    const { error } = await client.auth.signInWithPassword({ email, password });
    setAuthBusy(false);
    if (error) setAuthError(error.message);
  }

  async function handleSignOut() {
    const client = getSupabaseBrowserClient();
    try {
      if (isWebPushSupported()) {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (existing) await deleteStaffWebPushSubscription(client, existing.endpoint);
      }
    } catch {
      // Best-effort, same discipline as the mobile app's sign-out cleanup
      // (clearPushTokenForCurrentDeviceAsync) -- never block sign-out over it.
    }
    await client.auth.signOut();
    setSubscribed(false);
  }

  async function handleEnableNotifications() {
    setSubscribing(true);
    setSubscribeMessage(null);
    const result = await requestWebPushSubscription();
    setSubscribing(false);

    if (result.status === 'subscribed') {
      const client = getSupabaseBrowserClient();
      try {
        await upsertStaffWebPushSubscription(client, session!.user.id, result.subscription);
        setSubscribed(true);
        setSubscribeMessage('Οι ειδοποιήσεις ενεργοποιήθηκαν σε αυτή τη συσκευή.');
      } catch {
        setSubscribeMessage('Η συσκευή σου έδωσε άδεια, αλλά κάτι πήγε στραβά κατά την αποθήκευση. Δοκίμασε ξανά.');
      }
      return;
    }
    if (result.status === 'denied') {
      setSubscribeMessage('Δεν δόθηκε άδεια ειδοποιήσεων. Άνοιξε τις Ρυθμίσεις της συσκευής και επίτρεψε τις ειδοποιήσεις για το ReservX.');
      return;
    }
    if (result.status === 'unsupported') {
      setSubscribeMessage(
        'Αυτό το πρόγραμμα περιήγησης δεν υποστηρίζει ακόμα ειδοποιήσεις εδώ. Σε iPhone: πρόσθεσε πρώτα αυτή τη σελίδα στην Αρχική Οθόνη (Μοιράσου → "Προσθήκη στην Αρχική Οθόνη"), άνοιξέ την από εκεί, και ξαναδοκίμασε.',
      );
      return;
    }
    setSubscribeMessage('Κάτι πήγε στραβά. Δοκίμασε ξανά σε λίγο.');
  }

  const pageStyle: CSSProperties = {
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'clamp(20px, 5vw, 48px)',
    gap: 'var(--space-lg, 20px)',
  };

  const fieldStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    width: '100%',
  };

  const inputStyle: CSSProperties = {
    fontFamily: 'var(--font-family)',
    fontSize: 15,
    padding: '12px 14px',
    borderRadius: 'var(--radius-md, 10px)',
    border: '1px solid var(--border)',
    background: 'var(--background)',
    color: 'inherit',
  };

  if (!sessionLoaded) {
    return <div style={pageStyle} />;
  }

  if (!session) {
    return (
      <div style={pageStyle}>
        <div style={{ ...cardStyle, maxWidth: 380, width: '100%' }}>
          <h1 style={{ fontSize: 20, marginTop: 0, marginBottom: 4 }}>ReservX — Προσωπικό</h1>
          <p style={{ color: 'var(--text-muted)', marginTop: 0, marginBottom: 20, fontSize: 14 }}>
            Σύνδεση με τον λογαριασμό σου (owner/manager) για να ενεργοποιήσεις ειδοποιήσεις νέων κρατήσεων σε αυτή τη συσκευή.
          </p>
          <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={fieldStyle}>
              <label htmlFor="email" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Email</label>
              <input id="email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
            </div>
            <div style={fieldStyle}>
              <label htmlFor="password" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Κωδικός</label>
              <input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
            </div>
            {authError ? <p style={{ color: '#e05252', fontSize: 13, margin: 0 }}>{authError}</p> : null}
            <button type="submit" disabled={authBusy} style={buttonStyle('primary', { disabled: authBusy, fullWidth: true })}>
              {authBusy ? 'Σύνδεση...' : 'Σύνδεση'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={{ ...cardStyle, maxWidth: 380, width: '100%' }}>
        <h1 style={{ fontSize: 20, marginTop: 0, marginBottom: 4 }}>ReservX — Προσωπικό</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 0, marginBottom: 20, fontSize: 14 }}>
          Συνδεδεμένος ως {session.user.email}
        </p>

        {checkedExistingSubscription && subscribed ? (
          <p style={{ fontSize: 14, marginBottom: 16 }}>✓ Οι ειδοποιήσεις είναι ενεργές σε αυτή τη συσκευή.</p>
        ) : (
          <button
            type="button"
            onClick={handleEnableNotifications}
            disabled={subscribing || !checkedExistingSubscription}
            style={buttonStyle('primary', { disabled: subscribing, fullWidth: true })}
          >
            {subscribing ? 'Ενεργοποίηση...' : 'Ενεργοποίηση ειδοποιήσεων'}
          </button>
        )}

        {subscribeMessage ? <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 14 }}>{subscribeMessage}</p> : null}

        <button type="button" onClick={() => void handleSignOut()} style={{ ...buttonStyle('ghost', { fullWidth: true }), marginTop: 20 }}>
          Αποσύνδεση
        </button>
      </div>
    </div>
  );
}
