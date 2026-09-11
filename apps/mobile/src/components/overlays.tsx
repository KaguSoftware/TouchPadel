/**
 * Overlay primitives (design 2026-08-31; alerts made native 2026-09-09): the
 * booking notices (blocked / desk-only slots), the error alert, the
 * confirmation before a write (spec R7 — no write without one), and the
 * transient toast.
 *
 * EVERY ALERT IS THE PLATFORM'S OWN — `UIAlertController` on iOS, a Material
 * dialog on Android — raised through `Alert.alert`. The custom card dialog this
 * file used to carry is gone: a confirmation is a system affordance, and users
 * read one faster in the chrome the OS uses everywhere else.
 *
 * That choice costs three things, all of them deliberate:
 *   • No styling. `Alert.alert` exposes default / cancel / destructive and no
 *     colour API, so the brand blue #3360AB cannot reach an alert button.
 *   • System direction. An alert follows the DEVICE language, not the app's, so
 *     an Arabic app on an English phone shows an LTR alert. Copy still comes
 *     from `t()`.
 *   • No busy state. An alert is gone the instant it is answered, so a caller
 *     shows a pending write on its own button, never on the alert.
 *
 * All three share one shape: imperative, so they render nothing and fire from
 * an effect; presented once per open, guarded by a ref against a re-render
 * stacking a second copy; and every dismissal path — buttons, Android back,
 * tap-outside — reports back, so a caller's state cannot be left open with
 * nothing on screen. Their buttons read handlers from a ref, because the alert
 * outlives the render that raised it.
 *
 * The toast below is still ours: it is not an alert, and has no system analogue.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Alert, View, type AlertButton } from 'react-native';
import { Text } from '../i18n/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale } from '../i18n/LocaleProvider';
import { brand, radius, shadows, space, useTheme } from '../theme';

// ── Notice alert ────────────────────────────────────────────────────────────

/**
 * The booking notices ("this slot cannot be booked online", the desk-only
 * horizon) as the PLATFORM's own alert — `UIAlertController` on iOS, a Material
 * dialog on Android — rather than a custom sheet.
 *
 * `Alert.alert` is imperative, so this renders nothing and fires the alert as an
 * effect when `visible` turns true. A ref guards against a re-render raising a
 * second copy over the first: the alert is presented once per open, and the
 * flag clears when the caller sets `visible` back to false.
 *
 * Every dismissal path routes through `onClose` — the buttons, Android's back
 * button and its tap-outside — so the caller's state cannot be left stuck open
 * with no alert on screen.
 */
export function NoticeSheet({
  visible,
  title,
  body,
  callLabel,
  onCall,
  onClose,
}: {
  visible: boolean;
  title: string;
  body: string;
  /** When set, adds the call action alongside Close. */
  callLabel?: string | null;
  onCall?: () => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const shown = useRef(false);
  // The alert outlives the render that raised it, so its buttons must not close
  // over stale props; a ref kept current in an effect stands in for them.
  const handlers = useRef({ onCall, onClose });
  useEffect(() => {
    handlers.current = { onCall, onClose };
  }, [onCall, onClose]);

  useEffect(() => {
    if (!visible) {
      shown.current = false;
      return;
    }
    if (shown.current) return;
    shown.current = true;

    // Close first with `cancel`, Call second as `default`. Order matters on
    // iOS: `cancel` is always pinned to the bottom whatever its position here,
    // and it is the LAST button that renders bold — so this puts Call in the
    // emphasised slot and leaves Close as the plain dismiss. Both are the
    // system tint (blue); `UIAlertController` exposes only default/cancel/
    // destructive, so the brand blue #3360AB cannot be applied to an alert
    // button — it is the OS blue or nothing.
    const buttons: AlertButton[] = [
      { text: t('common.close'), style: 'cancel', onPress: () => handlers.current.onClose() },
    ];
    if (callLabel && onCall) {
      buttons.push({
        text: callLabel,
        style: 'default',
        onPress: () => handlers.current.onCall?.(),
      });
    }

    Alert.alert(title, body, buttons, {
      cancelable: true,
      onDismiss: () => handlers.current.onClose(),
    });
  }, [visible, title, body, callLabel, onCall, t]);

  return null;
}

/**
 * A booking error as the platform's own alert, for failures that used to land
 * in a line of red text under the duration picker — an unbookable slot, a
 * conflict, an expired session. Same imperative pattern as `NoticeSheet`:
 * renders nothing, presents once per distinct message, and reports every
 * dismissal so the caller can clear its error state.
 *
 * Keyed on the MESSAGE, not a boolean: two different failures in a row must
 * each raise their own alert, and re-running a failed request that yields the
 * same message should not stack a second copy.
 */
export function ErrorAlert({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  const { t } = useLocale();
  const shownFor = useRef<string | null>(null);
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!message) {
      shownFor.current = null;
      return;
    }
    if (shownFor.current === message) return;
    shownFor.current = message;
    Alert.alert(t('errors.title'), message, [
      { text: t('common.ok'), style: 'cancel', onPress: () => dismiss.current() },
    ], { cancelable: true, onDismiss: () => dismiss.current() });
  }, [message, t]);

  return null;
}

