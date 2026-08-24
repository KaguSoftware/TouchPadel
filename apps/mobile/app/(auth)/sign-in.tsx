import { StyleSheet, Text, View } from 'react-native';
import { t } from '@touch/i18n';

// Sign-in placeholder. Real flow: Supabase email+password with email verification,
// refresh tokens persisted via expo-secure-store (design-arch.md §4). FE1, Drop 1.
export default function SignInScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('en', 'auth.signIn')}</Text>
      <Text style={styles.hint}>{t('en', 'auth.placeholder')}</Text>
    </View>
  );
}

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
