import { useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { FieldIssue } from '@touch/core';
import { formatDateTime, isolate, type MessageKey } from '@touch/i18n';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import { Button, ErrorText, Hint, MicroLabel, Screen } from '../src/components/ui';
import { SkeletonList } from '../src/components/states';
import { useToast } from '../src/components/overlays';
import { PhotoButton, type AttachedPhoto } from '../src/components/PhotoButton';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { mapStaffError } from '../src/features/staff/edge';
import { staffKeys } from '../src/features/staff/keys';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import { clearStaffIntentKey, staffIntentKey } from '../src/lib/idempotency';
import { intentFor } from '../src/features/staff/supplies/logic';
import { declineIdea, fetchIdeasToReview, fetchMyIdeas, submitIdea, withdrawIdea } from '../src/features/staff/ideas/api';
import {
  IDEA_FIELDS,
  IDEA_PHOTOS_MAX,
  IDEA_PHOTO_FOLDER,
  canWithdrawIdea,
  focusFirst,
  ideaName,
  isIdeaAuthor,
  isIdeaReviewer,
  validateIdea,
  type MyIdea,
  type ReviewIdea,
} from '../src/features/staff/ideas/logic';
import { fetchIngredients, ingredientList } from '../src/features/staff/protocols/api';
import { emptyDraft, recordFromDraft, type Draft } from '../src/features/staff/protocols/assemble';
import { FormFields } from '../src/features/staff/protocols/FormFields';
import { IDEA_ROLES, bilingual } from '../src/features/staff/protocols/logic';
import {
  Muted,
  PhotoStrip,
  ReasonForm,
  Section,
  Strong,
  serverIssue,
  useRefreshProtocols,
} from '../src/features/staff/protocols/parts';
import { RecordView } from '../src/features/staff/protocols/RecordView';

/**
 * New-item ideas (build-contracts-2026-09-23 §6.1 `staff-ideas.tsx?id=`, role
 * spec #65). A barista or chef assistant sends an idea to the head of their
 * team and follows it: waiting, declined with the head's reason, or started as
 * a new item, whose step names and status they see and never its record
 * (#72: the proposal is the recipe, with quantities). A head reviews their
 * team's ideas (management, both teams'): Start opens the new-item form
 * filled from the idea (`staff-start.tsx?kind=product_release&ideaId=`), and
 * Decline asks for a reason the author reads.
 */

interface IdeaArgs {
  record: Record<string, unknown>;
  photos: string[];
}

function freshDraft(): Draft {
  return emptyDraft(IDEA_FIELDS);
}

function IdeaForm({ venueId, onSent }: { venueId: string; onSent: () => void }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(freshDraft);
  const [photos, setPhotos] = useState<AttachedPhoto[]>([]);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  // An idea is keyed by exactly what it sends: a retry of the same idea
  // reuses its key, and a different idea never replays one whose answer was lost.
  const intent = (args: IdeaArgs) => intentFor('idea', { ...args, venueId });
  const ingredients = useQuery({
    queryKey: staffKeys.ingredients(venueId),
    queryFn: () => fetchIngredients(venueId),
    select: ingredientList,
  });

  const send = useMutation({
    mutationKey: staffKeys.mutation('idea'),
    mutationFn: (args: IdeaArgs) => submitIdea({ ...args, venueId, idempotencyKey: staffIntentKey(intent(args), 'idea') }),
    onSuccess: (_, args) => {
      clearStaffIntentKey(intent(args));
      setDraft(freshDraft());
      setPhotos([]);
      setIssues([]);
      toast(t('staff.protocols.ideas.sent'), 'success');
      onSent();
    },
    onError: (err) => {
      setError(t(mapStaffError(err)));
      const issue = serverIssue(err);
      if (issue) setIssues((all) => [...all, issue]);
    },
  });

  const onSubmit = () => {
    setError(null);
    const record = recordFromDraft(IDEA_FIELDS, draft);
    const found = validateIdea(record, photos.length);
    setIssues(found);
    if (found.length > 0) {
      setError(t('staff.protocols.step.checkForm'));
      return;
    }
    send.mutate({ record, photos: photos.map((p) => p.path) });
  };

  return (
    <Section title={t('staff.protocols.ideas.newTitle')}>
      <FormFields
        testID="staff-ideas"
        fields={IDEA_FIELDS}
        draft={draft}
        onChange={(next) => {
          setDraft(next);
          setIssues([]);
        }}
        issues={issues}
        pickers={{
          'lines.ingredient_id': {
            options: (ingredients.data ?? []).map((i) => ({ value: i.id, label: bilingual(locale, i.name_en, i.name_ar) ?? '' })),
          },
        }}
        hints={{ lines: t('staff.protocols.form.lineIngredientOrLabel'), sizes: t('staff.protocols.form.sizeName') }}
        disabled={send.isPending}
      />
      <PhotoButton
        testID="staff-ideas.photo"
        venueId={venueId}
        folder={IDEA_PHOTO_FOLDER}
        photos={photos}
        onChange={setPhotos}
        max={IDEA_PHOTOS_MAX}
        disabled={send.isPending}
      />
      <ErrorText>{error}</ErrorText>
      <Button testID="staff-ideas.submit" label={t('staff.protocols.ideas.submit')} variant="cta" busy={send.isPending} onPress={onSubmit} />
    </Section>
  );
}

function MyIdeaCard({ idea, focused }: { idea: MyIdea; focused: boolean }) {
  const { t, locale } = useLocale();
  const { colors } = useTheme();
  const toast = useToast();
  const refresh = useRefreshProtocols();
  const withdraw = useMutation({
    mutationKey: staffKeys.mutation('idea.withdraw'),
    mutationFn: () => withdrawIdea(idea.id),
    onSuccess: () => {
      toast(t('staff.protocols.ideas.withdrawn'), 'info');
      void refresh();
    },
    onError: (err) => toast(t(mapStaffError(err)), 'error'),
  });
  const steps = (idea.run?.current_steps ?? []).map((s) => bilingual(locale, s.name_en, s.name_ar)).filter(Boolean);
  return (
    <View testID={`staff-ideas.idea.${idea.id}`}>
      <Section style={focused ? { borderColor: colors.blue, borderWidth: 1.5 } : undefined}>
        <Strong>{ideaName(idea.record, locale) ?? t('staff.protocols.common.untitled')}</Strong>
        <Muted style={{ color: idea.status === 'declined' ? colors.redtext : colors.mut }}>
          {`${t(`work.idea.status.${idea.status}`)} · ${formatDateTime(new Date(idea.submitted_at), locale)}`}
        </Muted>
        {idea.status === 'declined' && idea.decline_reason ? (
          <Muted>
            {t('staff.protocols.ideas.declinedBecause', {
              name: idea.decided_by_name ?? '',
              reason: isolate(idea.decline_reason),
            })}
          </Muted>
        ) : null}
        {idea.run ? (
          <>
            <Muted>{t('staff.protocols.ideas.runStatus', { status: t(`work.protocol.runStatus.${idea.run.status}` as MessageKey) })}</Muted>
            {steps.length > 0 ? (
              <Muted>{t('staff.protocols.ideas.runNow', { steps: steps.join(locale === 'ar' ? '، ' : ', ') })}</Muted>
            ) : null}
          </>
        ) : null}
        <PhotoStrip paths={idea.photos} label={(n) => t('staff.media.photo', { n })} />
        {canWithdrawIdea(idea) ? (
          <Button
            testID={`staff-ideas.withdraw.${idea.id}`}
            label={t('staff.protocols.ideas.withdraw')}
            variant="ghost"
            busy={withdraw.isPending}
            onPress={() =>
              Alert.alert(t('staff.protocols.ideas.withdraw'), t('staff.protocols.ideas.withdrawConfirm'), [
                { text: t('staff.protocols.step.decide.cancel'), style: 'cancel' },
                { text: t('staff.protocols.ideas.withdraw'), style: 'destructive', onPress: () => withdraw.mutate() },
              ])
            }
            style={{ alignSelf: 'flex-start' }}
          />
        ) : null}
      </Section>
    </View>
  );
}

function ReviewCard({ idea, names, focused }: { idea: ReviewIdea; names: Record<string, string>; focused: boolean }) {
  const { t, locale } = useLocale();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const refresh = useRefreshProtocols();
  const [declining, setDeclining] = useState(false);
  const decline = useMutation({
    mutationKey: staffKeys.mutation('idea.decline'),
    mutationFn: (reason: string) => declineIdea(idea.id, reason),
    onSuccess: () => {
      setDeclining(false);
      toast(t('staff.protocols.ideas.declined'), 'info');
      void refresh();
    },
  });
  return (
    <View testID={`staff-ideas.idea.${idea.id}`}>
      <Section style={focused ? { borderColor: colors.blue, borderWidth: 1.5 } : undefined}>
        <Strong>{ideaName(idea.record, locale) ?? t('staff.protocols.common.untitled')}</Strong>
        <Muted>
          {`${t(`work.team.${idea.team}`)} · ${t('staff.protocols.ideas.fromAuthor', {
            name: idea.author_name ?? '',
            when: formatDateTime(new Date(idea.submitted_at), locale),
          })}`}
        </Muted>
        <RecordView fields={IDEA_FIELDS} record={idea.record} names={names} />
        <PhotoStrip paths={idea.photos} label={(n) => t('staff.media.photo', { n })} />
        {declining ? (
          <ReasonForm
            testID={`staff-ideas.decline-form.${idea.id}`}
            label={t('staff.protocols.ideas.declineReason')}
            confirmLabel={t('staff.protocols.ideas.declineConfirm')}
            danger
            busy={decline.isPending}
            error={decline.error ? t(mapStaffError(decline.error)) : null}
            onCancel={() => setDeclining(false)}
            onConfirm={(reason) => decline.mutate(reason)}
          />
        ) : (
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <Button
              testID={`staff-ideas.decline.${idea.id}`}
              label={t('staff.protocols.ideas.decline')}
              variant="dangerOutline"
              size="compact"
              onPress={() => setDeclining(true)}
              style={{ flex: 1 }}
            />
            <Button
              testID={`staff-ideas.start.${idea.id}`}
              label={t('staff.protocols.ideas.start')}
              variant="primary"
              size="compact"
              onPress={() =>
                router.push({ pathname: '/staff-start', params: { kind: 'product_release', ideaId: idea.id } })
              }
              style={{ flex: 1.4 }}
            />
          </View>
        )}
      </Section>
    </View>
  );
}

function IdeasScreen() {
  const { t, locale } = useLocale();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const refresh = useRefreshProtocols();
  const pull = usePullRefresh(refresh);
  const { status, venueId } = useStaffStatus();
  const params = useLocalSearchParams<{ id?: string }>();
  const role = status.kind === 'staff' ? status.staff.role : null;
  const venue = venueId ?? '';
  const author = isIdeaAuthor(role);
  const reviewer = isIdeaReviewer(role);

  const mine = useQuery({ queryKey: staffKeys.ideas(venue), queryFn: () => fetchMyIdeas(venue), enabled: venue !== '' && author });
  const review = useQuery({
    queryKey: staffKeys.ideasToReview(venue),
    queryFn: () => fetchIdeasToReview(venue),
    enabled: venue !== '' && reviewer,
  });
  const ingredients = useQuery({
    queryKey: staffKeys.ingredients(venue),
    queryFn: () => fetchIngredients(venue),
    select: ingredientList,
    enabled: venue !== '' && reviewer,
  });
  const names: Record<string, string> = {};
  for (const i of ingredients.data ?? []) {
    const n = bilingual(locale, i.name_en, i.name_ar);
    if (n) names[i.id] = n;
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.protocols.ideas.title') }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        {!venueId ? <SkeletonList rows={2} height={72} /> : null}
        {author && venueId ? (
          <>
            <Muted>{t('staff.protocols.ideas.lead')}</Muted>
            <IdeaForm venueId={venueId} onSent={() => void queryClient.invalidateQueries({ queryKey: staffKeys.ideas(venue) })} />
            <MicroLabel style={{ paddingStart: 4, marginTop: space.s }}>{t('staff.protocols.ideas.mine')}</MicroLabel>
            {mine.isPending ? (
              <SkeletonList rows={2} height={72} />
            ) : mine.isError ? (
              <Hint>{t(mapStaffError(mine.error))}</Hint>
            ) : mine.data.length === 0 ? (
              <Hint>{t('staff.protocols.ideas.mineEmpty')}</Hint>
            ) : (
              focusFirst(mine.data, params.id).map((idea) => (
                <MyIdeaCard key={idea.id} idea={idea} focused={idea.id === params.id} />
              ))
            )}
          </>
        ) : null}
        {reviewer && venueId ? (
          <>
            <Muted>{t('staff.protocols.ideas.reviewLead')}</Muted>
            <MicroLabel style={{ paddingStart: 4, marginTop: space.s }}>{t('staff.protocols.ideas.toReview')}</MicroLabel>
            {review.isPending ? (
              <SkeletonList rows={2} height={96} />
            ) : review.isError ? (
              <Hint>{t(mapStaffError(review.error))}</Hint>
            ) : review.data.ideas.length === 0 ? (
              <Hint>{t('staff.protocols.ideas.reviewEmpty')}</Hint>
            ) : (
              focusFirst(review.data.ideas, params.id).map((idea) => (
                <ReviewCard key={idea.id} idea={idea} names={names} focused={idea.id === params.id} />
              ))
            )}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export default function StaffIdeasRoute() {
  return (
    <RequireStaff roles={IDEA_ROLES}>
      <IdeasScreen />
    </RequireStaff>
  );
}
