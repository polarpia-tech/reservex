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
  const [openingHours, specialHours, liveAvailabilityEnabled, waitlistPublicEnabled, lastMinuteAlertsEnabled, popularityIndicatorEnabled] = await Promise.all([
    fetchOpeningHours(supabase, restaurant.id),
    fetchSpecialHours(supabase, restaurant.id),
    // Phase 2 of the Live Availability upgrade (migration 0024): off for
    // every restaurant until its owner (or a platform admin) explicitly
    // turns it on, so this changes nothing for the overwhelming majority of
    // restaurants today. Never throws -- see fetchIsFeatureEnabledForRestaurant's
    // own comment -- so a flag-check hiccup can never take down this page.
    fetchIsFeatureEnabledForRestaurant(supabase, restaurant.slug, 'live_availability'),
    // Phase 6, Part 2c of the same upgrade: the self-service waitlist's
    // public-facing "Join waitlist" affordance. `waitlist_public` isn't
    // owner-configurable yet (is_owner_configurable is flipped on in a
    // follow-up migration once this UI is verified end to end) -- until
    // then this is off for every restaurant, same as live_availability was
    // before its own owner toggle shipped.
    fetchIsFeatureEnabledForRestaurant(supabase, restaurant.slug, 'waitlist_public'),
    // Phase 6, sub-feature 3 (migration 0034): the "notify me about
    // anything today" affordance -- same off-by-default,
    // not-owner-configurable-yet story as waitlist_public above, until this
    // is verified live end to end.
    fetchIsFeatureEnabledForRestaurant(supabase, restaurant.slug, 'last_minute_alerts'),
    // Phase 6, sub-feature 4 (migration 0036/0037): the "🔥 Popular time"
    // badge on top of the Live Availability chips. Same off-by-default,
    // not-owner-configurable-yet story as the two flags above, until this
    // is verified live end to end -- see 'popularity_indicator' in
    // BookingForm.tsx's own comment on popularityIndicatorEnabled.
    fetchIsFeatureEnabledForRestaurant(supabase, restaurant.slug, 'popularity_indicator'),
  ]);
  // TEMP DIAGNOSTIC (to be reverted): fetchIsFeatureEnabledForRestaurant
  // swallows any RPC error into `false`, which is hiding a real discrepancy
  // for 'popularity_indicator' specifically -- raw REST calls with the
  // browser's own anon key return true, but this server call is producing
  // false. Calling the RPC directly here, unswallowed, to see the actual
  // {data, error} this server-side client gets back.
  const popularityDebugRaw = await supabase.rpc('is_feature_enabled_for_restaurant', {
    p_restaurant_slug: restaurant.slug,
    p_flag_key: 'popularity_indicator',
  });
  const popularityDebugEnvUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'MISSING';
  const popularityDebugEnvKeyTail = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'MISSING').slice(-12);
  // TEMP DIAGNOSTIC 2 (to be reverted): every row this depends on has been
  // hand-verified in the SQL editor to line up exactly (restaurant.id,
  // flag.id, override.flag_id+restaurant_id all match, override.is_enabled
  // = true) -- so the function is provably deterministic-true for these
  // exact arguments. Yet the supabase-js call above still comes back false
  // with no error. Two more isolations to find where the discrepancy is
  // actually introduced:
  // (a) a completely raw, undecorated fetch() straight to PostgREST,
  //     bypassing the supabase-js client entirely and explicitly disabling
  //     any Next.js fetch caching/memoization -- mirrors the raw BROWSER
  //     fetch test that already came back true, but run from the server.
  // (b) the exact same supabase-js RPC call as above, but made in true
  //     isolation -- NOT inside the earlier Promise.all -- in case
  //     concurrent execution of the 4 flag checks is somehow involved.
  const popularityRawFetchDebug = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/rest/v1/rpc/is_feature_enabled_for_restaurant`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
        authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''}`,
      },
      body: JSON.stringify({ p_restaurant_slug: restaurant.slug, p_flag_key: 'popularity_indicator' }),
    },
  )
    .then(async (r) => ({ status: r.status, body: await r.text() }))
    .catch((e) => ({ status: -1, body: String(e) }));
  const popularityIsolatedRpcDebug = await supabase
    .rpc('is_feature_enabled_for_restaurant', { p_restaurant_slug: restaurant.slug, p_flag_key: 'popularity_indicator' })
    .then((r) => ({ data: r.data, error: r.error }));
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 'clamp(var(--space-xl), 6vw, 56px) var(--space-2xl) var(--space-4xl)' }}>
      <div
        id="popularity-debug"
        style={{ display: 'none' }}
        data-debug={JSON.stringify({
          data: popularityDebugRaw.data,
          error: popularityDebugRaw.error,
          envUrl: popularityDebugEnvUrl,
          envKeyTail: popularityDebugEnvKeyTail,
          rawFetch: popularityRawFetchDebug,
          isolatedRpc: popularityIsolatedRpcDebug,
          restaurantSlug: restaurant.slug,
        })}
      />
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
