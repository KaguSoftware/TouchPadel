import { StyleSheet, Text, View } from 'react-native';
import { t } from '@touch/i18n';

// Court list placeholder (mobile is padel booking ONLY — HANDOFF scope).
// Real availability grid + slot holds: FE1, W2 (design-delivery.md). Data: courts table
// + realtime broadcast topic `courts` (plan override #4). Reservation kinds:
// booking/hold/maintenance (plan override #3).
export default function CourtListScreen() {
  // TODO(FE1): locale from i18n context, not hardcoded 'en'.
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('en', 'courts.title')}</Text>
      <Text style={styles.hint}>{t('en', 'courts.placeholder')}</Text>
    </View>
  );
}

// RN style props here are logical (paddingStart/paddingEnd) per the CSS-logical-only rule.
const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingStart: 16,
    paddingEnd: 16,
  },
  title: { fontSize: 24, fontWeight: '700' },
  hint: { marginTop: 8, fontSize: 14, textAlign: 'center' },
});
