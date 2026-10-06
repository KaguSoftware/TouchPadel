import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Platform, Pressable, View } from 'react-native';
import { Text } from '../src/i18n/text';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { formatDate, isolate, isolateLtr, type MessageKey } from '@touch/i18n';
import { useLocale } from '../src/i18n/LocaleProvider';
import { useAuth } from '../src/features/auth/context';
import { RequireSession } from '../src/features/auth/RequireSession';
import {
  useMyBirthDate,
  useMyFrames,
  useOwnProfile,
  useSetAvatar,
  useSetBirthDate,
  useSetFrame,
  useSetUsername,
  useUpdateProfile,
  useUsernameCheck,
  useUsernameSuggestion,
} from '../src/features/profile/hooks';
import {
  atUsername,
  isUsernameShape,
  nextUsernameChange,
  normalizeUsername,
  stateFromCheck,
  usernameStateKey,
  type UsernameState,
} from '../src/features/profile/username';
import {
  EARNED_FRAMES,
  FREE_FRAMES,
  frameNameKey,
  frameOf,
  frameRuleKey,
  type FrameId,
} from '../src/features/profile/frames';
import { errorCode } from '@touch/i18n';
import { useSetMyGender } from '../src/features/matches/hooks';
import { pickAvatarPhoto, PhotoError, type PhotoSource } from '../src/features/staff/photo';
import {
  BIRTH_MIN,
  BIRTH_TZ,
  birthDateToDate,
  defaultBirthDate,
  isValidBirthDate,
  todayBirthDate,
} from '../src/features/profile/birthDate';
import { ProfileAvatar } from '../src/components/ProfileAvatar';
import { DateWheelSheet } from '../src/components/DateWheelSheet';
import { WheelSheet } from '../src/components/WheelSheet';
import { mapErrorToKey } from '../src/features/booking/errors';
import { brand, radius, space, useTheme } from '../src/theme';
import {
  Button,
  ErrorText,
  Field,
  FormScreen,
  Hint,
  Screen,
  SectionLabel,
} from '../src/components/ui';
import { useBack } from '../src/navigation/back';
import { PhoneField } from '../src/components/phone';
import {
  composePhone,
  DEFAULT_ISO,
  displayPhone,
  parsePhone,
  phoneChangeNeedsCode,
  validatePhone,
} from '../src/features/profile/phone';
import { startPhoneLink } from '../src/features/auth/api';
import { isPhoneTaken, mapOtpError, phoneOtpEnabled } from '../src/features/auth/phoneOtp';
import { phoneTakenKey } from '../src/features/loyalty/errors';
import { supabase } from '../src/lib/supabase';
import { useToast } from '../src/components/overlays';
import { passwordProofOf } from '../src/features/profile/changePasswordFlow';
import {
  CalendarIcon,
  CameraIcon,
  CheckIcon,
  ChevronIcon,
  EnvelopeIcon,
  LockIcon,
  ImageIcon,
  PencilIcon,
  PhoneIcon,
  TabProfileIcon,
  TrashIcon,
} from '../src/components/icons';
import { SkeletonList } from '../src/components/states';
import { NAME_PART_MAX, nameFieldsOf, namePatch } from '../src/features/profile/names';

/**
 * Edit profile: a hub, then one small form per thing to change (owner,
 * 2026-10-01). The hub is the avatar plus its rows: Name & surname, Email,
 * Mobile phone, Gender, Date of birth and Change password. Name and phone open
 * this same route with `section` set, so there is one file and one stack entry
 * per form; an unset gender and the date of birth open a wheel in a bottom
 * sheet, the country picker's (owner, 2026-10-04), and Email and a set gender are read-only and say
 * why when tapped. Delete account sits last, in a card
 * of its own (moved here from the Profile tab, 2026-10-04).
 *
 * PHOTO, GENDER, DATE OF BIRTH (owner, 2026-10-04; migration 0302). Tapping the
 * avatar offers camera, library and (with a photo) remove; the photo is
 * cropped square and re-encoded on the phone (`pickAvatarPhoto`), uploaded to
 * the private avatars bucket and set by `app.set_my_avatar`. Gender is the
 * one-time `set_my_gender` answer the match screens also ask (OM-28): once set
 * only the desk changes it. "Prefer not to say" writes nothing: the gender
 * stays unset, and a women's or men's match asks again. The date of birth is optional, editable, and read
 * only by its guest.
 * Email is not editable (re-verification, spec 05.18); language lives in
 * Settings alone. Leaving never prompts: back drops unsaved edits (owner, 2026-09-09).
 *
 * USERNAME AND FRAME (Phase 2, owner 2026-10-06; migration 0307). Username
 * opens a form with a live availability check (`app.username_check`, after a
 * short pause in typing), a suggestion built from the name (hassan.s), and
 * the 7-day rule: the first username is free, then one change a week. Photo
 * frame opens a picker: the six free frames, and the four earned ones shown
 * locked with their rule until the guest earns them. Other players and the
 * desk see the username beside the short name ("Hassan S.").
 *
 * NAME (open matches, guest.md §4.9): two fields, because other players see
 * the first name and the surname's initial. The first is required; the
 * surname is not (single-name guests exist). The server rebuilds `full_name`.
 *
 * PHONE: a CHANGED number costs a 6-digit code. The number is what the desk
 * dials about a booking, so Save sends a code (`startPhoneLink`) and hands
 * off to app/verify-otp.tsx in `link` mode, which writes `profiles.phone`
 * only after the code comes back. Only when `phoneChangeNeedsCode` says so;
 * otherwise Save writes the number directly.
 */
