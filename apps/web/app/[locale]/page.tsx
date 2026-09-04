import { fetchPublicRestaurantDirectory } from '@reservex/core';
import Link from 'next/link';

import { ArrowRightIcon, MapPinIcon, UtensilsIcon } from '@/components/icons';
import { getDictionary, isSupportedLocale, t, type SupportedLocale } from '@/lib/dictionary';
import { createSupabaseServerClient } from '@/lib/supabaseServer';

// This page's own header comment already documents the intent: fetched
// anonymously at REQUEST time, not baked in at build time -- a live
// restaurant directory would otherwise go stale between deploys. Next.js
// 14's App Router doesn't reliably detect that intent on its own here (the
// Supabase client's fetch isn't Next's native `fetch`), so without this it
// tries to statically prerender the page during `next build` for every
// locale in generateStaticParams (../layout.tsx) -- which is exactly what
// broke CI: the build step's placeholder Supabase URL
// (ci-placeholder.supabase.co, see ci.yml) doesn't resolve, so the
// build-time fetch fails outright. `force-dynamic` makes the already-
// documented behavior the actual behavior.
export const dynamic = 'force-dynamic';

const TYPE_LABEL_KEY: Record<string, string> = {
  restaurant: 'restaurantTypes.restaurant',
  cafe: 'restaurantTypes.cafe',
  bar: 'restaurantTypes.bar',
  club: 'restaurantTypes.club',
  beach_venue: 'restaurantTypes.beach_venue',
  hotel_venue: 'restaurantTypes.hotel_venue',
  event_venue: 'restaurantTypes.event_venue',
};

/**
 * The public restaurant directory -- every active restaurant on ReservX,
 * for a visitor who arrived with no QR code or direct link. Server
 * Component: fetched anonymously at request time via
 * createSupabaseServerClient(), no client-side JS needed for this page at
 * all. Deliberately no search/filter UI yet (see BookPublicReservationInput's
 * README note) -- with only a handful of pilot restaurants at launch, a
 * plain list is honest about what's actually here; search is a natural
 * Phase 09+ addition once there are enough restaurants for it to matter.
 */
export default async function RestaurantDirectoryPage({ params }: { params: { locale: string } }) {
  if (!isSupportedLocale(params.locale)) return null; // layout already 404s; this satisfies the type narrowing below.
  const locale: SupportedLocale = params.locale;
  const dict = getDictionary(locale);

  const supabase = createSupabaseServerClient();
  const restaurants = await fetchPublicRestaurantDirectory(supabase);

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 'clamp(var(--space-xl), 6vw, 64px) var(--space-2xl) var(--space-4xl)' }}>
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          fontSize: 'clamp(28px, 5vw, 42px)',
          lineHeight: 1.1,
          margin: '0 0 var(--space-sm)',
        }}
      >
        {t(dict, 'public.directory.title')}
      </h1>
      <p style={{ color: 'var(--text-muted)', marginTop: 0, marginBottom: 'var(--space-3xl)', maxWidth: 520, lineHeight: 1.55 }}>
        {t(dict, 'public.directory.subtitle')}
      </p>

      {restaurants.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-md)', padding: 'var(--space-4xl) 0', color: 'var(--text-muted)' }}>
          <UtensilsIcon size={36} style={{ opacity: 0.5 }} />
          <p style={{ margin: 0 }}>{t(dict, 'public.directory.noRestaurants')}</p>
        </div>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 'var(--space-md)',
          }}
        >
          {restaurants.map((restaurant) => (
            <li
              key={restaurant.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-xl)',
                background: 'var(--surface)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-md)',
              }}
            >
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, marginBottom: 6 }}>{restaurant.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-xs) var(--space-sm)', color: 'var(--text-muted)', fontSize: 13 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <UtensilsIcon size={13} />
                    {t(dict, TYPE_LABEL_KEY[restaurant.restaurantType] ?? 'restaurantTypes.restaurant')}
                  </span>
                  {restaurant.city && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <MapPinIcon size={13} />
                      {restaurant.city}
                    </span>
                  )}
                </div>
              </div>
              <Link
                href={`/${locale}/r/${restaurant.slug}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--surface)',
                  background: 'var(--accent)',
                  borderRadius: 'var(--radius-full)',
                  padding: '11px 16px',
                  minHeight: 44,
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {t(dict, 'public.directory.viewAndBook')}
                <ArrowRightIcon size={14} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}