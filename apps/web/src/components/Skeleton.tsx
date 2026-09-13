import type { CSSProperties } from 'react';

/**
 * Phase 20 (customer UI redesign): a shimmering placeholder block, used in
 * place of the plain "Loading..." text that every data-fetching screen in
 * this app showed before (directory, restaurant profile's opening hours,
 * account page, live availability). The shimmer itself is a real CSS
 * keyframe animation (`.skeleton` in globals.css) -- the one thing plain
 * inline `style={{...}}` objects can't express -- this component just
 * supplies the box's own size/shape via inline style, same convention as
 * everywhere else. `prefers-reduced-motion` turns the shimmer off globally
 * (see globals.css); this component needs no special-casing for that.
 */
export function Skeleton({ width = '100%', height = 16, radius, style }: { width?: number | string; height?: number | string; radius?: string; style?: CSSProperties }) {
  return <span className="skeleton" style={{ display: 'block', width, height, borderRadius: radius ?? 'var(--radius-sm)', ...style }} />;
}

/** A vertical stack of Skeleton lines -- the common case (a few text lines of unknown final content). */
export function SkeletonLines({ count = 3, lastLineWidth = '60%' }: { count?: number; lastLineWidth?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} height={14} width={i === count - 1 ? lastLineWidth : '100%'} />
      ))}
    </div>
  );
}
