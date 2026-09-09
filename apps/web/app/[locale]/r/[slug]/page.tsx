import { fetchIsFeatureEnabledForRestaurant, fetchOpeningHours, fetchPublicRestaurant, fetchSpecialHours } from '@reservex/core';
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
  const [openingHours, specialHours] = await Promise.all([fetchOpeningHours(supabase, restaurant.id), fetchSpecialHours(supabase, restaurant.id)]);
  // Root-caused live in production (see the two now-removed TEMP diagnostic
  // deploys): calling multiple is_feature_enabled_for_restaurant RPCs --
  // same URL, different p_flag_key body -- CONCURRENTLY inside one
  // Promise.all silently corrupted the result for whichever call landed
  // last (popularity_indicator): a raw, unswallowed capture of that exact
  // call, still inside the Promise.all, came back {data:false,error:null};
  // the SAME call made sequentially, outside any Promise.all, came back
  // {data:true,error:null} -- and so did a completely raw fetch() bypassing
  // supabase-js entirely. Every underlying row (restaurant, flag, override)
  // was hand-verified in the SQL editor to make the true answer the only
  // correct one. So: four *concurrent* POSTs to the identical RPC endpoint
  // is the trigger (most likely Next.js's server-side fetch request
  // memoization/dedup, or Vercel's Node fetch connection reuse under
  // concurrency, mis-attributing one response) -- not a data or RLS bug.
  // Fix: run these four flag checks *sequentially*, never inside the same
  // Promise.all as each other. The two lookups above (opening/special
  // hours) hit different RPCs entirely and are unaffected, so they keep
  // their own Promise.all.
  const liveAvailabilityEnabled = await fetchIsFeatureEnabledForRestaurant(supabase, restaurant.slug, 'live_availability');
  const waitlistPublicEnabled = await fetchIsFeatureEnabledForRestaurant(supabase, restaurant.slug, 'waitlist_public');
  const lastMinuteAlertsEnabled = await fetchIsFeatureEnabledForRestaurant(supabase, restaurant.slug, 'last_minute_alerts');
  const popularityIndicatorEnabled = await fetchIsFeatureEnabledForRestaurant(supabase, restaurant.slug, 'popularity_indicator');
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
