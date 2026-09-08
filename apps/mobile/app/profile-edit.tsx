import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from '../src/i18n/text';
import { Stack } from 'expo-router';
import { isolate } from '@touch/i18n';
import { useLocale } from '../src/i18n/LocaleProvider';
import { useAuth } from '../src/features/auth/context';
import { RequireSession } from '../src/features/auth/RequireSession';
import { useOwnProfile, useUpdateProfile } from '../src/features/profile/hooks';
import { mapErrorToKey } from '../src/features/booking/errors';
import { radius, space, useTheme } from '../src/theme';
import { Button, ErrorText, Field, FormScreen, Screen } from '../src/components/ui';
import { useBackGuard } from '../src/navigation/back';
import { ConfirmationDialog, useToast } from '../src/components/overlays';
import { SkeletonList } from '../src/components/states';

/**
 * Edit profile (design 2026-08-31): name and phone. Email is deliberately not
 * editable here — it changes through re-verification (spec 05.18). Language is
 * NOT offered here either: it lives in Settings alone, where the switch owns
 * the whole screen (overlay + reload) instead of hiding inside a form whose
 * Save would flip the app's direction as a side effect.
 * Unsaved edits prompt before leaving (spec `dirty` state).
 */
function EditProfileScreen() {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const { session } = useAuth();
  const profile = useOwnProfile(!!session);
  const update = useUpdateProfile();
  const toast = useToast();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [initial, setInitial] = useState<{ name: string; phone: string } | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);

  useEffect(() => {
    if (profile.data && !initial) {
      setName(profile.data.full_name ?? '');
      setPhone(profile.data.phone ?? '');
      setInitial({
        name: profile.data.full_name ?? '',
        phone: profile.data.phone ?? '',
      });
    }
  }, [profile.data, initial]);

  const dirty = initial !== null && (name !== initial.name || phone !== initial.phone);

  /**
   * Unsaved edits ask before leaving (spec `dirty` state). The guard covers the
   * native back item, the edge-swipe and Android back alike; `leave` replays
   * whichever one was blocked.
   */
  const leave = useBackGuard({
    when: dirty && !update.isPending,
    onBlocked: () => setDiscardOpen(true),
  });

  const onSave = () => {
    setError(null);
    setNameError(null);
    setPhoneError(null);
    if (!name.trim()) return setNameError(t('auth.nameRequired'));
    // Required from day one (spec 05.3): the desk calls it about bookings, and
    // the booking path refuses without it — so it cannot be cleared here.
    if (!phone.trim()) return setPhoneError(t('auth.phoneRequired'));
    update.mutate(
      { full_name: name.trim(), phone: phone.trim() },
      {
        onSuccess: () => {
          toast(t('profile.updated'));
          // `leave` rather than a plain back: the form is still "dirty"
          // against the captured `initial`, so the pop would otherwise be
          // intercepted and offer to discard changes that were just saved.
          leave();
        },
        onError: (err) => setError(t(mapErrorToKey(err))),
      },
    );
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('profile.editProfile') }} />
      {profile.isLoading && !initial ? (
        <SkeletonList rows={3} height={64} />
      ) : (
        <FormScreen contentStyle={{ paddingTop: 4 }}>
          <Field
            label={t('profile.name')}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            dense
            error={nameError}
          />
          <Field
            label={t('auth.phoneLabel')}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            dense
            error={phoneError}
          />
          <View
            style={{
              marginTop: space.sm,
              backgroundColor: colors.sub,
              borderRadius: radius.cell,
              paddingStart: 13,
              paddingEnd: 13,
              paddingTop: 11,
              paddingBottom: 11,
            }}
          >
            <Text
              style={{
                fontFamily: fonts.body400,
                fontSize: 12,
                lineHeight: 18,
                color: colors.mut,
                textAlign: 'auto',
              }}
            >
              {t('profile.emailLocked', { email: isolate(session?.user.email ?? '') })}
            </Text>
          </View>

          <ErrorText>{error}</ErrorText>
          <Button
            label={t('profile.saveChanges')}
            variant="cta"
            busy={update.isPending}
            onPress={onSave}
            style={{ marginTop: 6 }}
          />
        </FormScreen>
      )}

      <ConfirmationDialog
        visible={discardOpen}
        title={t('profile.discardTitle')}
        body={t('profile.discardBody')}
        confirmLabel={t('profile.discard')}
        cancelLabel={t('profile.keepEditing')}
        danger
        onConfirm={() => {
          setDiscardOpen(false);
          leave();
        }}
        onDismiss={() => setDiscardOpen(false)}
      />
    </Screen>
  );
}

/**
 * This screen lives on the ROOT stack rather than in the `(gated)` group, so
 * that a push from the Profile tab leaves real history beneath it and UIKit
 * draws its own (animated) back item. The group's layout guard does not apply
 * here, so the session requirement is declared explicitly — same three states,
 * same redirect.
 */
export default function GuardedEditProfileScreen() {
  return (
    <RequireSession>
      <EditProfileScreen />
    </RequireSession>
  );
}
