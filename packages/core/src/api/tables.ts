import type { SupabaseClient } from '@supabase/supabase-js';

import type { RestaurantTable, TableShape, TableStatus, TableZone, TableZoneType, UUID } from '../types/database';

// ---- table_zones -----------------------------------------------------------

interface TableZoneRow {
  id: string;
  restaurant_id: string;
  name: string;
  zone_type: TableZoneType;
  sort_order: number;
  is_active: boolean;
}

function mapZoneRow(row: TableZoneRow): TableZone {
  return { id: row.id, restaurantId: row.restaurant_id, name: row.name, zoneType: row.zone_type, sortOrder: row.sort_order, isActive: row.is_active };
}

export async function fetchTableZones(client: SupabaseClient, restaurantId: UUID): Promise<TableZone[]> {
  const { data, error } = await client
    .from('table_zones')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapZoneRow);
}

export interface TableZoneInput {
  name: string;
  zoneType: TableZoneType;
  sortOrder?: number;
}

/** Owner/manager only -- gated by the `table_zones_write` RLS policy (0011), same as every write below. */
export async function createTableZone(client: SupabaseClient, restaurantId: UUID, input: TableZoneInput): Promise<TableZone> {
  const { data, error } = await client
    .from('table_zones')
    .insert({ restaurant_id: restaurantId, name: input.name, zone_type: input.zoneType, sort_order: input.sortOrder ?? 0 })
    .select('*')
    .single();
  if (error) throw error;
  return mapZoneRow(data as TableZoneRow);
}

export interface TableZoneUpdate {
  name?: string;
  zoneType?: TableZoneType;
  sortOrder?: number;
  isActive?: boolean;
}

export async function updateTableZone(client: SupabaseClient, zoneId: UUID, patch: TableZoneUpdate): Promise<TableZone> {
  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.zoneType !== undefined) payload.zone_type = patch.zoneType;
  if (patch.sortOrder !== undefined) payload.sort_order = patch.sortOrder;
  if (patch.isActive !== undefined) payload.is_active = patch.isActive;

  const { data, error } = await client.from('table_zones').update(payload).eq('id', zoneId).select('*').single();
  if (error) throw error;
  return mapZoneRow(data as TableZoneRow);
}

/**
 * Hard delete. Safe by design, not just by convention: `tables.zone_id` is
 * `references public.table_zones(id) on delete set null` (migration 0003),
 * so any table in this zone becomes unzoned rather than being deleted or
 * orphaned -- confirmed by reading that foreign key, not assumed.
 */
export async function deleteTableZone(client: SupabaseClient, zoneId: UUID): Promise<void> {
  const { error } = await client.from('table_zones').delete().eq('id', zoneId);
  if (error) throw error;
}

// ---- tables ------------------------------------------------------------

interface TableRow {
  id: string;
  restaurant_id: string;
  zone_id: string | null;
  label: string;
  capacity_min: number;
  capacity_max: number;
  is_vip: boolean;
  is_combinable: boolean;
  shape: TableShape;
  status: TableStatus;
  is_active: boolean;
}

function mapTableRow(row: TableRow): RestaurantTable {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    zoneId: row.zone_id,
    label: row.label,
    capacityMin: row.capacity_min,
    capacityMax: row.capacity_max,
    isVip: row.is_vip,
    isCombinable: row.is_combinable,
    shape: row.shape,
    status: row.status,
    isActive: row.is_active,
  };
}

/** deleted_at is a soft-delete column (migration 0003) -- always excluded here; use setTableActive for a reversible disable, deleteTable only for a genuine mistake. */
export async function fetchTables(client: SupabaseClient, restaurantId: UUID): Promise<RestaurantTable[]> {
  const { data, error } = await client
    .from('tables')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .is('deleted_at', null)
    .order('label', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapTableRow);
}

export interface TableInput {
  zoneId: UUID | null;
  label: string;
  capacityMin: number;
  capacityMax: number;
  isVip: boolean;
  isCombinable: boolean;
  shape: TableShape;
}

