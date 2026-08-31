'use client';

import { createSupabaseClient } from '@reservex/core';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The one browser-side Supabase client for the whole web app -- goes
 * through @reservex/core's createSupabaseClient() factory (same one the
 * Expo app uses) so there is exactly one place that knows how a client is
 * built. No `storage` option is passed: on web, supabase-js defaults to
 * `window.localStorage` for the auth session, which is exactly right here
 * (unlike React Native, which has no localStorage and must supply an
 * AsyncStorage adapter instead).
 *
 * This client always runs with the anon key, in the browser. It is used for:
 *  - anonymous public reads (restaurant directory, restaurant profile,
 *    opening hours) -- though see src/lib/supabaseServer.ts for why the
 *    directory/profile PAGES themselves fetch server-side instead;
 *  - the book_public_reservation RPC, as either a guest or a signed-in
 *    customer;
 *  - customer auth (signUp/signInWithPassword/signOut) and every
 *    customer-account API in @reservex/core's api/customerAccount.ts,
 *    which all need the caller's own auth session to satisfy RLS.
 *
 * A module-level singleton is safe here: this file is only ever imported
 * from Client Components (see the 'use client' directive above), so it is
 * re-used across a whole browser tab's lifetime rather than reconstructed
 * on every render.
 */
let client: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (!client) {
    client = createSupabaseClient({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    });
  }
  return client;
}
