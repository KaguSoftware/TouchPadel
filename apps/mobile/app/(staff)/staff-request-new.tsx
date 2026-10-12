import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { formatDate, isolate } from '@touch/i18n';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { space } from '../../src/theme';
import { Button, Card, ErrorText, Field, Hint, MicroLabel, Screen } from '../../src/components/ui';
import { useToast } from '../../src/components/overlays';
import { RequireStaff } from '../../src/features/staff/RequireStaff';
import { useStaffStatus } from '../../src/features/staff/StaffStatusProvider';
import { submitStaffRequest } from '../../src/features/staff/api';
import { mapStaffError } from '../../src/features/staff/edge';
import { staffKeys } from '../../src/features/staff/keys';
import { Chip } from '../../src/features/staff/protocols/FormFields';
import { MULTILINE_BOX, MULTILINE_TEXT } from '../../src/features/staff/protocols/multiline';
import { useBack } from '../../src/navigation/back';

/**
 * A new request (migration 0072): leave, a shift swap, a wage advance or a
 * correction to the record (build-contracts-2026-09-23 §6.1). Every role asks.
 * Opened by the + in the requests page's top bar; a sent request goes back to
 * that page, which lists it.
 */

/** A stored `YYYY-MM-DD` in the reader's language (noon UTC, so no zone moves the day). */
function dayLabel(day: string, locale: 'en' | 'ar'): string {
  return formatDate(new Date(`${day}T12:00:00Z`), locale);
}

function freshDraft(): StaffRequestDraft {
  const today = localIsoDate(new Date());
  return { kind: 'leave', from: today, to: today, amount: '', note: '' };
}

function NewRequestScreen() {
  const { t, locale } = useLocale();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const back = useBack('/staff-request');
  const queryClient = useQueryClient();
  const { status } = useStaffStatus();
  const uid = status.kind === 'staff' ? status.staff.id : '';

  const [draft, setDraft] = useState<StaffRequestDraft>(freshDraft);
  const [issues, setIssues] = useState<StaffRequestIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const example = localIsoDate(new Date());

  const edit = (patch: Partial<StaffRequestDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    // A field the person is fixing stops showing its error.
    setIssues((all) => all.filter((i) => !(i.field in patch)));
  };

  const submit = useMutation({
    mutationKey: staffKeys.mutation('request'),
    mutationFn: (args: StaffRequestArgs) => submitStaffRequest(args),
    onSuccess: () => {
      toast(t('staff.shell.requests.sent'), 'success');
      void queryClient.invalidateQueries({ queryKey: staffKeys.requests(uid) });
      back();
    },
    onError: (err) => setError(t(mapStaffError(err))),
  });

  const onSubmit = () => {
    setError(null);
    const found = validateStaffRequest(draft);
    setIssues(found);
    if (found.length === 0) submit.mutate(staffRequestArgs(draft));
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

  const dated = draft.kind === 'leave' || draft.kind === 'shift_swap';
  const noteLabel =
    draft.kind === 'correction'
      ? t('staff.shell.requests.noteCorrection')
      : t('staff.shell.requests.noteOptional');

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.shell.requests.newTitle') }} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: space.m,
          paddingBottom: 40 + insets.bottom,
          gap: space.sm,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <Card style={{ padding: space.m, gap: space.s }}>
          {/* The kind is one choice of four: the same chips, with the same
              selected state read out, as every other choice on the staff forms. */}
          <View style={{ gap: 6 }}>
            <MicroLabel>{t('staff.shell.requests.kind')}</MicroLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {STAFF_REQUEST_KINDS.map((kind: StaffRequestKind) => (
                <Chip
                  key={kind}
                  testID={`staff-request-new.kind.${kind}`}
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
                testID="staff-request-new.from"
                label={t('staff.shell.requests.from')}
                value={draft.from}
                onChangeText={(from) => edit({ from })}
                keyboardType="numbers-and-punctuation"
                latin
                error={fieldError('from')}
              />
              {datePreview(draft.from)}
              <Field
                testID="staff-request-new.to"
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
                testID="staff-request-new.from"
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
              testID="staff-request-new.amount"
              label={t('staff.shell.requests.amount')}
              value={draft.amount}
              onChangeText={(amount) => edit({ amount })}
              keyboardType="number-pad"
              latin
              error={fieldError('amount')}
            />
          ) : null}
          <Field
            testID="staff-request-new.note"
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
            testID="staff-request-new.submit"
            label={t('staff.shell.requests.submit')}
            variant="primary"
            busy={submit.isPending}
            onPress={onSubmit}
          />
        </Card>
      </ScrollView>
    </Screen>
  );
}

export default function StaffRequestNewRoute() {
  return (
    <RequireStaff>
      <NewRequestScreen />
    </RequireStaff>
  );
}
