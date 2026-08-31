import { createI18n } from '@reservex/i18n';
import * as Localization from 'expo-localization';

/**
 * One instance for the whole app lifetime, seeded with the device's locale.
 * A per-user override (Settings > Language) persists a saved preference
 * and is wired in Phase 04 alongside the rest of the profile/settings state
 * -- this is just the bootstrap.
 */
export const i18n = createI18n({ detectedLocale: Localization.getLocales()[0]?.languageCode ?? undefined });
