import { fetchPublicRestaurantDirectory } from '@reservex/core';
import Link from 'next/link';

import { ArrowRightIcon, MapPinIcon, UtensilsIcon } from '@/components/icons';
import { getDictionary, isSupportedLocale, t, type SupportedLocale } from '@/lib/dictionary';
import { restaurantTypeLabelKey } from '@/lib/restaurantType';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { badgeStyle, cardStyle } from '@/lib/ui';

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
    // Full-bleed (Phase 20 part 2): matches the restaurant profile page's
    // own container -- same clamp() side padding, no hard maxWidth -- so
    // the directory no longer reads as a separate, narrower "boxed
    // document" sandwiched between two full-width pages.
    <div style={{ width: '100%', padding: 'clamp(40px, 8vw, 88px) clamp(20px, 5vw, 64px) clamp(56px, 9vw, 104px)' }}>
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          fontSize: 'clamp(32px, 5vw, 52px)',
          lineHeight: 1.08,
          letterSpacing: '-0.01em',
          margin: '0 0 var(--space-sm)',
        }}
      >
        {t(dict, 'public.directory.title')}
      </h1>
      <p style={{ color: 'var(--text-muted)', marginTop: 0, marginBottom: 'clamp(32px, 5vw, 56px)', maxWidth: 520, lineHeight: 1.55, fontSize: 15.5 }}>
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
          {restaurants.map((restaurant, index) => (
            <li key={restaurant.id} style={{ animation: 'fade-in-up 0.4s ease both', animationDelay: `${Math.min(index, 8) * 40}ms` }}>
              {/* The whole card is one Link (not just the CTA at the
                  bottom) -- a single clear click/focus target instead of
                  two overlapping ones, and a much larger, easier-to-hit
                  tap area on mobile. The visual "button" below is a plain
                  span, since a real <button> nested inside an <a> is
                  invalid HTML. */}
              <Link
                href={`/${locale}/r/${restaurant.slug}`}
                className="card-hover"
                style={{
                  ...cardStyle,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-md)',
                  textDecoration: 'none',
                  color: 'inherit',
                  height: '100%',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {restaurant.logoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- a
                    // handful of remote restaurant-owned logo URLs; not worth
                    // wiring next/image's domain allowlist for this yet.
                    <img
                      src={restaurant.logoUrl}
                      alt=""
                      width={40}
                      height={40}
                      style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', objectFit: 'cover', border: '1px solid var(--border)', flexShrink: 0 }}
                    />
                  )}
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18 }}>{restaurant.name}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-xs) var(--space-sm)' }}>
                  <span style={badgeStyle('muted')}>
                    <UtensilsIcon size={12} />
                    {t(dict, restaurantTypeLabelKey(restaurant.restaurantType))}
                  </span>
                  {restaurant.city && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)', fontSize: 13 }}>
                      <MapPinIcon size={13} />
                      {restaurant.city}
                    </span>
                  )}
                </div>
                <span
                  style={{
                    marginTop: 'auto',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--accent-contrast)',
                    background: 'var(--accent)',
                    borderRadius: 'var(--radius-full)',
                    padding: '11px 16px',
                    minHeight: 44,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t(dict, 'public.directory.viewAndBook')}
                  <ArrowRightIcon size={14} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}