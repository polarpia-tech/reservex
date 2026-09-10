import { fetchOpeningHours, fetchPublicFeatureFlagsForRestaurant, fetchPublicRestaurant, fetchSpecialHours } from '@reservex/core';
import { BookingForm } from '@/components/BookingForm';
import { MapPinIcon, PhoneIcon } from '@/components/icons';
import { OpeningHoursList } from '@/components/OpeningHoursList';
import { getDictionary, isSupportedLocale, t, type SupportedLocale } from '@/lib/dictionary';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
// Same reasoning as app/[locale]/page.tsx's own force-dynamic: opening
// hours, special-hours exceptions and live table availability all change
// after a restaurant owner edits them in the mobile app, and this page
// must reflect that on the very next visit -- not whenever Next/Vercel's
// static cache next happens to expire. Without this, the page renders
// once (e.g. right after the restaurant is created, before any opening
// hours exist) and keeps serving that same stale HTML indefinitely.
export const dynamic = 'force-dynamic';
/**
 * A restaurant's public profile + inline booking form. Server Component for
 * everything that's just a read (profile, opening hours, special hours --
 * all anonymous, all through 0014's public RLS policies); the booking form
 * itself is a Client Component (BookingForm) since it needs interactivity
 * and, for a signed-in customer, the browser's own auth session.
 */
export default async function RestaurantProfilePage({ params }: { params: { locale: string; slug: string } }) {
  if (!isSupportedLocale(params.locale)) return null;
  const locale: SupportedLocale = params.locale;
  const dict = getDictionary(locale);
  const supabase = createSupabaseServerClient();
  const restaurant = await fetchPublicRestaurant(supabase, params.slug);
  if (!restaurant) {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', padding: 'var(--space-2xl)', textAlign: 'center' }}>
        <h1 style={{ fontSize: 24 }}>{t(dict, 'public.restaurant.notFoundTitle')}</h1>
        <p style={{ color: 'var(--text-muted)' }}>{t(dict, 'public.restaurant.notFoundBody')}</p>
      </div>
    );
  }
  const [openingHours, specialHours, flags] = await Promise.all([
    fetchOpeningHours(supabase, restaurant.id),
    fetchSpecialHours(supabase, restaurant.id),
    // Migration 0038: resolves all 4 feature flags in a SINGLE round trip.
    // Root-caused live in production this window (PRs #8-#11, and 0038's
    // own header comment): checking each flag with its own separate RPC
    // call hit a confirmed, reproducible bug where whichever call was the
    // 6th cumulative outbound Supabase request in this one server render
    // came back with the wrong answer -- reproduced by reordering the
    // checks twice and watching the failure move to whichever flag landed
    // 6th each time. Not a data or RLS bug (every underlying row was hand-
    // verified correct in the SQL editor); something in the request/
    // connection layer between this server and Supabase misbehaves past a
    // certain request count within one invocation. Batching all 4 flags
    // into this one call keeps the page's total Supabase request count at
    // 3 (this Promise.all's three entries), comfortably clear of it, and
    // is fewer round trips regardless of the underlying bug.
    fetchPublicFeatureFlagsForRestaurant(supabase, restaurant.slug, ['live_availability', 'waitlist_public', 'last_minute_alerts', 'popularity_indicator']),
  ]);
  const liveAvailabilityEnabled = flags.live_availability;
  const waitlistPublicEnabled = flags.waitlist_public;
  const lastMinuteAlertsEnabled = flags.last_minute_alerts;
  const popularityIndicatorEnabled = flags.popularity_indicator;
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 'clamp(var(--space-xl), 6vw, 56px) var(--space-2xl) var(--space-4xl)' }}>
      <div style={{ marginBottom: 'var(--space-3xl)' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(26px, 4.5vw, 40px)', lineHeight: 1.1, margin: '0 0 var(--space-sm)' }}>
          {restaurant.name}
        </h1>
        {(restaurant.addressLine || restaurant.city) && (
          <p style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 14.5, margin: '0 0 6px' }}>
            <MapPinIcon size={15} />
            {[restaurant.addressLine, restaurant.city].filter(Boolean).join(', ')}
          </p>
        )}
        {restaurant.phone && (
          <p style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 14.5, margin: 0 }}>
            <PhoneIcon size={15} />
            {restaurant.phone}
          </p>
        )}
        {restaurant.description && <p style={{ marginTop: 'var(--space-md)', maxWidth: 640, lineHeight: 1.6 }}>{restaurant.description}</p>}
      </div>
      {/* Same auto-fit grid technique as the directory page: two columns
          when there's room for both at >= ~320px each, one column
          (opening hours above the booking form) on a narrow phone --
          no separate mobile markup needed. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-2xl)', alignItems: 'start' }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-xl)' }}>
          <OpeningHoursList locale={locale} openingHours={openingHours} specialHours={specialHours} />
        </div>
        <BookingForm
          locale={locale}
          restaurant={{
            id: restaurant.id,
            slug: restaurant.slug,
            name: restaurant.name,
            timezone: restaurant.timezone,
            minPartySize: restaurant.minPartySize,
            maxPartySize: restaurant.maxPartySize,
            bookingWindowMinHours: restaurant.bookingWindowMinHours,
            bookingWindowMaxDays: restaurant.bookingWindowMaxDays,
          }}
          liveAvailabilityEnabled={liveAvailabilityEnabled}
          waitlistPublicEnabled={waitlistPublicEnabled}
          lastMinuteAlertsEnabled={lastMinuteAlertsEnabled}
          popularityIndicatorEnabled={popularityIndicatorEnabled}
        />
      </div>
    </div>
  );
}
