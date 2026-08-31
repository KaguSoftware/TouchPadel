/**
 * Overlay primitives (design 2026-08-31): the bottom notice sheet (blocked /
 * desk-only slots), the confirmation dialog (spec R7 — no write without one),
 * and the transient toast. Every Modal carries onRequestClose so the Android
 * hardware back button is never trapped (the availability-modal lesson).
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
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale } from '../i18n/LocaleProvider';
import { brand, radius, space, useTheme } from '../theme';
import { Button } from './ui';

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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
        onPress={onClose}
        style={{ flex: 1, backgroundColor: '#10182866', justifyContent: 'flex-end' }}
      >
        <Pressable
          // Swallow taps inside the sheet so only the backdrop dismisses.
          onPress={() => {}}
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
            style={{ marginTop: 9, backgroundColor: colors.sub, borderWidth: 0 }}
          />
        </Pressable>
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismissUnlessBusy}>
      <View
        style={{
          flex: 1,
          backgroundColor: '#10182880',
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
              label={t('common.keepIt')}
              onPress={dismissUnlessBusy}
              disabled={busy}
              variant="secondary"
              style={{ flex: 1, backgroundColor: colors.sub, borderWidth: 0 }}
            />
            <Button
              label={confirmLabel}
              onPress={onConfirm}
              busy={busy}
              variant={danger ? 'danger' : 'cta'}
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
  const bg = toast.tone === 'error' ? brand.danger : toast.tone === 'info' ? brand.navy : '#3E6318';
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
        }}
      >
        <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: brand.white }}>{toast.message}</Text>
      </View>
    </View>
  );
}
