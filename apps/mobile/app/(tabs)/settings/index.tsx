import { SUPPORTED_LOCALES, type SupportedLocale } from '@reservex/i18n';
import { spacing, typeScale } from '@reservex/ui';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useMyRestaurant } from '@/hooks/useMyRestaurant';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/theme/ThemeProvider';

const LOCALE_LABEL: Record<SupportedLocale, string> = {
  de: 'Deutsch',
  en: 'English',
  el: 'Ελληνικά',
  tr: 'Türkçe',
};

/**
 * As of Phase 09, every card on this hub links to a genuinely functional
 * screen -- "Notifications" (inbox, preferences, reminder rules) was the
 * last remaining future-phase stub and is now real too.
 */
export default function SettingsHubScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { membership } = useMyRestaurant();

  return (
    <>
      <Stack.Screen options={{ title: t('nav.settings') }} />
      <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>{t('settings.profile')}</Text>
      <Card style={{ gap: spacing.sm }}>
        <View>
          <Text style={[styles.metaLabel, { color: theme.textMuted }]}>{t('settings.signedInAs')}</Text>
          <Text style={{ color: theme.textPrimary }}>{user?.email ?? '—'}</Text>
        </View>
        {membership ? (
          <View style={{ marginTop: spacing.sm }}>
            <Text style={[styles.metaLabel, { color: theme.textMuted }]}>{t('settings.yourRole')}</Text>
            <Text style={{ color: theme.textPrimary }}>{t(`roles.${membership.role}`)}</Text>
          </View>
        ) : null}
      </Card>

      <Text style={[styles.sectionTitle, { color: theme.textMuted, marginTop: spacing['3xl'] }]}>
        {t('settings.restaurant')}
      </Text>
      <NavRow
        title={membership?.restaurant.name ?? t('settings.restaurant')}
        subtitle={t('settings.restaurantSubtitle')}
        onPress={() => router.push('/(tabs)/settings/restaurant-profile')}
      />
      <NavRow
        title={t('settings.openingHoursNav')}
        subtitle={t('settings.openingHoursNavSubtitle')}
        onPress={() => router.push('/(tabs)/settings/opening-hours')}
      />

      <Text style={[styles.sectionTitle, { color: theme.textMuted, marginTop: spacing['3xl'] }]}>
        {t('settings.language')}
      </Text>
      <Card style={styles.languageCard}>
        {SUPPORTED_LOCALES.map((locale) => {
          const active = i18n.language === locale;
          return (
            <Pressable
              key={locale}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => void i18n.changeLanguage(locale)}
              style={[styles.row, { borderColor: theme.border }]}
            >
              <Text style={[styles.rowLabel, { color: theme.textPrimary }]}>{LOCALE_LABEL[locale]}</Text>
              <View style={[styles.radio, { borderColor: active ? theme.accent : theme.border }]}>
                {active && <View style={[styles.radioDot, { backgroundColor: theme.accent }]} />}
              </View>
            </Pressable>
          );
        })}
      </Card>

      <Text style={[styles.sectionTitle, { color: theme.textMuted, marginTop: spacing['3xl'] }]}>
        {t('settings.staff')}
      </Text>
      <NavRow
        title={t('settings.staff')}
        subtitle={t('settings.staffSubtitle')}
        onPress={() => router.push('/(tabs)/settings/staff')}
      />

      <Text style={[styles.sectionTitle, { color: theme.textMuted, marginTop: spacing['3xl'] }]}>
        {t('settings.notifications')}
      </Text>
      <NavRow
        title={t('settings.notifications')}
        subtitle={t('settings.notificationsSubtitle')}
        onPress={() => router.push('/(tabs)/settings/notifications')}
      />

      <Text style={[styles.sectionTitle, { color: theme.textMuted, marginTop: spacing['3xl'] }]}>
        {t('payments.title')}
      </Text>
      <NavRow
        title={t('settings.deposits')}
        subtitle={t('settings.depositsSubtitle')}
        onPress={() => router.push('/(tabs)/settings/deposit-policies')}
      />

      <View style={{ marginTop: spacing['3xl'] }}>
        <Button label={t('auth.logout')} variant="neutral" onPress={() => void signOut()} />
      </View>
      </ScrollView>
    </>
  );
}

function NavRow({ title, subtitle, onPress }: { title: string; subtitle: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      <Card style={styles.navRow}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.textPrimary, fontWeight: '600' }}>{title}</Text>
          <Text style={{ color: theme.textMuted, marginTop: spacing.xs }}>{subtitle}</Text>
        </View>
        <Ionicons name="chevron-forward" color={theme.textMuted} size={20} />
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  sectionTitle: { ...typeScale.label, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.4 },
  metaLabel: { ...typeScale.label, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  languageCard: { padding: 0, overflow: 'hidden' },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { fontSize: typeScale.body.size },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
});