// ── Native confirmation alert ───────────────────────────────────────────────

/**
 * A confirmation as the PLATFORM's own alert — `UIAlertController` on iOS, a
 * Material dialog on Android — for the destructive actions that read better in
 * system chrome than in a card of ours (clearing booking history). Same
 * imperative shape as `NoticeSheet`: renders nothing, presents once per open,
 * and every dismissal path reports back so the caller cannot be left with its
 * state open and nothing on screen.
 *
 * `destructive` gets the red button on iOS; Android has no such style, so the
 * label carries the weight there. Cancel is listed FIRST because iOS pins a
 * `cancel` button to the bottom regardless, while Android reads the array
 * left-to-right and wants the dismissive action on the left.
 *
 * Like the sign-out alert, this follows the SYSTEM language's direction, not
 * the app's: an Arabic app on an English phone shows an LTR alert.
 */
export function ConfirmAlert({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive,
  onConfirm,
  onDismiss,
}: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const { t } = useLocale();
  const shown = useRef(false);
  // The alert outlives the render that raised it, so its buttons read the
  // handlers from a ref rather than closing over stale props.
  const handlers = useRef({ onConfirm, onDismiss });
  useEffect(() => {
    handlers.current = { onConfirm, onDismiss };
  }, [onConfirm, onDismiss]);

  useEffect(() => {
    if (!visible) {
      shown.current = false;
      return;
    }
    if (shown.current) return;
    shown.current = true;

    Alert.alert(
      title,
      body,
      [
        { text: cancelLabel ?? t('common.cancel'), style: 'cancel', onPress: () => handlers.current.onDismiss() },
        {
          text: confirmLabel,
          style: destructive ? 'destructive' : 'default',
          onPress: () => handlers.current.onConfirm(),
        },
      ],
      { cancelable: true, onDismiss: () => handlers.current.onDismiss() },
    );
  }, [visible, title, body, confirmLabel, cancelLabel, destructive, t]);

  return null;
}

// ── Toast ───────────────────────────────────────────────────────────────────

export type ToastTone = 'success' | 'info' | 'error';

interface ToastState {
  message: string;
  tone: ToastTone;
}

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

/** Hosts the toast above everything; wrap the app root once. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, tone: ToastTone = 'success') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, tone });
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastHost toast={toast} />
    </ToastContext.Provider>
  );
}

function ToastHost({ toast }: { toast: ToastState | null }) {
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  const bg =
    toast.tone === 'error'
      ? colors.danger
      : toast.tone === 'info'
        ? brand.navy
        : brand.successToast;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        start: space.l,
        end: space.l,
        bottom: 74 + insets.bottom,
        alignItems: 'center',
      }}
    >
      <View
        accessibilityLiveRegion="polite"
        style={{
          backgroundColor: bg,
          borderRadius: radius.cell,
          paddingStart: space.l,
          paddingEnd: space.l,
          paddingTop: 11,
          paddingBottom: 11,
          maxWidth: '100%',
          boxShadow: shadows.toast,
        }}
      >
        <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: brand.white }}>{toast.message}</Text>
      </View>
    </View>
  );
}
