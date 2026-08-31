import { fetchPublicRestaurantDirectory } from '@reservex/core';
import Link from 'next/link';

import { getDictionary, isSupportedLocale, t, type SupportedLocale } from '@/lib/dictionary';
import { createSupabaseServerClient } from '@/lib/supabaseServer';

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
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 'var(--space-2xl)' }}>
      <h1 style={{ fontSize: 28, marginBottom: 'var(--space-xs)' }}>{t(dict, 'public.directory.title')}</h1>
      <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>{t(dict, 'public.directory.subtitle')}</p>

      {restaurants.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>{t(dict, 'public.directory.noRestaurants')}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {restaurants.map((restaurant) => (
            <li
              key={restaurant.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-lg)',
                background: 'var(--surface)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-lg)',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{restaurant.name}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  {t(dict, TYPE_LABEL_KEY[restaurant.restaurantType] ?? 'restaurantTypes.restaurant')}
                  {restaurant.city ? ` · ${restaurant.city}` : ''}
                </div>
              </div>
              <Link
                href={`/${locale}/r/${restaurant.slug}`}
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--surface)',
                  background: 'var(--accent)',
                  borderRadius: 'var(--radius-full)',
                  padding: '8px 16px',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {t(dict, 'public.directory.viewAndBook')}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
