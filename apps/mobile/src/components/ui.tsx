/**
 * Minimal shared primitives (functional pass — visual polish is FE1's later).
 * All styles use LOGICAL properties only (paddingStart/End, marginStart/End,
 * textAlign left-relative avoided) so every screen mirrors correctly in RTL.
 */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { theme } from '../theme';

export function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Hint({ children }: { children: ReactNode }) {
  return <Text style={styles.hint}>{children}</Text>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <Text style={styles.error}>{children}</Text>;
}

export interface FieldProps extends TextInputProps {
  label: string;
}

export function Field({ label, ...inputProps }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholderTextColor={theme.muted}
        autoCapitalize="none"
        {...inputProps}
      />
    </View>
  );
}

export interface ButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}

export function Button({ label, onPress, disabled, busy, variant = 'primary' }: ButtonProps) {
  const bg =
    variant === 'danger' ? theme.danger : variant === 'secondary' ? theme.surface : theme.accent;
  const fg = variant === 'secondary' ? theme.accent : theme.accentContrast;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled || busy ? 0.5 : pressed ? 0.8 : 1 },
        variant === 'secondary' && { borderWidth: 1, borderColor: theme.accent },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.buttonLabel, { color: fg }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function LinkText({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress}>
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}

export function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={theme.accent} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
    paddingStart: 16,
    paddingEnd: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  title: { fontSize: 24, fontWeight: '700', color: theme.fg, marginBottom: 8 },
  hint: { fontSize: 14, color: theme.mutedFg, marginTop: 4 },
  error: { fontSize: 14, color: theme.danger, marginTop: 8 },
  field: { marginTop: 12 },
  label: { fontSize: 13, fontWeight: '600', color: theme.mutedFg, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    paddingStart: 12,
    paddingEnd: 12,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
    color: theme.fg,
    backgroundColor: theme.bg,
  },
  button: {
    marginTop: 16,
    borderRadius: 8,
    paddingTop: 12,
    paddingBottom: 12,
    paddingStart: 16,
    paddingEnd: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  buttonLabel: { fontSize: 16, fontWeight: '700' },
  link: { color: theme.accent, fontSize: 14, marginTop: 14, fontWeight: '600' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
