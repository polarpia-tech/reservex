import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';

import './globals.css';

export const metadata: Metadata = {
  title: 'ReservX',
  description: 'AI-first restaurant reservations.',
  // manifest.webmanifest is auto-linked by Next.js because app/manifest.ts
  // exists -- no explicit `manifest:` field needed here for that. appleWebApp
  // covers what the manifest does NOT reliably cover on iOS Safari (no
  // Apple Developer account yet, per the project brief -- a well-configured
  // PWA "Add to Home Screen" is the iOS story until/unless that changes):
  // standalone status-bar app chrome and the home-screen title. The actual
  // apple-touch-icon comes from the app/apple-icon.png convention file
  // (Next.js auto-generates the <link> for it), not from this object.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ReservX',
  },
};

// theme-color intentionally tracks app/theme-editorial.css's --accent --
// this is what colors the browser chrome/status bar in a standalone PWA
// window and Android's task switcher card, so it should visually match
// the app itself, not be an unrelated brand color. A single value, not a
// light/dark pair: the site is dark-only by design now (see
// theme-editorial.css's header comment), so there is no light variant to
// track.
export const viewport: Viewport = {
  themeColor: '#E8A33D',
};

// Locale-aware routing (app/[locale]/...) was built in Phase 08 alongside
// the customer booking flow -- see app/page.tsx (detects a locale and
// redirects) and app/[locale]/layout.tsx (validates it, loads the
// dictionary). This root layout stays deliberately locale-neutral: the
// Next.js App Router requires the true root layout to own <html>/<body>,
// and that segment sits ABOVE the [locale] param, so it has no access to
// it -- `lang` is pinned to "en" here rather than pretending to be
// locale-aware. That's a known, disclosed limitation (see the Phase 08
// README), not a bug: every visible string on every page is still served
// in the correct language via the dictionary, this only affects the
// `<html lang>` attribute screen readers and search engines see.

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Display (Fraunces) + body (Inter) typefaces for the dark
            editorial theme -- see theme-editorial.css. A plain <link>
            rather than next/font/google: this exact Google Fonts request
            (same families/weights/axes) is what the approved design
            mockup itself used, so it's a known-working request rather
            than a guess at next/font's variable-font weight API. Greek
            text (almost everything real users see) has no Fraunces
            glyphs, so it gracefully falls through to the Georgia
            fallback in the `--font-display` stack -- expected, and the
            same thing the mockup itself rendered. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}