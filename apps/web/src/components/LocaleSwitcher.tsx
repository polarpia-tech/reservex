'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/dictionary';

const LABELS: Record<SupportedLocale, string> = { de: 'DE', en: 'EN', el: 'EL', tr: 'TR' };

/** Swaps only the leading locale segment of the current path, e.g. "/de/r/taverna-ithaki" -> "/el/r/taverna-ithaki" -- keeps the visitor on the same page, just in a different language. */
export function LocaleSwitcher({ current }: { current: SupportedLocale }) {
  const pathname = usePathname();
  const rest = pathname.split('/').slice(2).join('/');

  return (
    <nav style={{ display: 'flex', gap: 'var(--space-sm)' }} aria-label="Language">
      {SUPPORTED_LOCALES.map((locale) => (
        <Link
          key={locale}
          href={`/${locale}${rest ? `/${rest}` : ''}`}
          style={{
            fontSize: 12,
            fontWeight: locale === current ? 700 : 400,
            padding: '4px 8px',
            borderRadius: 'var(--radius-sm)',
            color: locale === current ? 'var(--text-primary)' : 'var(--text-muted)',
            background: locale === current ? 'var(--surface-elevated)' : 'transparent',
            textDecoration: 'none',
          }}
        >
          {LABELS[locale]}
        </Link>
      ))}
    </nav>
  );
}
