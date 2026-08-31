import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { getDictionary, isSupportedLocale, SUPPORTED_LOCALES, t, type SupportedLocale } from '@/lib/dictionary';

export function generateStaticParams() {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }));
}

/**
 * Every route under here is public-facing (the Phase 08 customer
 * directory/booking/account pages). Validates the [locale] segment itself
 * -- an unsupported value (typo, old bookmark, scraper probing random
 * paths) 404s here rather than silently falling back to English, which
 * would otherwise mask a broken link.
 */
export default function LocaleLayout({ children, params }: { children: ReactNode; params: { locale: string } }) {
  if (!isSupportedLocale(params.locale)) notFound();
  const locale: SupportedLocale = params.locale;
  const dict = getDictionary(locale);

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-lg) var(--space-2xl)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <Link href={`/${locale}`} style={{ fontWeight: 700, fontSize: 18, textDecoration: 'none', color: 'var(--text-primary)' }}>
          {t(dict, 'common.appName')}
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-lg)' }}>
          <Link href={`/${locale}/account`} style={{ fontSize: 14, textDecoration: 'none', color: 'var(--text-primary)' }}>
            {t(dict, 'public.account.title')}
          </Link>
          <LocaleSwitcher current={locale} />
        </div>
      </header>
      <main style={{ flex: 1 }}>{children}</main>
    </div>
  );
}