type Section = 'name' | 'phone' | 'username' | 'frame';

function initialsOf(first: string, last: string, email: string) {
  return (
    [first, last]
      .map((w) => w.trim()[0] ?? '')
      .join('')
      .toUpperCase() ||
    email.slice(0, 1).toUpperCase() ||
    '•'
  );
}

function HubRow({
  testID,
  icon,
  iconBg,
  label,
  labelColor,
  value,
  onPress,
  last,
  chevron = true,
}: {
  testID: string;
  icon: React.ReactNode;
  /** The disc behind the icon; `gtint` unless the row is destructive. */
  iconBg?: string;
  label: string;
  labelColor?: string;
  value?: string;
  onPress: () => void;
  last?: boolean;
  /** False on a read-only row (Email, a set gender): tapping explains, nothing opens. */
  chevron?: boolean;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingStart: space.l,
        paddingEnd: space.l,
        paddingTop: 14,
        paddingBottom: 14,
        backgroundColor: pressed ? colors.sub : 'transparent',
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.line,
      })}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: radius.pill,
          backgroundColor: iconBg ?? colors.gtint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            fontFamily: fonts.body600,
            fontSize: 14,
            color: labelColor ?? colors.ink,
            textAlign: 'auto',
          }}
        >
          {label}
        </Text>
        {value ? (
          <Text
            numberOfLines={1}
            style={{
              marginTop: 2,
              fontFamily: fonts.body400,
              fontSize: 12.5,
              color: colors.mut,
              textAlign: 'auto',
            }}
          >
            {value}
          </Text>
        ) : null}
      </View>
      {chevron ? (
        <ChevronIcon size={16} color={colors.fnt2} />
      ) : (
        <LockIcon size={14} color={colors.fnt2} />
      )}
    </Pressable>
  );
}

/**
 * One labelled card of hub rows, as on the Profile tab. A row can be absent
 * (Change password), so the divider-less `last` goes to whichever row
 * actually renders last, and a group with no rows renders nothing.
 */
