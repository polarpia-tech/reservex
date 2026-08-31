import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { DEFAULT_LOCALE, isSupportedLocale } from '@/lib/dictionary';

/**
 * Locale-neutral entry point. Picks a best-guess locale from the browser's
 * Accept-Language header and redirects straight into it -- there is
 * nothing to render here itself, this route only ever exists to bounce
 * "/" to "/de", "/en", "/el" or "/tr". No cookie-based "remembered
 * language" preference is implemented yet (a returning visitor is
 * re-detected from their browser header on every visit to "/"); that's a
 * reasonable follow-up, not a Phase 08 requirement, and worth flagging
 * rather than silently pretending it's there.
 */
export default function RootIndexPage() {
  const acceptLanguage = headers().get('accept-language') ?? '';
  const firstTag = acceptLanguage.split(',')[0]?.trim().split(';')[0]?.trim();
  const candidate = firstTag?.slice(0, 2).toLowerCase();
  const locale = candidate && isSupportedLocale(candidate) ? candidate : DEFAULT_LOCALE;
  redirect(`/${locale}`);
}
