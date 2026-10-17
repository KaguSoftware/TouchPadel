import { useState } from 'react';
import { Stack } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { space } from '../../src/theme';
import { Button, Card, Field, Hint, Screen } from '../../src/components/ui';
import { ScreenWithBar } from '../../src/components/BottomBar';
import { useToast } from '../../src/components/overlays';
import { RequireStaff } from '../../src/features/staff/RequireStaff';
import { useStaffStatus } from '../../src/features/staff/StaffStatusProvider';
import { staffKeys } from '../../src/features/staff/keys';
import { mapStaffError } from '../../src/features/staff/edge';
import { clearStaffIntentKey, staffIntentKey } from '../../src/lib/idempotency';
import { useBackToItem } from '../../src/navigation/back';
import { addSuggestion } from '../../src/features/staff/suggestions/api';
import {
  BODY_MAX,
  SUGGESTION_FILTERS,
  readsAllSuggestions,
  suggestionIntent,
  suggestionIssue,
} from '../../src/features/staff/suggestions/logic';
import { Lead, MULTILINE_BOX, MULTILINE_TEXT } from '../../src/features/staff/checklists/parts';

/**
 * Send a suggestion (build-contracts-2026-09-23 §2.24.4, §6.1; plan #63).
 * Every role sends one, signed. Opened by the + in the suggestions page's top
 * bar; a sent suggestion goes back to that page, which lists it. No photo, and
 * the form asks for no guest names or phone numbers.
 */
function SuggestionNewScreen() {
  const { t } = useLocale();
  const toast = useToast();
  // Back to the list, the new suggestion first and marked.
  const showInList = useBackToItem('/staff-suggestions');
  const queryClient = useQueryClient();
  const { status, venueId } = useStaffStatus();
  const staff = status.kind === 'staff' ? status.staff : null;
  const mgmt = staff !== null && readsAllSuggestions(staff.role);
  const venue = venueId ?? '';

  const [body, setBody] = useState('');
  const [issue, setIssue] = useState<'required' | 'tooLong' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    mutationKey: staffKeys.mutation('suggestion'),
    mutationFn: (text: string) =>
      addSuggestion(venue, text, staffIntentKey(suggestionIntent(venue, text), 'suggestion')),
    onSuccess: (result, text) => {
      clearStaffIntentKey(suggestionIntent(venue, text));
      toast(t('staff.checklists.suggestions.sent'), 'success');
      void queryClient.invalidateQueries({ queryKey: staffKeys.mySuggestions(venue) });
      if (mgmt) {
        for (const f of SUGGESTION_FILTERS) {
          void queryClient.invalidateQueries({ queryKey: staffKeys.suggestions(venue, f) });
        }
      }
      showInList(result.id);
    },
    onError: (err) => setError(t(mapStaffError(err))),
  });

  const onSend = () => {
    setError(null);
    const found = suggestionIssue(body);
    setIssue(found);
    if (!found && venue !== '') send.mutate(body.trim());
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.checklists.suggestions.new') }} />
      <ScreenWithBar
        contentContainerStyle={{ paddingTop: space.m, gap: space.sm }}
        error={error}
        bar={
          <Button
            testID="staff-suggestion-new.submit"
            label={t('staff.checklists.suggestions.submit')}
            variant="primary"
            busy={send.isPending}
            disabled={venue === ''}
            onPress={onSend}
          />
        }
      >
        <Lead>{t('staff.checklists.suggestions.lead')}</Lead>
        {venue === '' ? <Hint>{t('staff.shell.venue.none')}</Hint> : null}

        <Card style={{ padding: space.m, gap: space.s }}>
          <Field
            testID="staff-suggestion-new.body"
            label={t('staff.checklists.suggestions.field')}
            value={body}
            onChangeText={(text) => {
              setBody(text);
              setIssue(null);
              setError(null);
            }}
            multiline
            boxStyle={MULTILINE_BOX}
            style={MULTILINE_TEXT}
            maxLength={BODY_MAX + 200}
            error={
              issue === 'required'
                ? t('staff.checklists.suggestions.errors.required')
                : issue === 'tooLong'
                  ? t('staff.checklists.suggestions.errors.tooLong')
                  : null
            }
          />
          <Hint style={{ marginTop: 0 }}>{t('staff.checklists.noGuestData')}</Hint>
        </Card>
      </ScreenWithBar>
    </Screen>
  );
}

export default function StaffSuggestionNewRoute() {
  return (
    <RequireStaff>
      <SuggestionNewScreen />
    </RequireStaff>
  );
}
