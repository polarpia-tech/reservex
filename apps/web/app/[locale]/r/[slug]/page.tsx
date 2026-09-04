import { fetchOpeningHours, fetchPublicRestaurant, fetchSpecialHours } from '@reservex/core';

import { BookingForm } from '@/components/BookingForm';
import { MapPinIcon, PhoneIcon } from '@/components/icons';
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
        />
      </div>
    </div>
  );
}