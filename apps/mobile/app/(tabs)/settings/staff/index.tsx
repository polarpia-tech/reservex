import { fetchRestaurantStaff } from '@reservex/core';
import { spacing, typeScale } from '@reservex/ui';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link, Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { useAuth } from '@/providers/AuthProvider';
import { useMyRestaurant } from '@/hooks/useMyRestaurant';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * The roster. Visible to any active staff member (matches the
 * `restaurant_users_select` RLS policy) -- everyone can see who their
 * colleagues are. Only owner/manager get the invite button and can tap
 * through to change someone's role or deactivate them (enforced both here,
 * for UX, and again server-side by RLS, since that's the real boundary).
 */
export default function StaffListScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const { membership, isOwnerOrManager } = useMyRestaurant();
  const restaurantId = membership?.restaurant.id;

  const staffQuery = useQuery({
    queryKey: ['restaurant-staff', restaurantId],
    queryFn: () => fetchRestaurantStaff(supabase, restaurantId!),
    enabled: Boolean(restaurantId),
  });

  return (
    <>
      <Stack.Screen
        options={{
          title: t('staff.title'),
          headerRight: isOwnerOrManager
            ? () => (
                <Link href="/(tabs)/settings/staff/invite" asChild>
                  <Pressable accessibilityRole="button" hitSlop={8}>
                    <Ionicons name="person-add-outline" color={theme.accent} size={22} />
                  </Pressable>
                </Link>
              )
            : undefined,
        }}
      />
      <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
        <Link href="/(tabs)/settings/roles-reference" style={[styles.rolesLink, { color: theme.accent }]}>
          {t('staff.rolesReferenceLink')}
        </Link>

        {staffQuery.isLoading ? <Text style={{ color: theme.textMuted }}>{t('common.loading')}</Text> : null}

        {(staffQuery.data ?? []).map((member) => {
          const isSelf = member.userId === user?.id;
          const isOwnerRow = member.role === 'owner';
          const canManage = isOwnerOrManager && !isOwnerRow && !isSelf;

          return (
            <Pressable
              key={member.restaurantUserId}
              accessibilityRole={canManage ? 'button' : undefined}
              onPress={canManage ? () => router.push(`/(tabs)/settings/staff/${member.restaurantUserId}`) : undefined}
            >
              <Card style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>
                    {member.email} {isSelf ? t('staff.you') : ''}
                  </Text>
                  <Text style={{ color: theme.textMuted, marginTop: spacing.xs }}>
                    {t(`roles.${member.role}`)} · {member.isActive ? t('staff.statusActive') : t('staff.statusInactive')}
                  </Text>
                </View>
                {canManage ? <Ionicons name="chevron-forward" color={theme.textMuted} size={20} /> : null}
              </Card>
            </Pressable>
          );
        })}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing['4xl'] },
  rolesLink: { ...typeScale.caption, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
