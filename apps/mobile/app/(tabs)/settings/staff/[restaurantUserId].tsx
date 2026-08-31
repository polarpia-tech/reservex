import { fetchRestaurantStaff, setStaffActive, updateStaffRole, type StaffRole } from '@reservex/core';
import { spacing, typeScale } from '@reservex/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { RolePicker } from '@/components/staff/RolePicker';
import { useMyRestaurant } from '@/hooks/useMyRestaurant';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Change role / deactivate-reactivate for one existing staff member.
 * Unlike inviting someone new, both actions here are plain client-side
 * UPDATEs on `restaurant_users` -- allowed directly by the
 * `restaurant_users_write` RLS policy (0011) for owner/manager, no Edge
 * Function involved (see scripts/verify_phase04_bootstrap.sql Test F,
 * which proved this exact thing back in Phase 04).
 */
export default function StaffMemberScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { restaurantUserId } = useLocalSearchParams<{ restaurantUserId: string }>();
  const { membership } = useMyRestaurant();
  const restaurantId = membership?.restaurant.id;
  const queryClient = useQueryClient();

  const staffQuery = useQuery({
    queryKey: ['restaurant-staff', restaurantId],
    queryFn: () => fetchRestaurantStaff(supabase, restaurantId!),
    enabled: Boolean(restaurantId),
  });

  const member = staffQuery.data?.find((m) => m.restaurantUserId === restaurantUserId);

  const roleMutation = useMutation({
    mutationFn: (role: Exclude<StaffRole, 'owner'>) => updateStaffRole(supabase, restaurantUserId, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['restaurant-staff', restaurantId] }),
  });

  const activeMutation = useMutation({
    mutationFn: (isActive: boolean) => setStaffActive(supabase, restaurantUserId, isActive),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['restaurant-staff', restaurantId] });
      if (!member?.isActive) router.back(); // just reactivated -- nothing more to do here
    },
  });

  function confirmDeactivate() {
    Alert.alert(t('staff.confirmDeactivateTitle'), t('staff.confirmDeactivateBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('staff.deactivate'), style: 'destructive', onPress: () => activeMutation.mutate(false) },
    ]);
  }

  if (!member) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <Text style={{ color: theme.textMuted }}>{t('common.loading')}</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: member.email }} />
      <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
        <Text style={{ color: theme.textPrimary, fontWeight: '600', fontSize: typeScale.h3.size }}>{member.email}</Text>
        <Text style={{ color: theme.textMuted }}>
          {member.isActive ? t('staff.statusActive') : t('staff.statusInactive')}
        </Text>

        {member.role === 'owner' ? (
          <Text style={{ color: theme.textMuted }}>{t('staff.ownerCannotBeChanged')}</Text>
        ) : (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>{t('staff.changeRole')}</Text>
            <RolePicker value={member.role} onChange={(role) => roleMutation.mutate(role)} />
          </View>
        )}

        <View style={styles.section}>
          {member.isActive ? (
            <Button label={t('staff.deactivate')} variant="neutral" onPress={confirmDeactivate} loading={activeMutation.isPending} />
          ) : (
            <Button label={t('staff.reactivate')} onPress={() => activeMutation.mutate(true)} loading={activeMutation.isPending} />
          )}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.lg },
  section: { gap: spacing.sm, marginTop: spacing.lg },
  sectionTitle: { ...typeScale.label, textTransform: 'uppercase', letterSpacing: 0.4 },
});
