'use client';
import { useState, type CSSProperties, type FormEvent } from 'react';

import { getSupabaseBrowserClient } from '@/lib/supabase';
import { buttonStyle, cardStyle, chipStyle } from '@/lib/ui';

const RESTAURANT_TYPES: { value: string; label: string }[] = [
  { value: 'restaurant', label: 'Εστιατόριο' },
  { value: 'cafe', label: 'Καφέ' },
  { value: 'bar', label: 'Μπαρ' },
  { value: 'club', label: 'Club' },
  { value: 'beach_venue', label: 'Beach venue' },
  { value: 'hotel_venue', label: 'Ξενοδοχείο' },
  { value: 'event_venue', label: 'Χώρος εκδηλώσεων' },
];

const inputStyle: CSSProperties = {
  fontFamily: 'var(--font-family)',
  fontSize: 16,
  padding: '12px 14px',
  borderRadius: 'var(--radius-md, 10px)',
  border: '1px solid var(--border)',
  background: 'var(--background)',
  color: 'inherit',
  width: '100%',
};

/**
 * Web equivalent of the mobile app's app/(onboarding)/create-restaurant.tsx
 * -- same Edge Function (bootstrap-restaurant), same three fields, same
 * "everyone is allowed to bootstrap their own first restaurant" rule (see
 * that function's own header comment for why this can't be a plain client
 * insert). Built 2026-09 so an iPhone/iPad-only restaurant (no iOS build
 * of the mobile app exists yet) can still do this one-time setup step from
 * Safari, with zero install.
 */
export function CreateRestaurantForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('restaurant');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timezone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Europe/Athens';

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (name.trim().length < 2) {
      setError('Το όνομα πρέπει να έχει τουλάχιστον 2 χαρακτήρες.');
      return;
    }
    setBusy(true);
    const client = getSupabaseBrowserClient();
    const { error: invokeError } = await client.functions.invoke('bootstrap-restaurant', {
      body: { restaurantName: name.trim(), restaurantType: type, timezone },
    });
    setBusy(false);
    if (invokeError) {
      setError('Κάτι πήγε στραβά κατά τη δημιουργία του εστιατορίου. Δοκίμασε ξανά.');
      return;
    }
    onCreated();
  }

  const pageStyle: CSSProperties = {
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'clamp(20px, 5vw, 48px)',
  };

  return (
    <div style={pageStyle}>
      <div style={{ ...cardStyle, maxWidth: 420, width: '100%' }}>
        <h1 style={{ fontSize: 20, marginTop: 0, marginBottom: 4 }}>Το εστιατόριό σου</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 0, marginBottom: 20, fontSize: 14 }}>
          Δεν βρέθηκε κανένα εστιατόριο στον λογαριασμό σου — ας φτιάξουμε το πρώτο. Τη διεύθυνση, τηλέφωνο κ.λπ. τα συμπληρώνεις μετά, από τις Ρυθμίσεις.
        </p>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="restaurant-name" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Όνομα εστιατορίου</label>
            <input id="restaurant-name" type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="π.χ. Μελίνα" style={inputStyle} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Τύπος</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {RESTAURANT_TYPES.map((opt) => (
                <button key={opt.value} type="button" style={chipStyle({ selected: type === opt.value })} onClick={() => setType(opt.value)}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Ζώνη ώρας</span>
            <span style={{ fontSize: 14 }}>{timezone}</span>
          </div>
          {error ? <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{error}</p> : null}
          <button type="submit" disabled={busy} style={buttonStyle('primary', { disabled: busy, fullWidth: true })}>
            {busy ? 'Δημιουργία...' : 'Δημιουργία εστιατορίου'}
          </button>
        </form>
      </div>
    </div>
  );
}
