'use client';

import { useEffect } from 'react';

/**
 * Phase 14: registers public/sw.js once, on every page (mounted from the
 * root layout). Guarded by the feature-detect -- older/unusual browsers
 * without serviceWorker support just skip this silently, the site works
 * identically either way, this is a pure enhancement.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // Best-effort: a failed registration (e.g. unsupported browser quirk,
      // dev server oddity) should never break the page itself.
    });
  }, []);

  return null;
}
