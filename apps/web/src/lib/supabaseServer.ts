import { createSupabaseClient } from '@reservex/core';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A fresh, request-scoped Supabase client for Server Components -- used
 * ONLY for anonymous public reads (the restaurant directory and a single
 * restaurant's public profile/opening hours, all covered by 0014's
 * `*_public_select` RLS policies). There is no signed-in user on the
 * server side of this app (no cookie-based Supabase Auth session wiring
 * has been built), so nothing that needs a customer's own identity --
 * booking, "my reservations", cancelling -- can go through this client.
 * Those all happen in Client Components via src/lib/supabase.ts instead,
 * which has real access to the browser's auth session.
 *
 * `persistSession: false` matters here: Node has no `window`/`localStorage`
 * for supabase-js to fall back to, and there is nothing to persist across
 * one server-rendered request anyway.
 */
export function createSupabaseServerClient(): SupabaseClient {
  return createSupabaseClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    persistSession: false,
  });
}
