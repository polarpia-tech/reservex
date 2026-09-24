/**
 * ReservX design tokens -- the single source of truth for color, type and
 * spacing, shared by the Expo app (via StyleSheet) and the Next.js app
 * (via generated CSS variables, see apps/web/app/globals.css).
 *
 * Visual identity, in one sentence: a dark, futuristic operations surface
 * (not a warm/cream "restaurant" cliche) with exactly two accents that each
 * mean something -- "ember" for the restaurant/reservation domain, "pulse"
 * for anything the AI did. Never mix the two: if a color is decorative
 * rather than meaningful, it should be neutral, not accent.
 *
 * Performance note: the whole app uses ONE font family (see `fonts` below).
 * A second/third family would mean extra font files loaded before the
 * splash screen can resolve -- not worth it for a mobile cold-start budget.
 */

export const palette = {
  // Neutrals -- cool-leaning charcoal, not a warm "hospitality" cliche.
  // 2026-09: lightened from a near-black OLED palette (ink900 was #0B0C10)
  // to a softer charcoal-slate scale -- the original read as harsh/heavy,
  // especially stacked (a bordered card on the near-black page background,
  // itself holding bordered chips/squares) where each extra layer of near-
  // black-on-near-black just compounded. Same relative step sizes between
  // background/surface/surfaceElevated/border, just a lighter starting
  // point, so contrast ratios and the "this sits above that" layering
  // still read correctly -- this is a brightness retune, not a redesign.
  ink900: '#1A1C22',
  ink800: '#23262E',
  ink700: '#2C2F39',
  ink600: '#3B3F4B',
  ink400: '#646B7A',
  ink200: '#9BA1AE',
  ink100: '#C7CAD1',
  paper: '#FAFAFA',
  paperElevated: '#FFFFFF',
  paperMuted: '#F2F1EE',
  paperLine: '#E4E2DD',

  // Ember -- the restaurant/reservation domain accent (warm, appetite,
  // "table is ready" energy). Used for primary actions and reservation state.
  emberDark: '#FF7A45',
  emberLight: '#E85D2C',

  // Pulse -- the AI domain accent. ANY time the UI shows something the AI
  // produced, suggested or is "thinking" about, it wears this color and
  // nothing else does. That consistency is the whole point.
  pulseDark: '#7C5CFF',
  pulseLight: '#6A4CFF',

  // Semantic -- deliberately distinct from both accents so status is never
  // ambiguous with "this is an AI thing" or "this is a primary action".
  success: '#34D399',
  warning: '#FBBF24',
  danger: '#F87171',
  info: '#38BDF8',
  infoLight: '#0284C7',

  // Depth -- one extra dark-theme step ABOVE surfaceElevated, used only for
  // an interactive card's hover/selected background (never a base surface).
  // Kept as its own named step, distinct from ink600 (which already means
  // "border"), so the two roles never accidentally collapse into the same
  // literal value if one is retuned later.
  ink550: '#343847',
} as const;

export type ColorScheme = 'light' | 'dark';

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceElevated: string;
  /**
   * One step lighter than surfaceElevated -- an interactive card's
   * pressed/selected background (e.g. a table card the host just tapped,
   * a selected date chip). Never a base surface for ordinary content.
   */
  surfaceHighlight: string;
  border: string;
  /** A stronger border for a selected/focused card outline, distinct from the ordinary hairline `border`. */
  borderStrong: string;
  /** Modal / bottom-sheet backdrop scrim. */
  overlay: string;
  textPrimary: string;
  textMuted: string;
  accent: string;      // "ember" -- primary actions, reservation-domain UI
  ai: string;           // "pulse" -- anything AI-originated
  success: string;
  warning: string;
  danger: string;
  /** Neutral informational tone -- distinct from both accents and from warning/danger. */
  info: string;
}

