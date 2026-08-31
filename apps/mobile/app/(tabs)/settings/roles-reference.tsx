import type { StaffRole } from '@reservex/core';
import { spacing, typeScale } from '@reservex/ui';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { Card } from '@/components/ui/Card';
import { useTheme } from '@/theme/ThemeProvider';

const ROLES: StaffRole[] = ['owner', 'manager', 'reservation_manager', 'host', 'staff'];

/**
 * Purely informational -- no editing here. Deliberately NOT a custom
 * permission editor: the `permission_overrides` jsonb column on
 * `restaurant_users` (migration 0002) exists as an escape hatch for
 * fine-grained, per-person overrides LATER, but building a full custom-RBAC
 * UI now, for an MVP with 5 fixed roles, would be exactly the kind of
 * overengineering the project brief warns against. See the honesty notice
 * below -- it says outright which of these distinctions the database
 * actually enforces today versus which are still just team conventions.
 */
export default function RolesReferenceScreen() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <>
      <Stack.Screen options={{ title: t('rolesReference.title') }} />
      <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
        <Text style={[styles.notice, { color: theme.textMuted, backgroundColor: theme.surface }]}>
          {t('rolesReference.enforcementNotice')}
        </Text>
        {ROLES.map((role) => (
          <Card key={role} style={{ gap: spacing.xs }}>
            <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>{t(`roles.${role}`)}</Text>
            <Text style={{ color: theme.textMuted }}>{t(`rolesReference.${role}`)}</Text>
          </Card>
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing['4xl'] },
  notice: { ...typeScale.caption, padding: spacing.md, borderRadius: 12 },
});
