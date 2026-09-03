import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { LogoMark, UserIcon } from '@/components/icons';
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
          flexWrap: 'wrap',
          rowGap: 'var(--space-sm)',
          columnGap: 'var(--space-md)',
          padding: 'var(--space-lg) clamp(1rem, 4vw, var(--space-2xl))',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <Link
          href={`/${locale}`}
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', fontWeight: 700, fontSize: 18, textDecoration: 'none', color: 'var(--text-primary)' }}
        >
          <LogoMark />
          {t(dict, 'common.appName')}
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
          <Link
            href={`/${locale}/account`}
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', fontSize: 14, textDecoration: 'none', color: 'var(--text-primary)' }}
          >
            <UserIcon />
            {t(dict, 'public.account.title')}
          </Link>
          <LocaleSwitcher current={locale} />
        </div>
      </header>
      <main style={{ flex: 1 }}>{children}</main>
    </div>
  );
}