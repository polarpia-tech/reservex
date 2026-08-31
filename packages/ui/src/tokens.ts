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
  // Neutrals -- cool-leaning near-black, not a warm "hospitality" cliche.
  ink900: '#0B0C10',
  ink800: '#16181D',
  ink700: '#1E2129',
  ink600: '#2A2E38',
  ink400: '#5B6270',
  ink200: '#8B909C',
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
} as const;

export type ColorScheme = 'light' | 'dark';

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceElevated: string;
  border: string;
  textPrimary: string;
  textMuted: string;
  accent: string;      // "ember" -- primary actions, reservation-domain UI
  ai: string;           // "pulse" -- anything AI-originated
  success: string;
  warning: string;
  danger: string;
}

export const themes: Record<ColorScheme, ThemeColors> = {
  dark: {
    background: palette.ink900,
    surface: palette.ink800,
    surfaceElevated: palette.ink700,
    border: palette.ink600,
    textPrimary: '#F2F3F5',
    textMuted: palette.ink200,
    accent: palette.emberDark,
    ai: palette.pulseDark,
    success: palette.success,
    warning: palette.warning,
    danger: palette.danger,
  },
  light: {
    background: palette.paper,
    surface: palette.paperElevated,
    surfaceElevated: palette.paperMuted,
    border: palette.paperLine,
    textPrimary: '#14151A',
    textMuted: '#6B7280',
    accent: palette.emberLight,
    ai: palette.pulseLight,
    success: '#0F9D6E',
    warning: '#B27C00',
    danger: '#D64545',
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
