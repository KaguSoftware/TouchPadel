import { useMemo, useState } from 'react';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parseTypedAmount, parseTypedDate, type StaffRole } from '@touch/core';
import { formatDate, formatIQD, isolate, type MessageKey } from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { space, useTheme } from '../../src/theme';
import { Button, Card, Field, Hint, Screen } from '../../src/components/ui';
import { ScreenWithBar } from '../../src/components/BottomBar';
import { useFieldChain } from '../../src/components/fieldChain';
import { ErrorState } from '../../src/components/states';
import { useToast } from '../../src/components/overlays';
import { RequireStaff } from '../../src/features/staff/RequireStaff';
import { useStaffStatus } from '../../src/features/staff/StaffStatusProvider';
import { mapStaffError } from '../../src/features/staff/edge';
import { staffKeys } from '../../src/features/staff/keys';
import { clearStaffIntentKey, staffIntentKey } from '../../src/lib/idempotency';
import { useBackToItem } from '../../src/navigation/back';
import {
  GroupLabel,
  Lead,
  MULTILINE_BOX,
  MULTILINE_TEXT,
} from '../../src/features/staff/checklists/parts';
import { PickList, type PickOption } from '../../src/features/staff/marketing/PickList';
import { intentFor } from '../../src/features/staff/supplies/logic';
import { fetchDeductionTargets, proposeDeduction } from '../../src/features/staff/deductions/api';
import {
  DEDUCTION_CAPS,
  deductionArgs,
  deductionsAccess,
  emptyDeductionDraft,
  recordedAtOnce,
  validateDeduction,
  venueBusinessToday,
  type DeductionDraft,
  type DeductionField,
  type DeductionIssue,
} from '../../src/features/staff/deductions/logic';

/**
 * Propose a pay deduction (wave5-addendum-2026-09-25 §2.5, §5.3; migrations
 * 0197, 0272). Opened by the + in the deductions page's top bar; a sent
 * proposal goes back to that page, which lists it.
 *
 *   head_barista, head_chef   for a member of their own team; the owner decides
 *   manager                   for anyone at the venue but themselves and the
 *                             owners; the owner decides
 *   owner                     recorded approved at once, off the person's next
 *                             unpaid wage
 *
 * The amount never leaves this page and the deductions page: no push carries
 * one (§2.3).
 */

/** A stored `YYYY-MM-DD` in the reader's language (noon UTC, so no zone moves the day). */
function dayLabel(day: string, locale: 'en' | 'ar'): string {
  return formatDate(new Date(`${day}T12:00:00Z`), locale);
}

function DeductionProposeScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  // Back to the list, the new proposal first and marked.
  const showInList = useBackToItem('/staff-deductions');
  const queryClient = useQueryClient();
  const { status, venueId } = useStaffStatus();

  const role: StaffRole = status.kind === 'staff' ? status.staff.role : 'cashier';
  const access = deductionsAccess(role);
  const venue = venueId ?? '';
  // The venue's business day, which propose_deduction checks the date against.
  const today = venueBusinessToday();
  // The owner alone decides, so the owner's own entry is approved at once (0272).
  const atOnce = recordedAtOnce(role);

  const targets = useQuery({
    queryKey: staffKeys.deductionTargets(venue),
    queryFn: () => fetchDeductionTargets(venue),
    enabled: venue !== '' && access.proposes,
  });

  const targetOptions: PickOption[] = useMemo(
    () =>
      (targets.data?.staff ?? []).map((s) => ({
        id: s.id,
        label: s.display_name,
        detail: t(`op.roles.${s.role as StaffRole}`),
      })),
    [targets.data, t],
  );

  const [draft, setDraft] = useState<DeductionDraft>(() => emptyDeductionDraft(today));
  // With one person to choose, they are chosen once the list arrives (Sait,
  // 2026-10-17: fill in what the app already knows); Change still clears it.
  const [autoPicked, setAutoPicked] = useState(false);
  if (!autoPicked && targetOptions.length === 1 && !draft.staffId) {
    setAutoPicked(true);
    setDraft((d) => ({ ...d, staffId: targetOptions[0]!.id }));
  }
  const [issues, setIssues] = useState<DeductionIssue[]>([]);
  const [error, setError] = useState<string | null>(null);

  const edit = (patch: Partial<DeductionDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setIssues((all) => all.filter((i) => !(i.field in patch)));
  };

  const propose = useMutation({
    mutationKey: staffKeys.mutation('deduction'),
    mutationFn: ({ args, intent }: { args: ReturnType<typeof deductionArgs>; intent: string }) =>
      proposeDeduction(args, staffIntentKey(intent, 'deduction')),
    onSuccess: (data, { intent }) => {
      clearStaffIntentKey(intent);
      toast(
        t(atOnce ? 'staff.deductions.propose.recorded' : 'staff.deductions.propose.sent'),
        'success',
      );
      void queryClient.invalidateQueries({ queryKey: staffKeys.myDeductionProposals(venue) });
      void queryClient.invalidateQueries({ queryKey: staffKeys.deductionsWaiting(venue) });
      showInList(data.id);
    },
    onError: (err) => setError(t(mapStaffError(err))),
  });

  const onPropose = () => {
    setError(null);
    const found = validateDeduction(draft, today);
    setIssues(found);
    if (found.length > 0 || !venue) return;
    const args = deductionArgs(draft, venue);
    propose.mutate({ args, intent: intentFor('deduction.propose', args) });
  };

  const fieldError = (field: DeductionField): string | null => {
    const issue = issues.find((i) => i.field === field);
    if (!issue) return null;
    const keys: Record<DeductionField, MessageKey> = {
      staffId: 'staff.deductions.propose.errors.who',
      amount:
        issue.code === 'tooMuch'
          ? 'staff.deductions.propose.errors.amountTooMuch'
          : 'staff.deductions.propose.errors.amount',
      date:
        issue.code === 'future'
          ? 'staff.deductions.propose.errors.future'
          : issue.code === 'tooOld'
            ? 'staff.deductions.propose.errors.tooOld'
            : 'staff.deductions.propose.errors.date',
      reason:
        issue.code === 'tooLong'
          ? 'staff.deductions.propose.errors.reasonTooLong'
          : 'staff.deductions.propose.errors.reason',
    };
    return t(keys[field], { example: isolate(today) });
  };

  // Next walks amount and date; Done on the date sends.
  const chain = useFieldChain(2);

  if (status.kind !== 'staff') return null;

  const body = { fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.mut2 };
  const chosen = targetOptions.find((o) => o.id === draft.staffId);
  const amountPreview = parseTypedAmount(draft.amount);
  const datePreview = parseTypedDate(draft.date);

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.deductions.propose.title') }} />
      <ScreenWithBar
        contentContainerStyle={{ paddingTop: space.m, gap: space.sm }}
        error={error}
        bar={
          <Button
            testID="staff-deduction-propose.submit"
            label={t(
              atOnce ? 'staff.deductions.propose.submitOwner' : 'staff.deductions.propose.submit',
            )}
            variant="primary"
            busy={propose.isPending}
            disabled={venue === '' || !access.proposes}
            onPress={onPropose}
          />
        }
      >
        {venue === '' ? <Hint>{t('staff.shell.venue.none')}</Hint> : null}
        <Lead>
          {t(
            atOnce
              ? 'staff.deductions.propose.leadOwner'
              : access.proposesForAnyone
                ? 'staff.deductions.propose.leadMgmt'
                : 'staff.deductions.propose.lead',
          )}
        </Lead>
        <Card style={{ padding: space.m, gap: space.s }}>
          <GroupLabel>{t('staff.deductions.propose.who')}</GroupLabel>
          {targets.isError ? (
            <ErrorState
              testID="staff-deduction-propose.targets-error"
              title={t('errors.loadFailedTitle')}
              message={t(mapStaffError(targets.error))}
              retryLabel={t('common.retry')}
              onRetry={() => void targets.refetch()}
            />
          ) : !targets.isPending && targetOptions.length === 0 ? (
            <Hint style={{ marginTop: 0 }}>{t('staff.deductions.propose.noTargets')}</Hint>
          ) : (
            <PickList
              testID="staff-deduction-propose.target"
              options={targetOptions}
              loading={targets.isPending}
              value={draft.staffId}
              onChange={(staffId) => edit({ staffId })}
              error={fieldError('staffId')}
            />
          )}
          <Field
            {...chain.field(0, 'numeric')}
            testID="staff-deduction-propose.amount"
            label={t('staff.deductions.propose.amount')}
            value={draft.amount}
            onChangeText={(amount) => edit({ amount })}
            keyboardType="number-pad"
            latin
            error={fieldError('amount')}
          />
          {amountPreview !== null && amountPreview <= DEDUCTION_CAPS.amountMax ? (
            <Hint style={{ marginTop: 0 }}>{formatIQD(amountPreview, locale)}</Hint>
          ) : null}
          <Field
            {...chain.field(1)}
            testID="staff-deduction-propose.date"
            label={t('staff.deductions.propose.date')}
            value={draft.date}
            onChangeText={(date) => edit({ date })}
            keyboardType="numbers-and-punctuation"
            latin
            error={fieldError('date')}
          />
          <Hint style={{ marginTop: 0 }}>
            {datePreview
              ? dayLabel(datePreview, locale)
              : t('staff.deductions.propose.dateHint', { example: isolate(today) })}
          </Hint>
          <Field
            testID="staff-deduction-propose.reason"
            label={t('staff.deductions.propose.reason')}
            value={draft.reason}
            onChangeText={(reason) => edit({ reason })}
            multiline
            boxStyle={MULTILINE_BOX}
            style={MULTILINE_TEXT}
            maxLength={DEDUCTION_CAPS.reason}
            error={fieldError('reason')}
          />
          {/* What happens next, said before the send: the owner decides (or,
              for the owner, it is recorded at once), and the person never
              learns who proposed it (§2.5.2). */}
          <Text style={{ ...body, marginTop: space.xs }}>
            {chosen
              ? t(
                  atOnce
                    ? 'staff.deductions.propose.consequenceOwner'
                    : 'staff.deductions.propose.consequence',
                  { name: isolate(chosen.label) },
                )
              : t(
                  atOnce
                    ? 'staff.deductions.propose.consequenceAnyoneOwner'
                    : 'staff.deductions.propose.consequenceAnyone',
                )}
          </Text>
        </Card>
        {chain.bar}
      </ScreenWithBar>
    </Screen>
  );
}

export default function StaffDeductionProposeRoute() {
  return (
    <RequireStaff>
      <DeductionProposeScreen />
    </RequireStaff>
  );
}
