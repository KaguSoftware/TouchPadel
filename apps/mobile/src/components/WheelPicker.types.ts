export interface WheelOption<T extends string> {
  value: T;
  label: string;
}

export interface WheelPickerProps<T extends string> {
  /** `<route>.<element>`; each row is `${testID}.<value>`. */
  testID: string;
  options: readonly WheelOption<T>[];
  value: T;
  onChange: (next: T) => void;
}

/** One row of the Android wheel; up to five show, the middle one picked. */
export const WHEEL_ROW = 40;
export const WHEEL_ROWS = 5;

export interface WheelSheetProps<T extends string> {
  /** `<route>.<element>`; Android's wheel, button and scrim hang off it. */
  testID: string;
  visible: boolean;
  title: string;
  /** A line under the title. */
  message?: string;
  options: readonly WheelOption<T>[];
  value: T;
  onChange: (next: T) => void;
  /** The button under the wheel, and what it does with the current value. */
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}

export interface DateWheelSheetProps {
  /** `<route>.<element>`; unused on iOS (SwiftUI has no RN node to carry it). */
  testID: string;
  visible: boolean;
  title: string;
  /** A line under the title (iOS; Android's dialog has no room for one). */
  message?: string;
  /** `YYYY-MM-DD`; where the wheel opens. */
  value: string;
  min: string;
  max: string;
  confirmLabel: string;
  onConfirm: (day: string) => void;
  /** Set to offer a third button that clears the value. */
  removeLabel?: string;
  onRemove?: () => void;
  onClose: () => void;
}
