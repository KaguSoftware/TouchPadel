import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDateTime, isolate } from '@touch/i18n';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import { Button, ErrorText, Field, Hint, MicroLabel, Screen } from '../src/components/ui';
import { ErrorState, SkeletonList } from '../src/components/states';
import { useToast } from '../src/components/overlays';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { mapStaffError } from '../src/features/staff/edge';
import { staffKeys } from '../src/features/staff/keys';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import { clearStaffIntentKey, staffIntentKey } from '../src/lib/idempotency';
import { intentFor } from '../src/features/staff/supplies/logic';
import { addReleaseNote, fetchItemNotes, fetchNoteItems } from '../src/features/staff/notes/api';
import { NOTE_MAX, checkNote, daysLeft, initialItemId } from '../src/features/staff/notes/logic';
import { Chip } from '../src/features/staff/protocols/FormFields';
import { bilingual } from '../src/features/staff/protocols/logic';
import { Muted, Section, Strong, useRefreshProtocols } from '../src/features/staff/protocols/parts';
import { Lead, MULTILINE_BOX, MULTILINE_TEXT } from '../src/features/staff/checklists/parts';

/**
 * Notes on new items (build-contracts-2026-09-23 §6.1 `staff-notes.tsx?itemId=`,
 * Q9): every role, for the 30 days after a new item launches, writes what
 * customers and the team say about it. The notes go into the item's day-30
 * review, which only management reads (#54). The page asks for no names or
 * phone numbers; notes are shown as typed.
 */

function ItemNotesPanel({ itemId }: { itemId: string }) {
  const { t, locale } = useLocale();
  const { colors } = useTheme();
  const toast = useToast();
  const refresh = useRefreshProtocols();
  const [body, setBody] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  // A note is keyed by the item and its text: a retry reuses the key, and the
  // next note never replays one whose answer was lost.
  const intent = (text: string) => intentFor('note', { itemId, body: text });
  const notes = useQuery({ queryKey: staffKeys.itemNotes(itemId), queryFn: () => fetchItemNotes(itemId) });

  const add = useMutation({
    mutationKey: staffKeys.mutation('note'),
    mutationFn: (text: string) => addReleaseNote(itemId, text, staffIntentKey(intent(text), 'note')),
    onSuccess: (_, text) => {
      clearStaffIntentKey(intent(text));
      setBody('');
      toast(t('staff.notes.added'), 'success');
      void refresh();
    },
    onError: (err) => setProblem(t(mapStaffError(err))),
  });

  if (notes.isPending) return <SkeletonList rows={2} height={72} />;
  if (notes.isError) {
    return (
      <ErrorState
        testID="staff-notes.notes-error"
        title={t('errors.loadFailedTitle')}
        message={t(mapStaffError(notes.error))}
        retryLabel={t('common.retry')}
        onRetry={() => void notes.refetch()}
      />
    );
  }
  const { item, notes: list } = notes.data;
  const left = daysLeft(item.window_ends_at);

  return (
    <>
      <Section>
        <Strong>{bilingual(locale, item.name_en, item.name_ar) ?? ''}</Strong>
        <Muted style={{ color: item.open ? colors.gtext : colors.mut }}>
          {item.open
            ? left <= 1
              ? t('staff.notes.lastDay')
              : t('staff.notes.daysLeft', { days: left })
            : t('staff.notes.closed')}
        </Muted>
        {item.open ? (
          <>
            <Field
              testID="staff-notes.body"
              label={t('staff.notes.body')}
              value={body}
              onChangeText={(v) => {
                setBody(v);
                setProblem(null);
              }}
              multiline
              boxStyle={MULTILINE_BOX}
              style={MULTILINE_TEXT}
              maxLength={NOTE_MAX}
            />
            <Hint>{t('staff.notes.hint')}</Hint>
          </>
        ) : null}
        <ErrorText>{problem}</ErrorText>
        <Button
          testID="staff-notes.add"
          label={t('staff.notes.add')}
          variant="primary"
          busy={add.isPending}
          disabled={!item.open}
          onPress={() => {
            const issue = checkNote(body);
            if (issue) {
              setProblem(t(issue === 'required' ? 'staff.notes.required' : 'staff.notes.tooLong'));
              return;
            }
            add.mutate(body.trim());
          }}
        />
      </Section>
      <MicroLabel style={{ paddingStart: 4, marginTop: space.s }}>{t('staff.notes.notesTitle')}</MicroLabel>
      {list.length === 0 ? (
        <Hint>{t('staff.notes.none')}</Hint>
      ) : (
        list.map((n) => (
          <Section key={n.id}>
            <Muted style={{ color: colors.ink }}>{n.body}</Muted>
            <Muted>
              {t('staff.notes.by', {
                name: n.mine ? t('staff.notes.mine') : isolate(n.author_name ?? ''),
                when: formatDateTime(new Date(n.created_at), locale),
              })}
            </Muted>
          </Section>
        ))
      )}
    </>
  );
}

function NotesScreen() {
  const { t, locale } = useLocale();
  const insets = useSafeAreaInsets();
  const refresh = useRefreshProtocols();
  const pull = usePullRefresh(refresh);
  const { venueId } = useStaffStatus();
  const params = useLocalSearchParams<{ itemId?: string }>();
  const venue = venueId ?? '';
  const items = useQuery({ queryKey: staffKeys.notes(venue), queryFn: () => fetchNoteItems(venue), enabled: venue !== '' });
  const [picked, setPicked] = useState<string | null>(null);
  const itemId = picked ?? initialItemId(items.data ?? [], params.itemId);

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.notes.title') }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        <Lead>{t('staff.notes.lead')}</Lead>
        {items.isPending && venue !== '' ? (
          <SkeletonList rows={1} height={44} />
        ) : items.isError ? (
          <ErrorState
            testID="staff-notes.error"
            title={t('errors.loadFailedTitle')}
            message={t(mapStaffError(items.error))}
            retryLabel={t('common.retry')}
            onRetry={() => void items.refetch()}
          />
        ) : (items.data ?? []).length > 0 ? (
          <View style={{ gap: 6 }}>
            <MicroLabel style={{ paddingStart: 4 }}>{t('staff.notes.pick')}</MicroLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {(items.data ?? []).map((it) => (
                <Chip
                  key={it.menu_item_id}
                  testID={`staff-notes.item.${it.menu_item_id}`}
                  label={bilingual(locale, it.name_en, it.name_ar) ?? ''}
                  selected={it.menu_item_id === itemId}
                  onPress={() => setPicked(it.menu_item_id)}
                />
              ))}
            </View>
          </View>
        ) : !itemId ? (
          <Hint>{t('staff.notes.empty')}</Hint>
        ) : null}
        {itemId ? <ItemNotesPanel key={itemId} itemId={itemId} /> : null}
      </ScrollView>
    </Screen>
  );
}

export default function StaffNotesRoute() {
  return (
    <RequireStaff>
      <NotesScreen />
    </RequireStaff>
  );
}
