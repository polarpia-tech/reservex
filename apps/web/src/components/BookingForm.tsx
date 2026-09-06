'use client';

import {
  bookPublicReservation,
  createDepositPaymentIntent,
  ensureMyCustomerProfile,
  fetchMyCustomerProfile,
  fetchPublicAvailabilitySummary,
  parsePublicReservationErrorCode,
  quoteDepositAmount,
  subscribeToAvailabilityChanges,
  type DepositQuote,
  type PublicAvailabilitySlot,
  type Reservation,
} from '@reservex/core';
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';

import { DepositPaymentStep } from '@/components/DepositPaymentStep';
import { CalendarIcon, CheckCircleIcon, ClockIcon, PhoneIcon, UsersIcon } from '@/components/icons';
import { getDictionary, interpolate, t, type SupportedLocale } from '@/lib/dictionary';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { formatDateTimeInTimeZone, formatTimeInTimeZone, zonedTimeToUtc } from '@/lib/timezone';

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
export function BookingForm({
  locale,
  restaurant,
  // Optional, defaulting to off: the booking widget page (widget/[locale]/
  // [slug]) also renders this same form and doesn't check the flag itself
  // yet -- an omitted prop must mean "behave exactly as before this feature
  // existed", never a type error at every other call site every time a new
  // opt-in capability like this one is added.
  liveAvailabilityEnabled = false,
}: {
  locale: SupportedLocale;
  restaurant: BookingRestaurant;
  liveAvailabilityEnabled?: boolean;
}) {
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

  // Phase 2 of the Live Availability upgrade (migration 0023/0024). `null`
  // means "haven't fetched yet" (or the flag is off, or no date is picked)
  // -- distinct from `[]`, which means "fetched, and the restaurant is
  // simply closed that day" (get_public_availability_summary's own
  // documented empty-result convention). Only ever populated when
  // liveAvailabilityEnabled is true, so this whole feature is inert for
  // every restaurant that hasn't opted in.
  const [availabilitySlots, setAvailabilitySlots] = useState<PublicAvailabilitySlot[] | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);

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

  // Debounced (350ms) so typing a two-digit party size or dragging the date
  // picker doesn't fire a request per keystroke -- same "don't hammer the
  // backend on every render" spirit as the Phase 42 spec's performance
  // section (§38). A stale response from a superseded date/partySize is
  // dropped via the `cancelled` flag, never rendered.
  useEffect(() => {
    if (!liveAvailabilityEnabled || !date || partySize <= 0) {
      setAvailabilitySlots(null);
      setAvailabilityLoading(false);
      return;
    }
    let cancelled = false;
    setAvailabilityLoading(true);
    const client = getSupabaseBrowserClient();
    const timer = setTimeout(() => {
      void fetchPublicAvailabilitySummary(client, { restaurantSlug: restaurant.slug, date, partySize })
        .then((slots) => {
          if (!cancelled) setAvailabilitySlots(slots);
        })
        .catch(() => {
          // A failed check (e.g. party size momentarily outside the
          // restaurant's range while the visitor is still typing) just
          // hides the panel -- the plain date/time/party-size inputs below
          // still work exactly as before this feature existed.
          if (!cancelled) setAvailabilitySlots(null);
        })
        .finally(() => {
          if (!cancelled) setAvailabilityLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [liveAvailabilityEnabled, restaurant.slug, date, partySize]);

  // Phase 3 of the Live Availability upgrade (migration 0025): a Realtime
  // subscription that quietly re-checks availability the instant someone
  // else's booking could have changed it, instead of only ever reflecting
  // whatever was true 350ms after this visitor last touched an input.
  //
  // Deliberately a SEPARATE effect from the debounced fetch above, and
  // deliberately does NOT touch availabilityLoading: this refresh is
  // triggered by someone else's activity, not something this visitor asked
  // for -- flashing the loading state over table counts they're already
  // looking at would be worse UX than briefly showing a half-second-stale
  // count. A failed background refresh is silently ignored, keeping
  // whatever slots are already on screen -- same "never break the plain
  // form" spirit as the debounced fetch's own .catch() above.
  useEffect(() => {
    if (!liveAvailabilityEnabled || !date || partySize <= 0) return;
    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const client = getSupabaseBrowserClient();

    const refetchQuietly = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      // Same 350ms coalescing idea as the debounced fetch above -- a burst
      // of several bookings landing within milliseconds of each other (or
      // the delete+insert pair a single reschedule produces, see 0025's
      // header comment) should trigger one re-check, not one per event.
      debounceTimer = setTimeout(() => {
        void fetchPublicAvailabilitySummary(client, { restaurantSlug: restaurant.slug, date, partySize })
          .then((slots) => {
            if (!cancelled) setAvailabilitySlots(slots);
          })
          .catch(() => {
            // Keep showing the last known-good slots rather than clearing
            // the panel over a transient background-refresh failure.
          });
      }, 350);
    };

    const unsubscribe = subscribeToAvailabilityChanges(client, restaurant.id, refetchQuietly);

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubscribe();
    };
  }, [liveAvailabilityEnabled, restaurant.id, restaurant.slug, date, partySize]);

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
            <strong>{t(dict, 'public.booking.deposit.paidTitle')}</strong> — {t(dict, 'public.booking.deposit.paidBody')}
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

        {liveAvailabilityEnabled && date ? (
          <LiveAvailabilityPanel
            locale={locale}
            dict={dict}
            timezone={restaurant.timezone}
            loading={availabilityLoading}
            slots={availabilitySlots}
            selectedTime={time}
            onPickTime={setTime}
          />
        ) : null}

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

/**
 * Phase 2 of the Live Availability upgrade. Shows one chip per bookable
 * time slot on the picked date, each labelled with the REAL count of
 * standalone free tables get_public_availability_summary() (0023) returned
 * -- never a made-up or rounded number, per the spec's "no fake scarcity"
 * rule. A slot with zero standalone tables but a combinable option is still
 * clickable (book_reservation, called downstream, already knows how to
 * merge tables); a slot with neither is shown, not hidden, but disabled --
 * telling the guest honestly why they can't pick it beats silently
 * removing it. Clicking a slot just fills in the existing `time` input;
 * it doesn't bypass or change anything about how the form actually submits.
 */
function LiveAvailabilityPanel({
  locale,
  dict,
  timezone,
  loading,
  slots,
  selectedTime,
  onPickTime,
}: {
  locale: SupportedLocale;
  dict: ReturnType<typeof getDictionary>;
  timezone: string;
  loading: boolean;
  slots: PublicAvailabilitySlot[] | null;
  selectedTime: string;
  onPickTime: (time: string) => void;
}) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px var(--space-md)', background: 'var(--background)' }}>
      <p style={{ margin: '0 0 8px', fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {t(dict, 'public.booking.liveAvailability.title')}
      </p>
      {loading && !slots ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>{t(dict, 'public.booking.liveAvailability.loading')}</p>
      ) : slots && slots.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>{t(dict, 'public.booking.liveAvailability.closed')}</p>
      ) : slots && slots.length > 0 ? (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {slots.map((slot) => {
              const localTime = formatTimeInTimeZone(slot.slotStartsAt, timezone, locale);
              const isAvailable = slot.availableTableCount > 0 || slot.hasCombinableOption;
              const isSelected = selectedTime === localTime;
              return (
                <button
                  type="button"
                  key={slot.slotStartsAt}
                  disabled={!isAvailable}
                  onClick={() => onPickTime(localTime)}
                  style={{
                    fontFamily: 'var(--font-family)',
                    textAlign: 'center',
                    fontSize: 12.5,
                    lineHeight: 1.3,
                    padding: '6px 10px',
                    borderRadius: 'var(--radius-md)',
                    border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                    background: isSelected ? 'var(--accent)' : isAvailable ? 'var(--surface)' : 'var(--background)',
                    color: isSelected ? 'var(--surface)' : isAvailable ? 'var(--text-primary)' : 'var(--text-muted)',
                    cursor: isAvailable ? 'pointer' : 'default',
                    opacity: isAvailable ? 1 : 0.55,
                  }}
                >
                  <span style={{ display: 'block', fontWeight: 600 }}>{localTime}</span>
                  <span style={{ display: 'block', fontSize: 10.5, opacity: 0.85 }}>
                    {slot.availableTableCount > 0
                      ? interpolate(
                          t(
                            dict,
                            slot.availableTableCount === 1
                              ? 'public.booking.liveAvailability.tableAvailableOne'
                              : 'public.booking.liveAvailability.tablesAvailableOther',
                          ),
                          { count: slot.availableTableCount },
                        )
                      : slot.hasCombinableOption
                        ? t(dict, 'public.booking.liveAvailability.availableCombinable')
                        : t(dict, 'public.booking.liveAvailability.none')}
                  </span>
                </button>
              );
            })}
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>{t(dict, 'public.booking.liveAvailability.hint')}</p>
        </>
      ) : null}
    </div>
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
