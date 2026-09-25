/**
 * PhotoButton — the work-photo field of the staff screens
 * (build-contracts-2026-09-23 §6.3, §6.9): the attached photos as thumbnails,
 * each with its remove button, and an add tile that asks camera or library in
 * the platform's own sheet (ActionSheetIOS on iOS, the system alert on
 * Android), re-encodes, uploads to a fresh slot and hands the path back.
 *
 * CONTROLLED. The screen owns the list and sends the paths with its recording
 * RPC, which claims them (§2.3); this component uploads and never claims. A
 * photo from an earlier round arrives as a path plus a signed URL
 * (staffPhotoUrl) and is shown the same way.
 *
 * TEST IDs derive from the required `testID`: `${testID}.add`,
 * `${testID}.<n>.remove` (n = the photo's index, from 0) and
 * `${testID}.settings`. Screens pass `<route>.photo` (staff-step.photo,
 * staff-start.photo) or `staff-purchase.receipt`.
 */
import { useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  Pressable,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { MessageKey } from '@touch/i18n';
import { Text } from '../i18n/text';
import { useLocale } from '../i18n/LocaleProvider';
import { mapErrorToKey } from '../features/booking/errors';
import {
  PhotoError,
  pickPhoto,
  uploadStaffPhoto,
  type PhotoFolder,
  type PhotoSource,
} from '../features/staff/photo';
import { radius, space, useTheme } from '../theme';
import { CloseIcon } from './icons';
import { ErrorText, LinkText } from './ui';

export interface AttachedPhoto {
  /** The staff-media storage path the recording RPC claims. */
  path: string;
  /** What to show: the local file just picked, or a signed URL. */
  uri: string;
}

export interface PhotoButtonProps {
  testID: string;
  venueId: string;
  folder: PhotoFolder;
  photos: AttachedPhoto[];
  onChange: (photos: AttachedPhoto[]) => void;
  /** The step's photos_max (§7.2); the add tile hides at the limit. */
  max?: number;
  disabled?: boolean;
}

const TILE = 72;

type Problem = { key: MessageKey; settings?: boolean } | null;

function chooseSource(t: (key: MessageKey) => string): Promise<PhotoSource | null> {
  return new Promise((resolve) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: t('staff.media.sourceTitle'),
          options: [t('staff.media.camera'), t('staff.media.library'), t('staff.media.cancel')],
          cancelButtonIndex: 2,
        },
        (i) => resolve(i === 0 ? 'camera' : i === 1 ? 'library' : null),
      );
      return;
    }
    Alert.alert(
      t('staff.media.sourceTitle'),
      undefined,
      [
        { text: t('staff.media.camera'), onPress: () => resolve('camera') },
        { text: t('staff.media.library'), onPress: () => resolve('library') },
        { text: t('staff.media.cancel'), style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

function problemFor(error: unknown): Problem {
  if (error instanceof PhotoError) {
    return error.code === 'permission'
      ? { key: 'staff.media.cameraOff', settings: true }
      : { key: 'staff.media.unavailable' };
  }
  const key = mapErrorToKey(error);
  return { key: key === 'errors.generic' ? 'staff.media.failed' : key };
}

export function PhotoButton({
  testID,
  venueId,
  folder,
  photos,
  onChange,
  max = 6,
  disabled,
}: PhotoButtonProps) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);

  const add = async () => {
    setProblem(null);
    const source = await chooseSource(t);
    if (!source) return;
    setBusy(true);
    try {
      const picked = await pickPhoto(source);
      if (!picked) return;
      const path = await uploadStaffPhoto(venueId, folder, picked);
      onChange([...photos, { path, uri: picked.uri }]);
    } catch (error) {
      setProblem(problemFor(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = (index: number) => {
    setProblem(null);
    onChange(photos.filter((_, i) => i !== index));
  };

  const full = photos.length >= max;

  return (
    <View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        {photos.map((photo, i) => (
          <View key={photo.path} style={{ width: TILE, height: TILE }}>
            <Image
              source={{ uri: photo.uri }}
              accessibilityLabel={t('staff.media.photo', { n: i + 1 })}
              style={{
                width: TILE,
                height: TILE,
                borderRadius: radius.cell,
                backgroundColor: colors.sub,
              }}
            />
            <Pressable
              testID={`${testID}.${i}.remove`}
              accessibilityRole="button"
              accessibilityLabel={t('staff.media.remove', { n: i + 1 })}
              disabled={disabled || busy}
              onPress={() => remove(i)}
              hitSlop={8}
              style={({ pressed }) => ({
                position: 'absolute',
                top: space.xs,
                end: space.xs,
                width: 24,
                height: 24,
                borderRadius: radius.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.line,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <CloseIcon size={12} color={colors.ink} strokeWidth={2.4} />
            </Pressable>
          </View>
        ))}
        {full ? null : (
          <Pressable
            testID={`${testID}.add`}
            accessibilityRole="button"
            accessibilityLabel={busy ? t('staff.media.uploading') : t('staff.media.add')}
            accessibilityState={{ disabled: !!(disabled || busy), busy }}
            disabled={disabled || busy}
            onPress={() => void add()}
            style={({ pressed }) => ({
              width: TILE,
              height: TILE,
              borderRadius: radius.cell,
              borderWidth: 1.5,
              borderStyle: 'dashed',
              borderColor: colors.line,
              backgroundColor: colors.card,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: disabled ? 0.55 : pressed ? 0.7 : 1,
            })}
          >
            {busy ? (
              <ActivityIndicator color={colors.blue} />
            ) : (
              <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" accessible={false}>
                <Path
                  d="M12 5v14M5 12h14"
                  stroke={colors.blue}
                  strokeWidth={2.2}
                  strokeLinecap="round"
                />
              </Svg>
            )}
          </Pressable>
        )}
      </View>
      {photos.length > 0 ? (
        <Text
          style={{
            fontFamily: fonts.body400,
            fontSize: 12,
            color: colors.mut,
            marginTop: space.xs,
          }}
        >
          {t('staff.media.count', { count: photos.length, max })}
        </Text>
      ) : null}
      {problem ? <ErrorText>{t(problem.key)}</ErrorText> : null}
      {problem?.settings ? (
        <LinkText
          testID={`${testID}.settings`}
          label={t('staff.media.openSettings')}
          onPress={() => void Linking.openSettings()}
          style={{ marginTop: space.xs }}
        />
      ) : null}
    </View>
  );
}
