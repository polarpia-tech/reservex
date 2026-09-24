'use client';
import { fetchOpeningHours, replaceOpeningHours, type OpeningHoursShiftInput, type Restaurant } from '@reservex/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState, type CSSProperties } from 'react';

import { buttonStyle, cardStyle } from '@/lib/ui';

const DAY_LABEL = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

interface ShiftDraft {
  key: string;
  label: string;
  opensAt: string; // "HH:MM"
  closesAt: string; // "HH:MM"
}

interface DayDraft {
  dayOfWeek: number;
  isClosed: boolean;
  shifts: ShiftDraft[];
}

let shiftKeySeq = 0;
function newShiftKey() {
  shiftKeySeq += 1;
  return `shift-${shiftKeySeq}`;
}

function emptyWeek(): DayDraft[] {
  return DAY_LABEL.map((_, dayOfWeek) => ({ dayOfWeek, isClosed: false, shifts: [] }));
}

function toHHMM(time: string): string {
  return time.slice(0, 5); // "14:30:00" -> "14:30"
}

const timeInputStyle: CSSProperties = {
  fontFamily: 'var(--font-family)',
  fontSize: 14,
  padding: '8px 10px',
  borderRadius: 'var(--radius-md, 10px)',
  border: '1px solid var(--border)',
  background: 'var(--background)',
  color: 'inherit',
};

/**
 * Web port of the mobile app's app/(tabs)/settings/opening-hours.tsx --
 * same DayDraft/ShiftDraft model, same replaceOpeningHours "replace the
 * whole week" save (see that function's own header comment for why),
 * intentionally WITHOUT the special_hours (one-off exceptions) half of
 * that screen: a restaurant with zero rows in `opening_hours` rejects
 * EVERY public booking outright (is_restaurant_open_at() -- see
 * migration 0014), so a correct weekly schedule is what actually unblocks
 * going live today; one-off holiday exceptions are a real feature but not
 * a launch blocker, and can be added to this tab later without touching
 * this weekly section's own state or save path.
 */
export function OpeningHoursTab({ client, restaurant }: { client: SupabaseClient; restaurant: Restaurant }) {
  const [week, setWeek] = useState<DayDraft[]>(emptyWeek());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchOpeningHours(client, restaurant.id)
      .then((rows) => {
        if (cancelled) return;
        const byDay = emptyWeek();
        for (const row of rows) {
          const day = byDay[row.dayOfWeek];
          if (!day) continue;
          if (row.isClosed) {
            day.isClosed = true;
          } else {
            day.shifts.push({ key: newShiftKey(), label: row.label ?? '', opensAt: toHHMM(row.opensAt), closesAt: toHHMM(row.closesAt) });
          }
        }
        setWeek(byDay);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Δεν φορτώθηκαν οι ώρες λειτουργίας.');
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, restaurant.id]);

  function updateDay(dayOfWeek: number, patch: Partial<DayDraft>) {
    setSavedNotice(false);
    setWeek((prev) => prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d)));
  }

  function updateShift(dayOfWeek: number, key: string, patch: Partial<ShiftDraft>) {
    setSavedNotice(false);
    setWeek((prev) =>
      prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, shifts: d.shifts.map((s) => (s.key === key ? { ...s, ...patch } : s)) } : d)),
    );
  }

  function addShift(dayOfWeek: number) {
    setSavedNotice(false);
    setWeek((prev) =>
      prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, shifts: [...d.shifts, { key: newShiftKey(), label: '', opensAt: '', closesAt: '' }] } : d)),
    );
  }

  function removeShift(dayOfWeek: number, key: string) {
    setSavedNotice(false);
    setWeek((prev) => prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, shifts: d.shifts.filter((s) => s.key !== key) } : d)));
  }

  async function handleSave() {
    setError(null);
    const shifts: OpeningHoursShiftInput[] = [];

    for (const day of week) {
      if (day.isClosed) {
        shifts.push({ dayOfWeek: day.dayOfWeek, label: null, opensAt: '00:00:00', closesAt: '00:00:00', isClosed: true });
        continue;
      }
      for (const shift of day.shifts) {
        if (!shift.opensAt.trim() && !shift.closesAt.trim()) continue; // skip a blank, never-filled-in row
        if (!TIME_PATTERN.test(shift.opensAt) || !TIME_PATTERN.test(shift.closesAt)) {
          setError(`Έλεγξε τις ώρες για ${DAY_LABEL[day.dayOfWeek]} (μορφή ΩΩ:ΛΛ).`);
          return;
        }
        shifts.push({
          dayOfWeek: day.dayOfWeek,
          label: shift.label.trim() || null,
          opensAt: `${shift.opensAt}:00`,
          closesAt: `${shift.closesAt}:00`,
          isClosed: false,
        });
      }
    }

    setSaving(true);
    try {
      await replaceOpeningHours(client, restaurant.id, shifts);
      setSavedNotice(true);
    } catch {
      setError('Η αποθήκευση απέτυχε. Δοκίμασε ξανά.');
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Φόρτωση...</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
        Χωρίς ρυθμισμένες ώρες λειτουργίας οι πελάτες δεν μπορούν να κάνουν κράτηση — αυτό είναι απαραίτητο πριν δώσεις την εφαρμογή για χρήση.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {week.map((day) => (
          <div key={day.dayOfWeek} style={{ ...cardStyle, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{DAY_LABEL[day.dayOfWeek]}</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={day.isClosed}
                  onChange={(e) => updateDay(day.dayOfWeek, { isClosed: e.target.checked })}
                />
                Κλειστά
              </label>
            </div>

            {!day.isClosed ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                {day.shifts.length === 0 ? (
                  <p style={{ fontSize: 12.5, color: 'var(--text-faint, var(--text-muted))', margin: 0 }}>Δεν έχει οριστεί ωράριο ακόμα.</p>
                ) : null}
                {day.shifts.map((shift) => (
                  <div key={shift.key} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <input
                      type="time"
                      value={shift.opensAt}
                      onChange={(e) => updateShift(day.dayOfWeek, shift.key, { opensAt: e.target.value })}
                      style={timeInputStyle}
                    />
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>έως</span>
                    <input
                      type="time"
                      value={shift.closesAt}
                      onChange={(e) => updateShift(day.dayOfWeek, shift.key, { closesAt: e.target.value })}
                      style={timeInputStyle}
                    />
                    <input
                      type="text"
                      placeholder="π.χ. Βράδυ"
                      value={shift.label}
                      onChange={(e) => updateShift(day.dayOfWeek, shift.key, { label: e.target.value })}
                      style={{ ...timeInputStyle, width: 110 }}
                    />
                    <button
                      type="button"
                      onClick={() => removeShift(day.dayOfWeek, shift.key)}
                      style={{ ...buttonStyle('ghost', { size: 'md' }), padding: '6px 10px', minHeight: 32, fontSize: 12.5 }}
                    >
                      Αφαίρεση
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addShift(day.dayOfWeek)}
                  style={{ ...buttonStyle('secondary'), alignSelf: 'flex-start', padding: '6px 12px', minHeight: 32, fontSize: 12.5 }}
                >
                  + Ζώνη ωραρίου
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {error ? <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{error}</p> : null}
      {savedNotice ? <p style={{ color: 'var(--success)', fontSize: 13, margin: 0 }}>Αποθηκεύτηκε.</p> : null}

      <button type="button" disabled={saving} onClick={() => void handleSave()} style={buttonStyle('primary', { disabled: saving, fullWidth: true })}>
        {saving ? 'Αποθήκευση...' : 'Αποθήκευση ωραρίου'}
      </button>
    </div>
  );
}
