'use client';
import {
  deleteStaffWebPushSubscription,
  fetchOwnerConfigurableFlags,
  setOwnerFeatureFlag,
  upsertStaffWebPushSubscription,
  type OwnerConfigurableFlag,
  type Restaurant,
} from '@reservex/core';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState, type CSSProperties } from 'react';

import { buttonStyle, cardStyle } from '@/lib/ui';
import { isWebPushSupported, requestWebPushSubscription } from '@/lib/webPush';

const FLAG_COPY: Record<string, { title: string; description: string }> = {
  live_availability: {
    title: 'Ζωντανή διαθεσιμότητα',
    description: 'Οι πελάτες βλέπουν στην ώρα τους πόσο γεμάτο είναι κάθε χρονικό διάστημα, με τα χρωματιστά τετραγωνάκια.',
  },
  waitlist_public: {
    title: 'Λίστα αναμονής',
    description: 'Όταν δεν υπάρχει διαθεσιμότητα, ο πελάτης μπορεί να μπει σε λίστα αναμονής και να ειδοποιηθεί αν ανοίξει θέση.',
  },
  last_minute_alerts: {
    title: 'Ειδοποιήσεις τελευταίας στιγμής',
    description: 'Ειδοποίηση σε ενδιαφερόμενους πελάτες όταν ανοίξει διαθεσιμότητα λόγω ακύρωσης, κοντά στην ώρα.',
  },
  popularity_indicator: {
    title: 'Ένδειξη ζήτησης',
    description: 'Δείχνει στους πελάτες πόσο δημοφιλές είναι το εστιατόριο αυτή τη στιγμή.',
  },
};

const rowStyle: CSSProperties = { ...cardStyle, padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 };

/**
 * The catch-all "everything else" tab: owner-configurable feature flags
 * (fetchOwnerConfigurableFlags/setOwnerFeatureFlag -- all default OFF, see
 * migrations 0010/0011/0020/0023/0024/0028/0033/0035/0040), plus the
 * Phase 24 web-push enable/disable flow ported verbatim from the original
 * /staff page (same upsertStaffWebPushSubscription/
 * deleteStaffWebPushSubscription/requestWebPushSubscription/
 * isWebPushSupported calls, same iOS "add to home screen first" copy), and
 * sign-out. None of these are launch BLOCKERS the way opening hours/tables
 * are -- flags default off and push is a nice-to-have -- which is why this
 * tab comes last, not because it matters less as an ongoing settings home.
 */
export function SettingsTab({ client, restaurant, session }: { client: SupabaseClient; restaurant: Restaurant; session: Session }) {
  const [flags, setFlags] = useState<OwnerConfigurableFlag[] | null>(null);
  const [flagError, setFlagError] = useState<string | null>(null);
  const [busyFlagId, setBusyFlagId] = useState<string | null>(null);

  const [subscribed, setSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [subscribeMessage, setSubscribeMessage] = useState<string | null>(null);
  const [checkedExistingSubscription, setCheckedExistingSubscription] = useState(false);

  useEffect(() => {
    fetchOwnerConfigurableFlags(client, restaurant.id, restaurant.organizationId)
      .then(setFlags)
      .catch(() => setFlagError('Δεν φορτώθηκαν οι ρυθμίσεις λειτουργιών.'));
  }, [client, restaurant.id, restaurant.organizationId]);

  useEffect(() => {
    if (!isWebPushSupported()) {
      setCheckedExistingSubscription(true);
      return;
    }
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((existing) => setSubscribed(Boolean(existing)))
      .finally(() => setCheckedExistingSubscription(true));
  }, []);

  async function handleToggleFlag(flag: OwnerConfigurableFlag) {
    setFlagError(null);
    setBusyFlagId(flag.flag.id);
    try {
      await setOwnerFeatureFlag(client, restaurant.id, flag.flag.id, !flag.isEnabled);
      setFlags((prev) => prev && prev.map((f) => (f.flag.id === flag.flag.id ? { ...f, isEnabled: !f.isEnabled } : f)));
    } catch {
      setFlagError('Η ενημέρωση απέτυχε. Δοκίμασε ξανά.');
    } finally {
      setBusyFlagId(null);
    }
  }

  async function handleEnableNotifications() {
    setSubscribing(true);
    setSubscribeMessage(null);
    const result = await requestWebPushSubscription();
    setSubscribing(false);

    if (result.status === 'subscribed') {
      try {
        await upsertStaffWebPushSubscription(client, session.user.id, result.subscription);
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

  async function handleSignOut() {
    try {
      if (isWebPushSupported()) {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (existing) await deleteStaffWebPushSubscription(client, existing.endpoint);
      }
    } catch {
      // Best-effort, same discipline as the mobile app's sign-out cleanup -- never block sign-out over it.
    }
    await client.auth.signOut();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h3 style={{ fontSize: 15, marginTop: 0, marginBottom: 10 }}>Ειδοποιήσεις σε αυτή τη συσκευή</h3>
        <div style={{ ...cardStyle, padding: 14 }}>
          {checkedExistingSubscription && subscribed ? (
            <p style={{ fontSize: 14, margin: 0 }}>✓ Οι ειδοποιήσεις είναι ενεργές σε αυτή τη συσκευή.</p>
          ) : (
            <button
              type="button"
              onClick={() => void handleEnableNotifications()}
              disabled={subscribing || !checkedExistingSubscription}
              style={buttonStyle('primary', { disabled: subscribing, fullWidth: true })}
            >
              {subscribing ? 'Ενεργοποίηση...' : 'Ενεργοποίηση ειδοποιήσεων'}
            </button>
          )}
          {subscribeMessage ? <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 12, marginBottom: 0 }}>{subscribeMessage}</p> : null}
        </div>
      </div>

      <div>
        <h3 style={{ fontSize: 15, marginTop: 0, marginBottom: 10 }}>Λειτουργίες</h3>
        {flagError ? <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 0 }}>{flagError}</p> : null}
        {flags === null ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Φόρτωση...</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {flags.map((f) => {
              const copy = FLAG_COPY[f.flag.key] ?? { title: f.flag.key, description: f.flag.description ?? '' };
              return (
                <div key={f.flag.id} style={rowStyle}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{copy.title}</span>
                    <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{copy.description}</span>
                  </div>
                  <button
                    type="button"
                    disabled={busyFlagId === f.flag.id}
                    onClick={() => void handleToggleFlag(f)}
                    style={{
                      ...buttonStyle(f.isEnabled ? 'primary' : 'secondary'),
                      padding: '6px 14px',
                      minHeight: 32,
                      fontSize: 12.5,
                      flexShrink: 0,
                    }}
                  >
                    {f.isEnabled ? 'Ενεργό' : 'Ανενεργό'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <h3 style={{ fontSize: 15, marginTop: 0, marginBottom: 10 }}>Λογαριασμός</h3>
        <div style={{ ...cardStyle, padding: 14 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 14 }}>Συνδεδεμένος ως {session.user.email}</p>
          <button type="button" onClick={() => void handleSignOut()} style={buttonStyle('ghost', { fullWidth: true })}>
            Αποσύνδεση
          </button>
        </div>
      </div>
    </div>
  );
}
