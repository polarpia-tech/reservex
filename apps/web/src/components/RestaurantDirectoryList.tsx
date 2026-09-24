'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import type { Restaurant } from '@reservex/core';
import { ArrowRightIcon, MapPinIcon, SearchIcon, UtensilsIcon, XIcon } from '@/components/icons';
import { getDictionary, t, type SupportedLocale } from '@/lib/dictionary';
import { restaurantTypeLabelKey } from '@/lib/restaurantType';
import { badgeStyle, cardStyle } from '@/lib/ui';

/**
 * Client-side piece of the public restaurant directory (2026-09): a search
 * box over the SAME restaurant array the Server Component page already
 * fetched -- no new endpoint, no extra request per keystroke. The page's
 * own header comment used to say search was deliberately deferred until
 * there were "enough restaurants for it to matter"; this is that Phase 09+
 * addition. Filtering a handful-to-low-hundreds of restaurants client-side
 * is instant and keeps the page's Server Component (and its force-dynamic/
 * force-no-store freshness guarantees) completely unchanged -- this
 * component only ever re-renders the list it was handed, it never
 * re-fetches.
 */
export function RestaurantDirectoryList({
  restaurants,
  locale,
}: {
  restaurants: Restaurant[];
  locale: SupportedLocale;
}) {
  const dict = getDictionary(locale);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(locale);
    if (!q) return restaurants;
    return restaurants.filter((restaurant) => {
      const haystack = [restaurant.name, restaurant.city, t(dict, restaurantTypeLabelKey(restaurant.restaurantType))]
        .filter((part): part is string => Boolean(part))
        .join(' ')
        .toLocaleLowerCase(locale);
      return haystack.includes(q);
    });
  }, [restaurants, query, dict, locale]);

  // Only worth showing once there's actually something to search through --
  // with a handful of pilot restaurants a search box above a 2-card list is
  // just noise, not a feature.
  const showSearch = restaurants.length > 4;

  return (
    <>
      {showSearch ? (
        <div style={{ position: 'relative', marginBottom: 'clamp(24px, 4vw, 36px)', maxWidth: 420 }}>
          <SearchIcon
            size={16}
            style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(dict, 'public.directory.searchPlaceholder')}
            aria-label={t(dict, 'public.directory.searchPlaceholder')}
            style={{
              fontFamily: 'var(--font-family)',
              fontSize: 16,
              width: '100%',
              color: 'var(--text-primary)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-full)',
              padding: query ? '12px 40px 12px 40px' : '12px 14px 12px 40px',
              transition: 'border-color 0.15s ease',
            }}
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={t(dict, 'public.directory.clearSearch')}
              style={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 26,
                height: 26,
                borderRadius: '50%',
                border: 'none',
                background: 'var(--surface-elevated)',
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              <XIcon size={13} />
            </button>
          ) : null}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'var(--space-md)',
            padding: 'var(--space-4xl) 0',
            color: 'var(--text-muted)',
          }}
        >
          <SearchIcon size={32} style={{ opacity: 0.5 }} />
          <p style={{ margin: 0 }}>{t(dict, 'public.directory.noResults')}</p>
        </div>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))',
            gap: 'var(--space-md)',
          }}
        >
          {filtered.map((restaurant, index) => (
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
    </>
  );
}
