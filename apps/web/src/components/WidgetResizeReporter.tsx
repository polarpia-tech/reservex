'use client';

import { useEffect } from 'react';

/**
 * Phase 14: the whole point of an iframe-embeddable widget is that the
 * HOST page (a restaurant's own website) doesn't know the widget's content
 * height in advance -- it changes as the visitor picks a date/time and the
 * form grows or shrinks. This posts the widget's own scrollHeight to
 * `window.parent` on mount and on every resize (via ResizeObserver on
 * <body>), so the host page can react and resize the <iframe> to match. A
 * no-op when this page is NOT inside an iframe (`window.self ===
 * window.top`) -- renders nothing either way.
 *
 * Deliberately a plain postMessage + a copy-paste listener snippet (see
 * the Phase 14 README) rather than a published JS SDK: no build/bundling/
 * CDN-hosting pipeline needed for something this small, and postMessage
 * height-reporting is a well-understood, standard pattern for embeddable
 * widgets. `targetOrigin: '*'` is intentional here -- the message carries
 * nothing sensitive (a number), and the whole premise of a public
 * booking widget is that it doesn't know or care which site embeds it.
 */
export function WidgetResizeReporter() {
  useEffect(() => {
    if (typeof window === 'undefined' || window.self === window.top) return;

    function postHeight() {
      const height = document.body.scrollHeight;
      window.parent.postMessage({ source: 'reservex-widget', type: 'resize', height }, '*');
    }

    postHeight();
    const observer = new ResizeObserver(postHeight);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, []);

  return null;
}
