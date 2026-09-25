/**
 * Start a protocol from /tasks (build-contracts-2026-09-23 §5.4): the head
 * roles' "Propose a new item", marketing's "Price or promo change" and the
 * court desk's "Start a tournament". A start is the first step's record
 * (app.start_protocol's `p_first_record`) with the run's title; the step
 * passes on to its decider, a manager, from there.
 *
 * A head starting from a team idea (#65) opens this form prefilled from the
 * idea, photos included, and the start carries `{idea_id}` so the idea is
 * marked started in the same transaction; the head may change anything first.
 *
 * Staff may title a run in one language (Q10). A new item or a tournament
 * already has a name in the form, so a title left blank takes that name.
 */
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  TOURNAMENT_VARIANTS,
  startForm,
  validateStart,
  type FieldIssue,
  type PriceChangeKind,
  type TournamentVariant,
} from '@touch/core/protocols';
import { appRpc, AppRpcError } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { MessagePresenter, SegmentedControl } from '../../components/kit';
import type { IdeaRow } from '../roleExtras/roleExtrasLogic';
import { StepFormFields } from './StepFormFields';
import { emptyDraft, fromRecord, toRecord, type Draft } from './formModel';
import { startDraft } from './priceLogic';
import type { TaskStart } from './search';

const TITLE_MAX = 120;

const FIELD_CODES = ['RECORD_INVALID', 'TEXT_TOO_LONG', 'SPONSOR_DETAILS_REQUIRED'] as const;

/** A refusal the server tied to a field (its hint) marks that field beside the form's own issues. */
export function withServerIssue(current: readonly FieldIssue[], error: unknown): readonly FieldIssue[] {
  if (!(error instanceof AppRpcError) || !error.hint) return current;
  const code = (FIELD_CODES as readonly string[]).includes(error.code) ? (error.code as (typeof FIELD_CODES)[number]) : null;
  if (!code || current.some((i) => i.field === error.hint)) return current;
  return [...current, { field: error.hint, code }];
}

function titleFallback(start: TaskStart, record: Record<string, unknown>, which: 'en' | 'ar'): string {
  if (start === 'price_promo') return '';
  const v = record[`name_${which}`];
  return typeof v === 'string' ? v : '';
}

