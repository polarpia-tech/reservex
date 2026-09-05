/**
 * Item 3 of the animation brief: every screen transition in the app should
 * read from ONE place, so a push looks the same everywhere and a modal
 * looks the same everywhere -- never a per-screen guess, and never two
 * screens quietly disagreeing on how navigation should feel.
 *
 * These are all native, UI-thread transitions built into Expo Router's
 * underlying @react-navigation/native-stack (the "animation"/"presentation"
 * screen options) -- no Reanimated involved, nothing that runs on the JS
 * thread, and nothing that can drop a frame mid-navigation, which is
 * exactly where a dropped frame would be most visible. Deliberately NOT
 * importing @react-navigation/native-stack's own option types here: this
 * app doesn't depend on that package directly (only transitively, via
 * expo-router), and under this workspace's package manager a type-only
 * import of an undeclared dependency can fail to resolve even though the
 * import itself would be erased at build time. `as const` on each value
 * gives the same literal-type safety without that risk.
 *
 * React Navigation automatically reverses a screen's own "animation" when
 * the user goes back (swipe-back gesture or the header back button), so
 * there is no separate "back" transition to define here -- picking a push
 * animation picks its back animation too.
 */

/** A normal push onto a stack -- e.g. the reservations list to a reservation's detail, or the tables list to a table's detail. */
export const pushScreenOptions = {
  animation: 'slide_from_right' as const,
};

/**
 * A screen presented as a distinct moment rather than another page in the
 * stack -- so far just the reservation success confirmation (Phase 2).
 * `presentation: 'modal'` alone already changes how the screen sits in the
 * stack (it can be swiped away independently); pairing it with an explicit
 * `animation` guarantees the same slide-up entrance on both platforms
 * instead of leaving it to whatever each OS defaults to.
 */
export const modalScreenOptions = {
  presentation: 'modal' as const,
  animation: 'slide_from_bottom' as const,
};

/**
 * The three root-level "modes" of the app -- (auth), (onboarding), (tabs) --
 * reached via router.replace() in useProtectedRoute.ts, never a push the
 * user would swipe back out of. A fade reads as "the app changed context"
 * (you signed in, you finished onboarding), distinct from the directional
 * slide a push/pop uses for moving around within one context.
 */
export const rootModeScreenOptions = {
  animation: 'fade' as const,
};
