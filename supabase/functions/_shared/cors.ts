/**
 * Shared CORS headers for every Edge Function in this project.
 *
 * Wide-open ("*") for now because there is no public web client calling
 * these functions yet in Phase 04 -- only the mobile app, via the Supabase
 * client SDK, which is not subject to browser CORS at all. Once the Next.js
 * booking widget (Phase 08+) or the web admin starts calling these
 * functions directly from a browser, THIS MUST be tightened to an explicit
 * allow-list of that app's real origin(s). Tracked as a known gap, not
 * silently deferred.
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Call at the top of every function; returns a response to send immediately for preflight, or null to continue. */
export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return null;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function jsonError(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}