function RowGroup({
  label,
  first,
  children,
}: {
  label: string;
  first?: boolean;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const rows = Children.toArray(children).filter(isValidElement) as ReactElement<{
    last?: boolean;
  }>[];
  if (rows.length === 0) return null;
  return (
    <View style={{ marginTop: first ? 0 : space.xl }}>
      <SectionLabel style={{ marginBottom: space.s, paddingStart: space.xs }}>{label}</SectionLabel>
      <View
        style={{
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: radius.card,
          overflow: 'hidden',
        }}
      >
        {rows.map((row, i) => (i === rows.length - 1 ? cloneElement(row, { last: true }) : row))}
      </View>
    </View>
  );
}

/** The photo's action sheet: camera, library and, with a photo, remove. */
function choosePhotoAction(
  t: (key: MessageKey) => string,
  hasPhoto: boolean,
): Promise<PhotoSource | 'remove' | null> {
  return new Promise((resolve) => {
    if (Platform.OS === 'ios') {
      const options = [t('profile.photoTake'), t('profile.photoChoose')];
      if (hasPhoto) options.push(t('profile.photoRemove'));
      options.push(t('common.cancel'));
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: t('profile.photoSourceTitle'),
          options,
          cancelButtonIndex: options.length - 1,
          destructiveButtonIndex: hasPhoto ? 2 : undefined,
        },
        (i) =>
          resolve(i === 0 ? 'camera' : i === 1 ? 'library' : hasPhoto && i === 2 ? 'remove' : null),
      );
      return;
    }
    Alert.alert(
      t('profile.photoSourceTitle'),
      undefined,
      [
        { text: t('profile.photoTake'), onPress: () => resolve('camera') },
        { text: t('profile.photoChoose'), onPress: () => resolve('library') },
        ...(hasPhoto
          ? [
              {
                text: t('profile.photoRemove'),
                style: 'destructive' as const,
                onPress: () => resolve('remove' as const),
              },
            ]
          : []),
        { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

type GenderPick = 'female' | 'male' | 'none';

/** How long a native sheet takes to slide away before an alert can present. */
const SHEET_DISMISS_MS = 450;

function Hub() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const { session } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const profile = useOwnProfile(!!session);
  const birth = useMyBirthDate(!!session);
  const saveBirth = useSetBirthDate();
  const [birthOpen, setBirthOpen] = useState(false);
  const setAvatar = useSetAvatar();
  const setGender = useSetMyGender();
  // The gender sheet: open while unset and tapped; its wheel's current pick.
  const [genderOpen, setGenderOpen] = useState(false);
  const [genderPick, setGenderPick] = useState<GenderPick>('female');
  const { first, last } = nameFieldsOf(profile.data ?? {});
  const email = session?.user.email ?? '';
  const phone = profile.data?.phone ? isolateLtr(displayPhone(profile.data.phone)) : '';
  const gender = profile.data?.gender ?? null;
  const birthDate = birthDateToDate(birth.data);
  const hasPhoto = !!profile.data?.avatar_path;
  const username = profile.data?.username ?? null;
  const hasPassword = !!passwordProofOf(session?.user);
  const go = (section: Section) => router.push({ pathname: '/profile-edit', params: { section } });

  const onPhoto = async () => {
    if (setAvatar.isPending) return;
    const choice = await choosePhotoAction(t, hasPhoto);
    if (!choice) return;
    try {
      if (choice === 'remove') {
        await setAvatar.mutateAsync(null);
        toast(t('profile.photoRemoved'));
        return;
      }
      const photo = await pickAvatarPhoto(choice);
      if (!photo) return;
      await setAvatar.mutateAsync(photo.uri);
      toast(t('profile.photoUpdated'));
    } catch (err) {
      if (err instanceof PhotoError) {
        toast(
          t(err.code === 'permission' ? 'profile.photoCameraOff' : 'profile.photoUnavailable'),
          'error',
        );
      } else {
        const key = mapErrorToKey(err);
        toast(t(key === 'errors.generic' ? 'profile.photoFailed' : key), 'error');
      }
    }
  };

  // Asked once (OM-28), confirmed first because only the desk can change it.
  // "Prefer not to say" writes nothing and closes the sheet. The sheet closes
  // first and the alert waits out its slide: UIKit drops an alert presented
  // while a sheet is still dismissing.
  const onSetGender = () => {
    setGenderOpen(false);
    if (genderPick === 'none') return;
    const choice = genderPick;
    const value = t(choice === 'female' ? 'matches.gender.female' : 'matches.gender.male');
    setTimeout(confirmGender, Platform.OS === 'ios' ? SHEET_DISMISS_MS : 0, choice, value);
  };
  const confirmGender = (choice: 'female' | 'male', value: string) =>
    Alert.alert(t('profile.genderConfirmTitle', { value }), t('profile.genderConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.genderConfirm'),
        onPress: () =>
          setGender.mutate(choice, {
            onSuccess: () => toast(t('profile.genderSaved')),
            onError: (err) => toast(t(mapErrorToKey(err)), 'error'),
          }),
      },
    ]);

  // Date of birth (0302): optional, any day from 1900-01-01 to today; the
  // sheet opens on the stored day, or 25 years back.
  const onSaveBirth = (next: string | null) => {
    setBirthOpen(false);
    if (next !== null && !isValidBirthDate(next)) return toast(t('errors.generic'), 'error');
    saveBirth.mutate(next, {
      onSuccess: () => toast(t(next === null ? 'profile.birthRemoved' : 'profile.birthSaved')),
      onError: (err) => toast(t(mapErrorToKey(err)), 'error'),
    });
  };

  // Read-only rows say why when tapped; nothing opens.
  const explain = (title: string, body: string) =>
    Alert.alert(title, body, [{ text: t('common.ok') }]);

  return (
    <FormScreen contentStyle={{ paddingTop: 4 }}>
      <WheelSheet<GenderPick>
        testID="profile-edit.gender-sheet"
        visible={genderOpen && !gender}
        title={t('profile.genderSection')}
        options={[
          { value: 'female', label: t('matches.gender.female') },
          { value: 'male', label: t('matches.gender.male') },
          { value: 'none', label: t('profile.genderPreferNot') },
        ]}
        value={genderPick}
        onChange={setGenderPick}
        confirmLabel={t(genderPick === 'none' ? 'common.done' : 'profile.genderConfirm')}
        onConfirm={onSetGender}
        onClose={() => setGenderOpen(false)}
      />
      <DateWheelSheet
        testID="profile-edit.birth-sheet"
        visible={birthOpen}
        title={t('profile.birthSection')}
        value={birth.data ?? defaultBirthDate()}
        min={BIRTH_MIN}
        max={todayBirthDate()}
        confirmLabel={t('profile.birthSave')}
        onConfirm={onSaveBirth}
        removeLabel={birth.data ? t('profile.birthRemove') : undefined}
        onRemove={() => onSaveBirth(null)}
        onClose={() => setBirthOpen(false)}
      />
      <Pressable
        testID="profile-edit.photo"
        accessibilityRole="button"
        accessibilityLabel={t(hasPhoto ? 'profile.photoChange' : 'profile.photoAdd')}
        accessibilityState={{ busy: setAvatar.isPending }}
        onPress={() => void onPhoto()}
        style={({ pressed }) => ({
          alignItems: 'center',
          alignSelf: 'center',
          marginTop: 8,
          marginBottom: 22,
          gap: 10,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View>
          <ProfileAvatar
            path={profile.data?.avatar_path}
            initials={initialsOf(first, last, email)}
            size={84}
            frame={frameOf(profile.data?.avatar_frame)}
          />
          {setAvatar.isPending ? (
            <View
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                start: 0,
                end: 0,
                borderRadius: radius.pill,
                backgroundColor: brand.scrim,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ActivityIndicator color={brand.white} />
            </View>
          ) : (
            <View
              style={{
                position: 'absolute',
                bottom: 0,
                end: 0,
                width: 28,
                height: 28,
                borderRadius: radius.pill,
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.line,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CameraIcon size={14} color={colors.gstrong} />
            </View>
          )}
        </View>
        <Text
          style={{
            fontFamily: fonts.body700,
            fontSize: 13,
            color: colors.gstrong,
            textAlign: 'center',
          }}
        >
          {t(hasPhoto ? 'profile.photoChange' : 'profile.photoAdd')}
        </Text>
      </Pressable>
      <RowGroup label={t('profile.editGroupPublic')} first>
        <HubRow
          testID="profile-edit.name"
          icon={<PencilIcon size={15} color={colors.gstrong} />}
          label={t('profile.nameSection')}
          value={[first, last].filter(Boolean).join(' ') || t('profile.notSet')}
          onPress={() => go('name')}
        />
        {/* Phase 2 (0307): required to join open matches; one change a week. */}
        <HubRow
          testID="profile-edit.username"
          icon={<TabProfileIcon size={15} color={colors.gstrong} />}
          label={t('profile.usernameSection')}
          value={username ? isolateLtr(atUsername(username)) : t('profile.notSet')}
          onPress={() => go('username')}
        />
        <HubRow
          testID="profile-edit.frame"
          icon={<ImageIcon size={15} color={colors.gstrong} />}
          label={t('profile.frameSection')}
          value={t(frameNameKey(frameOf(profile.data?.avatar_frame)))}
          onPress={() => go('frame')}
        />
      </RowGroup>
      <RowGroup label={t('profile.editGroupContact')}>
        {/* Not editable here (re-verification, spec 05.18): tapping says so. */}
        <HubRow
          testID="profile-edit.email"
          icon={<EnvelopeIcon size={15} color={colors.gstrong} />}
          label={t('profile.emailSection')}
          value={email ? isolate(email) : t('profile.notSet')}
          onPress={() =>
            explain(t('profile.emailSection'), t('profile.emailLocked', { email: isolate(email) }))
          }
          chevron={false}
        />
        <HubRow
          testID="profile-edit.phone-row"
          icon={<PhoneIcon size={15} color={colors.gstrong} />}
          label={t('profile.phoneSection')}
          value={phone || t('profile.notSet')}
          onPress={() => go('phone')}
        />
      </RowGroup>
      <RowGroup label={t('profile.editGroupPersonal')}>
        {/* Asked once (OM-28): unset opens the wheel sheet; set, only the desk changes it. */}
        <HubRow
          testID="profile-edit.gender"
          icon={<TabProfileIcon size={15} color={colors.gstrong} />}
          label={t('profile.genderSection')}
          value={
            gender
              ? t(gender === 'female' ? 'matches.gender.female' : 'matches.gender.male')
              : t('profile.notSet')
          }
          onPress={() =>
            gender
              ? explain(
                  t('profile.genderSection'),
                  t(gender === 'female' ? 'profile.genderFemale' : 'profile.genderMale'),
                )
              : setGenderOpen(true)
          }
          chevron={!gender}
        />
        <HubRow
          testID="profile-edit.birth-date"
          icon={<CalendarIcon size={15} color={colors.gstrong} />}
          label={t('profile.birthSection')}
          value={birthDate ? formatDate(birthDate, locale, BIRTH_TZ) : t('profile.notSet')}
          onPress={() => !saveBirth.isPending && setBirthOpen(true)}
        />
      </RowGroup>
      <RowGroup label={t('profile.editGroupSecurity')}>
        {/* Only for an account that HAS a password (not Google/Apple-only, not a
            desk walk-in): every "current password" is wrong for the others. */}
        {hasPassword ? (
          <HubRow
            testID="profile-edit.change-password"
            icon={<LockIcon size={15} color={colors.gstrong} />}
            label={t('profile.changePassword')}
            onPress={() => router.push('/change-password')}
          />
        ) : null}
      </RowGroup>
      {/* SEC-16. Its own card, last, in the error colour: both stores require
          account deletion to be reachable from inside the app, and this row is
          the path (Profile → Edit profile). It pushes a screen with a typed
          confirmation rather than opening a dialog — the act is not undoable,
          and an Alert is what a mis-tap dismisses by habit. */}
      <View
        style={{
          marginTop: space.xl,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: radius.card,
          overflow: 'hidden',
        }}
      >
        <HubRow
          testID="profile-edit.delete-account"
          icon={<TrashIcon size={15} color={colors.redtext} />}
          iconBg={colors.redtint}
          label={t('profile.deleteAccount')}
          labelColor={colors.redtext}
          onPress={() => router.push('/delete-account')}
          last
        />
      </View>
    </FormScreen>
  );
}

function NameForm() {
  const { t } = useLocale();
  const { session } = useAuth();
  const profile = useOwnProfile(!!session);
  const update = useUpdateProfile();
  const toast = useToast();
  const back = useBack();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [ready, setReady] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile.data && !ready) {
      const names = nameFieldsOf(profile.data);
      setFirstName(names.first);
      setLastName(names.last);
      setReady(true);
    }
  }, [profile.data, ready]);

  const onSave = () => {
    setError(null);
    setNameError(null);
    if (!firstName.trim()) return setNameError(t('auth.firstNameRequired'));
    update.mutate(namePatch(firstName, lastName), {
      onSuccess: () => {
        toast(t('profile.updated'));
        back();
      },
      onError: (err) => setError(t(mapErrorToKey(err))),
    });
  };

  if (profile.isLoading && !ready) return <SkeletonList rows={2} height={64} />;
  return (
    <FormScreen contentStyle={{ paddingTop: 4 }}>
      <Field
        testID="profile-edit.first-name"
        label={t('auth.firstNameLabel')}
        value={firstName}
        onChangeText={setFirstName}
        autoCapitalize="words"
        autoComplete="given-name"
        textContentType="givenName"
        maxLength={NAME_PART_MAX}
        dense
        error={nameError}
      />
      <Field
        testID="profile-edit.last-name"
        label={t('auth.lastNameLabel')}
        value={lastName}
        onChangeText={setLastName}
        autoCapitalize="words"
        autoComplete="family-name"
        textContentType="familyName"
        maxLength={NAME_PART_MAX}
        dense
      />
      <Hint>{t('profile.nameShownHint')}</Hint>
      <ErrorText>{error}</ErrorText>
      <Button
        testID="profile-edit.save"
        label={t('profile.saveChanges')}
        variant="cta"
        busy={update.isPending}
        onPress={onSave}
        style={{ marginTop: 6 }}
      />
    </FormScreen>
  );
}

function PhoneForm() {
  const { t } = useLocale();
  const { session } = useAuth();
  const profile = useOwnProfile(!!session);
  const update = useUpdateProfile();
  const toast = useToast();
  const router = useRouter();
  const back = useBack();
  const [sendingCode, setSendingCode] = useState(false);
  // The phone is EDITED as country + national digits and STORED as E.164.
  const [iso, setIso] = useState(DEFAULT_ISO);
  const [national, setNational] = useState('');
  const [initialPhone, setInitialPhone] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile.data && initialPhone === null) {
      const parsed = parsePhone(profile.data.phone);
      setIso(parsed.iso);
      setNational(parsed.national);
      // The COMPOSED baseline, not the raw column: a number stored in an older
      // shape (`00964…`, or with spaces) round-trips as normalized E.164.
      setInitialPhone(composePhone(parsed.iso, parsed.national));
    }
  }, [profile.data, initialPhone]);

  const phone = composePhone(iso, national);

  const onSave = () => {
    setError(null);
    setPhoneError(null);
    // Required from day one (spec 05.3): the desk calls it about bookings, and
    // the booking path refuses without it — so it cannot be cleared here.
    const badPhone = validatePhone(iso, national);
    if (badPhone === 'PHONE_REQUIRED') return setPhoneError(t('auth.phoneRequired'));
    if (badPhone) return setPhoneError(t('auth.phoneInvalid'));

    const needsCode = phoneChangeNeedsCode({
      enabled: phoneOtpEnabled(),
      current: initialPhone ?? undefined,
      next: phone,
    });

    if (!needsCode) {
      update.mutate(
        { phone },
        {
          onSuccess: () => {
            toast(t('profile.updated'));
            back();
          },
          onError: (err) => {
            // PHONE_TAKEN (loyalty L-3): another live account holds the number; said at the field.
            const taken = phoneTakenKey(err);
            if (taken) setPhoneError(t(taken));
            else setError(t(mapErrorToKey(err)));
          },
        },
      );
      return;
    }

    // Not written here: it is not this guest's number until the code proves
    // it. verify-otp writes it after `verifyPhoneLink` succeeds.
    void (async () => {
      setSendingCode(true);
      try {
        await startPhoneLink(supabase, phone);
        router.push({ pathname: '/verify-otp', params: { phone, mode: 'link', from: 'edit' } });
      } catch (err) {
        // GoTrue's phone_exists: another sign-in already owns the number (as phone-sign-in.tsx).
        if (isPhoneTaken(err)) setPhoneError(t('auth.phoneLinkTaken'));
        else setError(t(phoneOtpEnabled() ? mapOtpError(err) : mapErrorToKey(err)));
      } finally {
        setSendingCode(false);
      }
    })();
  };

  if (profile.isLoading && initialPhone === null) return <SkeletonList rows={1} height={64} />;
  return (
    <FormScreen contentStyle={{ paddingTop: 4 }}>
      <PhoneField
        testID="profile-edit.phone"
        label={t('auth.phoneLabel')}
        iso={iso}
        onChangeIso={setIso}
        national={national}
        onChangeNational={setNational}
        dense
        error={phoneError}
      />
      <ErrorText>{error}</ErrorText>
      <Button
        testID="profile-edit.save-phone"
        label={t('profile.saveChanges')}
        variant="cta"
        busy={update.isPending || sendingCode}
        onPress={onSave}
        style={{ marginTop: 6 }}
      />
    </FormScreen>
  );
}

/**
 * Username (0307). The field checks availability after a short pause in
 * typing, never on every key; the grammar is checked on the phone first so a
 * bad name never reaches the server. Save is the only write.
 */
function UsernameForm() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const { session } = useAuth();
  const profile = useOwnProfile(!!session);
  const save = useSetUsername();
  const toast = useToast();
  const back = useBack();
  const current = profile.data?.username ?? null;
  const [typed, setTyped] = useState<string | null>(null);
  // The name the server is asked about: set after a pause in typing.
  const [asked, setAsked] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const suggestion = useUsernameSuggestion(!!session && profile.isSuccess && !current);

  const value = typed ?? current ?? '';
  const name = normalizeUsername(value);
  const shaped = isUsernameShape(name);
  const pending = asked ?? (typed === null ? current : null) ?? '';
  const check = useUsernameCheck(pending, shaped && pending === name);
  const next = nextUsernameChange(current, profile.data?.username_changed_at);
  const unchanged = name === current;

  const state: UsernameState =
    name === ''
      ? { kind: 'empty' }
      : !shaped
        ? name.length < 3
          ? { kind: 'empty' }
          : { kind: 'invalid' }
        : pending !== name
          ? { kind: 'checking' }
          : stateFromCheck(check.data, current);
  const stateKey = usernameStateKey(state);
  const good = state.kind === 'available' || state.kind === 'yours';

  const onChange = (text: string) => {
    setTyped(text);
    setError(null);
    if (timer.current) clearTimeout(timer.current);
    const n = normalizeUsername(text);
    timer.current = setTimeout(() => setAsked(n), 350);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onSave = () => {
    if (!good || unchanged) return;
    setError(null);
    save.mutate(name, {
      onSuccess: () => {
        toast(t('profile.usernameSaved'));
        back();
      },
      onError: (err) => {
        const details = (err as { details?: unknown }).details;
        const when = typeof details === 'string' ? new Date(details) : null;
        setError(
          errorCode(err) === 'USERNAME_TOO_SOON' && when && !Number.isNaN(when.getTime())
            ? t('profile.usernameTooSoon', { date: formatDate(when, locale) })
            : t(mapErrorToKey(err)),
        );
      },
    });
  };

  if (profile.isLoading) return <SkeletonList rows={1} height={64} />;
  const tone =
    state.kind === 'available' || state.kind === 'yours'
      ? colors.gstrong
      : state.kind === 'checking'
        ? colors.mut
        : colors.redtext;
  return (
    <FormScreen contentStyle={{ paddingTop: 4 }}>
      <Field
        testID="profile-edit.username-field"
        label={t('profile.usernameSection')}
        value={value}
        onChangeText={onChange}
        placeholder={t('profile.usernamePlaceholder')}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        textContentType="username"
        maxLength={21}
        latin
        dense
        editable={!next}
      />
      {stateKey ? (
        <Text style={{ marginTop: -4, fontFamily: fonts.body600, fontSize: 12.5, color: tone }}>
          {t(stateKey)}
        </Text>
      ) : null}
      {!current && suggestion.data && suggestion.data !== name ? (
        <Pressable
          testID="profile-edit.username-suggestion"
          accessibilityRole="button"
          onPress={() => onChange(suggestion.data!)}
          style={({ pressed }) => ({
            marginTop: 10,
            alignSelf: 'flex-start',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingStart: 12,
            paddingEnd: 12,
            paddingTop: 8,
            paddingBottom: 8,
            borderRadius: radius.pill,
            backgroundColor: pressed ? colors.sub : colors.gtint,
          })}
        >
          <Text style={{ fontFamily: fonts.body600, fontSize: 13, color: colors.ink }}>
            {t('profile.usernameSuggestion', { name: isolateLtr(atUsername(suggestion.data)) })}
          </Text>
          <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.gstrong }}>
            {t('profile.usernameUseSuggestion')}
          </Text>
        </Pressable>
      ) : null}
      <Hint>
        {next
          ? t('profile.usernameTooSoon', { date: formatDate(next, locale) })
          : `${t('profile.usernameHint')} ${t('profile.usernameWeekly')}`}
      </Hint>
      <ErrorText>{error}</ErrorText>
      <Button
        testID="profile-edit.save-username"
        label={t('profile.usernameSave')}
        variant="cta"
        busy={save.isPending}
        disabled={!good || unchanged || !!next}
        onPress={onSave}
        style={{ marginTop: 6 }}
      />
    </FormScreen>
  );
}

