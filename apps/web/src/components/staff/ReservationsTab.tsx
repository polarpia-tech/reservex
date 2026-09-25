'use client';
import {
  bookReservation,
  fetchAvailableTableCombinations,
  fetchAvailableTables,
  fetchReservations,
  fetchTableZones,
  parseBookReservationErrorCode,
  subscribeToRestaurantReservations,
  updateReservationStatus,
  type AvailableTable,
  type AvailableTableCombination,
  type ReservationStatus,
  type ReservationWithTables,
  type Restaurant,
  type TableZone,
} from '@reservex/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react';

import { badgeStyle, buttonStyle, cardStyle, chipStyle } from '@/lib/ui';
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

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

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

const optionRowStyle = (active: boolean): CSSProperties => ({
  textAlign: 'left',
  padding: '9px 12px',
  borderRadius: 'var(--radius-md, 10px)',
  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
  background: active ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--surface)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-family)',
  fontSize: 13,
  cursor: 'pointer',
});

/** Kept in sync with reservations.ts's BookReservationErrorCode -- see that file's own comment on why the object-vs-Error-instance check matters for parseBookReservationErrorCode to ever match anything at all. */
function mapBookingError(error: unknown): string {
  const code = parseBookReservationErrorCode(error);
  switch (code) {
    case 'INVALID_TIME_RANGE':
      return 'Μη έγκυρη ώρα κράτησης.';
    case 'INVALID_PARTY_SIZE':
      return 'Μη έγκυρος αριθμός ατόμων.';
    case 'NO_AVAILABILITY':
      return 'Δεν υπάρχει διαθέσιμο τραπέζι για αυτή την ώρα και τον αριθμό ατόμων.';
    case 'DOUBLE_BOOKED':
      return 'Κάποιο από τα τραπέζια μόλις κλείστηκε από αλλού. Έλεγξε ξανά τη διαθεσιμότητα.';
    default:
      return 'Η καταχώρηση απέτυχε. Δοκίμασε ξανά.';
  }
}

/**
 * The core reason this whole web dashboard exists: a host at an iPhone/
 * iPad-only restaurant needs to SEE today's reservations and update their
 * status as the shift happens (party arrives -> seated, finishes ->
 * completed, doesn't show -> no_show). Same fetchReservations/
 * updateReservationStatus/subscribeToRestaurantReservations the mobile
 * app's own reservations screen uses -- this is a new UI over identical,
 * already-battle-tested data access, not a new backend capability.
 *
 * Also includes a "Νέα κράτηση" form (added after initial launch, once a
 * real restaurant confirmed it needed to log phone/walk-in bookings from
 * here rather than always pointing callers at the public booking link) --
 * ported from apps/mobile's own (tabs)/reservations/new.tsx, same
 * fetchAvailableTables/fetchAvailableTableCombinations/bookReservation
 * calls against the same book_reservation() engine every booking path
 * uses, source defaults to 'admin'. One deliberate improvement over the
 * mobile screen: date+time here are converted with zonedTimeToUtc
 * (restaurant.timezone), not the device's own local timezone -- the mobile
 * screen's own header comment documents that shortcut as a known
 * limitation for exactly this reason.
 */