export function StartSheet({ start, idea, onClose, onStarted }: { start: TaskStart; idea?: IdeaRow | null; onClose: () => void; onStarted: (runId: string) => void }) {
  const { tr } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [variant, setVariant] = useState<TournamentVariant | null>(start === 'tournament' ? 'type1' : null);
  const [change, setChange] = useState<PriceChangeKind | null>(null);
  const form = useMemo(() => startForm(start, { variant, change }), [start, variant, change]);
  const [draft, setDraft] = useState<Draft>(() => (idea ? fromRecord(form.fields, idea.record) : emptyDraft(form.fields)));
  const [photos, setPhotos] = useState<string[]>(() => (idea ? [...idea.photos] : []));
  const [titleEn, setTitleEn] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [issues, setIssues] = useState<readonly FieldIssue[]>([]);
  // Minted when the form opens, reused on a retry, replaced after success (§5.3).
  const key = useRef(`protocol.start:${crypto.randomUUID()}`);

  const submit = useMutation({
    mutationFn: async () => {
      const record = toRecord(form.fields, draft);
      const en = titleEn.trim() || titleFallback(start, record, 'en');
      const ar = titleAr.trim() || titleFallback(start, record, 'ar');
      const found = validateStart(
        { kind: start, variant, change, titleEn: en, titleAr: ar, record, byOwner: false },
        { photos: form.photoFolder ? photos.length : undefined },
      );
      setIssues(found);
      if (found.length > 0) throw new AppRpcError('RECORD_INVALID', 'RECORD_INVALID', found[0]!.field);
      return appRpc<{ run_id: string }>('start_protocol', {
        p_kind: start,
        p_variant: variant,
        p_title_en: en || null,
        p_title_ar: ar || null,
        p_data: idea ? { idea_id: idea.id } : {},
        p_first_record: record,
        p_photos: photos,
        p_venue_id: null,
        p_idempotency_key: key.current,
      });
    },
    onSuccess: (res) => {
      key.current = `protocol.start:${crypto.randomUUID()}`;
      toast.ok(tr('ws.team.tasks.start.started'));
      void qc.invalidateQueries({ queryKey: ['protocols'] });
      if (idea) void qc.invalidateQueries({ queryKey: ['ideas'] });
      onStarted(res.run_id);
    },
    onError: (e) => setIssues((cur) => withServerIssue(cur, e)),
  });

  const title = tr(`ws.team.tasks.start.title.${start}`);
  const titleIssue = issues.find((i) => i.field === 'title');

  return (
    <Modal
      title={title}
      subtitle={idea ? tr('ws.team.tasks.start.fromIdea') : tr(`ws.team.tasks.start.lead.${start}`)}
      onClose={onClose}
      dismissible={!submit.isPending}
      size="xl"
      footer={(close) => (
        <>
          <Button onClick={close} disabled={submit.isPending}>
            {tr('ws.team.tasks.cancel')}
          </Button>
          <Button kind="primary" busy={submit.isPending} disabled={start === 'price_promo' && change === null} onClick={() => submit.mutate()} data-testid="start.submit">
            {tr('ws.team.tasks.start.submit')}
          </Button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
        {start === 'tournament' && (
          <Field label={tr('ws.team.tasks.start.variant')} group hint={variant ? tr(`ws.team.tasks.start.variantHint.${variant}`) : undefined}>
            <SegmentedControl<TournamentVariant>
              value={variant ?? 'type1'}
              onChange={(v) => {
                setVariant(v);
                // The short type 2 plan and the full one share their first fields.
                setDraft((d) => fromRecord(startForm('tournament', { variant: v }).fields, toRecord(form.fields, d)));
              }}
              options={TOURNAMENT_VARIANTS.map((v) => ({ value: v, label: tr(`work.protocol.variant.${v}`) }))}
            />
          </Field>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '0 var(--tp-sp-3)' }}>
          <Field
            label={tr('ws.team.tasks.start.titleEn')}
            // A new item or a tournament falls back to its name; a price change needs one title.
            optional={start !== 'price_promo'}
            hint={start === 'price_promo' ? tr('ws.team.tasks.start.titleHint') : tr('ws.team.tasks.start.titleHintNamed')}
            error={titleIssue ? tr(titleIssue.code === 'TEXT_TOO_LONG' ? 'ws.team.tasks.form.issue.tooLong' : 'ws.team.tasks.start.titleNeeded') : undefined}
          >
            <input style={inputStyle} dir="ltr" value={titleEn} maxLength={TITLE_MAX} onChange={(e) => setTitleEn(e.target.value)} data-testid="start.title_en" />
          </Field>
          <Field label={tr('ws.team.tasks.start.titleAr')} optional={start !== 'price_promo'}>
            <input style={inputStyle} dir="rtl" lang="ar" value={titleAr} maxLength={TITLE_MAX} onChange={(e) => setTitleAr(e.target.value)} data-testid="start.title_ar" />
          </Field>
        </div>
        {idea && idea.photos.length > 0 && <MessagePresenter tone="info" message={tr('ws.team.tasks.start.ideaPhotos')} />}
        <StepFormFields
          kind={start}
          stepKey={form.stepKey}
          form={form}
          variant={variant}
          change={change}
          onChangeKind={(c) => {
            setChange(c);
            setIssues([]);
            setDraft((d) => startDraft(c, startForm('price_promo', { change: c }).fields, d, null));
          }}
          draft={draft}
          onDraft={setDraft}
          photos={photos}
          onPhotos={setPhotos}
          issues={issues}
          disabled={submit.isPending}
        />
        {issues.length > 0 && <MessagePresenter tone="refused" message={tr('ws.team.tasks.form.issuesSummary')} />}
        {submit.error && !(submit.error instanceof AppRpcError && submit.error.code === 'RECORD_INVALID' && issues.length > 0) && <ErrorText error={submit.error} />}
      </div>
    </Modal>
  );
}
