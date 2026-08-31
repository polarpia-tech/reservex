import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  AdminOrganizationSummary,
  AdminRestaurantSummary,
  FeatureFlag,
  FeatureFlagOverride,
  PlatformAdmin,
  PlatformAdminRole,
  Restaurant,
  Subscription,
  SubscriptionStatus,
  UUID,
} from '../types/database';

// ---------------------------------------------------------------------------
// Phase 13: Admin πλατφόρμας. Every write here (suspend/unsuspend a
// restaurant, override a subscription, grant/revoke platform-admin access)
// goes through a SECURITY DEFINER SQL function (migration 0020), not plain
// RLS CRUD -- these are cross-tenant, privileged operations, and each
// function checks is_platform_admin()/is_platform_super_admin() itself and
// writes its own audit_logs row. This file is a thin, typed wrapper around
// those RPCs, same shape as api/payments.ts's wrappers around its Edge
// Functions -- the difference is these are plain `client.rpc()` calls (SQL
// functions, callable directly by `authenticated` under Postgres's normal
// grant model), not `client.functions.invoke()` (Edge Functions).
//
// isPlatformAdmin()/isPlatformSuperAdmin() below are what the admin app
// calls right after sign-in to decide whether to show ANY of this UI at
// all -- an ordinary restaurant staff or customer account gets `false` and
// never sees an admin screen exists.
// ---------------------------------------------------------------------------

export async function isPlatformAdmin(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client.rpc('is_platform_admin');
  if (error) throw error;
  return Boolean(data);
}

export async function isPlatformSuperAdmin(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client.rpc('is_platform_super_admin');
  if (error) throw error;
  return Boolean(data);
}

interface AdminOrganizationRow {
  organization_id: string;
  organization_name: string;
  owner_email: string;
  billing_email: string | null;
  restaurant_count: number;
  subscription_status: SubscriptionStatus | null;
  plan_code: string | null;
  trial_ends_at: string | null;
  created_at: string;
}

function mapAdminOrganizationRow(row: AdminOrganizationRow): AdminOrganizationSummary {
  return {
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    ownerEmail: row.owner_email,
    billingEmail: row.billing_email,
    restaurantCount: Number(row.restaurant_count),
    subscriptionStatus: row.subscription_status,
    planCode: row.plan_code,
    trialEndsAt: row.trial_ends_at,
    createdAt: row.created_at,
  };
}

/** admin_list_organizations() -- one row per organization, owner email + current subscription. Raises NOT_AUTHORIZED (surfaced as a thrown PostgrestError) for anyone who isn't an active platform admin. */
export async function fetchAdminOrganizations(client: SupabaseClient): Promise<AdminOrganizationSummary[]> {
  const { data, error } = await client.rpc('admin_list_organizations');
  if (error) throw error;
  return (data as AdminOrganizationRow[]).map(mapAdminOrganizationRow);
}

interface AdminRestaurantRow {
  restaurant_id: string;
  organization_id: string;
  name: string;
  slug: string;
  restaurant_type: Restaurant['restaurantType'];
  city: string | null;
  country_code: string | null;
  is_active: boolean;
  suspended_by_platform_at: string | null;
  suspension_reason: string | null;
  created_at: string;
}

function mapAdminRestaurantRow(row: AdminRestaurantRow): AdminRestaurantSummary {
  return {
    restaurantId: row.restaurant_id,
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    restaurantType: row.restaurant_type,
    city: row.city,
    countryCode: row.country_code,
    isActive: row.is_active,
    suspendedByPlatformAt: row.suspended_by_platform_at,
    suspensionReason: row.suspension_reason,
    createdAt: row.created_at,
  };
}

/** admin_list_restaurants(organizationId) -- pass null/undefined for every restaurant on the platform, or an organizationId to scope to one. */
export async function fetchAdminRestaurants(client: SupabaseClient, organizationId?: UUID | null): Promise<AdminRestaurantSummary[]> {
  const { data, error } = await client.rpc('admin_list_restaurants', { p_organization_id: organizationId ?? null });
  if (error) throw error;
  return (data as AdminRestaurantRow[]).map(mapAdminRestaurantRow);
}

export async function suspendRestaurant(client: SupabaseClient, restaurantId: UUID, reason: string): Promise<void> {
  const { error } = await client.rpc('admin_suspend_restaurant', { p_restaurant_id: restaurantId, p_reason: reason });
  if (error) throw error;
}

