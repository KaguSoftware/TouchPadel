/**
 * Small pieces the protocol pages share: a titled section, a status pill, the
 * reason form a stop, a skip or a decline asks for, a work photo by its signed
 * URL, and the refresh every protocol write ends with.
 *
 * Every interactive piece takes its `testID` from the call site and forwards
 * it explicitly (apps/mobile/CLAUDE.md "Tests").
 */
import { useCallback, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FieldIssue, RunStatus, StaffRole, StepStatus } from '@touch/core';
import type { MessageKey } from '@touch/i18n';
import { Text } from '../../../i18n/text';
import { useLocale } from '../../../i18n/LocaleProvider';
import { radius, space, useTheme } from '../../../theme';
import { Button, Card, ErrorText, Field, MicroLabel } from '../../../components/ui';
import { staffKeys } from '../keys';
import { staffPhotoUrl } from '../photo';
import { isProtocolQueryKey } from './logic';

export function Section({
  title,
  children,
  style,
}: {
  title?: string | null;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Card style={[{ padding: space.m, gap: space.s }, style]}>
      {title ? <MicroLabel>{title}</MicroLabel> : null}
      {children}
    </Card>
  );
}

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

export function runStatusTone(status: RunStatus): Tone {
  switch (status) {
    case 'active':
      return 'info';
    case 'scheduled':
      return 'warn';
    case 'live':
    case 'done':
      return 'good';
    case 'stopped':
      return 'bad';
    default:
      return 'neutral';
  }
}

export function stepStatusTone(status: StepStatus): Tone {
  switch (status) {
    case 'open':
      return 'info';
    case 'submitted':
      return 'warn';
    case 'passed':
      return 'good';
    case 'stopped':
      return 'bad';
    default:
      return 'neutral';
  }
}

export function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  const { colors, fonts } = useTheme();
  const palette: Record<Tone, { bg: string; fg: string; line: string }> = {
    neutral: { bg: colors.sub, fg: colors.mut, line: colors.line },
    good: { bg: colors.gtint, fg: colors.gtext, line: colors.gline },
    warn: { bg: colors.amb, fg: colors.ambtext, line: colors.ambline },
    bad: { bg: colors.redtint, fg: colors.redtext, line: colors.redline },
    info: { bg: colors.tint, fg: colors.blue, line: colors.line },
  };
  const p = palette[tone];
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        paddingStart: 8,
        paddingEnd: 8,
        paddingTop: 3,
        paddingBottom: 3,
        borderRadius: radius.pill,
        backgroundColor: p.bg,
        borderWidth: 1,
        borderColor: p.line,
      }}
    >
      <Text style={{ fontFamily: fonts.body700, fontSize: 11.5, color: p.fg }}>{label}</Text>
    </View>
  );
}

/** "Head chef, Manager": a step's actors in the reader's language. */
export function useRolesText(): (roles: readonly StaffRole[]) => string {
  const { t, locale } = useLocale();
  return useCallback(
    (roles) => roles.map((r) => t(`op.roles.${r}` as MessageKey)).join(locale === 'ar' ? '، ' : ', '),
    [t, locale],
  );
}

/**
 * A reason to type and a confirm: stopping a run, skipping a step, declining
 * an idea. The confirm stays pressable with the box empty so the person is
 * told why nothing happened rather than shown a dead button.
 */
