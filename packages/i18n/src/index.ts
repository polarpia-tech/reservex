import i18next, { type i18n as I18nInstance } from 'i18next';

import de from './locales/de.json';
import el from './locales/el.json';
import en from './locales/en.json';
import tr from './locales/tr.json';

/**
 * MVP launch locales, per the blueprint's Part 12 (Πολυγλωσσία): DE/EN/EL/TR
 * from day one, for both the staff-facing app and the customer/AI channel.
 * Add a new locale by adding one JSON file here + one line in this record --
 * nothing else in the app should ever hardcode a language list.
 */
export const resources = { de: { translation: de }, en: { translation: en }, el: { translation: el }, tr: { translation: tr } } as const;

export type SupportedLocale = keyof typeof resources;
export const SUPPORTED_LOCALES: SupportedLocale[] = Object.keys(resources) as SupportedLocale[];
export const DEFAULT_LOCALE: SupportedLocale = 'en';

export interface CreateI18nOptions {
  /** Best-guess locale from the platform (device locale, browser Accept-Language, saved preference). */
  detectedLocale?: string;
}

function toSupportedLocale(candidate?: string): SupportedLocale {
  if (!candidate) return DEFAULT_LOCALE;
  const short = candidate.slice(0, 2).toLowerCase();
  return (SUPPORTED_LOCALES as string[]).includes(short) ? (short as SupportedLocale) : DEFAULT_LOCALE;
}

/**
 * Platform-agnostic i18next factory. The Expo app passes in
 * Localization.getLocales()[0]?.languageCode; the Next.js app passes in the
 * Accept-Language header or a `?lang=` param. Neither platform's detection
 * mechanism lives in this package -- this package only owns the strings and
 * the fallback chain (requested -> English -> restaurant's default locale,
 * per the blueprint).
 */
export function createI18n(options: CreateI18nOptions = {}): I18nInstance {
  const instance = i18next.createInstance();
  void instance.init({
    resources,
    lng: toSupportedLocale(options.detectedLocale),
    fallbackLng: DEFAULT_LOCALE,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instance;
}
