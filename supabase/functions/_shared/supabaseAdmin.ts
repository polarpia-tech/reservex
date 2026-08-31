// deno-lint-ignore-file no-explicit-any
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';

/**
 * Thrown for anything that should map to HTTP 401 -- callers catch this
 * specifically to distinguish "you're not signed in" from "something broke".
 */
export class AuthError extends Error {}

/**
 * Service-role client: bypasses Row Level Security entirely. This is the
 * ONLY place in the whole codebase that should ever hold the service role
 * key -- it lives in this function's environment (set via
 * `supabase secrets set`), never in any client bundle. Every function that
 * uses this client is responsible for doing its OWN authentication and
 * authorization checks before touching data with it (see
 * getAuthenticatedUser below) -- RLS is not there to save you here.
 */
export function createAdminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the function environment.');
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Authentication step, shared by every function: resolves the calling user
 * from the request's `Authorization: Bearer <access_token>` header, using
 * the ANON key (never the service role for this check) so an invalid or
 * expired JWT is rejected exactly the way Supabase's own PostgREST would
 * reject it. Throws AuthError if there is no valid session -- callers
 * should let that propagate to a 401 response.
 */
export async function getAuthenticatedUser(req: Request): Promise<User> {
  const client = createCallerClient(req);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new AuthError('Invalid or expired session.');
  return data.user;
}

/**
 * Same resolution as getAuthenticatedUser(), but returns null instead of
 * throwing when there is no Authorization header at all or the session is
 * invalid -- for the small set of functions (Phase 12's create-deposit-
 * payment-intent, so far) that must serve BOTH signed-in staff AND a fully
 * anonymous guest, exactly like book_public_reservation (0014) already does
 * at the SQL level for the booking call itself. Every caller of this MUST
 * still apply its own authorization rule for the null case -- this only
 * answers "who, if anyone, is this", never "are they allowed".
 */
export async function tryGetAuthenticatedUser(req: Request): Promise<User | null> {
  if (!req.headers.get('Authorization')) return null;
  try {
    return await getAuthenticatedUser(req);
  } catch {
    return null;
  }
}

/**
 * A client scoped to the CALLER's own JWT (anon key + their Authorization
 * header) -- every query made with this client is subject to the exact same
 * RLS policies a direct client-side Supabase call would be. Added in Phase
 * 10 for the AI Gateway: whenever a tool's actual DB operation is something
 * an ordinary staff member could already do directly (create/modify/cancel
 * a reservation, update restaurant settings), the Gateway deliberately
 * reuses THIS client rather than the admin one, so RLS keeps enforcing
 * tenant isolation as a second, independent layer under the Gateway's own
 * authorization checks -- defense in depth, not a replacement for it.
 */
export function createCallerClient(req: Request): SupabaseClient {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw new AuthError('Missing Authorization header.');

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in the function environment.');
  }

  return createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
