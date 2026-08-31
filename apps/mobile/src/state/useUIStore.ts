import { create } from 'zustand';

/**
 * Local, ephemeral UI state only -- which restaurant is currently selected
 * in the switcher, which modal is open, etc. Anything that comes from the
 * server belongs in TanStack Query (added in Phase 04 alongside auth),
 * never duplicated in here. See Part 01 of the blueprint for the rationale
 * on Zustand + TanStack Query over Redux.
 */
interface UIState {
  activeRestaurantId: string | null;
  setActiveRestaurantId: (id: string | null) => void;
  isRestaurantSwitcherOpen: boolean;
  setRestaurantSwitcherOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeRestaurantId: null,
  setActiveRestaurantId: (id) => set({ activeRestaurantId: id }),
  isRestaurantSwitcherOpen: false,
  setRestaurantSwitcherOpen: (open) => set({ isRestaurantSwitcherOpen: open }),
}));
