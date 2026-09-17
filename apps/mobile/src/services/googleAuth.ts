import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from './supabase';

/**
 * "Continue with Google" for the mobile app, backed by Supabase Auth's
 * OAuth provider (the same Google provider that can be wired up for the
 * web app -- both go through Supabase, never a separate identity system).
 *
 * How this differs from a web OAuth redirect: there is no page to redirect
 * back to, so we open the authorization URL in an in-app browser tab
 * (expo-web-browser) and listen for it to redirect to our own app's
 * `reservex://` scheme (already registered for expo-router deep links --
 * see android/app/src/main/AndroidManifest.xml's intent-filter).
 *
 * This project's Supabase client does not set `flowType: 'pkce'`, so
 * supabase-js defaults to the *implicit* OAuth flow: the redirect carries
 * `access_token`/`refresh_token` directly in the URL fragment (after `#`),
 * not a `?code=` query param. We parse that fragment by hand (React
 * Native's built-in URLSearchParams only implements append/toString) and
 * call setSession() with the tokens. A `?code=` fallback is kept in case
 * the client is ever switched to PKCE.
 *
 * Once setSession succeeds, we don't need to do anything else here --
 * AuthProvider's onAuthStateChange listener picks up the new session
 * automatically, and useProtectedRoute (root layout) sends the user
 * wherever a freshly-authenticated user belongs.
 */
export async function signInWithGoogle(): Promise<void> {
  const redirectTo = Linking.createURL('auth-callback');

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      // We drive the browser ourselves via WebBrowser below -- without
      // this, supabase-js would try (and fail) to do a web-style redirect,
      // since there is no `window.location` on native.
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;
  if (!data?.url) throw new Error('Supabase did not return a Google authorization URL.');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  if (result.type !== 'success' || !result.url) {
    // The user closed the browser tab or cancelled -- not a real error,
    // there is simply nothing to sign in with. Callers treat a silent
    // return as "no-op", same as e.g. dismissing a native share sheet.
    return;
  }

  // See the module doc-comment: this parses the redirect's URL fragment by
  // hand rather than relying on URLSearchParams (RN's polyfill only
  // implements append/toString) or Linking.parse() (query string only).
  const hashIndex = result.url.indexOf('#');
  const fragment = hashIndex >= 0 ? result.url.slice(hashIndex + 1) : '';
  const fragmentParams: Record<string, string> = {};
  for (const pair of fragment.split('&')) {
    if (!pair) continue;
    const [key, value = ''] = pair.split('=');
    fragmentParams[decodeURIComponent(key)] = decodeURIComponent(value);
  }

  const accessToken = fragmentParams.access_token;
  const refreshToken = fragmentParams.refresh_token;

  if (accessToken && refreshToken) {
    const { error: setSessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (setSessionError) throw setSessionError;
    return;
  }

  // Fall back to the PKCE-style `?code=` query param, in case this project
  // is ever switched to flowType: 'pkce'.
  const { queryParams } = Linking.parse(result.url);
  const code = typeof queryParams?.code === 'string' ? queryParams.code : undefined;
  if (!code) {
    throw new Error('Google sign-in did not return a session.');
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) throw exchangeError;
}
