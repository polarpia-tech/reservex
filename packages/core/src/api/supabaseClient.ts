import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Platform-agnostic Supabase client factory. Neither the Expo app nor the
 * Next.js app should call `createClient` directly -- both go through this,
 * so there is exactly one place that knows how a Supabase client is built.
 *
 * The url/anonKey are passed in rather than read from process.env here,
 * because Expo (EXPO_PUBLIC_*) and Next.js (NEXT_PUBLIC_*) expose env vars
 * under different names and at different times (build vs runtime).
 */
/** Minimal structural type matching both AsyncStorage and window.localStorage. */
export interface SupabaseAuthStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  /**
   * Platform-specific session storage. React Native has no `localStorage`,
   * so the mobile app MUST pass an AsyncStorage-backed adapter here; the web
   * app can omit this and supabase-js will use `window.localStorage`.
   */
  storage?: SupabaseAuthStorage;
  /**
   * Set to `false` for a short-lived, request-scoped client that only ever
   * makes anonymous reads -- e.g. a Next.js Server Component rendering the
   * Phase 08 public restaurant directory/profile pages, which runs on the
   * server with no browser `window`/`localStorage` and no user session to
   * persist in the first place. Defaults to `true`, which is correct for
   * every long-lived, browser-side client (both apps' normal usage).
   */
  persistSession?: boolean;
}

export function createSupabaseClient(config: SupabaseConfig): SupabaseClient {
  if (!config.url || !config.anonKey) {
    throw new Error(
      'createSupabaseClient: missing url or anonKey. Did you forget to set the ' +
        'EXPO_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL env vars?',
    );
  }
  const persistSession = config.persistSession ?? true;
  return createClient(config.url, config.anonKey, {
    auth: {
      persistSession,
      autoRefreshToken: persistSession,
      ...(config.storage ? { storage: config.storage } : {}),
    },
  });
}
