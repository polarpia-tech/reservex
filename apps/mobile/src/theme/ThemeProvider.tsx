import { getTheme, type ThemeColors } from '@reservex/ui';
import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import { useColorScheme } from 'react-native';

const ThemeContext = createContext<ThemeColors>(getTheme('dark'));

/**
 * Wraps the app in the current color theme, following the system setting.
 * ReservX has no in-app light/dark toggle in the MVP -- it simply respects
 * the device, which covers the vast majority of users and avoids a whole
 * extra settings surface for a v1.
 */
export function ThemeProvider({ children }: PropsWithChildren) {
  const scheme = useColorScheme();
  const theme = useMemo(() => getTheme(scheme === 'light' ? 'light' : 'dark'), [scheme]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeColors {
  return useContext(ThemeContext);
}