export function ReservationsTab({ client, restaurant }: { client: SupabaseClient; restaurant: Restaurant }) {
  const [dateOffset, setDateOffset] = useState(0);
  const [customDate, setCustomDate] = useState<string | null>(null);
  const [reservations, setReservations] = useState<ReservationWithTables[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

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
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
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
        <button
          type="button"
          onClick={() => setShowNewForm((v) => !v)}
          style={{ ...buttonStyle(showNewForm ? 'secondary' : 'primary'), padding: '8px 16px', minHeight: 36, fontSize: 13 }}
        >
          {showNewForm ? 'Κλείσιμο φόρμας' : '+ Νέα κράτηση'}
        </button>
      </div>

      {showNewForm ? (
        <NewReservationForm
          client={client}
          restaurant={restaurant}
          defaultDate={dateStr}
          onBooked={() => {
            setShowNewForm(false);
            load();
          }}
          onCancel={() => setShowNewForm(false)}
        />
      ) : null}

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

function NewReservationForm({
  client,
  restaurant,
  defaultDate,
  onBooked,
  onCancel,
}: {
  client: SupabaseClient;
  restaurant: Restaurant;
  defaultDate: string;
  onBooked: () => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState('20:00');
  const [durationMinutes, setDurationMinutes] = useState(String(restaurant.defaultReservationDurationMin || 90));
  const [partySize, setPartySize] = useState('2');
  const [zones, setZones] = useState<TableZone[]>([]);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [specialRequests, setSpecialRequests] = useState('');
  const [internalNotes, setInternalNotes] = useState('');

  const [availability, setAvailability] = useState<{ tables: AvailableTable[]; combinations: AvailableTableCombination[] } | null>(null);
  const [selectedTableIds, setSelectedTableIds] = useState<string[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTableZones(client, restaurant.id)
      .then((rows) => {
        if (!cancelled) setZones(rows);
      })
      .catch(() => undefined); // zones are a nice-to-have filter here -- a failed fetch just means "no zone picker", never blocks the booking form itself.
    return () => {
      cancelled = true;
    };
  }, [client, restaurant.id]);

  function computeTimes(): { startsAt: string; endsAt: string } | null {
    if (!DATE_PATTERN.test(date) || !TIME_PATTERN.test(time)) return null;
    const duration = Number.parseInt(durationMinutes, 10);
    if (!Number.isFinite(duration) || duration <= 0) return null;
    const start = zonedTimeToUtc(date, time, restaurant.timezone);
    const end = new Date(start.getTime() + duration * 60_000);
    return { startsAt: start.toISOString(), endsAt: end.toISOString() };
  }

  async function handleCheckAvailability() {
    setFormError(null);
    const times = computeTimes();
    const size = Number.parseInt(partySize, 10);
    if (!times) {
      setFormError('Έλεγξε την ημερομηνία και την ώρα (μορφή ΩΩ:ΛΛ).');
      return;
    }
    if (!Number.isFinite(size) || size <= 0) {
      setFormError('Έλεγξε τον αριθμό ατόμων.');
      return;
    }
    setChecking(true);
    try {
      const [tables, combinations] = await Promise.all([
        fetchAvailableTables(client, {
          restaurantId: restaurant.id,
          startsAt: times.startsAt,
          endsAt: times.endsAt,
          partySize: size,
          zoneId,
          includeVip: true,
        }),
        fetchAvailableTableCombinations(client, {
          restaurantId: restaurant.id,
          startsAt: times.startsAt,
          endsAt: times.endsAt,
          partySize: size,
        }),
      ]);
      setAvailability({ tables, combinations });
      setSelectedTableIds(null);
    } catch {
      setFormError('Ο έλεγχος διαθεσιμότητας απέτυχε. Δοκίμασε ξανά.');
    } finally {
      setChecking(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const times = computeTimes();
    const size = Number.parseInt(partySize, 10);
    if (!times) {
      setFormError('Έλεγξε την ημερομηνία και την ώρα (μορφή ΩΩ:ΛΛ).');
      return;
    }
    if (!Number.isFinite(size) || size <= 0) {
      setFormError('Έλεγξε τον αριθμό ατόμων.');
      return;
    }
    if (!guestName.trim() && !guestPhone.trim()) {
      setFormError('Χρειάζεται τουλάχιστον όνομα ή τηλέφωνο πελάτη.');
      return;
    }
    setSubmitting(true);
    try {
      await bookReservation(client, {
        restaurantId: restaurant.id,
        startsAt: times.startsAt,
        endsAt: times.endsAt,
        partySize: size,
        zonePreferenceId: zoneId,
        guestName: guestName.trim() || null,
        guestPhone: guestPhone.trim() || null,
        guestEmail: guestEmail.trim() || null,
        specialRequests: specialRequests.trim() || null,
        internalNotes: internalNotes.trim() || null,
        tableIds: selectedTableIds,
      });
      onBooked();
    } catch (err) {
      setFormError(mapBookingError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ ...cardStyle, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ fontSize: 15, margin: 0 }}>Νέα κράτηση (τηλεφωνική / walk-in)</h3>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 140 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Ημερομηνία</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 110 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Ώρα</label>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={inputStyle} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 130 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Διάρκεια (λεπτά)</label>
            <input type="number" min={15} step={15} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 90 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Άτομα</label>
            <input type="number" min={1} value={partySize} onChange={(e) => setPartySize(e.target.value)} style={inputStyle} />
          </div>
        </div>

        {zones.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Ζώνη προτίμησης</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setZoneId(null)} style={chipStyle({ selected: zoneId === null })}>
                Οποιαδήποτε
              </button>
              {zones.map((z) => (
                <button key={z.id} type="button" onClick={() => setZoneId(z.id)} style={chipStyle({ selected: zoneId === z.id })}>
                  {z.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 140 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Όνομα πελάτη</label>
            <input type="text" value={guestName} onChange={(e) => setGuestName(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 140 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Τηλέφωνο</label>
            <input type="tel" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} style={inputStyle} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Email (προαιρετικό)</label>
          <input type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Ειδικά αιτήματα</label>
          <input type="text" value={specialRequests} onChange={(e) => setSpecialRequests(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Εσωτερικές σημειώσεις (μόνο για το προσωπικό)</label>
          <input type="text" value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} style={inputStyle} />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" disabled={checking} onClick={() => void handleCheckAvailability()} style={buttonStyle('secondary', { disabled: checking })}>
            {checking ? 'Έλεγχος...' : 'Έλεγχος διαθεσιμότητας'}
          </button>
          {availability ? <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Επίλεξε τραπέζι ή άφησέ το σε αυτόματη ανάθεση</span> : null}
        </div>

        {availability ? (
          availability.tables.length === 0 && availability.combinations.length === 0 ? (
            <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>Δεν υπάρχει διαθέσιμο τραπέζι για αυτή την ώρα.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button type="button" onClick={() => setSelectedTableIds(null)} style={optionRowStyle(selectedTableIds === null)}>
                Αυτόματη ανάθεση (προτεινόμενο)
              </button>
              {availability.tables.map((table) => {
                const active = selectedTableIds?.length === 1 && selectedTableIds[0] === table.tableId;
                return (
                  <button key={table.tableId} type="button" onClick={() => setSelectedTableIds([table.tableId])} style={optionRowStyle(active)}>
                    {table.label} ({table.capacityMin}–{table.capacityMax}){table.isVip ? ' · VIP' : ''}
                  </button>
                );
              })}
              {availability.combinations.map((combo) => {
                const active = JSON.stringify(selectedTableIds) === JSON.stringify(combo.tableIds);
                return (
                  <button key={combo.combinationId} type="button" onClick={() => setSelectedTableIds(combo.tableIds)} style={optionRowStyle(active)}>
                    Συνδυασμός: {combo.name} ({combo.combinedCapacityMin}–{combo.combinedCapacityMax})
                  </button>
                );
              })}
            </div>
          )
        ) : null}

        {formError ? <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{formError}</p> : null}

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" disabled={submitting} style={buttonStyle('primary', { disabled: submitting, fullWidth: true })}>
            {submitting ? 'Καταχώρηση...' : 'Καταχώρηση κράτησης'}
          </button>
          <button type="button" onClick={onCancel} style={buttonStyle('ghost')}>
            Άκυρο
          </button>
        </div>
      </form>
    </div>
  );
}
