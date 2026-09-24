'use client';
import { fetchReservations, subscribeToRestaurantReservations, updateReservationStatus, type ReservationStatus, type ReservationWithTables, type Restaurant } from '@reservex/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';

import { badgeStyle, buttonStyle, cardStyle } from '@/lib/ui';
import { formatTimeInTimeZone, getDateStringInTimeZone, zonedTimeToUtc } from '@/lib/timezone';

const STATUS_LABEL: Record<ReservationStatus, string> = {
  pending: 'Εκκρεμεί',
  confirmed: 'Επιβεβαιωμένη',
  seated: 'Κάθισε',
  completed: 'Ολοκληρώθηκε',
  cancelled: 'Ακυρώθηκε',
  no_show: 'Δεν ήρθε',
};

const STATUS_TONE: Record<ReservationStatus, 'accent' | 'success' | 'warning' | 'danger' | 'muted'> = {
  pending: 'warning',
  confirmed: 'accent',
  seated: 'success',
  completed: 'muted',
  cancelled: 'danger',
  no_show: 'danger',
};

/**
 * The core reason this whole web dashboard exists: a host at an iPhone/
 * iPad-only restaurant needs to SEE today's reservations and update their
 * status as the shift happens (party arrives -> seated, finishes ->
 * completed, doesn't show -> no_show). Same fetchReservations/
 * updateReservationStatus/subscribeToRestaurantReservations the mobile
 * app's own reservations screen uses -- this is a new UI over identical,
 * already-battle-tested data access, not a new backend capability.
 *
 * Deliberately no "create a walk-in/phone reservation" form here yet: that
 * needs the same table-availability engine the public booking form uses
 * (get_available_tables/combinations), which is a bigger scope than today's
 * "get the restaurant able to receive and manage its first real bookings"
 * goal -- a phone caller can be pointed at the same public booking link
 * for now.
 */
export function ReservationsTab({ client, restaurant }: { client: SupabaseClient; restaurant: Restaurant }) {
  const [dateOffset, setDateOffset] = useState(0);
  const [customDate, setCustomDate] = useState<string | null>(null);
  const [reservations, setReservations] = useState<ReservationWithTables[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const dateStr = customDate ?? getDateStringInTimeZone(restaurant.timezone, dateOffset);

  const load = useCallback(() => {
    const fromInclusive = zonedTimeToUtc(dateStr, '00:00', restaurant.timezone).toISOString();
    const nextDay = new Date(zonedTimeToUtc(dateStr, '00:00', restaurant.timezone).getTime() + 86_400_000);
    const toExclusive = nextDay.toISOString();
    fetchReservations(client, restaurant.id, { fromInclusive, toExclusive })
      .then((rows) => setReservations(rows))
      .catch(() => setError('Δεν φορτώθηκαν οι κρατήσεις. Δοκίμασε ανανέωση.'));
  }, [client, restaurant.id, restaurant.timezone, dateStr]);

  useEffect(() => {
    setReservations(null);
    load();
    const unsubscribe = subscribeToRestaurantReservations(client, restaurant.id, load);
    return unsubscribe;
  }, [client, restaurant.id, load]);

  async function setStatus(reservationId: string, status: ReservationStatus) {
    setBusyId(reservationId);
    try {
      await updateReservationStatus(client, reservationId, status);
      load();
    } catch {
      setError('Η ενημέρωση απέτυχε. Δοκίμασε ξανά.');
    } finally {
      setBusyId(null);
    }
  }

  const dayChipStyle = (selected: boolean): CSSProperties => ({
    fontFamily: 'var(--font-family)',
    fontSize: 13,
    fontWeight: 600,
    padding: '8px 14px',
    borderRadius: 'var(--radius-full)',
    border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
    background: selected ? 'var(--accent)' : 'var(--surface)',
    color: selected ? 'var(--accent-contrast)' : 'var(--text-primary)',
    cursor: 'pointer',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" style={dayChipStyle(customDate === null && dateOffset === 0)} onClick={() => { setDateOffset(0); setCustomDate(null); }}>
          Σήμερα
        </button>
        <button type="button" style={dayChipStyle(customDate === null && dateOffset === 1)} onClick={() => { setDateOffset(1); setCustomDate(null); }}>
          Αύριο
        </button>
        <input
          type="date"
          value={dateStr}
          onChange={(e) => setCustomDate(e.target.value)}
          style={{
            fontFamily: 'var(--font-family)',
            fontSize: 13,
            padding: '7px 10px',
            borderRadius: 'var(--radius-full)',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text-primary)',
          }}
        />
      </div>

      {error ? <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p> : null}

      {reservations === null ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Φόρτωση...</p>
      ) : reservations.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: 'center', color: 'var(--text-muted)' }}>Καμία κράτηση αυτή την ημέρα.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {reservations.map((r) => (
            <div key={r.id} style={{ ...cardStyle, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700 }}>
                    {formatTimeInTimeZone(r.startsAt, restaurant.timezone, 'el')}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{r.guestName ?? '—'}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{r.partySize} άτομα</span>
                </div>
                <span style={badgeStyle(STATUS_TONE[r.status])}>{STATUS_LABEL[r.status]}</span>
              </div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-muted)' }}>
                {r.guestPhone ? <a href={`tel:${r.guestPhone}`} style={{ color: 'inherit' }}>📞 {r.guestPhone}</a> : null}
                {r.tables.length > 0 ? <span>🪑 {r.tables.map((t) => t.label).join(', ')}</span> : null}
                {r.specialRequests ? <span>📝 {r.specialRequests}</span> : null}
              </div>
              {(r.status === 'pending' || r.status === 'confirmed' || r.status === 'seated') ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                  {r.status !== 'seated' ? (
                    <button type="button" disabled={busyId === r.id} style={buttonStyle('secondary', { disabled: busyId === r.id })} onClick={() => setStatus(r.id, 'seated')}>
                      Ήρθε
                    </button>
                  ) : (
                    <button type="button" disabled={busyId === r.id} style={buttonStyle('primary', { disabled: busyId === r.id })} onClick={() => setStatus(r.id, 'completed')}>
                      Ολοκληρώθηκε
                    </button>
                  )}
                  {r.status !== 'seated' ? (
                    <button type="button" disabled={busyId === r.id} style={buttonStyle('ghost', { disabled: busyId === r.id })} onClick={() => setStatus(r.id, 'no_show')}>
                      Δεν ήρθε
                    </button>
                  ) : null}
                  <button type="button" disabled={busyId === r.id} style={buttonStyle('ghost', { disabled: busyId === r.id })} onClick={() => setStatus(r.id, 'cancelled')}>
                    Ακύρωση
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
