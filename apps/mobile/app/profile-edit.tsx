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
import { PhoneField } from '../src/components/phone';
import { composePhone, DEFAULT_ISO, parsePhone, validatePhone } from '../src/features/profile/phone';
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
  // The phone is EDITED as country + national digits and STORED as E.164; the
  // dirty check compares the composed value, so merely opening the picker and
  // re-choosing the same country does not arm the unsaved-changes guard.
  const [iso, setIso] = useState(DEFAULT_ISO);
  const [national, setNational] = useState('');
  const [initial, setInitial] = useState<{ name: string; phone: string } | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);

  useEffect(() => {
    if (profile.data && !initial) {
      setName(profile.data.full_name ?? '');
      const parsed = parsePhone(profile.data.phone);
      setIso(parsed.iso);
      setNational(parsed.national);
      setInitial({
        name: profile.data.full_name ?? '',
        // The COMPOSED baseline, not the raw column. A number stored in an
        // older shape (`00964…`, or with spaces) round-trips through the
        // picker as normalized E.164 — comparing against the raw string would
        // mark the form dirty the instant it loaded, and every back press
        // would offer to discard edits the guest never made.
        phone: composePhone(parsed.iso, parsed.national),
      });
    }
  }, [profile.data, initial]);

  const phone = composePhone(iso, national);
  const dirty = initial !== null && (name !== initial.name || phone !== initial.phone);

  /**
   * Unsaved edits ask before leaving (spec `dirty` state). The guard covers the
   * native back item and Android's back gesture; `leave` replays whichever one
   * was blocked.
   *
   * The iOS edge-swipe is NOT caught here: UIKit commits that transition before
   * `beforeRemove` fires, so `preventDefault()` cannot put the screen back. It
   * is disabled outright while the guard is armed — see `gestureEnabled` below.
   */
  const blockPop = dirty && !update.isPending;
  const leave = useBackGuard({
    when: blockPop,
    onBlocked: () => setDiscardOpen(true),
  });

  const onSave = () => {
    setError(null);
    setNameError(null);
    setPhoneError(null);
    if (!name.trim()) return setNameError(t('auth.nameRequired'));
    // Required from day one (spec 05.3): the desk calls it about bookings, and
    // the booking path refuses without it — so it cannot be cleared here.
    const badPhone = validatePhone(iso, national);
    if (badPhone === 'PHONE_REQUIRED') return setPhoneError(t('auth.phoneRequired'));
    if (badPhone) return setPhoneError(t('auth.phoneInvalid'));
    update.mutate(
      { full_name: name.trim(), phone },
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
      {/*
       * `gestureEnabled: false` while the guard is armed, and ONLY then.
       *
       * The iOS interactive pop gesture is driven by UIKit inside
       * react-native-screens, not by JS. By the time `beforeRemove` runs for an
       * edge-swipe, UIKit has already committed the transition: the screen is
       * detached, so `e.preventDefault()` cannot put it back. The dialog then
       * rendered over the PREVIOUS screen and confirming replayed a pop that
       * had already happened — the form was gone either way, discarding the
       * edits without ever really asking.
       *
       * Turning the gesture off leaves the native back item as the only way
       * out, and THAT is a JS-side dispatch the listener can genuinely cancel.
       * It is re-enabled the moment the form is clean (or is saving/leaving),
       * so the swipe still works on a screen with nothing to lose.
       */}
      <Stack.Screen options={{ title: t('profile.editProfile'), gestureEnabled: !blockPop }} />
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
          <PhoneField
            label={t('auth.phoneLabel')}
            iso={iso}
            onChangeIso={setIso}
            national={national}
            onChangeNational={setNational}
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