export function ReasonForm({
  testID,
  label,
  confirmLabel,
  busy,
  error,
  danger,
  onConfirm,
  onCancel,
}: {
  testID: string;
  label: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  danger?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  return (
    <View style={{ gap: space.s }}>
      <Field
        testID={`${testID}.reason`}
        label={label}
        value={reason}
        onChangeText={(v) => {
          setReason(v);
          if (v.trim()) setMissing(false);
        }}
        multiline
        maxLength={1000}
        error={missing ? t('staff.protocols.step.decide.reasonRequired') : null}
      />
      <ErrorText>{error ?? null}</ErrorText>
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Button
          testID={`${testID}.cancel`}
          label={t('staff.protocols.step.decide.cancel')}
          variant="secondary"
          size="compact"
          onPress={onCancel}
          style={{ flex: 1 }}
        />
        <Button
          testID={`${testID}.confirm`}
          label={confirmLabel}
          variant={danger ? 'danger' : 'primary'}
          size="compact"
          busy={busy}
          onPress={() => {
            if (!reason.trim()) {
              setMissing(true);
              return;
            }
            onConfirm(reason.trim());
          }}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

/** A stored work photo through a 10-minute signed URL (§2.3). */
export function StoredPhoto({
  path,
  size = 72,
  selected,
  onPress,
  testID,
  label,
}: {
  path: string;
  size?: number;
  selected?: boolean;
  onPress?: () => void;
  testID?: string;
  label?: string;
}) {
  const { colors } = useTheme();
  const url = useQuery({
    queryKey: staffKeys.photoUrl(path),
    queryFn: () => staffPhotoUrl(path),
    // The URL lives ten minutes; ask again well before it lapses.
    staleTime: 8 * 60_000,
  });
  const body = (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.cell,
        overflow: 'hidden',
        backgroundColor: colors.sub,
        borderWidth: selected ? 3 : 1,
        borderColor: selected ? colors.blue : colors.line,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {url.data ? (
        <Image source={{ uri: url.data }} accessibilityLabel={label} style={{ width: '100%', height: '100%' }} />
      ) : url.isPending ? (
        <ActivityIndicator color={colors.blue} />
      ) : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
    >
      {body}
    </Pressable>
  );
}

export function PhotoStrip({ paths, label }: { paths: readonly string[]; label: (n: number) => string }) {
  if (paths.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
      {paths.map((p, i) => (
        <StoredPhoto key={p} path={p} label={label(i + 1)} />
      ))}
    </View>
  );
}

/** Every protocol read, refreshed after a protocol write: the step, its run, the lists and Today. */
export function useRefreshProtocols(): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ predicate: (q) => isProtocolQueryKey(q.queryKey) }),
    [queryClient],
  );
}

/**
 * A refusal's field, when the server named one: RECORD_INVALID and
 * TEXT_TOO_LONG carry the field as their hint (§2.1), so the form marks it
 * as it marks its own findings.
 */
export function serverIssue(err: unknown): FieldIssue | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { message?: unknown; hint?: unknown };
  const code = typeof e.message === 'string' ? e.message.trim() : '';
  const hint = typeof e.hint === 'string' ? e.hint.trim() : '';
  if (!hint) return null;
  if (code === 'RECORD_INVALID' || code === 'TEXT_TOO_LONG') return { field: hint, code };
  if (code === 'TEXT_REQUIRED' || code === 'TEXT_BOTH_LANGUAGES_REQUIRED') return { field: hint, code };
  return null;
}

/** The message under a field for one of its issues. */
export function issueMessageKey(issue: FieldIssue, blank: boolean): MessageKey {
  switch (issue.code) {
    case 'RECORD_INVALID':
      if (issue.index !== undefined) return 'staff.protocols.form.rowInvalid';
      return blank ? 'staff.protocols.form.required' : 'staff.protocols.form.invalid';
    case 'TEXT_TOO_LONG':
      return 'staff.protocols.form.tooLong';
    case 'REASON_REQUIRED':
      return 'staff.protocols.step.decide.reasonRequired';
    default:
      return `op.errors.${issue.code}` as MessageKey;
  }
}

/** A line of muted body text; the pages use it for every "who, when" line. */
export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { colors, fonts } = useTheme();
  return (
    <Text style={[{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 19, color: colors.mut }, style]}>
      {children}
    </Text>
  );
}

/** The heading of a card: a name in bold ink. */
export function Strong({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { colors, fonts } = useTheme();
  return <Text style={[{ fontFamily: fonts.body700, fontSize: 14, lineHeight: 20, color: colors.ink }, style]}>{children}</Text>;
}
