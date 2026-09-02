import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Text } from '../src/i18n/text';
import { Stack, useNavigation } from 'expo-router';
import type { NavigationAction } from '@react-navigation/routers';
import { isolate } from '@touch/i18n';
import { useLocale } from '../src/i18n/LocaleProvider';
import { useAuth } from '../src/features/auth/context';
import { RequireSession } from '../src/features/auth/RequireSession';
import { useOwnProfile, useUpdateProfile } from '../src/features/profile/hooks';
import { mapErrorToKey } from '../src/features/booking/errors';
import { radius, space, useTheme } from '../src/theme';
import { Button, ErrorText, Field, FormScreen, Screen, useSafeBack } from '../src/components/ui';
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
  const navigation = useNavigation();
  const safeBack = useSafeBack();
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
  const [pendingPop, setPendingPop] = useState<NavigationAction | null>(null);
  /**
   * Releases the unsaved-changes guard for a departure the user has already
   * agreed to. Two cases, both of which leave the form still "dirty" — the
   * edits differ from `initial`, which is captured once and never refreshed:
   *  - Discard: without this the replayed navigation is intercepted a second
   *    time and reopens the dialog, an inescapable loop;
   *  - a successful Save: `router.back()` would otherwise be blocked and the
   *    user asked to discard the changes they just saved.
   */
  const [leaving, setLeaving] = useState(false);

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

  const blockPop = dirty && !update.isPending && !leaving;

  /**
   * Intercepts the pop itself — the native back item AND the edge-swipe — so
   * the prompt appears without replacing the button.
   *
   * NOT `usePreventRemove`, deliberately. That hook registers the route as
   * prevented, and NativeStackView then forces
   * `headerBackButtonMenuEnabled: !isRemovePrevented` (false) regardless of
   * what the screen passes. react-native-screens reads that as
   * `disableBackButtonMenu` and swaps UIKit's back item for a plain
   * UIBarButtonItem carrying only the title — a bordered capsule with NO
   * CHEVRON, in the default tint. That is exactly what the Arabic screenshot
   * showed, and it appeared only while the form was dirty.
   *
   * Listening to `beforeRemove` directly gives the same interception (it is
   * the very event that hook wraps) without ever marking the route prevented,
   * so the back item stays native: chevron, our tint, the push/pop animation.
   */
  useEffect(() => {
    if (!blockPop) return;
    return navigation.addListener('beforeRemove', (e) => {
      e.preventDefault();
      setPendingPop(e.data.action);
      setDiscardOpen(true);
    });
  }, [navigation, blockPop]);

  // Navigates only AFTER the guard has actually been released: `setLeaving` is
  // async, so dispatching inside the dialog handler would still be intercepted
  // by the previous render's guard.
  // `useSafeBack` returns a fresh closure each render, so this effect would
  // re-run — and re-navigate — on every render while `leaving` is true. The ref
  // makes the departure fire exactly once.
  const left = useRef(false);
  useEffect(() => {
    if (!leaving || left.current) return;
    left.current = true;
    // Replay the exact action that was blocked (back, edge-swipe, or a deep
    // link pushing elsewhere) rather than assuming it was "back". A successful
    // Save has no blocked action — nothing was intercepted — so it just leaves.
    if (pendingPop) navigation.dispatch(pendingPop);
    else safeBack();
  }, [leaving, pendingPop, navigation, safeBack]);

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
          // Release the guard first: the form is still "dirty" against the
          // captured `initial`, so the pop would otherwise be intercepted and
          // offer to discard changes that were just saved.
          setLeaving(true);
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
          setLeaving(true);
        }}
        onDismiss={() => {
          setDiscardOpen(false);
          setPendingPop(null);
        }}
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
