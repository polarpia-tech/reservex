import { fetchOpeningHours, fetchPublicRestaurant, fetchSpecialHours } from '@reservex/core';

import { BookingForm } from '@/components/BookingForm';
import { OpeningHoursList } from '@/components/OpeningHoursList';
import { getDictionary, isSupportedLocale, t, type SupportedLocale } from '@/lib/dictionary';
import { createSupabaseServerClient } from '@/lib/supabaseServer';

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

  const [openingHours, specialHours] = await Promise.all([
    fetchOpeningHours(supabase, restaurant.id),
    fetchSpecialHours(supabase, restaurant.id),
  ]);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 'var(--space-2xl)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2xl)' }}>
      <div>
        <h1 style={{ fontSize: 28, marginBottom: 'var(--space-xs)' }}>{restaurant.name}</h1>
        {(restaurant.addressLine || restaurant.city) && (
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>{[restaurant.addressLine, restaurant.city].filter(Boolean).join(', ')}</p>
        )}
        {restaurant.phone && <p style={{ color: 'var(--text-muted)', margin: 0 }}>{restaurant.phone}</p>}
        {restaurant.description && <p style={{ marginTop: 'var(--space-md)' }}>{restaurant.description}</p>}
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
    </div>
  );
}
