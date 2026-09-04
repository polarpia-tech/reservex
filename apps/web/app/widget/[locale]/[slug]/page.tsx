import { fetchOpeningHours, fetchPublicRestaurant, fetchSpecialHours } from '@reservex/core';
import Link from 'next/link';

import { BookingForm } from '@/components/BookingForm';
import { OpeningHoursList } from '@/components/OpeningHoursList';
import { WidgetResizeReporter } from '@/components/WidgetResizeReporter';
import { getDictionary, isSupportedLocale, t, type SupportedLocale } from '@/lib/dictionary';
import { createSupabaseServerClient } from '@/lib/supabaseServer';

// Same reasoning as app/[locale]/page.tsx and app/[locale]/r/[slug]/page.tsx:
// this embeds live opening hours and booking availability into someone
// else's website, so it must reflect edits made in the mobile app on the
// very next request -- not a stale build/cache from whenever the iframe
// first loaded.
export const dynamic = 'force-dynamic';

/**
 * Phase 14: the embeddable booking widget -- a restaurant's own website
 * pastes `<iframe src="https://<your-domain>/widget/en/my-restaurant">`
 * and gets a working "book a table" box, no JS SDK/bundle to install.
 * Deliberately a SEPARATE route tree from app/[locale]/r/[slug] rather
 * than a "compact mode" flag on that page: this route is NOT nested under
 * app/[locale]/layout.tsx, so it renders with none of the site chrome
 * (header, nav, account link, locale switcher) that page always has --
 * exactly what an iframe embed needs and nothing else. Everything else is
 * shared (OpeningHoursList, BookingForm) so the booking logic itself is
 * identical to the full site, not a second implementation to keep in
 * sync.
 *
 * No X-Frame-Options/frame-ancestors restriction is set anywhere in this
 * app (see next.config.mjs) -- that's what makes embedding possible at
 * all, and is intentional here: this route only ever shows PUBLIC data
 * (Phase 08's public RLS policies), so there is nothing sensitive to
 * protect from being framed by an arbitrary site.
 */
export default async function BookingWidgetPage({ params }: { params: { locale: string; slug: string } }) {
  if (!isSupportedLocale(params.locale)) return null;
  const locale: SupportedLocale = params.locale;
  const dict = getDictionary(locale);

  const supabase = createSupabaseServerClient();
  const restaurant = await fetchPublicRestaurant(supabase, params.slug);

  if (!restaurant) {
    return (
      <div style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
        <WidgetResizeReporter />
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>{t(dict, 'public.restaurant.notFoundTitle')}</p>
      </div>
    );
  }

  const [openingHours, specialHours] = await Promise.all([
    fetchOpeningHours(supabase, restaurant.id),
    fetchSpecialHours(supabase, restaurant.id),
  ]);

  return (
    <div style={{ padding: 'var(--space-xl)', display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)', fontSize: 14 }}>
      <WidgetResizeReporter />

      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>{restaurant.name}</h1>
        {restaurant.city && <p style={{ color: 'var(--text-muted)', margin: '4px 0 0', fontSize: 13 }}>{restaurant.city}</p>}
      </div>

      <OpeningHoursList locale={locale} openingHours={openingHours} specialHours={specialHours} />

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
      />

      <div style={{ textAlign: 'center', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-md)' }}>
        <Link
          href={`/${locale}/r/${restaurant.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}
        >
          {t(dict, 'public.widget.poweredBy')} · {t(dict, 'public.widget.viewFullProfile')}
        </Link>
      </div>
    </div>
  );
}
