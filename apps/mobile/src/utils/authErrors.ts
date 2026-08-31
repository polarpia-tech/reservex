/**
 * Supabase Auth returns English, provider-specific error strings (e.g.
 * "Invalid login credentials"). We never show those raw -- every user-facing
 * message goes through i18n, per the project's language rule. This maps the
 * handful of errors a login/signup form actually needs to handle to a
 * translation key; anything unrecognized falls back to a generic message
 * rather than leaking a raw English string into a German or Turkish UI.
 */
export function mapSupabaseAuthError(message: string, t: (key: string) => string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return t('auth.errors.invalidCredentials');
  if (m.includes('email') && (m.includes('invalid') || m.includes('valid'))) return t('auth.errors.emailInvalid');
  if (m.includes('password') && (m.includes('least') || m.includes('short') || m.includes('6 characters'))) {
    return t('auth.errors.passwordTooShort');
  }
  return t('auth.errors.generic');
}
