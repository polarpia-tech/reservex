'use client';
import {
  bookPublicReservation,
  createDepositPaymentIntent,
  ensureMyCustomerProfile,
  fetchMyCustomerProfile,
  fetchPublicAvailabilitySummary,
  fetchPublicPopularityIndicators,
  joinLastMinuteAlert,
  joinPublicWaitlist,
  parseJoinLastMinuteAlertErrorCode,
  parseJoinPublicWaitlistErrorCode,
  parsePublicReservationErrorCode,
  quoteDepositAmount,
  subscribeToAvailabilityChanges,
  type DepositQuote,
  type PublicAvailabilitySlot,
  type Reservation,
  type WaitlistEntry,
  type WebPushSubscriptionJSON,
} from '@reservex/core';
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { DepositPaymentStep } from '@/components/DepositPaymentStep';
import { CalendarIcon, CheckCircleIcon, ClockIcon, PhoneIcon, UsersIcon } from '@/components/icons';
import { getDictionary, interpolate, t, type SupportedLocale } from '@/lib/dictionary';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { formatDateTimeInTimeZone, formatTimeInTimeZone, zonedTimeToUtc } from '@/lib/timezone';
import { requestWebPushSubscription } from '@/lib/webPush';
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
  // Phase 6, Part 2c: same convention as liveAvailabilityEnabled above --
  // optional, off by default, so every existing call site (including the
  // widget page, which doesn't pass it either) keeps working unchanged.
  // Gates the "Join waitlist" panel below; see showWaitlistPanel.
  waitlistPublicEnabled = false,
  // Phase 6, sub-feature 3 (migration 0034): same convention. Gates the
  // standalone LastMinuteAlertPanel below, which -- unlike WaitlistPanel --
  // is intentionally NOT tied to a picked date/time; see showLastMinuteAlertPanel.
  lastMinuteAlertsEnabled = false,
  // Phase 6, sub-feature 4 (migration 0036/0037): same convention. Gates
  // the "🔥 Popular time" badge rendered on top of LiveAvailabilityPanel's
  // own chips below -- purely cosmetic, so it's harmless for this to stay
  // false (no badges, chips render exactly as before this feature existed)
  // for every restaurant that hasn't opted in yet.
  popularityIndicatorEnabled = false,
}: {
  locale: SupportedLocale;
  restaurant: BookingRestaurant;
  liveAvailabilityEnabled?: boolean;
  waitlistPublicEnabled?: boolean;
  lastMinuteAlertsEnabled?: boolean;
  popularityIndicatorEnabled?: boolean;
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
  // ΚΡΑΤΩ-inspired redesign (2026-09): a small "something just changed" toast
  // fired off the SAME realtime subscription as the quiet refetch below --
  // deliberately generic copy ("availability was just updated"), not
  // "someone just booked around HH:MM": subscribeToAvailabilityChanges()
  // fires on every row event on restaurant_availability_versions WITHOUT
  // inspecting the payload (see that function's own comment -- "no date, no
  // table, no count" in the row), so there is no hour and no confirmed cause
  // (could be a cancellation or a staff edit, not only a new booking) to
  // honestly report. Only set after refetchQuietly's OWN fetch actually
  // succeeds, so this is never shown for a change that turned out to be a
  // no-op or a failed background refresh.
  const [liveActivityNotice, setLiveActivityNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!liveActivityNotice) return;
    const dismissTimer = setTimeout(() => setLiveActivityNotice(null), 4000);
    return () => clearTimeout(dismissTimer);
  }, [liveActivityNotice]);
  // Phase 6, sub-feature 4 (migration 0036/0037). `null` means "haven't
  // fetched yet" (or the flag is off, or no date is picked); `[]` means
  // "fetched, and this restaurant/day genuinely has no popular-enough
  // times yet" (get_public_popularity_indicators's own documented "not
  // enough data" convention -- never a fake badge on thin history). Unlike
  // availabilitySlots, this does NOT depend on partySize at all (the RPC
  // itself doesn't take one -- historical popularity isn't about table
  // capacity), so it's fetched in its own effect, keyed only on date.
  const [popularTimes, setPopularTimes] = useState<string[] | null>(null);
  // Phase 6, Part 2c: the self-service waitlist panel's own state, entirely
  // separate from the booking form's own submitting/errorMessage above --
  // joining the waitlist is a distinct action from booking a table, and a
  // guest can freely retry one without the other's state getting in the way.
  //
  // noAvailabilityFromSubmit and waitlistEntry are both reset whenever
  // date/time/partySize change (see the effect below) -- a waitlist join
  // (or a stale "no availability" flag) for a PREVIOUS date/time/party size
  // selection must never linger and be shown against a new one.
  const [noAvailabilityFromSubmit, setNoAvailabilityFromSubmit] = useState(false);
  const [waitlistEntry, setWaitlistEntry] = useState<WaitlistEntry | null>(null);
  const [waitlistNotifyEnabled, setWaitlistNotifyEnabled] = useState(false);
  const [waitlistSubmitting, setWaitlistSubmitting] = useState(false);
  const [waitlistError, setWaitlistError] = useState<string | null>(null);
  // Distinct from waitlistError: this is for the (non-fatal) "notifications
  // are blocked/unsupported" case -- the guest is still successfully on the
  // waitlist, just without push, so it's never shown as a failure.
  const [waitlistNotice, setWaitlistNotice] = useState<string | null>(null);
  useEffect(() => {
    setNoAvailabilityFromSubmit(false);
    setWaitlistEntry(null);
    setWaitlistNotifyEnabled(false);
    setWaitlistError(null);
    setWaitlistNotice(null);
  }, [date, time, partySize]);
  // Phase 6, sub-feature 3 (migration 0034): the last-minute alert panel's
  // own state, mirroring the waitlist panel's state above but kept
  // completely separate -- joining a last-minute alert is a distinct
  // action from both booking and the regular waitlist join, and (unlike
  // the waitlist panel) is never tied to the date/time inputs at all, only
  // to partySize (join_last_minute_alert resolves "today, right now" on
  // the server itself -- see that function's own header comment). Reset
  // only when partySize changes, since a stale "joined" confirmation for a
  // different party size must never linger, but changing date/time must
  // NOT reset this panel -- it has nothing to do with either.
  const [lastMinuteEntry, setLastMinuteEntry] = useState<WaitlistEntry | null>(null);
  const [lastMinuteNotifyEnabled, setLastMinuteNotifyEnabled] = useState(false);
  const [lastMinuteSubmitting, setLastMinuteSubmitting] = useState(false);
  const [lastMinuteError, setLastMinuteError] = useState<string | null>(null);
  const [lastMinuteNotice, setLastMinuteNotice] = useState<string | null>(null);
  useEffect(() => {
    setLastMinuteEntry(null);
    setLastMinuteNotifyEnabled(false);
    setLastMinuteError(null);
    setLastMinuteNotice(null);
  }, [partySize]);
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
  // Phase 6, sub-feature 4 (migration 0036/0037): fetches the "historically
  // popular" badge data for the picked date. Deliberately its own effect,
  // not folded into the debounced availability fetch above -- it doesn't
  // depend on partySize, so re-running it every time partySize changes
  // (as the debounced fetch above correctly does) would just be wasted
  // requests for data that hasn't changed. Also deliberately no realtime
  // subscription counterpart: this is backward-looking aggregate history,
  // not something a single new booking could ever change moment-to-moment.
  useEffect(() => {
    if (!popularityIndicatorEnabled || !date) {
      setPopularTimes(null);
      return;
    }
    let cancelled = false;
    const client = getSupabaseBrowserClient();
    void fetchPublicPopularityIndicators(client, { restaurantSlug: restaurant.slug, date }).then((times) => {
      if (!cancelled) setPopularTimes(times);
    });
    return () => {
      cancelled = true;
    };
  }, [popularityIndicatorEnabled, restaurant.slug, date]);
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
            if (!cancelled) {
              setAvailabilitySlots(slots);
              setLiveActivityNotice(t(dict, 'public.booking.liveActivity.updated'));
            }
          })
          .catch(() => {
            // Keep showing the last known-good slots rather than clearing
            // the panel over a transient background-refresh failure. No
            // toast either -- nothing was confirmed to have changed.
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
    setNoAvailabilityFromSubmit(false);
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
      // Drives showWaitlistPanel below: a plain booking attempt that comes
      // back NO_AVAILABILITY is exactly the moment to offer the waitlist,
      // even for a restaurant that doesn't have liveAvailabilityEnabled (and
      // therefore never rendered the LiveAvailabilityPanel chips at all).
      setNoAvailabilityFromSubmit(code === 'NO_AVAILABILITY');
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
  // Phase 6, Part 2c. `withPush` is what distinguishes the panel's two
  // buttons ("Join waitlist" vs "Join & notify me") and the "joined, but no
  // push yet" confirmation view's own "Enable notifications" button, which
  // re-calls this with withPush=true -- join_public_waitlist (0029) is
  // documented idempotent for the same identity/restaurant/date while the
  // entry is still 'waiting', so re-submitting it with a freshly-obtained
  // pushSubscription is the correct, safe way to add push to an
  // already-joined entry, not a special case.
  //
  // A denied/unsupported/failed push opt-in never blocks the join itself --
  // pushSubscription simply stays null and the guest still gets a normal,
  // no-push waitlist entry; only the notice shown differs (see
  // waitlistNotice below).
  async function handleJoinWaitlist(withPush: boolean) {
    if (!date || !time) return;
    setWaitlistError(null);
    setWaitlistNotice(null);
    setWaitlistSubmitting(true);
    try {
      let pushSubscription: WebPushSubscriptionJSON | null = null;
      if (withPush) {
        const result = await requestWebPushSubscription();
        if (result.status === 'subscribed') {
          pushSubscription = result.subscription;
        } else if (result.status === 'denied') {
          setWaitlistNotice(t(dict, 'public.booking.waitlist.notifyDenied'));
        } else if (result.status === 'unsupported') {
          setWaitlistNotice(t(dict, 'public.booking.waitlist.notifyUnsupported'));
        }
        // 'error' (e.g. the browser's own subscribe() call rejected):
        // proceed with a plain join below, same as 'denied'/'unsupported' --
        // no notice needed beyond what the join itself might report.
      }
      const startsAt = zonedTimeToUtc(date, time, restaurant.timezone);
      const client = getSupabaseBrowserClient();
      const entry = await joinPublicWaitlist(client, {
        restaurantSlug: restaurant.slug,
        desiredStartsAt: startsAt.toISOString(),
        partySize,
        guestName: guestName || null,
        guestPhone: guestPhone || null,
        guestEmail: guestEmail || null,
        pushSubscription,
      });
      // Same anonymous-read-back gap as bookPublicReservation's own
      // confirmedReservation above (see joinPublicWaitlist's own comment):
      // this response is rendered directly, never re-fetched.
      setWaitlistEntry(entry);
      setWaitlistNotifyEnabled(Boolean(pushSubscription));
    } catch (error) {
      const code = parseJoinPublicWaitlistErrorCode(error);
      if (code === 'PARTY_SIZE_OUT_OF_RANGE') {
        setWaitlistError(interpolate(t(dict, 'public.booking.waitlist.errors.PARTY_SIZE_OUT_OF_RANGE'), { min: restaurant.minPartySize, max: restaurant.maxPartySize }));
      } else if (code) {
        setWaitlistError(t(dict, `public.booking.waitlist.errors.${code}`));
      } else {
        setWaitlistError(t(dict, 'public.booking.waitlist.errors.generic'));
      }
    } finally {
      setWaitlistSubmitting(false);
    }
  }
  // Phase 6, sub-feature 3 (migration 0034). Same withPush/idempotent-retap
  // shape as handleJoinWaitlist above, but calls join_last_minute_alert
  // instead -- no date/time involved at all, only partySize and the guest's
  // own details, since the server resolves "today, right now" itself.
  async function handleJoinLastMinuteAlert(withPush: boolean) {
    setLastMinuteError(null);
    setLastMinuteNotice(null);
    setLastMinuteSubmitting(true);
    try {
      let pushSubscription: WebPushSubscriptionJSON | null = null;
      if (withPush) {
        const result = await requestWebPushSubscription();
        if (result.status === 'subscribed') {
          pushSubscription = result.subscription;
        } else if (result.status === 'denied') {
          setLastMinuteNotice(t(dict, 'public.booking.lastMinuteAlert.notifyDenied'));
        } else if (result.status === 'unsupported') {
          setLastMinuteNotice(t(dict, 'public.booking.lastMinuteAlert.notifyUnsupported'));
        }
      }
      const client = getSupabaseBrowserClient();
      const entry = await joinLastMinuteAlert(client, {
        restaurantSlug: restaurant.slug,
        partySize,
        guestName: guestName || null,
        guestPhone: guestPhone || null,
        guestEmail: guestEmail || null,
        pushSubscription,
      });
      // Same anonymous-read-back gap as joinPublicWaitlist above -- this
      // response is rendered directly, never re-fetched.
      setLastMinuteEntry(entry);
      setLastMinuteNotifyEnabled(Boolean(pushSubscription));
    } catch (error) {
      const code = parseJoinLastMinuteAlertErrorCode(error);
      if (code === 'PARTY_SIZE_OUT_OF_RANGE') {
        setLastMinuteError(interpolate(t(dict, 'public.booking.lastMinuteAlert.errors.PARTY_SIZE_OUT_OF_RANGE'), { min: restaurant.minPartySize, max: restaurant.maxPartySize }));
      } else if (code) {
        setLastMinuteError(t(dict, `public.booking.lastMinuteAlert.errors.${code}`));
      } else {
        setLastMinuteError(t(dict, 'public.booking.lastMinuteAlert.errors.generic'));
      }
    } finally {
      setLastMinuteSubmitting(false);
    }
  }
  // Phase 6, Part 2c: when to actually show the "Join waitlist" panel.
  // Either signal is sufficient on its own -- a restaurant with
  // liveAvailabilityEnabled shows it the moment every chip in
  // LiveAvailabilityPanel is unavailable (before the guest even tries to
  // submit); a restaurant WITHOUT it (or one where availabilitySlots simply
  // hasn't loaded yet) only finds out via a real submit attempt coming back
  // NO_AVAILABILITY. Both require waitlistPublicEnabled (the flag) and a
  // date+time actually picked -- join_public_waitlist needs a concrete
  // desired slot, same as book_public_reservation does.
  // Client-side-only, derived purely from availabilitySlots (already public
  // today via LiveAvailabilityPanel's chips -- see get_public_availability_
  // summary's own "no fake scarcity" comment). Deliberately a coarse 3-level
  // bucket, never a percentage: the underlying RPC doesn't expose total
  // table capacity at all (by design, so a percentage can't even be
  // reconstructed from it), and even if it did, an exact occupancy number is
  // owner-facing business data, not something to surface to the public. See
  // computeVibeLevel below.
  const vibeLevel = computeVibeLevel(availabilitySlots);
  const allSlotsUnavailable =
    liveAvailabilityEnabled &&
    availabilitySlots !== null &&
    availabilitySlots.length > 0 &&
    availabilitySlots.every((slot) => slot.availableTableCount === 0 && !slot.hasCombinableOption);
  const showWaitlistPanel = waitlistPublicEnabled && Boolean(date) && Boolean(time) && (allSlotsUnavailable || noAvailabilityFromSubmit);
  // Phase 6, sub-feature 3: unlike showWaitlistPanel above, this does NOT
  // depend on date/time at all -- last-minute alerts are for "right now,
  // today", so the panel is offered any time the flag is on, independent
  // of whatever the guest may or may not have picked in the date/time
  // fields above (which remain there for a normal advance booking).
  const showLastMinuteAlertPanel = lastMinuteAlertsEnabled;
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
        {showLastMinuteAlertPanel ? (
          <LastMinuteAlertPanel
            dict={dict}
            joined={lastMinuteEntry}
            notifyEnabled={lastMinuteNotifyEnabled}
            submitting={lastMinuteSubmitting}
            error={lastMinuteError}
            notice={lastMinuteNotice}
            onJoin={() => void handleJoinLastMinuteAlert(false)}
            onJoinWithNotify={() => void handleJoinLastMinuteAlert(true)}
            onEnableNotify={() => void handleJoinLastMinuteAlert(true)}
          />
        ) : null}
        {liveAvailabilityEnabled && date ? (
          <>
            {vibeLevel ? <VibeBadge dict={dict} level={vibeLevel} /> : null}
            <DemandTicker locale={locale} dict={dict} timezone={restaurant.timezone} slots={availabilitySlots} />
            <LiveAvailabilityPanel
              locale={locale}
              dict={dict}
              timezone={restaurant.timezone}
              loading={availabilityLoading}
              slots={availabilitySlots}
              selectedTime={time}
              onPickTime={setTime}
              popularTimes={popularityIndicatorEnabled ? popularTimes : null}
            />
          </>
        ) : null}
        {showWaitlistPanel ? (
          <WaitlistPanel
            dict={dict}
            joined={waitlistEntry}
            notifyEnabled={waitlistNotifyEnabled}
            submitting={waitlistSubmitting}
            error={waitlistError}
            notice={waitlistNotice}
            onJoin={() => void handleJoinWaitlist(false)}
            onJoinWithNotify={() => void handleJoinWaitlist(true)}
            onEnableNotify={() => void handleJoinWaitlist(true)}
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
      {liveActivityNotice ? (
        <div
          role="status"
          style={{
            position: 'fixed',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--surface-elevated)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            padding: '9px 16px',
            borderRadius: 'var(--radius-full)',
            fontSize: 12.5,
            boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
            zIndex: 40,
            maxWidth: 'calc(100vw - 32px)',
            textAlign: 'center',
          }}
        >
          {liveActivityNotice}
        </div>
      ) : null}
    </section>
  );
}
/**
 * Guest-facing "vibe" indicator (ΚΡΑΤΩ-inspired redesign, 2026-09). Buckets
 * the picked date's already-fetched availabilitySlots into one of three
 * qualitative levels, based on the SHARE of slots that are fully booked
 * (no standalone tables AND no combinable option). Deliberately a coarse
 * bucket, not a computed percentage -- see the "no fake scarcity" /
 * no-exact-occupancy-to-the-public reasoning on vibeLevel's own call site.
 * Returns null when there's nothing to show yet (no slots fetched, or the
 * restaurant is closed that day -- an empty array).
 */
function computeVibeLevel(slots: PublicAvailabilitySlot[] | null): 'busy' | 'moderate' | 'quiet' | null {
  if (!slots || slots.length === 0) return null;
  const fullCount = slots.filter((s) => s.availableTableCount === 0 && !s.hasCombinableOption).length;
  const ratio = fullCount / slots.length;
  if (ratio >= 0.6) return 'busy';
  if (ratio >= 0.25) return 'moderate';
  return 'quiet';
}
function VibeBadge({ dict, level }: { dict: ReturnType<typeof getDictionary>; level: 'busy' | 'moderate' | 'quiet' }) {
  const color = level === 'busy' ? 'var(--danger)' : level === 'moderate' ? 'var(--warning)' : 'var(--success)';
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        fontWeight: 600,
        color,
        background: 'var(--background)',
        border: `1px solid ${color}`,
        borderRadius: 'var(--radius-full)',
        padding: '5px 11px',
        alignSelf: 'flex-start',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
      {t(dict, `public.booking.vibe.${level}`)}
    </div>
  );
}
/**
 * Guest-facing bar-chart "demand ticker" (ΚΡΑΤΩ-inspired redesign, 2026-09).
 * Purely a re-visualization of the exact same availabilitySlots data
 * LiveAvailabilityPanel's chips already render below it -- no new fetch, no
 * new backend call, no data point here that isn't already public via that
 * panel. Bar height is a fixed 3-tier read of each slot (full /
 * limited-or-combinable-only / open), never a computed fill percentage --
 * get_public_availability_summary() doesn't expose total table capacity at
 * all, so an honest percentage literally can't be derived from what this
 * page has; a 3-tier read is the most precise thing that's actually true.
 */
