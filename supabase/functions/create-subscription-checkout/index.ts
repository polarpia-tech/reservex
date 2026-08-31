// deno-lint-ignore-file no-explicit-any
import { handleCors, jsonError, jsonResponse } from '../_shared/cors.ts';
import { AuthError, createAdminClient, createCallerClient, getAuthenticatedUser } from '../_shared/supabaseAdmin.ts';
import { getStripeClient } from '../_shared/stripe.ts';

/**
 * create-subscription-checkout
 * ==============================
 * Phase 12. Starts a real, paid subscription for an organization via a
 * Stripe-hosted Checkout page -- no custom card-collection UI to build, and
 * PCI scope stays entirely with Stripe (blueprint, Part 05).
 *
 * NOT needed for the 14-day free trial itself: per the blueprint's pricing
 * page ("δωρεάν δοκιμή 14 ημερών, χωρίς κάρτα"), the trial subscription row
 * is created directly, no Stripe call at all, the moment an organization's
 * first restaurant is bootstrapped (see bootstrap-restaurant's update this
 * phase). This function is only for the moment an org actually chooses to
 * start paying -- converting from trial, or picking a plan after trial end.
 *
 * Authorization: is_org_owner(organizationId) only -- billing is
 * deliberately owner-only (blueprint, Part 03's role table: "Owner: τα
 * πάντα, συμπεριλαμβανομένων χρέωσης/συνδρομής... οι υπόλοιποι ρόλοι χωρίς
 * billing").
 *
 * Admin screens for viewing/managing an org's subscription state are
 * explicitly Phase 13 (blueprint: "Admin πλατφόρμας — διαχείριση ...
 * συνδρομών"), not built here.
 */

interface RequestBody {
  organizationId?: string;
  planCode?: string;
  successUrl?: string;
  cancelUrl?: string;
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  try {
    const user = await getAuthenticatedUser(req);
    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const organizationId = body.organizationId?.trim();
    const planCode = body.planCode?.trim();
    const successUrl = body.successUrl?.trim();
    const cancelUrl = body.cancelUrl?.trim();
    if (!organizationId || !planCode || !successUrl || !cancelUrl) {
      return jsonError('organizationId, planCode, successUrl and cancelUrl are all required.', 400);
    }

    const callerClient = createCallerClient(req);
    const { data: isOwner } = await callerClient.rpc('is_org_owner', { target_organization_id: organizationId });
    if (!isOwner) return jsonError('Only the organization owner can manage billing.', 403);

    const adminClient = createAdminClient();

    const { data: plan } = await adminClient
      .from('subscription_plans')
      .select('id, code, provider_price_id, is_active')
      .eq('code', planCode)
      .maybeSingle();
    if (!plan || !plan.is_active) return jsonError('Unknown or inactive plan.', 400);
    if (!plan.provider_price_id) {
      return jsonError(`The ${planCode} plan is not available for self-serve checkout -- contact sales.`, 400);
    }

    const { data: organization } = await adminClient.from('organizations').select('id, billing_email').eq('id', organizationId).maybeSingle();
    if (!organization) return jsonError('Organization not found.', 404);

    const stripe = getStripeClient();
    const session = await stripe.createCheckoutSession({
      priceId: plan.provider_price_id,
      successUrl,
      cancelUrl,
      clientReferenceId: organizationId,
      customerEmail: (organization as any).billing_email ?? undefined,
      metadata: { organization_id: organizationId, plan_code: plan.code },
    });

    return jsonResponse({ checkoutUrl: session.url, initiatedBy: user.id });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, 401);
    console.error('create-subscription-checkout error', err);
    return jsonError('Internal error.', 500);
  }
});
