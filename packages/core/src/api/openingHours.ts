import type { SupabaseClient } from '@supabase/supabase-js';

import type { ISODate, OpeningHours, SpecialHours, UUID } from '../types/database';

interface OpeningHoursRow {
  id: string;
  restaurant_id: string;
  day_of_week: number;
  label: string | null;
  opens_at: string;
  closes_at: string;
  is_closed: boolean;
}

function mapOpeningHoursRow(row: OpeningHoursRow): OpeningHours {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    dayOfWeek: row.day_of_week,
    label: row.label,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    isClosed: row.is_closed,
  };
}

export async function fetchOpeningHours(client: SupabaseClient, restaurantId: UUID): Promise<OpeningHours[]> {
  const { data, error } = await client
    .from('opening_hours')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('day_of_week', { ascending: true })
    .order('opens_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapOpeningHoursRow);
}

export interface OpeningHoursShiftInput {
  dayOfWeek: number;
  label: string | null;
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
}

/**
 * Replaces the ENTIRE weekly schedule for a restaurant in one call, rather
 * than patching individual rows. Chosen deliberately over row-by-row
 * upsert/diff logic: the mobile screen always edits "the week" as a whole
 * (see app/(tabs)/settings/opening-hours.tsx), so a delete-then-insert
 * inside one request has simple, predictable semantics and there is no
 * multi-user concurrent-editing scenario for one restaurant's own hours
 * that would make that a real risk at this scale. If that ever changes,
 * this is the one place to revisit -- not a reason to build it now.
 */
export async function replaceOpeningHours(
  client: SupabaseClient,
  restaurantId: UUID,
  shifts: OpeningHoursShiftInput[],
): Promise<OpeningHours[]> {
  const { error: deleteError } = await client.from('opening_hours').delete().eq('restaurant_id', restaurantId);
  if (deleteError) throw deleteError;

  if (shifts.length === 0) return [];

  const { data, error: insertError } = await client
    .from('opening_hours')
    .insert(
      shifts.map((shift) => ({
        restaurant_id: restaurantId,
        day_of_week: shift.dayOfWeek,
        label: shift.label,
        opens_at: shift.opensAt,
        closes_at: shift.closesAt,
        is_closed: shift.isClosed,
      })),
    )
    .select('*');
  if (insertError) throw insertError;
  return (data ?? []).map(mapOpeningHoursRow);
}

// ---- special_hours: one-off exceptions (holidays, private buyouts) --------

interface SpecialHoursRow {
  id: string;
  restaurant_id: string;
  date: string;
  opens_at: string | null;
  closes_at: string | null;
  is_closed: boolean;
  reason: string | null;
}

function mapSpecialHoursRow(row: SpecialHoursRow): SpecialHours {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    date: row.date,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    isClosed: row.is_closed,
    reason: row.reason,
  };
}

export async function fetchSpecialHours(client: SupabaseClient, restaurantId: UUID): Promise<SpecialHours[]> {
  const { data, error } = await client
    .from('special_hours')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('date', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapSpecialHoursRow);
}

export interface SpecialHoursInput {
  date: ISODate;
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean;
  reason: string | null;
}

/** One row per date (unique constraint on restaurant_id+date) -- upsert on conflict rather than insert-only, so editing an existing exception just overwrites it. */
export async function upsertSpecialHours(
  client: SupabaseClient,
  restaurantId: UUID,
  input: SpecialHoursInput,
): Promise<SpecialHours> {
  const { data, error } = await client
    .from('special_hours')
    .upsert(
      {
        restaurant_id: restaurantId,
        date: input.date,
        opens_at: input.opensAt,
        closes_at: input.closesAt,
        is_closed: input.isClosed,
        reason: input.reason,
      },
      { onConflict: 'restaurant_id,date' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return mapSpecialHoursRow(data as SpecialHoursRow);
}

export async function deleteSpecialHours(client: SupabaseClient, specialHoursId: UUID): Promise<void> {
  const { error } = await client.from('special_hours').delete().eq('id', specialHoursId);
  if (error) throw error;
}
