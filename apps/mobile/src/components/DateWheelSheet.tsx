/**
 * A calendar day picked on a date wheel (Edit profile's date of birth, owner
 * 2026-10-04). iOS is a native SwiftUI sheet (`DateWheelSheet.ios.tsx`); this
 * file is Android's: the platform's own date dialog in its `spinner` display,
 * the system's date wheels, with OK as the confirm and, when offered, the
 * remove as its neutral button. Imperative like `NoticeSheet`: it renders
 * nothing, opens once per `visible`, and every way out reports `onClose`.
 */
import { useEffect, useRef } from 'react';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { BIRTH_TZ, birthDateToDate, dateToBirthDate } from '../features/profile/birthDate';
import type { DateWheelSheetProps } from './WheelPicker.types';

export function DateWheelSheet(props: DateWheelSheetProps) {
  const { visible, value, min, max, removeLabel } = props;
  // The dialog outlives the render that opened it: handlers come from a ref.
  const handlers = useRef(props);
  useEffect(() => {
    handlers.current = props;
  });
  const shown = useRef(false);

  useEffect(() => {
    if (!visible) {
      shown.current = false;
      return;
    }
    if (shown.current) return;
    shown.current = true;
    const day = birthDateToDate(value);
    if (!day) return handlers.current.onClose();
    DateTimePickerAndroid.open({
      value: day,
      mode: 'date',
      display: 'spinner',
      timeZoneName: BIRTH_TZ,
      minimumDate: birthDateToDate(min) ?? undefined,
      maximumDate: birthDateToDate(max) ?? undefined,
      ...(removeLabel && handlers.current.onRemove
        ? { neutralButton: { label: removeLabel } }
        : {}),
      onValueChange: (_e, next) => {
        handlers.current.onClose();
        handlers.current.onConfirm(dateToBirthDate(next));
      },
      onNeutralButtonPress: () => {
        handlers.current.onClose();
        handlers.current.onRemove?.();
      },
      onDismiss: () => handlers.current.onClose(),
    });
  }, [visible, value, min, max, removeLabel]);

  return null;
}
