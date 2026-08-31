import { StripeClient } from '../../../packages/payments/src/stripeClient.ts';

/** Shared across every payments Edge Function -- reads STRIPE_SECRET_KEY once, fails loudly (not silently) if it's missing, same pattern as ai-gateway's getProvider(). */
export function getStripeClient(): StripeClient {
  const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured for this function.');
  }
  return new StripeClient(secretKey);
}
