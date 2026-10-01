/**
 * A choice between a few actions in the platform's own sheet: ActionSheetIOS
 * on iOS, the system alert on Android. Generalised from PhotoButton's
 * `chooseSource` for the Book tab's Book / Start / Join choice
 * (docs/design/open-matches/guest.md §4.11 rule 7): it adds no view to the
 * stage, so the court's rally, drawn on the same JS thread, has nothing new to
 * lay out while the guest decides. The match screen's seat menu and cancel
 * reason (§4.14) use the same sheet; an option marked `destructive` is drawn
 * red on both platforms.
 *
 * Renders nothing and mints no id, so it needs no `testIdElements` entry.
 *
 * ANDROID'S ALERT CARRIES AT MOST THREE BUTTONS. The first three options are
 * shown; with fewer than three there is room for Cancel as well, and with
 * three the back button or a tap outside the dialog cancels (`cancelable`).
 * `slotActions` (features/matches/logic.ts) never returns more than three, and
 * neither does the seat menu.
 */
import { ActionSheetIOS, Alert, Platform } from 'react-native';

export interface NativeChoiceOption<T extends string> {
  value: T;
  label: string;
  /** Drawn as a destructive action (remove, block, give up a seat). */
  destructive?: boolean;
}

export interface NativeChoice<T extends string> {
  title: string;
  /** A line under the title; left out when undefined. */
  message?: string;
  options: readonly NativeChoiceOption<T>[];
  cancelLabel: string;
}

/** Android's `Alert` lays out three buttons at most. */
export const ANDROID_MAX_BUTTONS = 3;

/** Resolves with the picked option's value, or null when the guest cancels. */
export function nativeChoice<T extends string>({
  title,
  message,
  options,
  cancelLabel,
}: NativeChoice<T>): Promise<T | null> {
  return new Promise((resolve) => {
    if (Platform.OS === 'ios') {
      const destructive = options.flatMap((o, i) => (o.destructive ? [i] : []));
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title,
          message,
          options: [...options.map((o) => o.label), cancelLabel],
          cancelButtonIndex: options.length,
          ...(destructive.length > 0 ? { destructiveButtonIndex: destructive } : {}),
        },
        (i) => resolve(options[i]?.value ?? null),
      );
      return;
    }
    const shown = options.slice(0, ANDROID_MAX_BUTTONS);
    Alert.alert(
      title,
      message,
      [
        ...shown.map((o) => ({
          text: o.label,
          ...(o.destructive ? { style: 'destructive' as const } : {}),
          onPress: () => resolve(o.value),
        })),
        ...(shown.length < ANDROID_MAX_BUTTONS
          ? [{ text: cancelLabel, style: 'cancel' as const, onPress: () => resolve(null) }]
          : []),
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}
