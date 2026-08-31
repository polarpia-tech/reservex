import { DEFAULT_LOCALE, resources, SUPPORTED_LOCALES, type SupportedLocale } from '@reservex/i18n';

export { SUPPORTED_LOCALES, DEFAULT_LOCALE, type SupportedLocale };

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as string[]).includes(value);
}

/**
 * A plain, static JSON dictionary for one locale -- deliberately NOT the
 * full i18next runtime that @reservex/i18n's createI18n() sets up for the
 * Expo app. React Server Components (the restaurant directory and
 * restaurant-profile pages) render once on the server per request with no
 * client-side language switching, so there is no need for i18next's
 * interpolation engine, plural rules, or React context/hooks here -- a
 * plain object plus the tiny `t()` lookup below covers everything those
 * pages need, without shipping i18next's runtime to the server bundle (or,
 * worse, to the client bundle for pages that don't need it).
 *
 * Client Components that DO need interpolation (the booking form's
 * "{{min}}–{{max}} guests" error messages) use the small `interpolate()`
 * helper below instead of pulling in react-i18next -- see BookingForm.tsx.
 */
export function getDictionary(locale: SupportedLocale): (typeof resources)[SupportedLocale]['translation'] {
  return resources[locale].translation;
}

type Dictionary = ReturnType<typeof getDictionary>;

/** Dot-path lookup into a dictionary, e.g. t(dict, 'public.booking.title'). Returns the key itself (not throwing, not blank) if the path doesn't resolve, so a missing/typo'd key is visibly obvious instead of silently blank in the UI. */
export function t(dict: Dictionary, path: string): string {
  const value = path.split('.').reduce<unknown>((node, segment) => {
    if (node && typeof node === 'object' && segment in node) {
      return (node as Record<string, unknown>)[segment];
    }
    return undefined;
  }, dict);
  return typeof value === 'string' ? value : path;
}

/** Fills {{placeholders}} in a translated string, e.g. interpolate(t(dict, '...'), { min: 2, max: 8 }). Mirrors i18next's own {{ }} syntax so translators only ever see one convention across the whole app. */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}
