// Some Android devices' Hermes build (seen via Expo Go) is missing
// Intl.PluralRules, which i18next needs to pick the right plural form --
// this matters especially for Greek, which has its own singular/plural
// noun forms throughout the UI. Without it, i18next logs
// "environment seems not to be Intl API compatible" and the app can hang
// while it works out a fallback. This side-effect import polyfills
// Intl.PluralRules ONLY when the engine doesn't already have it natively
// (a no-op otherwise), and MUST run before createI18n() below calls
// i18next.init() -- hence importing it first, above everything else here.
import '@formatjs/intl-pluralrules/polyfill';
import '@formatjs/intl-pluralrules/locale-data/de';
import '@formatjs/intl-pluralrules/locale-data/el';
import '@formatjs/intl-pluralrules/locale-data/en';
import '@formatjs/intl-pluralrules/locale-data/tr';

import { createI18n } from '@reservex/i18n';
import * as Localization from 'expo-localization';

/**
 * One instance for the whole app lifetime, seeded with the device's locale.
 * A per-user override (Settings > Language) persists a saved preference
 * and is wired in Phase 04 alongside the rest of the profile/settings state
 * -- this is just the bootstrap.
 */
export const i18n = createI18n({ detectedLocale: Localization.getLocales()[0]?.languageCode ?? undefined });