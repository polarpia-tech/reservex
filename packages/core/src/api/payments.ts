import type { SupabaseClient } from '@supabase/supabase-js';

import type { DepositPolicy, DepositQuote, Payment, Subscription, SubscriptionPlan, UUID } from '../types/database';

// ---------------------------------------------------------------------------
// Phase 12: Payments & billing.
//
// deposit_policies is plain RLS-backed client CRUD (deposit_policies_write,
// 0011, already allowed owner/manager direct writes since Phase 02 -- no
// Edge Function needed for policy CONFIGURATION, only for actually moving
// money). Everything that touches Stripe goes through the Edge Functions
// below -- payments/subscriptions have no client-role write policy at all
// (0011's comment: "money actually moves only via Edge Functions + provider
// webhooks running as service role").
// ---------------------------------------------------------------------------

interface DepositPolicyRow {
  id: string;
  restaurant_id: string;
  name: string;
  applies_to: DepositPolicy['appliesTo'];
  calculation_type: DepositPolicy['calculationType'];
  amount_cents: number | null;
  percentage: number | null;
  percentage_base_amount_cents: number | null;
  party_size_threshold: number | null;
  cancellation_window_hours: number;
  refund_policy_text: string | null;
  is_active: boolean;
}

function mapDepositPolicyRow(row: DepositPolicyRow): DepositPolicy {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    appliesTo: row.applies_to,
    calculationType: row.calculation_type,
    amountCents: row.amount_cents,
    percentage: row.percentage,
    percentageBaseAmountCents: row.percentage_base_amount_cents,
    partySizeThreshold: row.party_size_threshold,
    cancellationWindowHours: row.cancellation_window_hours,
    refundPolicyText: row.refund_policy_text,
    isActive: row.is_active,
  };
}

export async function fetchDepositPolicies(client: SupabaseClient, restaurantId: UUID): Promise<DepositPolicy[]> {
  const { data, error } = await client.from('deposit_policies').select('*').eq('restaurant_id', restaurantId).order('name');
  if (error) throw error;
  return (data as unknown as DepositPolicyRow[]).map(mapDepositPolicyRow);
}

export interface DepositPolicyInput {
  restaurantId: UUID;
  name: string;
  appliesTo: DepositPolicy['appliesTo'];
  calculationType: DepositPolicy['calculationType'];
  amountCents?: number | null;
  percentage?: number | null;
  percentageBaseAmountCents?: number | null;
  partySizeThreshold?: number | null;
  cancellationWindowHours: number;
  refundPolicyText?: string | null;
  isActive?: boolean;
}

function toPolicyPayload(input: Partial<DepositPolicyInput>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.restaurantId !== undefined) payload.restaurant_id = input.restaurantId;
  if (input.name !== undefined) payload.name = input.name;
  if (input.appliesTo !== undefined) payload.applies_to = input.appliesTo;
  if (input.calculationType !== undefined) payload.calculation_type = input.calculationType;
  if (input.amountCents !== undefined) payload.amount_cents = input.amountCents;
  if (input.percentage !== undefined) payload.percentage = input.percentage;
  if (input.percentageBaseAmountCents !== undefined) payload.percentage_base_amount_cents = input.percentageBaseAmountCents;
  if (input.partySizeThreshold !== undefined) payload.party_size_threshold = input.partySizeThreshold;
  if (input.cancellationWindowHours !== undefined) payload.cancellation_window_hours = input.cancellationWindowHours;
  if (input.refundPolicyText !== undefined) payload.refund_policy_text = input.refundPolicyText;
  if (input.isActive !== undefined) payload.is_active = input.isActive;
  return payload;
}

export async function createDepositPolicy(client: SupabaseClient, input: DepositPolicyInput): Promise<DepositPolicy> {
  const { data, error } = await client.from('deposit_policies').insert(toPolicyPayload(input)).select('*').single();
  if (error) throw error;
  return mapDepositPolicyRow(data as unknown as DepositPolicyRow);
}

export async function updateDepositPolicy(client: SupabaseClient, policyId: UUID, patch: Partial<DepositPolicyInput>): Promise<DepositPolicy> {
  const { data, error } = await client.from('deposit_policies').update(toPolicyPayload(patch)).eq('id', policyId).select('*').single();
  if (error) throw error;
  return mapDepositPolicyRow(data as unknown as DepositPolicyRow);
}

export async function deleteDepositPolicy(client: SupabaseClient, policyId: UUID): Promise<void> {
  const { error } = await client.from('deposit_policies').delete().eq('id', policyId);
  if (error) throw error;
}

