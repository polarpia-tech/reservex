'use client';
import {
  createTable,
  createTableZone,
  deleteTable,
  fetchTableZones,
  fetchTables,
  updateTable,
  type Restaurant,
  type RestaurantTable,
  type TableShape,
  type TableZone,
} from '@reservex/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react';

import { buttonStyle, cardStyle } from '@/lib/ui';

const SHAPES: { value: TableShape; label: string }[] = [
  { value: 'round', label: 'Στρογγυλό' },
  { value: 'square', label: 'Τετράγωνο' },
  { value: 'rectangle', label: 'Παραλληλόγραμμο' },
];

const inputStyle: CSSProperties = {
  fontFamily: 'var(--font-family)',
  fontSize: 14,
  padding: '9px 11px',
  borderRadius: 'var(--radius-md, 10px)',
  border: '1px solid var(--border)',
  background: 'var(--background)',
  color: 'inherit',
};

interface NewTableDraft {
  label: string;
  capacityMin: string;
  capacityMax: string;
  zoneId: string;
  isVip: boolean;
  isCombinable: boolean;
  shape: TableShape;
}

function emptyDraft(): NewTableDraft {
  return { label: '', capacityMin: '2', capacityMax: '4', zoneId: '', isVip: false, isCombinable: true, shape: 'square' };
}

/**
 * Tables are the OTHER hard requirement for going live (alongside opening
 * hours): book_reservation() (migration 0022) resolves every booking
 * through get_available_tables/get_available_table_combinations, so a
 * restaurant with zero rows in `tables` raises NO_AVAILABILITY on every
 * single attempt, exactly like zero opening_hours rows blocks it a
 * different way. This tab is deliberately structural-only (add/rename/
 * capacity/delete) -- it does NOT expose the live per-table status
 * (available/seated/occupied/cleaning/...) the floor view on mobile
 * manages in real time during service; that is a working-service tool,
 * this is a one-time (or occasional) setup tool. Zones are optional --
 * most small restaurants never need more than the default "no zone"
 * bucket, so the zone picker only appears once at least one zone exists,
 * plus a lightweight "+ zone" affordance to create the first one.
 */
