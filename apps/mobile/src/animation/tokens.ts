import { Easing } from 'react-native-reanimated';

/**
 * The one place every animation in the app reads its timing/easing/spring
 * values from. Requested explicitly as a "central animation system" so the
 * whole app's motion can be re-tuned later from one file instead of hunting
 * through every screen -- and so no two screens end up with visibly
 * different animation "personalities" (one bouncy, one linear, one slow).
 *
 * Pair every animation built from these with useReduceMotion() (in this same
 * folder): these tokens describe HOW something animates, not WHETHER it
 * should -- that check belongs at each call site.
 */

export const durations = {
  /** Button press feedback, small icon toggles (heart, badge count). */
  instant: 120,
  /** Card/list-item entrance, most everyday fades and slides. */
  short: 220,
  /** Screen transitions, modal presentation/dismissal. */
  medium: 320,
  /** Splash intro beats, the reservation-success sequence. */
  long: 480,
} as const;

export const easings = {
  /** Default for most fades/slides -- gentle in, gentle out. */
  standard: Easing.bezier(0.4, 0, 0.2, 1),
  /** Entrances: elements arriving on screen. */
  decelerate: Easing.bezier(0, 0, 0.2, 1),
  /** Exits: elements leaving the screen. */
  accelerate: Easing.bezier(0.4, 0, 1, 1),
} as const;

/**
 * withSpring configs, named by feel rather than by raw numbers, so a call
 * site reads as intent ("springs.snappy") instead of a guess at what
 * {damping: 16, stiffness: 220} is supposed to feel like.
 */
export const springs = {
  /** The "breathing" CTA loop and any other very subtle, slow motion. */
  gentle: { damping: 18, stiffness: 90, mass: 1 },
  /** Button press-down/release, most interactive feedback. */
  snappy: { damping: 16, stiffness: 220, mass: 0.9 },
  /** Success checkmark and confirmation entrances -- a touch of bounce. */
  bouncy: { damping: 10, stiffness: 180, mass: 1 },
} as const;

/** Named scale values so call sites read as intent rather than magic numbers. */
export const scale = {
  pressedDown: 0.96,
  breatheUp: 1.02,
  resting: 1,
} as const;