/** compute_deposit_amount (0019) -- granted to anon too, so the public booking site can show "this reservation requires a €X deposit" before the guest commits. Returns null when no deposit is required. */
export async function quoteDepositAmount(
  client: SupabaseClient,
  input: { restaurantId: UUID; partySize: number; isVip?: boolean; eventId?: UUID | null },
): Promise<DepositQuote | null> {
  const { data, error } = await client.rpc('compute_deposit_amount', {
    p_restaurant_id: input.restaurantId,
    p_party_size: input.partySize,
    p_is_vip: input.isVip ?? false,
    p_event_id: input.eventId ?? null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.policy_id) return null;
  return { policyId: row.policy_id, amountCents: row.amount_cents };
}

interface PaymentRow {
  id: string;
  restaurant_id: string;
  reservation_id: string | null;
  customer_id: string | null;
  provider: string;
  provider_payment_id: string | null;
  payment_type: Payment['paymentType'];
  status: Payment['status'];
  amount_cents: number;
  currency: string;
  failure_reason: string | null;
  deposit_policy_id: string | null;
  created_at: string;
}

function mapPaymentRow(row: PaymentRow): Payment {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    reservationId: row.reservation_id,
    customerId: row.customer_id,
    provider: row.provider,
    providerPaymentId: row.provider_payment_id,
    paymentType: row.payment_type,
    status: row.status,
    amountCents: row.amount_cents,
    currency: row.currency,
    failureReason: row.failure_reason,
    depositPolicyId: row.deposit_policy_id,
    createdAt: row.created_at,
  };
}

/** Plain RLS-scoped read (payments_select, 0011) -- staff of the restaurant, or the reservation's own signed-in customer. Never available to a guest (no RLS identity) -- a guest never needs this, the deposit result comes back directly from createDepositPaymentIntent's response instead. */
export async function fetchPaymentsForReservation(client: SupabaseClient, reservationId: UUID): Promise<Payment[]> {
  const { data, error } = await client.from('payments').select('*').eq('reservation_id', reservationId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data as unknown as PaymentRow[]).map(mapPaymentRow);
}

async function invokeFunction<T>(client: SupabaseClient, name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.functions.invoke(name, { body });
  if (error) {
    // Same FunctionsHttpError-unwrapping pattern as staff.ts/ai.ts.
    const context = (error as { context?: Response }).context;
    let parsedMessage: string | undefined;
    if (context && typeof context.json === 'function') {
      try {
        const parsed = (await context.json()) as { error?: string };
        parsedMessage = parsed?.error;
      } catch {
        // ignore -- fall back below
      }
    }
    throw new Error(parsedMessage ?? error.message);
  }
  return data as T;
}

export interface CreateDepositPaymentIntentResult {
  paymentId: UUID;
  clientSecret: string;
  amountCents: number;
  currency: string;
}

/** Calls create-deposit-payment-intent. Works for a signed-in staff/customer session OR a fully anonymous guest right after a public booking -- see that function's own authorization comment. */
export function createDepositPaymentIntent(
  client: SupabaseClient,
  input: { reservationId: UUID; restaurantId: UUID },
): Promise<CreateDepositPaymentIntentResult> {
  return invokeFunction(client, 'create-deposit-payment-intent', { reservationId: input.reservationId, restaurantId: input.restaurantId });
}

export interface CaptureNoShowDepositResult {
  paymentId: UUID;
  status: string;
  capturedBy: UUID;
}

export function captureNoShowDeposit(client: SupabaseClient, reservationId: UUID): Promise<CaptureNoShowDepositResult> {
  return invokeFunction(client, 'capture-noshow-deposit', { reservationId });
}

export interface RefundDepositResult {
  results: Array<{ paymentId: UUID; refundEligible: boolean; newStatus: string }>;
  resolvedBy?: UUID;
  message?: string;
}

export function refundDeposit(client: SupabaseClient, reservationId: UUID): Promise<RefundDepositResult> {
  return invokeFunction(client, 'refund-deposit', { reservationId });
}

export interface CreateSubscriptionCheckoutResult {
  checkoutUrl: string;
  initiatedBy: UUID;
}

export function createSubscriptionCheckout(
  client: SupabaseClient,
  input: { organizationId: UUID; planCode: string; successUrl: string; cancelUrl: string },
): Promise<CreateSubscriptionCheckoutResult> {
  return invokeFunction(client, 'create-subscription-checkout', {
    organizationId: input.organizationId,
    planCode: input.planCode,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
  });
}

interface SubscriptionPlanRow {
  id: string;
  code: string;
  name: string;
  price_cents: number;
  billing_interval: SubscriptionPlan['billingInterval'];
  currency: string;
  limits: Record<string, unknown>;
  is_active: boolean;
}

function mapSubscriptionPlanRow(row: SubscriptionPlanRow): SubscriptionPlan {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    priceCents: row.price_cents,
    billingInterval: row.billing_interval,
    currency: row.currency,
    limits: row.limits,
    isActive: row.is_active,
  };
}

/** subscription_plans_select is `using (true)` (0011) -- public reference/pricing data, no auth required. */
export async function fetchSubscriptionPlans(client: SupabaseClient): Promise<SubscriptionPlan[]> {
  const { data, error } = await client.from('subscription_plans').select('*').eq('is_active', true).order('price_cents');
  if (error) throw error;
  return (data as unknown as SubscriptionPlanRow[]).map(mapSubscriptionPlanRow);
}

interface SubscriptionRow {
  id: string;
  organization_id: string;
  plan_id: string;
  status: Subscription['status'];
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

/** subscriptions_select restricts to is_org_owner (0011) -- only the organization's owner can see its own billing state. */
export async function fetchOrganizationSubscription(client: SupabaseClient, organizationId: UUID): Promise<Subscription | null> {
  const { data, error } = await client
    .from('subscriptions')
    .select('*')
    .eq('organization_id', organizationId)
    .in('status', ['trialing', 'active', 'past_due'])
    .maybeSingle();
  if (error) throw error;
  return data ? mapSubscriptionRow(data as unknown as SubscriptionRow) : null;
}
