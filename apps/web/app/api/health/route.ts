import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabaseServer';

/**
 * Phase 17 (Deployment): a real health-check endpoint, the one piece of
 * "monitoring" this sandbox can actually build and test without a live
 * account -- an uptime monitor (Vercel's own, UptimeRobot, a Supabase
 * synthetic check, whatever the pilot restaurants' hosting ends up using)
 * needs a real, unauthenticated URL to poll. Everything else this project's
 * README documents under "monitoring" (Sentry, Vercel Analytics, Supabase's
 * own dashboard) needs a real account/DSN this sandbox does not have and so
 * is documented, not wired up -- see the Phase 17 README section.
 *
 * Deliberately NOT edge runtime -- the default Node.js runtime is used so
 * this can run the same `createSupabaseServerClient()` every other Server
 * Component in this app already uses, rather than maintaining a second,
 * edge-compatible Supabase client just for this one route.
 *
 * Checks exactly one thing: can this app reach Postgres through Supabase's
 * REST layer and get a real answer back. `restaurants` is queried because
 * it already has an anon-readable RLS policy (`restaurants_public_select`,
 * migration 0013) -- no new policy, no service-role key, and no risk of
 * this endpoint becoming a way to enumerate anything not already public.
 * `head: true` with `count: 'exact'` asks Postgres for a row count without
 * transferring any row data -- the cheapest real query that still proves
 * the whole path (Vercel -> Supabase REST -> PostgREST -> Postgres -> RLS)
 * is actually working, not just that this process is running.
 */
export async function GET() {
  const startedAt = Date.now();

  try {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase
      .from('restaurants')
      .select('id', { count: 'exact', head: true })
      .limit(1);

    if (error) {
      return NextResponse.json(
        {
          status: 'error',
          checks: { database: 'error' },
          error: error.message,
          timestamp: new Date().toISOString(),
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        status: 'ok',
        checks: { database: 'ok' },
        latencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    // Anything that throws before even reaching Supabase (e.g. missing
    // NEXT_PUBLIC_SUPABASE_URL in a broken deploy) is still a real,
    // reportable "down" -- not a 500 with no explanation.
    return NextResponse.json(
      {
        status: 'error',
        checks: { database: 'unknown' },
        error: err instanceof Error ? err.message : 'unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
