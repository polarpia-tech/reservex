import type { CSSProperties } from 'react';

/**
 * Phase 20 (customer UI redesign): a small set of shared style-object
 * factories for the new, consistent design system across the public site.
 * This app has no CSS-in-JS layer and no component library (see
 * BookingForm.tsx's own header comment) -- every component builds its own
 * plain `style={{...}}` object. That's fine for one-off layout, but it was
 * starting to duplicate the same button/card/chip look with slightly
 * different numbers in every file (see e.g. account/page.tsx's
 * primaryButtonStyle vs. BookingForm.tsx's own inline submit-button style
 * before this phase). These functions/constants are the single source for
 * the handful of patterns that now appear in more than one place --
 * buttons, chips, cards, the mobile sticky-CTA bar, the bottom sheet
 * overlay -- so a future palette or spacing tweak is a change here, not a
 * hunt through every page. Existing one-off styles that were already
 * fine (e.g. the Field label pattern repeated in BookingForm.tsx and
 * account/page.tsx) are deliberately left alone -- this is additive, not a
 * forced rewrite of every inline style in the app.
 */

export const cardStyle: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding: 'clamp(20px, 3.5vw, 32px)',
  background: 'var(--surface)',
};

export function buttonStyle(
  variant: 'primary' | 'secondary' | 'ghost' = 'primary',
  opts: { disabled?: boolean; fullWidth?: boolean; size?: 'md' | 'lg' } = {},
): CSSProperties {
  const size = opts.size ?? 'md';
  const base: CSSProperties = {
    fontFamily: 'var(--font-family)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    border: 'none',
    borderRadius: 'var(--radius-full)',
    fontWeight: 600,
    fontSize: size === 'lg' ? 15.5 : 14,
    padding: size === 'lg' ? '15px 28px' : '10px 18px',
    minHeight: size === 'lg' ? 52 : 44,
    width: opts.fullWidth ? '100%' : undefined,
    cursor: opts.disabled ? 'default' : 'pointer',
    opacity: opts.disabled ? 0.6 : 1,
    transition: 'transform 0.15s ease, opacity 0.15s ease, background 0.15s ease',
  };
  if (variant === 'primary') {
    return { ...base, background: 'var(--accent)', color: 'var(--accent-contrast)' };
  }
  if (variant === 'secondary') {
    return { ...base, background: 'var(--surface-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-strong)' };
  }
  return { ...base, background: 'none', color: 'var(--text-primary)', border: '1px solid var(--border)' };
}

/**
 * The visual-chip picker style used for date/party-size/time selection
 * (Phase 20 -- replaces the native <input type="date">/<input type="time">/
 * <input type="number"> pattern the booking form used before). Purely
 * presentational: what a chip DOES when clicked is still plain application
 * state (see BookingForm.tsx), this just gives every chip in the app --
 * date, party size, time slot, seating preference -- the same look and the
 * same three states.
 */
export function chipStyle(opts: { selected?: boolean; disabled?: boolean } = {}): CSSProperties {
  return {
    fontFamily: 'var(--font-family)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    fontSize: 14,
    fontWeight: 600,
    padding: '11px 18px',
    minHeight: 44,
    borderRadius: 'var(--radius-full)',
    border: `1px solid ${opts.selected ? 'var(--accent)' : 'var(--border)'}`,
    background: opts.selected ? 'var(--accent)' : 'var(--surface)',
    color: opts.selected ? 'var(--accent-contrast)' : opts.disabled ? 'var(--text-faint)' : 'var(--text-primary)',
    opacity: opts.disabled ? 0.5 : 1,
    cursor: opts.disabled ? 'default' : 'pointer',
    whiteSpace: 'nowrap',
    transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.1s ease',
  };
}

/**
 * Bottom-sheet + sticky-CTA shell for mobile (Phase 20, spec section 10:
 * "mobile gets touch-friendly controls ... bottom sheets, sticky CTA where
 * sensible"). `stickyBarStyle` pins a full-width action bar to the bottom
 * of the viewport with a safe-area inset so it never sits under a phone's
 * home indicator; `bottomSheetOverlayStyle`/`bottomSheetStyle` are the two
 * halves of a simple modal-from-the-bottom pattern (a dimmed backdrop +
 * a rounded-top panel), used for the full date-picker and any other
 * choice too large for an inline chip row on a narrow screen.
 */
export const stickyBarStyle: CSSProperties = {
  position: 'sticky',
  bottom: 0,
  left: 0,
  right: 0,
  background: 'var(--surface)',
  borderTop: '1px solid var(--border)',
  padding: '12px clamp(16px, 4vw, 24px) calc(12px + env(safe-area-inset-bottom, 0px))',
  boxShadow: 'var(--shadow-elevated)',
  zIndex: 30,
};

export const bottomSheetOverlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(6, 8, 10, 0.6)',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  zIndex: 50,
};

export const bottomSheetStyle: CSSProperties = {
  width: '100%',
  maxWidth: 560,
  maxHeight: '80vh',
  overflowY: 'auto',
  background: 'var(--surface)',
  borderRadius: '20px 20px 0 0',
  border: '1px solid var(--border)',
  borderBottom: 'none',
  padding: '20px clamp(16px, 4vw, 28px) calc(20px + env(safe-area-inset-bottom, 0px))',
  boxShadow: 'var(--shadow-elevated)',
};

export const badgeStyle = (tone: 'accent' | 'success' | 'warning' | 'danger' | 'muted' = 'muted'): CSSProperties => {
  const colorVar = tone === 'muted' ? 'var(--text-muted)' : `var(--${tone})`;
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '3px 10px',
    borderRadius: 'var(--radius-full)',
    border: `1px solid ${colorVar}`,
    color: colorVar,
    background: tone === 'muted' ? 'var(--surface-elevated)' : `color-mix(in srgb, ${colorVar} 15%, transparent)`,
    fontSize: 11.5,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  };
};
