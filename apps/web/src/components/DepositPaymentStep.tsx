'use client';

import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { useState } from 'react';

import { getDictionary, t, type SupportedLocale } from '@/lib/dictionary';

/**
 * Phase 12: the guest-booking deposit collection step. Stripe Elements is
 * the ONLY thing that ever touches the guest's card number in this app --
 * this component never sees a card number, only a `clientSecret` for a
 * PaymentIntent that create-deposit-payment-intent already created
 * server-side (manual capture, so the card is authorized now and only
 * actually charged later, by a staff action -- see that Edge Function and
 * captureNoShowDeposit/refundDeposit). That keeps 100% of PCI scope on
 * Stripe, matching the blueprint's own payments section.
 *
 * A module-level singleton, same reasoning as getSupabaseBrowserClient():
 * loadStripe() does its own internal caching per publishable key, but
 * keeping one Promise here avoids re-triggering that lookup on every
 * re-render of a parent that re-mounts this component.
 *
 * HONESTY NOTE: this is real integration code against the real
 * @stripe/react-stripe-js + @stripe/stripe-js libraries and the real
 * PaymentIntent client-confirmation flow -- but it has NOT been exercised
 * against a live Stripe account or a real card in this sandbox (no network
 * egress to Stripe, no test API keys configured here). Same disclosure as
 * every other provider integration this session.
 */
let stripePromise: Promise<Stripe | null> | null = null;
function getStripePromise(): Promise<Stripe | null> {
  if (!stripePromise) {
    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    stripePromise = publishableKey ? loadStripe(publishableKey) : Promise.resolve(null);
  }
  return stripePromise;
}

export function DepositPaymentStep({
  locale,
  clientSecret,
  amountCents,
  currency,
  onPaid,
  onSkip,
}: {
  locale: SupportedLocale;
  clientSecret: string;
  amountCents: number;
  currency: string;
  onPaid: () => void;
  onSkip: () => void;
}) {
  const dict = getDictionary(locale);
  return (
    <div style={{ marginTop: 'var(--space-lg)', paddingTop: 'var(--space-lg)', borderTop: '1px solid var(--border)' }}>
      <p style={{ fontWeight: 600, marginBottom: 'var(--space-sm)' }}>
        {t(dict, 'public.booking.deposit.noticePrefix')} {(amountCents / 100).toFixed(2)} {currency}
      </p>
      <Elements stripe={getStripePromise()} options={{ clientSecret }}>
        <DepositForm locale={locale} onPaid={onPaid} onSkip={onSkip} />
      </Elements>
    </div>
  );
}

function DepositForm({ locale, onPaid, onSkip }: { locale: SupportedLocale; onPaid: () => void; onSkip: () => void }) {
  const dict = getDictionary(locale);
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handlePay() {
    if (!stripe || !elements) return;
    setSubmitting(true);
    setErrorMessage(null);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: typeof window !== 'undefined' ? window.location.href : undefined },
      redirect: 'if_required',
    });
    setSubmitting(false);
    if (error) {
      setErrorMessage(error.message ?? t(dict, 'public.booking.deposit.genericError'));
      return;
    }
    onPaid();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      <PaymentElement />
      {errorMessage && <p style={{ color: 'var(--danger)', fontSize: 14, margin: 0 }}>{errorMessage}</p>}
      <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
        <button
          type="button"
          onClick={() => void handlePay()}
          disabled={!stripe || submitting}
          style={{
            background: 'var(--accent)',
            color: 'var(--surface)',
            border: 'none',
            borderRadius: 'var(--radius-full)',
            padding: '12px 20px',
            fontWeight: 600,
            cursor: submitting ? 'default' : 'pointer',
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? t(dict, 'public.booking.deposit.paying') : t(dict, 'public.booking.deposit.payNow')}
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={submitting}
          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-full)', padding: '12px 20px', cursor: 'pointer' }}
        >
          {t(dict, 'public.booking.deposit.payLater')}
        </button>
      </div>
    </div>
  );
}