function DemandTicker({
  locale,
  dict,
  timezone,
  slots,
}: {
  locale: SupportedLocale;
  dict: ReturnType<typeof getDictionary>;
  timezone: string;
  slots: PublicAvailabilitySlot[] | null;
}) {
  if (!slots || slots.length === 0) return null;
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px var(--space-md) 8px', background: 'var(--background)' }}>
      <p style={{ margin: '0 0 10px', fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {t(dict, 'public.booking.demandTicker.title')}
      </p>
      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 60, overflowX: 'auto', paddingBottom: 2 }}>
        {slots.map((slot) => {
          const localTime = formatTimeInTimeZone(slot.slotStartsAt, timezone, locale);
          const isFull = slot.availableTableCount === 0 && !slot.hasCombinableOption;
          const isLimited = !isFull && (slot.availableTableCount <= 1 || slot.hasCombinableOption);
          const heightPct = isFull ? 100 : isLimited ? 55 : 24;
          const color = isFull ? 'var(--danger)' : isLimited ? 'var(--warning)' : 'var(--success)';
          return (
            <div
              key={slot.slotStartsAt}
              title={localTime}
              style={{ flex: '0 0 28px', width: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end', gap: 4 }}
            >
              <div style={{ width: '100%', height: `${heightPct}%`, minHeight: 3, borderRadius: 3, background: color, transition: 'height 0.5s ease' }} />
              <span style={{ fontSize: 8.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{localTime}</span>
            </div>
          );
        })}
      </div>
      <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>{t(dict, 'public.booking.demandTicker.hint')}</p>
    </div>
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
  popularTimes,
}: {
  locale: SupportedLocale;
  dict: ReturnType<typeof getDictionary>;
  timezone: string;
  loading: boolean;
  slots: PublicAvailabilitySlot[] | null;
  selectedTime: string;
  onPickTime: (time: string) => void;
  // Phase 6, sub-feature 4 (migration 0036/0037). A list of "HH:MM" 24h
  // local-time strings, same format formatTimeInTimeZone below already
  // produces (hourCycle: 'h23') -- so a chip's popularity is a plain string
  // match, no separate parsing needed. `null`/`undefined` (flag off, or not
  // fetched yet) and `[]` (fetched, nothing popular enough) both simply
  // render no badges -- the chips look exactly as they did before this
  // feature existed either way.
  popularTimes?: string[] | null;
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
          {/* ΚΡΑΤΩ-inspired "board" restyle (2026-09): same rows, same data,
              same click/disabled/selected logic as before -- only the
              container changed, from a flex-wrap chip grid to a vertical
              list of full-width rows (grid-template-columns), so it reads
              like a schedule board instead of a tag cloud. */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {slots.map((slot) => {
              const localTime = formatTimeInTimeZone(slot.slotStartsAt, timezone, locale);
              const isAvailable = slot.availableTableCount > 0 || slot.hasCombinableOption;
              const isSelected = selectedTime === localTime;
              // Phase 6, sub-feature 4 (migration 0036/0037): a plain string
              // match against the "HH:MM" 24h buckets get_public_popularity_
              // indicators returned -- formatTimeInTimeZone above already
              // formats localTime the same way (hourCycle: 'h23'), so no
              // separate parsing is needed. Shown regardless of whether the
              // slot is currently available: "historically popular" and
              // "free right now" are deliberately independent signals (see
              // fetchPublicPopularityIndicators's own comment) and can
              // legitimately disagree.
              const isPopular = Boolean(popularTimes?.includes(localTime));
              const availabilityLabel =
                slot.availableTableCount > 0
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
                    : t(dict, 'public.booking.liveAvailability.none');
              return (
                <button
                  key={slot.slotStartsAt}
                  type="button"
                  disabled={!isAvailable}
                  onClick={() => onPickTime(localTime)}
                  style={{
                    fontFamily: 'var(--font-family)',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    width: '100%',
                    textAlign: 'left',
                    cursor: isAvailable ? 'pointer' : 'default',
                  }}
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '52px 1fr auto',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                      marginBottom: 6,
                      borderRadius: 'var(--radius-md)',
                      border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                      background: isSelected ? 'var(--accent)' : isAvailable ? 'var(--surface)' : 'var(--background)',
                      opacity: isAvailable ? 1 : 0.55,
                    }}
                  >
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 600, color: isSelected ? 'var(--surface)' : 'var(--text-primary)' }}>
                      {localTime}
                    </span>
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 11.5,
                        color: isSelected ? 'var(--surface)' : 'var(--text-muted)',
                        opacity: 0.9,
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          flexShrink: 0,
                          background: isSelected ? 'var(--surface)' : isAvailable ? 'var(--success)' : 'var(--danger)',
                        }}
                      />
                      {availabilityLabel}
                    </span>
                    {isPopular ? (
                      <span title={t(dict, 'public.booking.liveAvailability.popularBadge')} aria-label={t(dict, 'public.booking.liveAvailability.popularBadge')} style={{ fontSize: 13, lineHeight: 1 }}>
                        🔥
                      </span>
                    ) : (
                      <span />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>{t(dict, 'public.booking.liveAvailability.hint')}</p>
        </>
      ) : null}
    </div>
  );
}
/**
 * Phase 6, Part 2c. Shown once BookingForm decides there's genuinely no
 * availability for the guest's picked date/time (see showWaitlistPanel's
 * own comment). Two states:
 *
 *  - `joined` is null: the guest hasn't joined yet -- two buttons, "Join
 *    waitlist" (no push) and "Join & notify me" (requests notification
 *    permission first, then joins with the resulting subscription). Both
 *    are always offered -- push is an enhancement, never a requirement to
 *    get on the list at all.
 *  - `joined` is set: the confirmation view, rendered directly from
 *    join_public_waitlist()'s own return value (see joinPublicWaitlist's
 *    comment for why -- there is no way to read it back afterwards for an
 *    anonymous guest). If `notifyEnabled` is false, a single "Enable
 *    notifications" button lets the guest add push to their existing entry
 *    without creating a duplicate (join_public_waitlist is idempotent for
 *    the same identity/restaurant/date while 'waiting').
 */
function WaitlistPanel({
  dict,
  joined,
  notifyEnabled,
  submitting,
  error,
  notice,
  onJoin,
  onJoinWithNotify,
  onEnableNotify,
}: {
  dict: ReturnType<typeof getDictionary>;
  joined: WaitlistEntry | null;
  notifyEnabled: boolean;
  submitting: boolean;
  error: string | null;
  notice: string | null;
  onJoin: () => void;
  onJoinWithNotify: () => void;
  onEnableNotify: () => void;
}) {
  const buttonStyle: CSSProperties = {
    fontFamily: 'var(--font-family)',
    fontSize: 13,
    borderRadius: 'var(--radius-full)',
    padding: '8px 14px',
    cursor: submitting ? 'default' : 'pointer',
    opacity: submitting ? 0.7 : 1,
  };
  const secondaryButtonStyle: CSSProperties = { ...buttonStyle, background: 'none', border: '1px solid var(--border)', color: 'var(--text-primary)' };
  const primaryButtonStyle: CSSProperties = { ...buttonStyle, background: 'var(--accent)', border: 'none', color: 'var(--surface)', fontWeight: 600 };
  if (joined) {
    return (
      <div
        style={{
          border: '1px solid var(--accent)',
          borderRadius: 'var(--radius-md)',
          padding: '10px var(--space-md)',
          background: 'var(--background)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>{t(dict, 'public.booking.waitlist.joinedTitle')}</p>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>{t(dict, 'public.booking.waitlist.joinedBody')}</p>
        {notice && <p style={{ margin: 0, fontSize: 12, color: 'var(--warning)' }}>{notice}</p>}
        <p style={{ margin: 0, fontSize: 12.5, color: notifyEnabled ? 'var(--success)' : 'var(--text-muted)' }}>
          {notifyEnabled ? t(dict, 'public.booking.waitlist.notifyEnabledNotice') : t(dict, 'public.booking.waitlist.notifyNotEnabledNotice')}
        </p>
        {!notifyEnabled ? (
          <button type="button" disabled={submitting} onClick={onEnableNotify} style={{ ...primaryButtonStyle, alignSelf: 'flex-start' }}>
            {submitting ? t(dict, 'public.booking.waitlist.notifyRequesting') : t(dict, 'public.booking.waitlist.notifyEnableButton')}
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: '10px var(--space-md)',
        background: 'var(--background)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>{t(dict, 'public.booking.waitlist.title')}</p>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>{t(dict, 'public.booking.waitlist.body')}</p>
      {notice && <p style={{ margin: 0, fontSize: 12, color: 'var(--warning)' }}>{notice}</p>}
      {error && <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{error}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" disabled={submitting} onClick={onJoin} style={secondaryButtonStyle}>
          {submitting ? t(dict, 'public.booking.waitlist.joining') : t(dict, 'public.booking.waitlist.joinButton')}
        </button>
        <button type="button" disabled={submitting} onClick={onJoinWithNotify} style={primaryButtonStyle}>
          {submitting ? t(dict, 'public.booking.waitlist.notifyRequesting') : t(dict, 'public.booking.waitlist.notifyButton')}
        </button>
      </div>
    </div>
  );
}
/**
 * Phase 6, sub-feature 3 (migration 0034). Same shape as WaitlistPanel
 * above (deliberately -- see this file's own convention of reusing a
 * proven pattern rather than inventing a new one), but for the "notify me
 * about anything today" entry point: no date/time context in the copy,
 * and shown independent of whatever the date/time inputs above currently
 * hold (see showLastMinuteAlertPanel).
 */
function LastMinuteAlertPanel({
  dict,
  joined,
  notifyEnabled,
  submitting,
  error,
  notice,
  onJoin,
  onJoinWithNotify,
  onEnableNotify,
}: {
  dict: ReturnType<typeof getDictionary>;
  joined: WaitlistEntry | null;
  notifyEnabled: boolean;
  submitting: boolean;
  error: string | null;
  notice: string | null;
  onJoin: () => void;
  onJoinWithNotify: () => void;
  onEnableNotify: () => void;
}) {
  const buttonStyle: CSSProperties = {
    fontFamily: 'var(--font-family)',
    fontSize: 13,
    borderRadius: 'var(--radius-full)',
    padding: '8px 14px',
    cursor: submitting ? 'default' : 'pointer',
    opacity: submitting ? 0.7 : 1,
  };
  const secondaryButtonStyle: CSSProperties = { ...buttonStyle, background: 'none', border: '1px solid var(--border)', color: 'var(--text-primary)' };
  const primaryButtonStyle: CSSProperties = { ...buttonStyle, background: 'var(--accent)', border: 'none', color: 'var(--surface)', fontWeight: 600 };
  if (joined) {
    return (
      <div
        style={{
          border: '1px solid var(--accent)',
          borderRadius: 'var(--radius-md)',
          padding: '10px var(--space-md)',
          background: 'var(--background)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>{t(dict, 'public.booking.lastMinuteAlert.joinedTitle')}</p>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>{t(dict, 'public.booking.lastMinuteAlert.joinedBody')}</p>
        {notice && <p style={{ margin: 0, fontSize: 12, color: 'var(--warning)' }}>{notice}</p>}
        <p style={{ margin: 0, fontSize: 12.5, color: notifyEnabled ? 'var(--success)' : 'var(--text-muted)' }}>
          {notifyEnabled ? t(dict, 'public.booking.lastMinuteAlert.notifyEnabledNotice') : t(dict, 'public.booking.lastMinuteAlert.notifyNotEnabledNotice')}
        </p>
        {!notifyEnabled ? (
          <button type="button" disabled={submitting} onClick={onEnableNotify} style={{ ...primaryButtonStyle, alignSelf: 'flex-start' }}>
            {submitting ? t(dict, 'public.booking.lastMinuteAlert.notifyRequesting') : t(dict, 'public.booking.lastMinuteAlert.notifyEnableButton')}
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: '10px var(--space-md)',
        background: 'var(--background)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>{t(dict, 'public.booking.lastMinuteAlert.title')}</p>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>{t(dict, 'public.booking.lastMinuteAlert.body')}</p>
      {notice && <p style={{ margin: 0, fontSize: 12, color: 'var(--warning)' }}>{notice}</p>}
      {error && <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{error}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" disabled={submitting} onClick={onJoin} style={secondaryButtonStyle}>
          {submitting ? t(dict, 'public.booking.lastMinuteAlert.joining') : t(dict, 'public.booking.lastMinuteAlert.joinButton')}
        </button>
        <button type="button" disabled={submitting} onClick={onJoinWithNotify} style={primaryButtonStyle}>
          {submitting ? t(dict, 'public.booking.lastMinuteAlert.notifyRequesting') : t(dict, 'public.booking.lastMinuteAlert.notifyButton')}
        </button>
      </div>
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