/** Structural creation -- owner/manager only (`tables_insert` RLS policy, 0011). */
export async function createTable(client: SupabaseClient, restaurantId: UUID, input: TableInput): Promise<RestaurantTable> {
  const { data, error } = await client
    .from('tables')
    .insert({
      restaurant_id: restaurantId,
      zone_id: input.zoneId,
      label: input.label,
      capacity_min: input.capacityMin,
      capacity_max: input.capacityMax,
      is_vip: input.isVip,
      is_combinable: input.isCombinable,
      shape: input.shape,
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapTableRow(data as TableRow);
}

export interface TableUpdate {
  zoneId?: UUID | null;
  label?: string;
  capacityMin?: number;
  capacityMax?: number;
  isVip?: boolean;
  isCombinable?: boolean;
  shape?: TableShape;
  status?: TableStatus;
  isActive?: boolean;
}

/**
 * One generic update function for everything from "mark this table
 * cleaning" to "rename it and change its capacity" -- because, as of this
 * phase, there is exactly ONE `tables_update` RLS policy (0011) and it
 * grants it to any active staff member, not just owner/manager. That means
 * the split this app's UI makes -- quick status changes for everyone,
 * structural edits (label/capacity/zone/shape) hidden from non-owner/
 * manager -- is a UI convention, not a database-enforced boundary. Same
 * honest disclosure as Phase 05's "Roles explained" screen: fine-grained,
 * per-field permissions are not built yet (`permission_overrides` remains
 * the reserved escape hatch for that). Do not describe structural table
 * edits as "owner/manager only" at the database level -- only status
 * changes and the create/delete of a table are actually enforced that way.
 */
export async function updateTable(client: SupabaseClient, tableId: UUID, patch: TableUpdate): Promise<RestaurantTable> {
  const payload: Record<string, unknown> = {};
  if (patch.zoneId !== undefined) payload.zone_id = patch.zoneId;
  if (patch.label !== undefined) payload.label = patch.label;
  if (patch.capacityMin !== undefined) payload.capacity_min = patch.capacityMin;
  if (patch.capacityMax !== undefined) payload.capacity_max = patch.capacityMax;
  if (patch.isVip !== undefined) payload.is_vip = patch.isVip;
  if (patch.isCombinable !== undefined) payload.is_combinable = patch.isCombinable;
  if (patch.shape !== undefined) payload.shape = patch.shape;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.isActive !== undefined) payload.is_active = patch.isActive;

  const { data, error } = await client.from('tables').update(payload).eq('id', tableId).select('*').single();
  if (error) throw error;
  return mapTableRow(data as TableRow);
}

/**
 * Soft delete: sets `deleted_at`, same pattern as `restaurants`, `customers`
 * and `events` elsewhere in this schema -- NOT a SQL `DELETE`, even though
 * a `tables_delete` RLS policy also exists for that. Deliberate choice: once
 * a table has ever been part of a reservation, `reservation_tables.table_id`
 * references it with `on delete restrict` (migration 0006), so a real hard
 * delete would simply fail the moment the table has any booking history --
 * which, for a restaurant that has been open for more than a day, is most
 * tables. Soft-deleting keeps the row (and reservation history) intact
 * while `fetchTables()`'s `is('deleted_at', null)` filter hides it from
 * every normal view. This is a plain client-side UPDATE, so -- like every
 * other write to `tables` -- it goes through the single `tables_update` RLS
 * policy (any active staff member), not an owner/manager-only one; the
 * "Delete" action is hidden from non-owner/manager in the UI as a
 * convention, same disclosed gap as the rest of this file.
 */
export async function deleteTable(client: SupabaseClient, tableId: UUID): Promise<void> {
  const { error } = await client.from('tables').update({ deleted_at: new Date().toISOString() }).eq('id', tableId);
  if (error) throw error;
}
