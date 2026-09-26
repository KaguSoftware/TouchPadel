import { useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  STAFF_REQUEST_KINDS,
  localIsoDate,
  parseTypedDate,
  staffRequestArgs,
  validateStaffRequest,
  type StaffRequestArgs,
  type StaffRequestDraft,
  type StaffRequestField,
  type StaffRequestIssue,
  type StaffRequestKind,
} from '@touch/core';
import { formatDate, formatIQD, isolate } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import { Button, Card, ErrorText, Field, Hint, MicroLabel, Screen } from '../src/components/ui';
import { ErrorState, SkeletonList } from '../src/components/states';
import { MenuRow } from '../src/components/booking';
import { CardIcon } from '../src/components/icons';
import { useToast } from '../src/components/overlays';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import {
  fetchStaffRequests,
  submitStaffRequest,
  withdrawStaffRequest,
  type StaffRequestRow,
} from '../src/features/staff/api';
import { mapStaffError } from '../src/features/staff/edge';
import { staffKeys } from '../src/features/staff/keys';
import { Chip } from '../src/features/staff/protocols/FormFields';
import { isMgmt } from '../src/features/staff/protocols/logic';
import { MULTILINE_BOX, MULTILINE_TEXT } from '../src/features/staff/protocols/multiline';
import { ListCard, StatusPill, type Tone } from '../src/features/staff/protocols/parts';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import { Lead } from '../src/features/staff/checklists/parts';

/**
 * Requests (migration 0072, unchanged): leave, a shift swap, a wage advance or
 * a correction to the record, and the list of what has been asked
 * (build-contracts-2026-09-23 §6.1). Every role asks here. The OWNER decides,
 * and only on the operator (plan #16, decided again in round 10 as #56): the
 * owner reads the requests here with a line saying so, and the phone never
 * calls decide_staff_request. Management's list is the venue's (the RPC
 * decides who sees what); everyone else sees their own.
 *
 * `?id=` is a request a push named; it is listed first.
 */

/** A stored `YYYY-MM-DD` in the reader's language (noon UTC, so no zone moves the day). */
function dayLabel(day: string, locale: 'en' | 'ar'): string {
  return formatDate(new Date(`${day}T12:00:00Z`), locale);
}

function freshDraft(): StaffRequestDraft {
  const today = localIsoDate(new Date());
  return { kind: 'leave', from: today, to: today, amount: '', note: '' };
}

function RequestsScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { status } = useStaffStatus();
  const params = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();

  const staff = status.kind === 'staff' ? status.staff : null;
  const uid = staff?.id ?? '';
  const mgmt = isMgmt(staff?.role);

  const requests = useQuery({
    queryKey: staffKeys.requests(uid),
    queryFn: fetchStaffRequests,
    enabled: uid !== '',
  });

  const [draft, setDraft] = useState<StaffRequestDraft>(freshDraft);
  const [issues, setIssues] = useState<StaffRequestIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const example = localIsoDate(new Date());

  const edit = (patch: Partial<StaffRequestDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    // A field the person is fixing stops showing its error.
    setIssues((all) => all.filter((i) => !(i.field in patch)));
  };

  const refetchList = () => queryClient.invalidateQueries({ queryKey: staffKeys.requests(uid) });
  // Pull to refresh, as on every other staff page: a decision made on the
  // operator shows here without leaving the page.
  const pull = usePullRefresh(refetchList);

  const submit = useMutation({
    mutationKey: staffKeys.mutation('request'),
    mutationFn: (args: StaffRequestArgs) => submitStaffRequest(args),
    onSuccess: () => {
      toast(t('staff.shell.requests.sent'), 'success');
      setDraft(freshDraft());
      setIssues([]);
      void refetchList();
    },
    onError: (err) => setError(t(mapStaffError(err))),
  });

  const withdraw = useMutation({
    mutationKey: staffKeys.mutation('request.withdraw'),
    mutationFn: (id: string) => withdrawStaffRequest(id),
    onSuccess: () => {
      toast(t('staff.shell.requests.withdrawn'), 'info');
      void refetchList();
    },
    onError: (err) => toast(t(mapStaffError(err)), 'error'),
  });

  const onSubmit = () => {
    setError(null);
    const found = validateStaffRequest(draft);
    setIssues(found);
    if (found.length === 0) submit.mutate(staffRequestArgs(draft));
  };

  const confirmWithdraw = (id: string) => {
    Alert.alert(t('staff.shell.requests.withdraw'), t('staff.shell.requests.withdrawConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('staff.shell.requests.withdraw'), style: 'destructive', onPress: () => withdraw.mutate(id) },
    ]);
  };

  const fieldError = (field: StaffRequestField): string | null => {
    const issue = issues.find((i) => i.field === field);
    if (!issue) return null;
    if (issue.code === 'order') return t('staff.shell.requests.errors.dateOrder');
    if (field === 'amount') return t('staff.shell.requests.errors.amount');
    if (field === 'note') return t('staff.shell.requests.errors.note');
    return t('staff.shell.requests.errors.date', { example: isolate(example) });
  };

  /** Under a date field: the typed day as the reader says it, so a swapped month shows. */
  const datePreview = (text: string) => {
    const day = parseTypedDate(text);
    return day ? <Hint>{dayLabel(day, locale)}</Hint> : null;
  };

  const rows = useMemo(() => {
    const list = requests.data?.requests ?? [];
    const first = params.id ? list.filter((r) => r.id === params.id) : [];
    return [...first, ...list.filter((r) => r.id !== params.id)];
  }, [requests.data, params.id]);

  const detailOf = (row: StaffRequestRow): string | null => {
    if (row.kind === 'advance' && row.amount_iqd !== null) return formatIQD(row.amount_iqd, locale);
    if (row.from_date && row.to_date && row.to_date !== row.from_date) {
      return t('staff.shell.requests.dates', {
        from: dayLabel(row.from_date, locale),
        to: dayLabel(row.to_date, locale),
      });
    }
    return row.from_date ? dayLabel(row.from_date, locale) : null;
  };

  const dated = draft.kind === 'leave' || draft.kind === 'shift_swap';
  const noteLabel =
    draft.kind === 'correction' ? t('staff.shell.requests.noteCorrection') : t('staff.shell.requests.noteOptional');
  const statusTone: Record<StaffRequestRow['status'], Tone> = {
    pending: 'warn',
    approved: 'good',
    rejected: 'bad',
    withdrawn: 'neutral',
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.shell.requests.title') }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        <Lead>{t('staff.shell.requests.lead')}</Lead>
        {staff?.role === 'owner' ? <Hint>{t('staff.shell.requests.decideOnOperator')}</Hint> : null}
        {staff?.role === 'manager' ? <Hint>{t('staff.shell.requests.managerNote')}</Hint> : null}

        {/* Wave 5 (wave5-addendum-2026-09-25 §5.3): every role reads the pay
            deductions approved for them from here; nobody proposes one
            against an owner, so the owner has none. */}
        {staff && staff.role !== 'owner' ? (
          <ListCard>
            <MenuRow
              testID="staff-request.deductions"
              icon={<CardIcon size={15} color={colors.gstrong} />}
              label={t('staff.deductions.mineRow')}
              onPress={() =>
                router.push({ pathname: '/staff-deductions', params: { view: 'mine' } })
              }
              last
            />
          </ListCard>
        ) : null}

        <Card style={{ padding: space.m, gap: space.s }}>
          <Text accessibilityRole="header" style={{ fontFamily: fonts.body700, fontSize: 15, lineHeight: 21, color: colors.ink }}>
            {t('staff.shell.requests.newTitle')}
          </Text>
          {/* The kind is one choice of four: the same chips, with the same
              selected state read out, as every other choice on the staff forms. */}
          <View style={{ gap: 6, marginTop: space.xs }}>
            <MicroLabel>{t('staff.shell.requests.kind')}</MicroLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {STAFF_REQUEST_KINDS.map((kind: StaffRequestKind) => (
                <Chip
                  key={kind}
                  testID={`staff-request.kind.${kind}`}
                  label={t(`staff.shell.requests.kinds.${kind}`)}
                  selected={draft.kind === kind}
                  onPress={() => edit({ kind })}
                />
              ))}
            </View>
          </View>

          {dated ? (
            <>
              <Field
                testID="staff-request.from"
                label={t('staff.shell.requests.from')}
                value={draft.from}
                onChangeText={(from) => edit({ from })}
                keyboardType="numbers-and-punctuation"
                latin
                error={fieldError('from')}
              />
              {datePreview(draft.from)}
              <Field
                testID="staff-request.to"
                label={t('staff.shell.requests.to')}
                value={draft.to}
                onChangeText={(to) => edit({ to })}
                keyboardType="numbers-and-punctuation"
                latin
                error={fieldError('to')}
              />
              {datePreview(draft.to)}
            </>
          ) : null}
          {draft.kind === 'correction' ? (
            <>
              <Field
                testID="staff-request.from"
                label={t('staff.shell.requests.day')}
                value={draft.from}
                onChangeText={(from) => edit({ from })}
                keyboardType="numbers-and-punctuation"
                latin
                error={fieldError('from')}
              />
              {datePreview(draft.from)}
            </>
          ) : null}
          {dated || draft.kind === 'correction' ? (
            <Hint>{t('staff.shell.requests.dateHint', { example: isolate(example) })}</Hint>
          ) : null}
          {draft.kind === 'advance' ? (
            <Field
              testID="staff-request.amount"
              label={t('staff.shell.requests.amount')}
              value={draft.amount}
              onChangeText={(amount) => edit({ amount })}
              keyboardType="number-pad"
              latin
              error={fieldError('amount')}
            />
          ) : null}
          <Field
            testID="staff-request.note"
            label={noteLabel}
            value={draft.note}
            onChangeText={(note) => edit({ note })}
            multiline
            boxStyle={MULTILINE_BOX}
            style={MULTILINE_TEXT}
            error={fieldError('note')}
          />
          <ErrorText>{error}</ErrorText>
          <Button
            testID="staff-request.submit"
            label={t('staff.shell.requests.submit')}
            variant="primary"
            busy={submit.isPending}
            onPress={onSubmit}
          />
        </Card>

        <MicroLabel style={{ paddingStart: 4, marginTop: space.s }}>
          {t(mgmt ? 'staff.shell.requests.everyone' : 'staff.shell.requests.mine')}
        </MicroLabel>
        {requests.isPending ? (
          <SkeletonList rows={2} height={72} />
        ) : requests.isError ? (
          <ErrorState
            testID="staff-request.error"
            title={t('errors.loadFailedTitle')}
            message={t(mapStaffError(requests.error))}
            retryLabel={t('common.retry')}
            onRetry={() => void requests.refetch()}
          />
        ) : rows.length === 0 ? (
          <Hint>{t('staff.shell.requests.empty')}</Hint>
        ) : (
          // One list, split by hairlines; the status is the same pill the
          // protocol pages use, so "waiting" looks the same everywhere.
          <ListCard>
            {rows.map((row, i) => {
              const mine = row.staff_id === uid;
              const detail = detailOf(row);
              return (
                <View
                  key={row.id}
                  style={{
                    padding: space.m,
                    gap: 4,
                    borderBottomWidth: i === rows.length - 1 ? 0 : 1,
                    borderBottomColor: colors.sub,
                    // The request a push opened is listed first and marked.
                    backgroundColor: row.id === params.id ? colors.tint : 'transparent',
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s }}>
                    <Text style={{ flexShrink: 1, fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>
                      {t(`staff.shell.requests.kinds.${row.kind}`)}
                    </Text>
                    <StatusPill label={t(`staff.shell.requests.statuses.${row.status}`)} tone={statusTone[row.status]} />
                  </View>
                  {!mine ? (
                    <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.mut }}>{row.staff_name}</Text>
                  ) : null}
                  {detail ? (
                    <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut }}>{detail}</Text>
                  ) : null}
                  {row.note ? (
                    <Text style={{ fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.mut2 }}>
                      {row.note}
                    </Text>
                  ) : null}
                  {row.decision_note ? (
                    <Text style={{ fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.mut2 }}>
                      {t('staff.shell.requests.ownerNote', { note: isolate(row.decision_note) })}
                    </Text>
                  ) : null}
                  {mine && row.status === 'pending' ? (
                    <Button
                      testID={`staff-request.withdraw.${row.id}`}
                      label={t('staff.shell.requests.withdraw')}
                      variant="ghost"
                      busy={withdraw.isPending && withdraw.variables === row.id}
                      onPress={() => confirmWithdraw(row.id)}
                      style={{ alignSelf: 'flex-start', marginTop: 4 }}
                    />
                  ) : null}
                </View>
              );
            })}
          </ListCard>
        )}
      </ScrollView>
    </Screen>
  );
}

export default function StaffRequestRoute() {
  return (
    <RequireStaff>
      <RequestsScreen />
    </RequireStaff>
  );
}
