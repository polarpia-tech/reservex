import type { SupabaseClient } from '@supabase/supabase-js';

import type { TableCombination, UUID } from '../types/database';

interface TableCombinationRow {
  id: string;
  restaurant_id: string;
  name: string;
  combined_capacity_min: number;
  combined_capacity_max: number;
  is_active: boolean;
  table_combination_members: { table_id: string }[] | null;
}

const SELECT_WITH_MEMBERS = '*, table_combination_members(table_id)';

function mapRow(row: TableCombinationRow): TableCombination {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    combinedCapacityMin: row.combined_capacity_min,
    combinedCapacityMax: row.combined_capacity_max,
    isActive: row.is_active,
    tableIds: (row.table_combination_members ?? []).map((m) => m.table_id),
  };
}

export async function fetchTableCombinations(client: SupabaseClient, restaurantId: UUID): Promise<TableCombination[]> {
  const { data, error } = await client
    .from('table_combinations')
    .select(SELECT_WITH_MEMBERS)
    .eq('restaurant_id', restaurantId)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data as unknown as TableCombinationRow[]).map(mapRow);
}

export interface TableCombinationInput {
  name: string;
  combinedCapacityMin: number;
  combinedCapacityMax: number;
  tableIds: UUID[];
}

/**
 * Two statements, not one transaction -- table_combinations and
 * table_combination_members are both owner/manager-only writes (0011), and
 * there's no concurrency hazard here the way there is for reservations (no
 * two people are racing to define the same combination at the same
 * instant), so a plain sequential insert is the simpler, honest choice
 * rather than reaching for another SECURITY INVOKER SQL function.
 */
export async function createTableCombination(client: SupabaseClient, restaurantId: UUID, input: TableCombinationInput): Promise<UUID> {
  const { data, error } = await client
    .from('table_combinations')
    .insert({
      restaurant_id: restaurantId,
      name: input.name,
      combined_capacity_min: input.combinedCapacityMin,
      combined_capacity_max: input.combinedCapacityMax,
    })
    .select('id')
    .single();
  if (error) throw error;
  const combinationId = (data as { id: string }).id;

  const { error: membersError } = await client
    .from('table_combination_members')
    .insert(input.tableIds.map((tableId) => ({ combination_id: combinationId, table_id: tableId })));
  if (membersError) throw membersError;

  return combinationId;
}

export interface TableCombinationUpdate {
  name?: string;
  combinedCapacityMin?: number;
  combinedCapacityMax?: number;
  isActive?: boolean;
  /** When provided, fully replaces the member table list (delete-then-insert, same pattern as openingHours.ts's replaceOpeningHours). */
  tableIds?: UUID[];
}

export async function updateTableCombination(client: SupabaseClient, combinationId: UUID, patch: TableCombinationUpdate): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.combinedCapacityMin !== undefined) row.combined_capacity_min = patch.combinedCapacityMin;
  if (patch.combinedCapacityMax !== undefined) row.combined_capacity_max = patch.combinedCapacityMax;
  if (patch.isActive !== undefined) row.is_active = patch.isActive;

  if (Object.keys(row).length > 0) {
    const { error } = await client.from('table_combinations').update(row).eq('id', combinationId);
    if (error) throw error;
  }

  if (patch.tableIds !== undefined) {
    const { error: deleteError } = await client.from('table_combination_members').delete().eq('combination_id', combinationId);
    if (deleteError) throw deleteError;
    if (patch.tableIds.length > 0) {
      const { error: insertError } = await client
        .from('table_combination_members')
        .insert(patch.tableIds.map((tableId) => ({ combination_id: combinationId, table_id: tableId })));
      if (insertError) throw insertError;
    }
  }
}

/** Hard delete -- safe here (unlike tables themselves): a combination has no foreign keys pointing at it from reservation history, only its own members (on delete cascade). */
export async function deleteTableCombination(client: SupabaseClient, combinationId: UUID): Promise<void> {
  const { error } = await client.from('table_combinations').delete().eq('id', combinationId);
  if (error) throw error;
}
