// Phase 12: a minimal Stripe REST client using plain `fetch`, not the
// `stripe` npm SDK -- same reasoning as packages/ai/src/providers/
// anthropic.ts: this file is imported by relative path into a Deno Edge
// Function, `fetch` is the one HTTP primitive both runtimes share
// unchanged, and an npm dependency could not be installed OR verified in
// this network-restricted sandbox anyway. Stripe's REST API is form-
// urlencoded (including bracket notation for nested params like
// `metadata[reservation_id]`), which this file builds by hand.
//
// HONESTY NOTE: like AnthropicProvider and voice-webhook's Twilio calls,
// none of this has been exercised against a live Stripe account -- no
// network access to api.stripe.com, no Stripe secret key, in this sandbox.
// The request shapes follow Stripe's publicly documented REST API.

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const STRIPE_API_VERSION = '2024-06-20';

export class StripeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
  }
}

function toFormBody(params: Record<string, string | number | boolean | undefined | Record<string, string>>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (typeof value === 'object') {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        usp.set(`${key}[${nestedKey}]`, nestedValue);
      }
    } else {
      usp.set(key, String(value));
    }
  }
  return usp.toString();
}

export class StripeClient {
  constructor(private readonly secretKey: string) {
    if (!secretKey) throw new Error('StripeClient requires a secret key.');
  }

  private async request<T>(method: 'POST' | 'GET', path: string, params?: Record<string, any>): Promise<T> {
    const url = `${STRIPE_API_BASE}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': STRIPE_API_VERSION,
      },
      body: params ? toFormBody(params) : undefined,
    });
    const bodyText = await response.text();
    if (!response.ok) {
      throw new StripeApiError(`Stripe API error ${response.status} for ${path}`, response.status, bodyText);
    }
    return JSON.parse(bodyText) as T;
  }

  /** Manual-capture PaymentIntent -- authorizes the card now, charges only on an explicit later capture() call. This is the "capture later" pattern the blueprint asks for (Part 05). */
  createPaymentIntent(input: {
    amountCents: number;
    currency: string;
    metadata: Record<string, string>;
  }): Promise<{ id: string; client_secret: string; status: string }> {
    return this.request('POST', '/payment_intents', {
      amount: input.amountCents,
      currency: input.currency.toLowerCase(),
      capture_method: 'manual',
      metadata: input.metadata,
    });
  }

  /** Actually charges a held (requires_capture) PaymentIntent -- the no-show fee moment. */
  capturePaymentIntent(paymentIntentId: string): Promise<{ id: string; status: string }> {
    return this.request('POST', `/payment_intents/${paymentIntentId}/capture`);
  }

  /** Releases a held (not yet captured) PaymentIntent without charging anything -- the "refund" for a deposit that was authorized but never captured. */
  cancelPaymentIntent(paymentIntentId: string): Promise<{ id: string; status: string }> {
    return this.request('POST', `/payment_intents/${paymentIntentId}/cancel`);
  }

  /** Refunds a PaymentIntent that WAS already captured -- different Stripe call from cancelPaymentIntent above; see refund-deposit's header comment for when each applies. */
  createRefund(paymentIntentId: string): Promise<{ id: string; status: string }> {
    return this.request('POST', '/refunds', { payment_intent: paymentIntentId });
  }

  /** Stripe Checkout for a subscription -- avoids building custom card-collection UI for platform billing; Stripe hosts the payment page. metadata (organization_id/plan_code) is how stripe-webhook later knows which of OUR rows a completed session corresponds to -- Stripe copies session-level metadata onto the Subscription object it creates, so customer.subscription.* events carry it too, not just checkout.session.completed. */
  createCheckoutSession(input: {
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    clientReferenceId: string;
    customerEmail?: string;
    metadata: Record<string, string>;
  }): Promise<{ id: string; url: string }> {
    return this.request('POST', '/checkout/sessions', {
      mode: 'subscription',
      'line_items[0][price]': input.priceId,
      'line_items[0][quantity]': 1,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.clientReferenceId,
      customer_email: input.customerEmail,
      metadata: input.metadata,
      'subscription_data[metadata]': input.metadata as any,
    });
  }
}
