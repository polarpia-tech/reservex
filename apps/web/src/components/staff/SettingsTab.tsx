'use client';
import {
  deleteStaffWebPushSubscription,
  fetchOwnerConfigurableFlags,
  setOwnerFeatureFlag,
  updateRestaurant,
  upsertStaffWebPushSubscription,
  type OwnerConfigurableFlag,
  type Restaurant,
} from '@reservex/core';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';

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

const inputStyle: CSSProperties = {
  fontFamily: 'var(--font-family)',
  fontSize: 14,
  padding: '9px 11px',
  borderRadius: 'var(--radius-md, 10px)',
  border: '1px solid var(--border)',
  background: 'var(--background)',
  color: 'inherit',
  width: '100%',
};

interface ProfileDraft {
  name: string;
  phone: string;
  email: string;
  addressLine: string;
  city: string;
  postalCode: string;
  description: string;
}

function draftFromRestaurant(r: Restaurant): ProfileDraft {
  return {
    name: r.name ?? '',
    phone: r.phone ?? '',
    email: r.email ?? '',
    addressLine: r.addressLine ?? '',
    city: r.city ?? '',
    postalCode: r.postalCode ?? '',
    description: r.description ?? '',
  };
}

/**
 * The catch-all "everything else" tab: restaurant profile (name/contact/
 * address -- added so an owner can fix these without ever needing a
 * developer, since CreateRestaurantForm only captures name/type/timezone
 * at signup time), owner-configurable feature flags
 * (fetchOwnerConfigurableFlags/setOwnerFeatureFlag -- all default OFF, see
 * migrations 0010/0011/0020/0023/0024/0028/0033/0035/0040), the Phase 24
 * web-push enable/disable flow ported verbatim from the original /staff
 * page, and sign-out.
 */
export function SettingsTab({
  client,
  restaurant,
  session,
  onProfileUpdated,
}: {
  client: SupabaseClient;
  restaurant: Restaurant;
  session: Session;
  onProfileUpdated?: () => void;
}) {
  const [profile, setProfile] = useState<ProfileDraft>(() => draftFromRestaurant(restaurant));
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => {
    setProfile(draftFromRestaurant(restaurant));
  }, [restaurant]);

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

  async function handleSaveProfile(event: FormEvent) {
    event.preventDefault();
    setProfileError(null);
    setProfileSaved(false);
    if (profile.name.trim().length < 2) {
      setProfileError('Το όνομα πρέπει να έχει τουλάχιστον 2 χαρακτήρες.');
      return;
    }
    setProfileSaving(true);
    try {
      await updateRestaurant(client, restaurant.id, {
        name: profile.name.trim(),
        phone: profile.phone.trim() || null,
        email: profile.email.trim() || null,
        addressLine: profile.addressLine.trim() || null,
        city: profile.city.trim() || null,
        postalCode: profile.postalCode.trim() || null,
        description: profile.description.trim() || null,
      });
      setProfileSaved(true);
      onProfileUpdated?.();
    } catch {
      setProfileError('Η αποθήκευση απέτυχε. Δοκίμασε ξανά.');
    } finally {
      setProfileSaving(false);
    }
  }

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
        <h3 style={{ fontSize: 15, marginTop: 0, marginBottom: 10 }}>Στοιχεία εστιατορίου</h3>
        <div style={{ ...cardStyle, padding: 16 }}>
          <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Όνομα</label>
              <input type="text" value={profile.name} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 140 }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Τηλέφωνο</label>
                <input type="tel" value={profile.phone} onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))} style={inputStyle} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 140 }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Email επικοινωνίας</label>
                <input type="email" value={profile.email} onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))} style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Διεύθυνση</label>
              <input type="text" value={profile.addressLine} onChange={(e) => setProfile((p) => ({ ...p, addressLine: e.target.value }))} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 140 }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Πόλη</label>
                <input type="text" value={profile.city} onChange={(e) => setProfile((p) => ({ ...p, city: e.target.value }))} style={inputStyle} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 130 }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Τ.Κ.</label>
                <input type="text" value={profile.postalCode} onChange={(e) => setProfile((p) => ({ ...p, postalCode: e.target.value }))} style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Περιγραφή (προαιρετικό, το βλέπουν οι πελάτες)</label>
              <textarea
                value={profile.description}
                onChange={(e) => setProfile((p) => ({ ...p, description: e.target.value }))}
                rows={3}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'var(--font-family)' }}
              />
            </div>
            {profileError ? <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{profileError}</p> : null}
            {profileSaved ? <p style={{ color: 'var(--success)', fontSize: 13, margin: 0 }}>Αποθηκεύτηκε.</p> : null}
            <button type="submit" disabled={profileSaving} style={buttonStyle('primary', { disabled: profileSaving, fullWidth: true })}>
              {profileSaving ? 'Αποθήκευση...' : 'Αποθήκευση στοιχείων'}
            </button>
          </form>
        </div>
      </div>

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