export async function unsuspendRestaurant(client: SupabaseClient, restaurantId: UUID): Promise<void> {
  const { error } = await client.rpc('admin_unsuspend_restaurant', { p_restaurant_id: restaurantId });
  if (error) throw error;
}

interface SubscriptionRow {
  id: string;
  organization_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

function mapSubscriptionRow(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    organizationId: row.organization_id,
    planId: row.plan_id,
    status: row.status,
    trialEndsAt: row.trial_ends_at,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
  };
}

export interface SetSubscriptionInput {
  organizationId: UUID;
  planCode: string;
  status: SubscriptionStatus;
  trialEndsAt?: string | null;
  currentPeriodEnd?: string | null;
  reason?: string | null;
}

/** admin_set_subscription() -- manually sets an organization's plan/status with no Stripe involvement (provider_subscription_id stays null on the new row). Retires any existing non-terminal subscription first, same sequence the stripe-webhook upsert (Phase 12) uses. */
export async function setOrganizationSubscription(client: SupabaseClient, input: SetSubscriptionInput): Promise<Subscription> {
  const { data, error } = await client.rpc('admin_set_subscription', {
    p_organization_id: input.organizationId,
    p_plan_code: input.planCode,
    p_status: input.status,
    p_trial_ends_at: input.trialEndsAt ?? null,
    p_current_period_end: input.currentPeriodEnd ?? null,
    p_reason: input.reason ?? null,
  });
  if (error) throw error;
  return mapSubscriptionRow(data as SubscriptionRow);
}

/** admin_list_subscription_history() -- every subscription row (including retired ones) an organization has ever had, newest first. */
export async function fetchOrganizationSubscriptionHistory(client: SupabaseClient, organizationId: UUID): Promise<Subscription[]> {
  const { data, error } = await client.rpc('admin_list_subscription_history', { p_organization_id: organizationId });
  if (error) throw error;
  return (data as SubscriptionRow[]).map(mapSubscriptionRow);
}

interface PlatformAdminRow {
  id: string;
  user_id: string;
  email: string;
  role: PlatformAdminRole;
  is_active: boolean;
  granted_by_email: string | null;
  created_at: string;
}

function mapPlatformAdminRow(row: PlatformAdminRow): PlatformAdmin {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    role: row.role,
    isActive: row.is_active,
    grantedByEmail: row.granted_by_email,
    createdAt: row.created_at,
  };
}

/** admin_list_platform_admins() -- the full roster, active and revoked. Any active platform admin (either role) may see it -- only granting/revoking is super_admin-only. */
export async function fetchPlatformAdmins(client: SupabaseClient): Promise<PlatformAdmin[]> {
  const { data, error } = await client.rpc('admin_list_platform_admins');
  if (error) throw error;
  return (data as PlatformAdminRow[]).map(mapPlatformAdminRow);
}

/** admin_grant_platform_admin() -- super_admin only. Looks up p_email in auth.users server-side; throws USER_NOT_FOUND if no account exists with that email yet (they must sign up normally first -- there is no invite-by-email flow). */
export async function grantPlatformAdmin(client: SupabaseClient, email: string, role: PlatformAdminRole = 'support'): Promise<PlatformAdmin> {
  const { data, error } = await client.rpc('admin_grant_platform_admin', { p_email: email, p_role: role });
  if (error) throw error;
  return mapPlatformAdminRow(data as PlatformAdminRow);
}