export const themes: Record<ColorScheme, ThemeColors> = {
  dark: {
    background: palette.ink900,
    surface: palette.ink800,
    surfaceElevated: palette.ink700,
    surfaceHighlight: palette.ink550,
    border: palette.ink600,
    borderStrong: palette.ink400,
    overlay: 'rgba(5, 6, 8, 0.72)',
    textPrimary: '#F2F3F5',
    textMuted: palette.ink200,
    accent: palette.emberDark,
    ai: palette.pulseDark,
    success: palette.success,
    warning: palette.warning,
    danger: palette.danger,
    info: palette.info,
  },
  light: {
    background: palette.paper,
    surface: palette.paperElevated,
    surfaceElevated: palette.paperMuted,
    surfaceHighlight: '#E9E7E1',
    border: palette.paperLine,
    borderStrong: '#C7C4BC',
    overlay: 'rgba(20, 21, 26, 0.5)',
    textPrimary: '#14151A',
    textMuted: '#6B7280',
    accent: palette.emberLight,
    ai: palette.pulseLight,
    success: '#0F9D6E',
    warning: '#B27C00',
    danger: '#D64545',
    info: palette.infoLight,
  },
};

/** 4px base grid. Every margin/padding in the app should come from here. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 48,
  '6xl': 64,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
} as const;

/**
 * Single font family for the whole app (see perf note above). Weights
 * follow Google Fonts' "Plus Jakarta Sans" variable font, which has solid
 * Greek, German and Turkish glyph coverage -- the three MVP markets besides
 * English.
 */
export const fonts = {
  family: 'PlusJakartaSans',
  mono: 'IBMPlexMono', // used sparingly: reservation IDs, technical values
  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800',
  },
} as const;

export const typeScale = {
  display: { size: 32, lineHeight: 38, weight: fonts.weight.extrabold },
  h1: { size: 26, lineHeight: 32, weight: fonts.weight.bold },
  h2: { size: 21, lineHeight: 27, weight: fonts.weight.bold },
  h3: { size: 17, lineHeight: 23, weight: fonts.weight.semibold },
  body: { size: 15, lineHeight: 22, weight: fonts.weight.regular },
  bodyStrong: { size: 15, lineHeight: 22, weight: fonts.weight.semibold },
  caption: { size: 13, lineHeight: 18, weight: fonts.weight.medium },
  label: { size: 12, lineHeight: 16, weight: fonts.weight.semibold },
} as const;

export function getTheme(scheme: ColorScheme): ThemeColors {
  return themes[scheme];
}

/**
 * RN-shape shadow presets (shadowColor/Offset/Opacity/Radius for iOS,
 * `elevation` for Android -- the two platforms' native depth systems, no
 * extra dependency). Three plain levels for ordinary depth, plus a
 * `glow(color)` helper for a colored highlight (a selected card's border
 * glow, an important CTA's breathing halo) -- pass a theme color so the
 * glow always matches the accent it belongs to instead of a hardcoded hex.
 *
 * These intentionally read as "this element sits above the surface behind
 * it" at three distinct strengths, so depth communicates hierarchy (a
 * plain list row vs. a stat card vs. a modal sheet) instead of every
 * surface in the app getting the same shadow.
 */
export const shadows = {
  none: {},
  /** List rows, ordinary cards sitting directly on the background. */
  sm: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.16,
    shadowRadius: 3,
    elevation: 2,
  },
  /** Stat cards, section cards -- the app's default "elevated" card. */
  md: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 6,
  },
  /** Modals/sheets, floating action buttons -- the top of the stack. */
  lg: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 14,
  },
} as const;

export function glowShadow(color: string, intensity: 'soft' | 'strong' = 'soft') {
  return {
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: intensity === 'strong' ? 0.55 : 0.32,
    shadowRadius: intensity === 'strong' ? 18 : 10,
    elevation: intensity === 'strong' ? 10 : 6,
  } as const;
}

/**
 * Two-stop gradient pairs, one per accent (never mixed -- see this file's
 * header comment on ember vs. pulse) plus one neutral "surface" gradient
 * for a premium card background that is still clearly part of the dark
 * neutral system, not a third accent. Consumed by expo-linear-gradient on
 * the Expo app; unused by the web codegen script (scripts/generate-css-
 * tokens.mjs only reads `themes`/`spacing`/`radii`/`fonts` by name), so
 * adding this here cannot affect the web app's generated CSS.
 */
export const gradients = {
  ember: [palette.emberLight, palette.emberDark] as [string, string],
  pulse: [palette.pulseLight, palette.pulseDark] as [string, string],
  surfaceCard: [palette.ink800, palette.ink700] as [string, string],
} as const;