/**
 * Photo frame (0307): the six free frames, then the four earned ones, locked
 * with their rule and progress (10 / 50; 0309) until the server says the guest
 * earned them: games played AND paid in full, or a tournament win. The avatar at
 * the top previews the pick; Save writes it.
 */
function FrameForm() {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const { session } = useAuth();
  const profile = useOwnProfile(!!session);
  const frames = useMyFrames(!!session);
  const save = useSetFrame();
  const toast = useToast();
  const back = useBack();
  const [picked, setPicked] = useState<FrameId | null>(null);
  const current = frameOf(frames.data?.current ?? profile.data?.avatar_frame);
  const selected = picked ?? current;
  const unlocked = new Set((frames.data?.frames ?? []).filter((f) => f.unlocked).map((f) => f.id));
  // 0309: how far the guest is towards each earned frame.
  const progressOf = (id: FrameId) => frames.data?.frames.find((f) => f.id === id);
  const { first, last } = nameFieldsOf(profile.data ?? {});
  const initials = initialsOf(first, last, session?.user.email ?? '');

  const onSave = () =>
    save.mutate(selected, {
      onSuccess: () => {
        toast(t('profile.frameSaved'));
        back();
      },
      onError: (err) => toast(t(mapErrorToKey(err)), 'error'),
    });

  if (profile.isLoading || frames.isLoading) return <SkeletonList rows={2} height={96} />;

  const tile = (id: FrameId) => {
    const locked = !FREE_FRAMES.includes(id) && !unlocked.has(id);
    const isSel = id === selected;
    const rule = frameRuleKey(id);
    const goal = progressOf(id)?.goal ?? null;
    const progress = progressOf(id)?.progress ?? 0;
    return (
      <Pressable
        key={id}
        testID={`profile-edit.frame.${id}`}
        accessibilityRole="button"
        accessibilityState={{ selected: isSel, disabled: locked }}
        accessibilityLabel={t(frameNameKey(id))}
        disabled={locked}
        onPress={() => setPicked(id)}
        style={{
          width: '31%',
          alignItems: 'center',
          gap: 4,
          paddingTop: 10,
          paddingBottom: 10,
          paddingStart: 4,
          paddingEnd: 4,
          borderRadius: 14,
          // Every tile sits on its own well; the pick turns green. One border
          // width for both, so selecting never shifts the grid.
          backgroundColor: isSel ? colors.gtint : colors.bg,
          borderWidth: 1.5,
          borderColor: isSel ? colors.gstrong : colors.line,
        }}
      >
        <View style={{ opacity: locked ? 0.4 : 1 }}>
          <ProfileAvatar
            path={profile.data?.avatar_path}
            initials={initials}
            size={48}
            frame={id}
          />
        </View>
        {locked ? (
          <View style={{ position: 'absolute', top: 24, alignSelf: 'center' }}>
            <LockIcon size={14} color={colors.ink} />
          </View>
        ) : null}
        {isSel ? (
          <View style={{ position: 'absolute', top: 4, end: 4 }}>
            <CheckIcon size={12} color={colors.gstrong} />
          </View>
        ) : null}
        <Text
          numberOfLines={2}
          style={{
            fontFamily: fonts.body600,
            fontSize: 11.5,
            color: colors.ink,
            textAlign: 'center',
          }}
        >
          {t(frameNameKey(id))}
        </Text>
        {locked && rule ? (
          <Text
            numberOfLines={2}
            style={{
              fontFamily: fonts.body400,
              fontSize: 10.5,
              color: colors.mut,
              textAlign: 'center',
            }}
          >
            {t(rule)}
          </Text>
        ) : null}
        {locked && goal ? (
          <View style={{ alignItems: 'center', gap: 3 }}>
            <View
              style={{
                width: 44,
                height: 3,
                borderRadius: 2,
                backgroundColor: colors.sub,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${Math.min(100, Math.round((progress / goal) * 100))}%`,
                  height: '100%',
                  backgroundColor: brand.green,
                }}
              />
            </View>
            <Text
              testID={`profile-edit.frame.${id}.progress`}
              style={{
                fontFamily: fonts.body400,
                fontSize: 10,
                color: colors.mut,
                writingDirection: 'ltr',
              }}
            >
              {isolateLtr(`${Math.min(progress, goal)} / ${goal}`)}
            </Text>
          </View>
        ) : null}
      </Pressable>
    );
  };

  const card = (title: string, ids: readonly FrameId[]) => (
    <View
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.card,
        padding: 12,
        gap: 10,
      }}
    >
      <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.ink }}>{title}</Text>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          rowGap: 8,
        }}
      >
        {ids.map(tile)}
      </View>
    </View>
  );

  return (
    <FormScreen contentStyle={{ paddingTop: 4, gap: 14 }}>
      <View style={{ alignItems: 'center', marginTop: 8, marginBottom: 4 }}>
        <ProfileAvatar
          path={profile.data?.avatar_path}
          initials={initials}
          size={84}
          frame={selected}
        />
      </View>
      {card(t('profile.frameFree'), FREE_FRAMES)}
      {card(t('profile.frameEarned'), EARNED_FRAMES)}
      <Button
        testID="profile-edit.save-frame"
        label={t('profile.frameSave')}
        variant="cta"
        busy={save.isPending}
        disabled={selected === current}
        onPress={onSave}
      />
    </FormScreen>
  );
}

function EditProfileScreen() {
  const { t } = useLocale();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const title =
    section === 'name'
      ? t('profile.nameSection')
      : section === 'phone'
        ? t('profile.phoneSection')
        : section === 'username'
          ? t('profile.usernameSection')
          : section === 'frame'
            ? t('profile.frameSection')
            : t('profile.editProfile');
  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title }} />
      {section === 'name' ? (
        <NameForm />
      ) : section === 'phone' ? (
        <PhoneForm />
      ) : section === 'username' ? (
        <UsernameForm />
      ) : section === 'frame' ? (
        <FrameForm />
      ) : (
        <Hub />
      )}
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
