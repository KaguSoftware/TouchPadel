/**
 * Today's work list (build-contracts-2026-09-23 §6.1, §6.3): what waits on
 * the person to decide, their open steps, what they sent that waits for a
 * decision, and the last week's decisions on it, from `my_protocol_work` at
 * the chosen venue. Each row opens its step. Checklists sit above this list
 * (the checklists lane mounts them); Today mounts this under the venue picker.
 *
 * TEST IDs are §6.3's: `staff.decide.<submissionId>`, `staff.todo.<runStepId>`,
 * `staff.waiting.<submissionId>`, `staff.decided.<submissionId>`, and
 * `staff.runs` for the way to every protocol.
 */
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { formatDateTime, isolate, type MessageKey } from '@touch/i18n';
import { Text } from '../../../i18n/text';
import { useLocale } from '../../../i18n/LocaleProvider';
import { radius, space, useTheme } from '../../../theme';
import { ChevronIcon } from '../../../components/icons';
import { Hint, LinkText, MicroLabel } from '../../../components/ui';
import { SkeletonList } from '../../../components/states';
import { mapStaffError } from '../edge';
import { staffKeys } from '../keys';
import { fetchMyWork } from './api';
import { bilingual } from './logic';

function Row({
  testID,
  title,
  sub,
  note,
  onPress,
  last,
}: {
  testID: string;
  title: string;
  sub: string;
  note?: string | null;
  onPress: () => void;
  last: boolean;
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
        gap: space.s,
        paddingStart: space.l,
        paddingEnd: space.l,
        paddingTop: 12,
        paddingBottom: 12,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.sub,
        backgroundColor: pressed ? colors.sub : 'transparent',
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={2} style={{ fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}>
          {title}
        </Text>
        <Text numberOfLines={2} style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut }}>
          {sub}
        </Text>
        {note ? (
          <Text numberOfLines={3} style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut2 }}>
            {note}
          </Text>
        ) : null}
      </View>
      <ChevronIcon size={16} color={colors.fnt2} />
    </Pressable>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const { colors } = useTheme();
  if (count === 0) return null;
  return (
    <View style={{ gap: space.xs }}>
      <MicroLabel style={{ paddingStart: 4 }}>{`${title} · ${count}`}</MicroLabel>
      <View
        style={{
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: radius.card,
          overflow: 'hidden',
        }}
      >
        {children}
      </View>
    </View>
  );
}

export function WorkList({ venueId }: { venueId: string }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const work = useQuery({ queryKey: staffKeys.work(venueId), queryFn: () => fetchMyWork(venueId) });

  if (work.isPending) return <SkeletonList rows={2} height={64} />;
  if (work.isError) return <Hint>{t(mapStaffError(work.error))}</Hint>;
  const w = work.data;
  const title = (row: { title_en: string | null; title_ar: string | null; kind: string }) =>
    bilingual(locale, row.title_en, row.title_ar) ?? t(`work.protocol.kind.${row.kind}` as MessageKey);
  const stepName = (row: { name_en: string; name_ar: string }) => bilingual(locale, row.name_en, row.name_ar) ?? '';
  const open = (runStepId: string) => router.push({ pathname: '/staff-step', params: { id: runStepId } });
  const empty = w.to_decide.length + w.todo.length + w.waiting.length + w.decided.length === 0;

  return (
    <View style={{ gap: space.sm }}>
      <Group title={t('staff.protocols.work.toDecide')} count={w.to_decide.length}>
        {w.to_decide.map((row, i) => (
          <Row
            key={row.submission_id}
            testID={`staff.decide.${row.submission_id}`}
            title={title(row)}
            sub={[
              stepName(row),
              t('staff.protocols.work.from', { name: row.submitted_by_name ?? '' }),
              row.needs_owner_ok ? t('staff.protocols.work.needsOwner') : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            onPress={() => open(row.run_step_id)}
            last={i === w.to_decide.length - 1}
          />
        ))}
      </Group>
      <Group title={t('staff.protocols.work.todo')} count={w.todo.length}>
        {w.todo.map((row, i) => (
          <Row
            key={row.run_step_id}
            testID={`staff.todo.${row.run_step_id}`}
            title={title(row)}
            sub={row.round > 1 ? `${stepName(row)} · ${t('work.protocol.round', { round: row.round })}` : stepName(row)}
            onPress={() => open(row.run_step_id)}
            last={i === w.todo.length - 1}
          />
        ))}
      </Group>
      <Group title={t('staff.protocols.work.waiting')} count={w.waiting.length}>
        {w.waiting.map((row, i) => (
          <Row
            key={row.submission_id}
            testID={`staff.waiting.${row.submission_id}`}
            title={title(row)}
            sub={`${stepName(row)} · ${formatDateTime(new Date(row.submitted_at), locale)}`}
            onPress={() => open(row.run_step_id)}
            last={i === w.waiting.length - 1}
          />
        ))}
      </Group>
      <Group title={t('staff.protocols.work.decided')} count={w.decided.length}>
        {w.decided.map((row, i) => (
          <Row
            key={row.submission_id}
            testID={`staff.decided.${row.submission_id}`}
            title={title(row)}
            sub={`${stepName(row)} · ${t('staff.protocols.work.decidedBy', {
              decision: t(`work.protocol.decision.${row.decision}` as MessageKey),
              name: row.decided_by_name ?? '',
            })}`}
            note={row.decision_note ? isolate(row.decision_note) : null}
            onPress={() => open(row.run_step_id)}
            last={i === w.decided.length - 1}
          />
        ))}
      </Group>
      {empty ? <Hint>{t('staff.protocols.work.empty')}</Hint> : null}
      <LinkText
        testID="staff.runs"
        label={t('staff.protocols.work.allRuns')}
        onPress={() => router.push('/staff-runs')}
        style={{ alignSelf: 'flex-start' }}
      />
    </View>
  );
}