export function TablesTab({ client, restaurant }: { client: SupabaseClient; restaurant: Restaurant }) {
  const [tables, setTables] = useState<RestaurantTable[] | null>(null);
  const [zones, setZones] = useState<TableZone[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<NewTableDraft>(emptyDraft());
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addingZone, setAddingZone] = useState(false);
  const [newZoneName, setNewZoneName] = useState('');

  const load = useCallback(() => {
    Promise.all([fetchTables(client, restaurant.id), fetchTableZones(client, restaurant.id)])
      .then(([t, z]) => {
        setTables(t);
        setZones(z);
      })
      .catch(() => setError('Δεν φορτώθηκαν τα τραπέζια.'));
  }, [client, restaurant.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreateZone(event: FormEvent) {
    event.preventDefault();
    if (!newZoneName.trim()) return;
    try {
      await createTableZone(client, restaurant.id, { name: newZoneName.trim(), zoneType: 'indoor' });
      setNewZoneName('');
      setAddingZone(false);
      load();
    } catch {
      setError('Η δημιουργία ζώνης απέτυχε.');
    }
  }

  async function handleCreateTable(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const capacityMin = Number.parseInt(draft.capacityMin, 10);
    const capacityMax = Number.parseInt(draft.capacityMax, 10);
    if (!draft.label.trim()) {
      setError('Δώσε όνομα/αριθμό τραπεζιού.');
      return;
    }
    if (!Number.isFinite(capacityMin) || !Number.isFinite(capacityMax) || capacityMin < 1 || capacityMax < capacityMin) {
      setError('Έλεγξε τη χωρητικότητα (ελάχιστη/μέγιστη).');
      return;
    }
    setCreating(true);
    try {
      await createTable(client, restaurant.id, {
        zoneId: draft.zoneId || null,
        label: draft.label.trim(),
        capacityMin,
        capacityMax,
        isVip: draft.isVip,
        isCombinable: draft.isCombinable,
        shape: draft.shape,
      });
      setDraft(emptyDraft());
      load();
    } catch {
      setError('Η δημιουργία τραπεζιού απέτυχε.');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(tableId: string) {
    setBusyId(tableId);
    try {
      await deleteTable(client, tableId);
      load();
    } catch {
      setError('Η διαγραφή απέτυχε.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleActive(table: RestaurantTable) {
    setBusyId(table.id);
    try {
      await updateTable(client, table.id, { isActive: !table.isActive });
      load();
    } catch {
      setError('Η ενημέρωση απέτυχε.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
        Χωρίς κανένα τραπέζι, καμία κράτηση δεν μπορεί να ολοκληρωθεί — πρόσθεσε τουλάχιστον όσα τραπέζια έχει πραγματικά το μαγαζί.
      </p>

      {error ? <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{error}</p> : null}

      {tables === null ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Φόρτωση...</p>
      ) : tables.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: 'center', color: 'var(--text-muted)' }}>Δεν έχει προστεθεί κανένα τραπέζι ακόμα.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tables.map((t) => (
            <div key={t.id} style={{ ...cardStyle, padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', opacity: t.isActive ? 1 : 0.5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{t.label}</span>
                <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                  {t.capacityMin}–{t.capacityMax} άτομα · {SHAPES.find((s) => s.value === t.shape)?.label ?? t.shape}
                  {t.isVip ? ' · VIP' : ''}
                  {zones.find((z) => z.id === t.zoneId) ? ` · ${zones.find((z) => z.id === t.zoneId)!.name}` : ''}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" disabled={busyId === t.id} onClick={() => handleToggleActive(t)} style={{ ...buttonStyle('ghost'), padding: '6px 12px', minHeight: 32, fontSize: 12.5 }}>
                  {t.isActive ? 'Απενεργοποίηση' : 'Ενεργοποίηση'}
                </button>
                <button type="button" disabled={busyId === t.id} onClick={() => void handleDelete(t.id)} style={{ ...buttonStyle('ghost'), padding: '6px 12px', minHeight: 32, fontSize: 12.5, color: 'var(--danger)' }}>
                  Διαγραφή
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ ...cardStyle, padding: 16 }}>
        <h3 style={{ fontSize: 15, marginTop: 0, marginBottom: 12 }}>Νέο τραπέζι</h3>
        <form onSubmit={handleCreateTable} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 100 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Όνομα/Αριθμός</label>
              <input type="text" value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} placeholder="π.χ. 5 ή Αυλή 2" style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 90 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Ελάχ. άτομα</label>
              <input type="number" min={1} value={draft.capacityMin} onChange={(e) => setDraft((d) => ({ ...d, capacityMin: e.target.value }))} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 90 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Μέγ. άτομα</label>
              <input type="number" min={1} value={draft.capacityMax} onChange={(e) => setDraft((d) => ({ ...d, capacityMax: e.target.value }))} style={inputStyle} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Σχήμα</label>
              <select value={draft.shape} onChange={(e) => setDraft((d) => ({ ...d, shape: e.target.value as TableShape }))} style={inputStyle}>
                {SHAPES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            {zones.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Ζώνη</label>
                <select value={draft.zoneId} onChange={(e) => setDraft((d) => ({ ...d, zoneId: e.target.value }))} style={inputStyle}>
                  <option value="">Χωρίς ζώνη</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>{z.name}</option>
                  ))}
                </select>
              </div>
            ) : null}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={draft.isVip} onChange={(e) => setDraft((d) => ({ ...d, isVip: e.target.checked }))} />
              VIP
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={draft.isCombinable} onChange={(e) => setDraft((d) => ({ ...d, isCombinable: e.target.checked }))} />
              Συνδυάζεται με άλλα
            </label>
          </div>

          {!addingZone ? (
            <button type="button" onClick={() => setAddingZone(true)} style={{ ...buttonStyle('ghost'), alignSelf: 'flex-start', padding: '6px 10px', minHeight: 28, fontSize: 12 }}>
              + Νέα ζώνη (π.χ. Αυλή, Εσωτερικό)
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="text" value={newZoneName} onChange={(e) => setNewZoneName(e.target.value)} placeholder="Όνομα ζώνης" style={{ ...inputStyle, flex: 1 }} />
              <button type="button" onClick={handleCreateZone} style={{ ...buttonStyle('secondary'), padding: '8px 12px', minHeight: 36, fontSize: 12.5 }}>
                Προσθήκη
              </button>
              <button type="button" onClick={() => { setAddingZone(false); setNewZoneName(''); }} style={{ ...buttonStyle('ghost'), padding: '8px 12px', minHeight: 36, fontSize: 12.5 }}>
                Άκυρο
              </button>
            </div>
          )}

          <button type="submit" disabled={creating} style={buttonStyle('primary', { disabled: creating, fullWidth: true })}>
            {creating ? 'Δημιουργία...' : 'Προσθήκη τραπεζιού'}
          </button>
        </form>
      </div>
    </div>
  );
}
