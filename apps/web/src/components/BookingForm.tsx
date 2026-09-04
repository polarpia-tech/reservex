'use client';

import {
  bookPublicReservation,
  createDepositPaymentIntent,
  ensureMyCustomerProfile,
  fetchMyCustomerProfile,
  parsePublicReservationErrorCode,
  quoteDepositAmount,
  type DepositQuote,
  type Reservation,
} from '@reservex/core';
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';

import { DepositPaymentStep } from '@/components/DepositPaymentStep';
import { CalendarIcon, CheckCircleIcon, ClockIcon, PhoneIcon, UsersIcon } from '@/components/icons';
import { getDictionary, interpolate, t, type SupportedLocale } from '@/lib/dictionary';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { formatDateTimeInTimeZone, zonedTimeToUtc } from '@/lib/timezone';

interface BookingRestaurant {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  minPartySize: number;
  maxPartySize: number;
  bookingWindowMinHours: number;
  bookingWindowMaxDays: number;
}

/**
 * The inline "book a table" form on a restaurant's public profile page.
 * Client Component: needs interactivity (form state) and, for a signed-in
 * customer, the browser's own Supabase auth session -- neither is
 * available in the Server Component that renders the rest of the page.
 *
 * IMPORTANT (see api/publicBooking.ts's bookPublicReservation() comment and
 * the Phase 08 README): for an anonymous guest, `confirmedReservation`
 * below is rendered directly from book_public_reservation()'s own return
 * value -- there is deliberately no follow-up fetch, because RLS genuinely
 * does not let a guest read their own booking back afterward. This is the
 * ONE chance to show them their booking details.
 */
