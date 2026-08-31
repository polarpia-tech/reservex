import { spacing, typeScale } from '@reservex/ui';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

/**
 * Deliberately explicit placeholder, per the blueprint's rule: never present
 * unfinished functionality as if it were done. Every screen that isn't
 * built yet says so, and says which phase builds it -- no fake data, no
 * silently-empty screen that looks broken instead of "not built yet".
 */
export function PhaseNotice({ title, phase, description }: { title: string; phase: string; description: string }) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <Text style={[styles.badge, { color: theme.ai, borderColor: theme.ai }]}>{phase}</Text>
      <Text style={[styles.title, { color: theme.textPrimary }]}>{title}</Text>
      <Text style={[styles.description, { color: theme.textMuted }]}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing['3xl'], gap: spacing.md },
  badge: {
    ...typeScale.label,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: spacing.md,
    textTransform: 'uppercase',
  },
  title: { ...typeScale.h2, textAlign: 'center' },
  description: { ...typeScale.body, textAlign: 'center', maxWidth: 280 },
});