/** admin_revoke_platform_admin() -- super_admin only. Refuses to revoke the last active super_admin (CANNOT_REVOKE_LAST_SUPER_ADMIN). Soft-revoke: the row is kept, is_active becomes false. */
export async function revokePlatformAdmin(client: SupabaseClient, userId: UUID): Promise<void> {
  const { error } = await client.rpc('admin_revoke_platform_admin', { p_user_id: userId });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Feature flags. Plain RLS CRUD (feature_flags_platform_write /
// feature_flag_overrides_platform_write, 0020) -- not SECURITY DEFINER
// functions, see that migration's own header comment for why: flags are
// non-monetary, fully reversible, and touch no auth.users data.
// ---------------------------------------------------------------------------
interface FeatureFlagRow {
  id: string;
  key: string;
  description: string | null;
  is_enabled_default: boolean;
  rollout_percentage: number;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** feature_flags_select (0011) -- readable by ANY signed-in user, not just platform admins (an app may want to check its own flags). Writing (this file's create/update/deleteFeatureFlag below) is platform-admin only. */
export async function fetchFeatureFlags(client: SupabaseClient): Promise<FeatureFlag[]> {
  const { data, error } = await client.from('feature_flags').select('*').order('key');
  if (error) throw error;
  return (data as unknown as FeatureFlagRow[]).map(mapFeatureFlagRow);
}

export interface FeatureFlagInput {
  key: string;
  description?: string | null;
  isEnabledDefault?: boolean;
  rolloutPercentage?: number;
}

export async function createFeatureFlag(client: SupabaseClient, input: FeatureFlagInput): Promise<FeatureFlag> {
  const { data, error } = await client
    .from('feature_flags')
    .insert({
      key: input.key,
      description: input.description ?? null,
      is_enabled_default: input.isEnabledDefault ?? false,
      rollout_percentage: input.rolloutPercentage ?? 0,
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapFeatureFlagRow(data as unknown as FeatureFlagRow);
}

export async function updateFeatureFlag(client: SupabaseClient, flagId: UUID, patch: Partial<FeatureFlagInput>): Promise<FeatureFlag> {
  const payload: Record<string, unknown> = {};
  if (patch.description !== undefined) payload.description = patch.description;
  if (patch.isEnabledDefault !== undefined) payload.is_enabled_default = patch.isEnabledDefault;
  if (patch.rolloutPercentage !== undefined) payload.rollout_percentage = patch.rolloutPercentage;
  const { data, error } = await client.from('feature_flags').update(payload).eq('id', flagId).select('*').single();
  if (error) throw error;
  return mapFeatureFlagRow(data as unknown as FeatureFlagRow);
}

export async function deleteFeatureFlag(client: SupabaseClient, flagId: UUID): Promise<void> {
  const { error } = await client.from('feature_flags').delete().eq('id', flagId);
  if (error) throw error;
}

interface FeatureFlagOverrideRow {
  id: string;
  flag_id: string;
  organization_id: string | null;
  restaurant_id: string | null;
  is_enabled: boolean;
  created_at: string;
}

function mapFeatureFlagOverrideRow(row: FeatureFlagOverrideRow): FeatureFlagOverride {
  return {
    id: row.id,
    flagId: row.flag_id,
    organizationId: row.organization_id,
    restaurantId: row.restaurant_id,
    isEnabled: row.is_enabled,
    createdAt: row.created_at,
  };
}

/** feature_flag_overrides_platform_select (0020) -- every override across the whole platform, for the admin UI. A restaurant/organization's OWN read of just its own overrides goes through the pre-existing 0011 policy instead, via the same table -- this wrapper is admin-only in practice because the platform-wide query only returns complete results for an admin caller. */
export async function fetchFeatureFlagOverrides(client: SupabaseClient, flagId?: UUID): Promise<FeatureFlagOverride[]> {
  let query = client.from('feature_flag_overrides').select('*').order('created_at', { ascending: false });
  if (flagId) query = query.eq('flag_id', flagId);
  const { data, error } = await query;
  if (error) throw error;
  return (data as unknown as FeatureFlagOverrideRow[]).map(mapFeatureFlagOverrideRow);
}

export interface SetFeatureFlagOverrideInput {
  flagId: UUID;
  organizationId?: UUID | null;
  restaurantId?: UUID | null;
  isEnabled: boolean;
}

/** Exactly one of organizationId/restaurantId must be set -- enforced server-side by feature_flag_override_target (0010)'s CHECK constraint. */
export async function setFeatureFlagOverride(client: SupabaseClient, input: SetFeatureFlagOverrideInput): Promise<FeatureFlagOverride> {
  const { data, error } = await client
    .from('feature_flag_overrides')
    .insert({
      flag_id: input.flagId,
      organization_id: input.organizationId ?? null,
      restaurant_id: input.restaurantId ?? null,
      is_enabled: input.isEnabled,
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapFeatureFlagOverrideRow(data as unknown as FeatureFlagOverrideRow);
}

export async function deleteFeatureFlagOverride(client: SupabaseClient, overrideId: UUID): Promise<void> {
  const { error } = await client.from('feature_flag_overrides').delete().eq('id', overrideId);
  if (error) throw error;
}
