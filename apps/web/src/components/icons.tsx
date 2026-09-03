/**
 * Hand-rolled inline SVG icons, deliberately NOT an external icon library.
 *
 * apps/web has no component library and no build step for anything besides
 * Next.js itself (see BookingForm.tsx/layout.tsx -- everything is plain
 * inline `style={{...}}` objects, no CSS Modules/Tailwind). Pulling in a
 * package like lucide-react for a dozen glyphs would add a new pnpm
 * dependency to chase through the workspace's strict node_modules
 * resolution (see apps/mobile/package.json's history with
 * @react-native/gradle-plugin and @babel/runtime for exactly that class of
 * problem) for something a handful of small, licensable-free SVG paths
 * solves directly, with zero install step and zero bundle-size surprise.
 *
 * Every icon takes the same two props and defaults to `currentColor`, so
 * color follows the surrounding text/CSS var the same way a font glyph
 * would (see usages: color: 'var(--text-muted)' on a wrapping element
 * colors the icon inside it for free).
 */
import type { CSSProperties } from 'react';

export type IconProps = { size?: number; style?: CSSProperties };

const base = (size: number): CSSProperties => ({ display: 'inline-block', flexShrink: 0, width: size, height: size });

export function LogoMark({ size = 22, style }: IconProps) {
  // A simple rounded-square "seat/reservation" mark: a table corner with a
  // checkmark, in the brand accent color -- not a photo-realistic logo, but
  // a real, deliberate glyph rather than a generic placeholder shape.
  return (
    <svg viewBox="0 0 24 24" fill="none" style={{ ...base(size), ...style }} aria-hidden="true">
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="var(--accent)" />
      <path d="M7 12.5L10.2 15.5L17 8.5" stroke="var(--surface)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function UserIcon({ size = 16, style }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ ...base(size), ...style }} aria-hidden="true">
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="7.5" r="4.5" />
    </svg>
  );
}

export function MapPinIcon({ size = 16, style }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ ...base(size), ...style }} aria-hidden="true">
      <path d="M20 10.5c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10.5" r="2.75" />
    </svg>
  );
}

export function PhoneIcon({ size = 16, style }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ ...base(size), ...style }} aria-hidden="true">
      <path d="M4.5 4.5h3.6l1.6 4.4-2.2 1.7a13 13 0 0 0 6 6l1.7-2.2 4.4 1.6v3.6c0 1-.9 1.8-1.9 1.7C9.7 20.7 3.3 14.3 2.8 6.4c-.1-1 .7-1.9 1.7-1.9Z" />
    </svg>
  );
}

export function ClockIcon({ size = 16, style }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ ...base(size), ...style }} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

export function CalendarIcon({ size = 16, style }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ ...base(size), ...style }} aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </svg>
  );
}

export function UsersIcon({ size = 16, style }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ ...base(size), ...style }} aria-hidden="true">
      <path d="M17 21a5.5 5.5 0 0 0-10 0" />
      <circle cx="12" cy="9.5" r="4" />
      <path d="M21 21a4.5 4.5 0 0 0-3.2-4.3M17 5.1A4 4 0 0 1 17 13" />
    </svg>
  );
}

export function UtensilsIcon({ size = 16, style }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ ...base(size), ...style }} aria-hidden="true">
      <path d="M7 3v6a2 2 0 0 0 2 2v10M7 3v6a2 2 0 0 1-2 2v0M5 3v6M9 3v6" />
      <path d="M17 3c-1.7 0-3 2-3 5s1.3 5 3 5v8" />
    </svg>
  );
}

export function ArrowRightIcon({ size = 16, style }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ ...base(size), ...style }} aria-hidden="true">
      <path d="M4 12h16M13 5l7 7-7 7" />
    </svg>
  );
}

export function CalendarOffIcon({ size = 40, style }: IconProps) {
  // Used only for empty states -- larger by default, meant to sit above
  // a line of muted text, not inline with it.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ ...base(size), ...style }} aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      <path d="M8 14l3.2 3.2M11.2 14 8 17.2" />
    </svg>
  );
}

export function CheckCircleIcon({ size = 20, style }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ ...base(size), ...style }} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5L16 9.5" />
    </svg>
  );
}

export function BellIcon({ size = 16, style }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ ...base(size), ...style }} aria-hidden="true">
      <path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 13 6 9Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function GlobeIcon({ size = 14, style }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ ...base(size), ...style }} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z" />
    </svg>
  );
}