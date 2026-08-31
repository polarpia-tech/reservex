import { radii, spacing, typeScale } from '@reservex/ui';
import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

export interface ButtonProps extends Omit<PressableProps, 'style'> {
  label: string;
  /** "accent" = ember (primary restaurant action). "ai" = pulse (an AI-originated action, e.g. "confirm what the assistant proposed"). */
  variant?: 'accent' | 'ai' | 'neutral';
  loading?: boolean;
}

/**
 * The one button component every screen should use. Two accent variants on
 * purpose: `accent` for ordinary actions, `ai` reserved for actions the AI
 * proposed -- so a user always knows, from color alone, whether they are
 * confirming their own action or the assistant's suggestion.
 */
export function Button({ label, variant = 'accent', loading = false, disabled, ...pressableProps }: ButtonProps) {
  const theme = useTheme();
  const backgroundColor =
    variant === 'neutral' ? theme.surfaceElevated : variant === 'ai' ? theme.ai : theme.accent;
  const textColor = variant === 'neutral' ? theme.textPrimary : '#0B0C10';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor, opacity: pressed ? 0.85 : disabled ? 0.5 : 1 },
      ]}
      {...pressableProps}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[styles.label, { color: textColor }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    paddingHorizontal: spacing['2xl'],
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: typeScale.bodyStrong.size,
    fontWeight: typeScale.bodyStrong.weight as '600',
  },
});
