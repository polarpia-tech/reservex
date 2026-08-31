import { radii, spacing, typeScale } from '@reservex/ui';
import { forwardRef } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

export interface TextFieldProps extends TextInputProps {
  label: string;
  errorText?: string | null;
}

/** The one text input every form in the app should use -- label, themed border, inline error state. */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, errorText, style, ...inputProps },
  ref,
) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: theme.textMuted }]}>{label}</Text>
      <TextInput
        ref={ref}
        placeholderTextColor={theme.textMuted}
        style={[
          styles.input,
          {
            color: theme.textPrimary,
            backgroundColor: theme.surface,
            borderColor: errorText ? theme.danger : theme.border,
          },
          style,
        ]}
        {...inputProps}
      />
      {errorText ? <Text style={[styles.error, { color: theme.danger }]}>{errorText}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { ...typeScale.label, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    fontSize: typeScale.body.size,
  },
  error: { ...typeScale.caption },
});