export function BookingForm({ locale, restaurant }: { locale: SupportedLocale; restaurant: BookingRestaurant }) {
  const dict = getDictionary(locale);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [profileName, setProfileName] = useState<string | null>(null);

  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [partySize, setPartySize] = useState(restaurant.minPartySize);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [specialRequests, setSpecialRequests] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmedReservation, setConfirmedReservation] = useState<Reservation | null>(null);

  // Phase 12: shown BEFORE the guest commits, so "this table needs a
  // deposit" is never a surprise after booking. isVip is always false here
  // -- VIP status comes from restaurant_customers, which doesn't exist yet
  // for a guest who hasn't booked before; eventId is always null -- this
  // MVP booking form has no event-selection step (see deposit_policies'
  // 'event' applies_to, which this form simply never triggers).
  const [depositQuote, setDepositQuote] = useState<DepositQuote | null>(null);
  const [depositIntent, setDepositIntent] = useState<{ clientSecret: string; amountCents: number; currency: string } | null>(null);
  const [depositPaid, setDepositPaid] = useState(false);
  const [depositSkipped, setDepositSkipped] = useState(false);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    void client.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setIsSignedIn(true);
      const profile = await fetchMyCustomerProfile(client).catch(() => null);
      if (profile) {
        setProfileName(profile.fullName);
        setGuestName((prev) => prev || profile.fullName || '');
        setGuestPhone((prev) => prev || profile.phone || '');
        setGuestEmail((prev) => prev || profile.email || '');
      }
    });
  }, []);

  useEffect(() => {
    if (!restaurant.id || partySize <= 0) return;
    const client = getSupabaseBrowserClient();
    let cancelled = false;
    void quoteDepositAmount(client, { restaurantId: restaurant.id, partySize }).then((quote) => {
      if (!cancelled) setDepositQuote(quote);
    });
    return () => {
      cancelled = true;
    };
  }, [restaurant.id, partySize]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrorMessage(null);

    if (!date || !time) return;
    const startsAt = zonedTimeToUtc(date, time, restaurant.timezone);

    setSubmitting(true);
    try {
      const client = getSupabaseBrowserClient();
      const reservation = await bookPublicReservation(client, {
        restaurantSlug: restaurant.slug,
        startsAt: startsAt.toISOString(),
        partySize,
        guestName: guestName || null,
        guestPhone: guestPhone || null,
        guestEmail: guestEmail || null,
        specialRequests: specialRequests || null,
      });

      // A signed-in customer's first booking lazily creates their
      // customers row server-side (see 0014's book_public_reservation) --
      // ensureMyCustomerProfile() here just makes sure any name/phone/email
      // they typed on THIS form (which may differ from what was already on
      // file, or may be their very first time providing it) is saved back
      // to their profile too, so their next booking's prefill is accurate.
      if (isSignedIn) {
        await ensureMyCustomerProfile(client, {
          fullName: guestName || undefined,
          phone: guestPhone || undefined,
          email: guestEmail || undefined,
        }).catch(() => undefined); // best-effort -- the booking itself already succeeded.
      }

      setConfirmedReservation(reservation);

      // Deposit collection MUST happen right here, in the same round-trip
      // as booking -- see create-deposit-payment-intent's own header
      // comment: a guest reservation has no way to authenticate later, this
      // confirmation view is the one chance. Best-effort: a failure here
      // never unwinds an already-successful booking, it just means the
      // guest sees the "pay later" notice instead of the payment form.
      if (depositQuote) {
        await createDepositPaymentIntent(client, { reservationId: reservation.id, restaurantId: restaurant.id })
          .then((result) => setDepositIntent(result))
          .catch(() => setDepositIntent(null));
      }
    } catch (error) {
      const code = parsePublicReservationErrorCode(error);
      if (code === 'PARTY_SIZE_OUT_OF_RANGE') {
        setErrorMessage(interpolate(t(dict, 'public.booking.errors.PARTY_SIZE_OUT_OF_RANGE'), { min: restaurant.minPartySize, max: restaurant.maxPartySize }));
      } else if (code) {
        setErrorMessage(t(dict, `public.booking.errors.${code}`));
      } else {
        setErrorMessage(t(dict, 'public.booking.errors.generic'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmedReservation) {
    return (
      <section style={{ border: '1px solid var(--success)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-xl)', background: 'var(--surface)' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', fontFamily: 'var(--font-display)', fontWeight: 600, color: 'var(--success)', margin: 0 }}>
          <CheckCircleIcon />
          {t(dict, 'public.booking.confirmedTitle')}
        </h2>
        <p>{t(dict, 'public.booking.confirmedBody')}</p>
        <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px', fontSize: 14 }}>
          <dt style={{ color: 'var(--text-muted)' }}>{t(dict, 'public.booking.confirmedRestaurant')}</dt>
          <dd style={{ margin: 0 }}>{restaurant.name}</dd>
          <dt style={{ color: 'var(--text-muted)' }}>{t(dict, 'public.booking.confirmedDateTime')}</dt>
          <dd style={{ margin: 0 }}>{formatDateTimeInTimeZone(confirmedReservation.startsAt, restaurant.timezone, locale)}</dd>
          <dt style={{ color: 'var(--text-muted)' }}>{t(dict, 'public.booking.confirmedPartySize')}</dt>
          <dd style={{ margin: 0 }}>{confirmedReservation.partySize}</dd>
          <dt style={{ color: 'var(--text-muted)' }}>{t(dict, 'public.booking.confirmedReference')}</dt>
          <dd style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{confirmedReservation.id}</dd>
        </dl>

        {depositIntent && !depositPaid && !depositSkipped ? (
          <DepositPaymentStep
            locale={locale}
            clientSecret={depositIntent.clientSecret}
            amountCents={depositIntent.amountCents}
            currency={depositIntent.currency}
            onPaid={() => setDepositPaid(true)}
            onSkip={() => setDepositSkipped(true)}
          />
        ) : null}
        {depositPaid ? (
          <p style={{ color: 'var(--success)', marginTop: 'var(--space-lg)' }}>
            <strong>{t(dict, 'public.booking.deposit.paidTitle')}</strong> â€” {t(dict, 'public.booking.deposit.paidBody')}
          </p>
        ) : null}
        {depositQuote && !depositIntent && !depositPaid ? (
          <p style={{ color: 'var(--warning)', marginTop: 'var(--space-lg)', fontSize: 14 }}>{t(dict, 'public.booking.deposit.unpaidNotice')}</p>
        ) : null}
        {depositSkipped ? (
          <p style={{ color: 'var(--warning)', marginTop: 'var(--space-lg)', fontSize: 14 }}>{t(dict, 'public.booking.deposit.unpaidNotice')}</p>
        ) : null}

        <button
          type="button"
          onClick={() => {
            setConfirmedReservation(null);
            setDepositIntent(null);
            setDepositPaid(false);
            setDepositSkipped(false);
          }}
          style={{ marginTop: 'var(--space-lg)', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-full)', padding: '8px 16px', cursor: 'pointer' }}
        >
          {t(dict, 'public.booking.bookAnother')}
        </button>
      </section>
    );
  }

  return (
    <section style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-xl)', background: 'var(--surface)' }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, marginTop: 0 }}>{t(dict, 'public.booking.title')}</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: '-8px' }}>
        {isSignedIn ? interpolate(t(dict, 'public.booking.signedInNotice'), { name: profileName ?? guestEmail ?? '' }) : t(dict, 'public.booking.guestNotice')}
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 'var(--space-md)' }}>
          <Field label={t(dict, 'public.booking.date')} icon={<CalendarIcon size={13} />}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required style={inputStyle} />
          </Field>
          <Field label={t(dict, 'public.booking.time')} icon={<ClockIcon size={13} />}>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required style={inputStyle} />
          </Field>
          <Field label={t(dict, 'public.booking.partySize')} icon={<UsersIcon size={13} />}>
            <input
              type="number"
              min={restaurant.minPartySize}
              max={restaurant.maxPartySize}
              value={partySize}
              onChange={(e) => setPartySize(Number(e.target.value))}
              required
              style={inputStyle}
            />
          </Field>
        </div>

        {depositQuote ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
            {t(dict, 'public.booking.deposit.noticePrefix')} {(depositQuote.amountCents / 100).toFixed(2)}
          </p>
        ) : null}

        <Field label={t(dict, 'public.booking.guestName')}>
          <input type="text" value={guestName} onChange={(e) => setGuestName(e.target.value)} required style={inputStyle} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-md)' }}>
          <Field label={t(dict, 'public.booking.guestPhone')} icon={<PhoneIcon size={13} />}>
            <input type="tel" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} style={inputStyle} />
          </Field>
          <Field label={t(dict, 'public.booking.guestEmail')}>
            <input type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} style={inputStyle} />
          </Field>
        </div>
        <Field label={t(dict, 'public.booking.specialRequests')}>
          <textarea
            value={specialRequests}
            onChange={(e) => setSpecialRequests(e.target.value)}
            placeholder={t(dict, 'public.booking.specialRequestsPlaceholder')}
            rows={2}
            style={{ ...inputStyle, resize: 'vertical' as const }}
          />
        </Field>

        {errorMessage && <p style={{ color: 'var(--danger)', fontSize: 14, margin: 0 }}>{errorMessage}</p>}

        <button
          type="submit"
          disabled={submitting}
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
          {submitting ? t(dict, 'public.booking.submitting') : t(dict, 'public.booking.submitButton')}
        </button>
      </form>
    </section>
  );
}

// minWidth: 0 overrides the browser default of `min-width: auto` on grid/flex
// items -- without it, a native <input type="date"/"time"> or similar's own
// intrinsic content width becomes a hard floor on this cell's size, which
// defeats `repeat(auto-fit, minmax(...))` above and pushes the row wider
// than the viewport on narrow phone screens instead of actually wrapping.
function Field({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--text-muted)', minWidth: 0 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {icon}
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle: CSSProperties = {
  fontFamily: 'var(--font-family)',
  fontSize: 14,
  color: 'var(--text-primary)',
  background: 'var(--background)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: '8px 10px',
  width: '100%',
};