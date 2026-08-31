import type { MetadataRoute } from 'next';

/**
 * Phase 14: PWA installability. Next.js auto-serves this at
 * /manifest.webmanifest and auto-links it from every page's <head> --
 * no manual <link rel="manifest"> needed anywhere.
 *
 * `name`/`short_name` are deliberately NOT localized: this file has no
 * access to the visitor's chosen locale (it's a single site-wide route,
 * not nested under app/[locale]/), and "ReservX" is a proper noun anyway
 * -- every other MVP-scope app in this project (mobile, admin) uses the
 * same unlocalized app name for the same reason.
 *
 * Icons are functional placeholders (a plain "R" monogram in the Ember
 * accent color, generated in this sandbox with ImageMagick -- see
 * public/icons/) -- real brand assets from an actual design pass should
 * replace them before a real launch; this is disclosed, not silently
 * treated as final branding. Only `purpose: "any"` icons are provided
 * (no maskable/safe-zone variant) -- that's the minimum PWA Lighthouse
 * actually requires for installability, and a padded maskable variant is
 * not worth the extra complexity until there's real artwork to build it
 * from.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ReservX',
    short_name: 'ReservX',
    description: 'AI-first restaurant, café, bar & venue reservations.',
    start_url: '/',
    display: 'standalone',
    background_color: '#FAFAFA',
    theme_color: '#E85D2C',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
