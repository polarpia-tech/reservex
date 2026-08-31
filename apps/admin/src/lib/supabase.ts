'use client';

import { createSupabaseClient } from '@reservex/core';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The one browser-side Supabase client for the admin app -- same
 * createSupabaseClient() factory apps/web and apps/mobile both go through
 * (see apps/web/src/lib/supabase.ts for the fuller rationale). Anon key
 * only: every privileged operation this app performs goes through a
 * SECURITY DEFINER SQL function that checks is_platform_admin()/
 * is_platform_super_admin() itself (migration 0020) -- there is no
 * service-role key anywhere in this app, by design (see .env.example).
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
