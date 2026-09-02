/**
 * Overlay primitives (design 2026-08-31): the bottom notice sheet (blocked /
 * desk-only slots), the confirmation dialog (spec R7 — no write without one),
 * the language-switch cover, and the transient toast. Every Modal carries onRequestClose so the Android
 * hardware back button is never trapped (the availability-modal lesson), and
 * statusBarTranslucent so the scrim covers the status bar under edge-to-edge.
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
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale } from '../i18n/LocaleProvider';
import { brand, radius, shadows, space, useTheme } from '../theme';
import { Button } from './ui';

// ── Language switch cover ───────────────────────────────────────────────────

/**
 * Covers the whole app while a language switch is applying.
 *
 * A switch to the other direction calls `forceRTL` and then reloads the JS
 * bundle: for the window in between, JS-side `isRTL` has already flipped while
 * the mounted native views have not, so the screen underneath is a mix of both
 * directions with the new strings in it. Rather than let the user watch that,
 * the app goes opaque, says what is happening, and comes back on the screen
 * they left (see `saveResumeRoute`).
 *
 * Opaque, not a scrim — the point is that nothing behind it is visible. Not
 * dismissible either: `onRequestClose` is a no-op so Android's back button
 * cannot strand the user on a half-flipped screen.
 */
export function LocaleSwitchOverlay() {
  const { t, switching } = useLocale();
  const { colors, fonts } = useTheme();
  return (
    <Modal visible={switching} animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={t('settings.switchingTitle')}
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.bg,
          paddingStart: space.xl,
          paddingEnd: space.xl,
          gap: 14,
        }}
      >
        <ActivityIndicator color={colors.blue} size="large" />
        <Text
          style={{
            fontFamily: fonts.display800,
            fontSize: 16,
            color: colors.ink,
            textAlign: 'center',
          }}
        >
          {t('settings.switchingTitle')}
        </Text>
        <Text
          style={{
            fontFamily: fonts.body400,
            fontSize: 12.5,
            lineHeight: 19,
            color: colors.mut,
            textAlign: 'center',
          }}
        >
          {t('settings.switchingBody')}
        </Text>
      </View>
    </Modal>
  );
}

// ── Notice sheet ────────────────────────────────────────────────────────────

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
  /** When set, renders the blue call action above Close. */
  callLabel?: string | null;
  onCall?: () => void;
  onClose: () => void;
}) {
  const { colors, fonts } = useTheme();
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
        onPress={onClose}
        style={{ flex: 1, backgroundColor: brand.scrim, justifyContent: 'flex-end' }}
      >
        {/* Swallow taps inside the sheet so only the backdrop dismisses — as a
            View with a responder, not a Pressable, so screen readers do not
            announce the whole sheet as a button. */}
        <View
          onStartShouldSetResponder={() => true}
          style={{
            backgroundColor: colors.card,
            borderTopStartRadius: radius.sheet,
            borderTopEndRadius: radius.sheet,
            paddingStart: space.xl,
            paddingEnd: space.xl,
            paddingTop: space.xl,
            paddingBottom: 26 + insets.bottom,
          }}
        >
          <View
            style={{
              width: 38,
              height: 4,
              borderRadius: radius.pill,
              backgroundColor: colors.line2,
              alignSelf: 'center',
              marginBottom: space.l,
            }}
          />
          <Text
            style={{
              fontFamily: fonts.display900,
              fontSize: 17,
              textTransform: 'uppercase',
              color: colors.ink,
            }}
          >
            {title}
          </Text>
          <Text
            style={{
              fontFamily: fonts.body400,
              fontSize: 13,
              lineHeight: 21,
              color: colors.mut,
              marginTop: 7,
            }}
          >
            {body}
          </Text>
          {callLabel && onCall ? (
            <Button label={callLabel} onPress={onCall} variant="primary" style={{ marginTop: space.l }} />
          ) : null}
          <Button
            label={t('common.close')}
            onPress={onClose}
            variant="secondary"
            size="medium"
            labelColor={colors.mut2}
            style={{ marginTop: 9, backgroundColor: colors.sub, borderWidth: 0 }}
          />
        </View>
      </Pressable>
    </Modal>
  );
}

// ── Confirmation dialog (spec R7) ───────────────────────────────────────────

export function ConfirmationDialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  busy,
  danger,
  onConfirm,
  onDismiss,
}: {
  visible: boolean;
  title: string;
  body: string;
  /** Caller swaps in the busy label ("Reserving…") while busy. */
  confirmLabel: string;
  /** Dismiss label (spec: required prop). Defaults to "Keep it" — right for cancelling, wrong for reserving. */
  cancelLabel?: string;
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const { colors, fonts } = useTheme();
  const { t } = useLocale();
  const dismissUnlessBusy = () => {
    if (!busy) onDismiss();
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismissUnlessBusy}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: brand.scrimStrong,
          alignItems: 'center',
          justifyContent: 'center',
          paddingStart: 28,
          paddingEnd: 28,
        }}
      >
        <View
          style={{
            alignSelf: 'stretch',
            backgroundColor: colors.card,
            borderRadius: 18,
            padding: space.xl,
            boxShadow: shadows.dialog,
          }}
        >
          <Text
            style={{
              fontFamily: fonts.display900,
              fontSize: 17,
              textTransform: 'uppercase',
              color: colors.ink,
            }}
          >
            {title}
          </Text>
          <Text
            style={{
              fontFamily: fonts.body400,
              fontSize: 13,
              lineHeight: 21,
              color: colors.mut2,
              marginTop: space.s,
            }}
          >
            {body}
          </Text>
          <View style={{ flexDirection: 'row', gap: 9, marginTop: 18 }}>
            <Button
              label={cancelLabel ?? t('common.keepIt')}
              onPress={dismissUnlessBusy}
              disabled={busy}
              variant="secondary"
              size="compact"
              labelColor={colors.mut2}
              style={{ flex: 1, backgroundColor: colors.sub, borderWidth: 0 }}
            />
            <Button
              label={confirmLabel}
              onPress={onConfirm}
              busy={busy}
              variant={danger ? 'danger' : 'cta'}
              size="compact"
              style={{ flex: 1.4 }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
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
  const { fonts } = useTheme();
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  const bg =
    toast.tone === 'error' ? brand.danger : toast.tone === 'info' ? brand.navy : brand.successToast;
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
