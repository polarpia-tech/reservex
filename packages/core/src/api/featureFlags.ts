import type { SupabaseClient } from '@supabase/supabase-js';

import type { FeatureFlag, UUID } from '../types/database';

// ---------------------------------------------------------------------------
// Phase 6 of the Live Availability upgrade: the OWNER-facing half of the
// feature_flags/feature_flag_overrides system (0010/0011/0020/0023/0024).
// Distinct from admin.ts's platform-wide feature flag admin functions --
// everything here only ever touches ONE restaurant's own override row,
// authorized by feature_flag_overrides_owner_write (0028), never the
// platform-admin RLS admin.ts relies on. See that migration's header
// comment for the full "why" (owner-configurable flags only, restaurant-
// scoped overrides only).
// ---------------------------------------------------------------------------

interface FeatureFlagRow {
  id: string;
  key: string;
  description: string | null;
  is_enabled_default: boolean;
  rollout_percentage: number;
  is_owner_configurable: boolean;
  created_at: string;
  updated_at: string;
}

function mapFeatureFlagRow(row: FeatureFlagRow): FeatureFlag {
  return {
    id: row.id,
    key: row.key,
    description: row.description,
    isEnabledDefault: row.is_enabled_default,
    rolloutPercentage: row.rollout_percentage,
    isOwnerConfigurable: row.is_owner_configurable,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface FeatureFlagOverrideRow {
  id: string;
  flag_id: string;
  is_enabled: boolean;
}

export interface OwnerConfigurableFlag {
  flag: FeatureFlag;
  /** The EFFECTIVE current state for this one restaurant: restaurant override > organization override > platform default -- same precedence is_feature_enabled_for_restaurant() (0024) resolves for the public page, kept consistent here by hand since this is a small, list-shaped read rather than that function's single-flag scalar RPC (see 0024's own comment: nothing else in the codebase resolved this precedence before it, so any second place that does must match it exactly). */
  isEnabled: boolean;
  /** Present only once this restaurant has its OWN override row (i.e. the owner has touched this flag at least once) -- null means the value shown is still the organization override or the platform default. Not currently used by the mobile screen (it always upserts), kept for a future "reset to default" affordance. */
  overrideId: UUID | null;
}

/**
 * Every flag this restaurant's owner/manager is allowed to self-toggle
 * (is_owner_configurable = true), resolved to its effective current state.
 * Three plain, RLS-scoped reads (feature_flags_select and
 * feature_flag_overrides_select, both 0011) -- no new database function,
 * matching admin.ts's own "plain RLS CRUD, not SECURITY DEFINER" choice for
 * this exact pair of tables.
 */
export async function fetchOwnerConfigurableFlags(
  client: SupabaseClient,
  restaurantId: UUID,
  organizationId: UUID,
): Promise<OwnerConfigurableFlag[]> {
  const [flagsResult, restaurantOverridesResult, orgOverridesResult] = await Promise.all([
    client.from('feature_flags').select('*').eq('is_owner_configurable', true).order('key'),
    client.from('feature_flag_overrides').select('id, flag_id, is_enabled').eq('restaurant_id', restaurantId),
    client.from('feature_flag_overrides').select('id, flag_id, is_enabled').eq('organization_id', organizationId),
  ]);
  if (flagsResult.error) throw flagsResult.error;
  if (restaurantOverridesResult.error) throw restaurantOverridesResult.error;
  if (orgOverridesResult.error) throw orgOverridesResult.error;

  const flags = (flagsResult.data as unknown as FeatureFlagRow[]).map(mapFeatureFlagRow);
  const restaurantOverrides = restaurantOverridesResult.data as unknown as FeatureFlagOverrideRow[];
  const orgOverrides = orgOverridesResult.data as unknown as FeatureFlagOverrideRow[];

  return flags.map((flag) => {
    const restaurantOverride = restaurantOverrides.find((o) => o.flag_id === flag.id);
    if (restaurantOverride) return { flag, isEnabled: restaurantOverride.is_enabled, overrideId: restaurantOverride.id };

    const orgOverride = orgOverrides.find((o) => o.flag_id === flag.id);
    if (orgOverride) return { flag, isEnabled: orgOverride.is_enabled, overrideId: orgOverride.id };

    return { flag, isEnabled: flag.isEnabledDefault, overrideId: null };
  });
}

/**
 * Sets this restaurant's own override row for one owner-configurable flag
 * -- idempotent, so toggling a switch on/off/on again always ends up with
 * exactly one restaurant_id+flag_id row (never a duplicate). Deliberately
 * NOT a plain `.upsert(..., { onConflict: 'flag_id,restaurant_id' })':
 * the only unique index covering that column pair,
 * uidx_flag_override_restaurant (0010), is a PARTIAL index (`where
 * restaurant_id is not null` -- required by the feature_flag_override_target
 * CHECK constraint, which forces exactly one of restaurant_id/organization_id
 * to be set). PostgREST's upsert always emits a bare
 * `ON CONFLICT (flag_id, restaurant_id) DO UPDATE ...` with no WHERE
 * predicate, and Postgres refuses to infer a partial unique index without
 * one ("there is no unique or exclusion constraint matching the ON
 * CONFLICT specification") -- confirmed locally against the real partial
 * index before this was ever shipped. A plain select-then-write sidesteps
 * that: a human tapping one Switch is not a concurrency-sensitive path, so
 * the small window between the read and the write here is an acceptable
 * trade for staying on plain RLS CRUD (this whole API deliberately avoids
 * a SECURITY DEFINER function -- see this file's header comment).
 * feature_flag_overrides_owner_write (0028) is what actually authorizes
 * the write: an attempt on a flag that isn't is_owner_configurable, or a
 * restaurant this caller isn't owner/manager of, is rejected by RLS (a
 * Postgres error), not by any check in this function.
 */
export async function setOwnerFeatureFlag(client: SupabaseClient, restaurantId: UUID, flagId: UUID, isEnabled: boolean): Promise<void> {
  const { data: existing, error: selectError } = await client
    .from('feature_flag_overrides')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('flag_id', flagId)
    .maybeSingle();
  if (selectError) throw selectError;

  if (existing) {
    const { error } = await client.from('feature_flag_overrides').update({ is_enabled: isEnabled }).eq('id', (existing as { id: string }).id);
    if (error) throw error;
  } else {
    const { error } = await client.from('feature_flag_overrides').insert({ flag_id: flagId, restaurant_id: restaurantId, is_enabled: isEnabled });
    if (error) throw error;
  }
}
