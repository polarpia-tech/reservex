import { fetchPublicRestaurantDirectory } from '@reservex/core';

import { RestaurantDirectoryList } from '@/components/RestaurantDirectoryList';
import { UtensilsIcon } from '@/components/icons';
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
// `force-dynamic` alone only forces this PAGE to render per request -- it
// does not stop Next.js's Data Cache from separately caching the
// individual fetch() calls this render makes. Confirmed live on the
// restaurant profile page (app/[locale]/r/[slug]/page.tsx, 2026-09-17):
// Vercel's own Function Invocation panel showed most of that page's
// Supabase REST calls served "Using cache" instead of hitting Supabase,
// which is exactly why edits made in the mobile app weren't showing up
// here. This directory fetches the same way (createSupabaseServerClient +
// a plain fetch() under the hood), so it's exposed to the same staleness
// for restaurant name/logo/city/type edits -- forcing every fetch() in
// this render to skip the Data Cache entirely fixes it here too.
export const fetchCache = 'force-no-store';

/**
 * The public restaurant directory -- every active restaurant on ReservX,
 * for a visitor who arrived with no QR code or direct link. Server
 * Component: fetched anonymously at request time via
 * createSupabaseServerClient(), no client-side JS needed for this page at
 * all. Search-as-you-type (RestaurantDirectoryList, 2026-09) filters this
 * same server-fetched array client-side -- no second endpoint, and it only
 * shows itself once there are enough restaurants for search to matter.
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
        <RestaurantDirectoryList restaurants={restaurants} locale={locale} />
      )}
    </div>
  );
}
