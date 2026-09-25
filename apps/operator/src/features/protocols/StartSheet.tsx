/**
 * Starting a protocol (build-contracts-2026-09-23 §2.7 `start_protocol`,
 * §2.8): a run's title, and its first step's record, sent together — a
 * release starts by sending its proposal, a tournament its plan, a hiring its
 * open position, a price or promo change its proposal. When the starter is
 * that step's decider, it passes at once (§2.7 "Automatic pass"), and the
 * sheet says so before they press Start. Who decides step 1 follows the
 * venue's template, which the run is snapshotted from, not the built-in
 * default: the owner may turn "Needs my OK" on or off there (§5.4 How it
 * works), so the sheet reads the template and says nothing until it has.
 *
 * Links in from other screens prefill it (§5.1, §5.5): `?variant=`, a price or
 * promo `?change=` with the target it named (`item`, `addon`, `promotion`,
 * `rule`), and a team idea (`?idea=`, role spec #65), whose record and photos
 * become the proposal and which the run is then started from (`p_data =
 * {idea_id}`).
 *
 * The same sheet serves /tasks: pass the change kinds that person may pick.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate, type MessageKey } from '@touch/i18n';
import {
  builtInStep,
  firstStepKey,
  startForm,
  validateStart,
  type FieldIssue,
  type PriceChangeKind,
  type ProtocolKind,
  type TournamentVariant,
} from '@touch/core/protocols';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { useAuth } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, Field, Modal, Select, inputStyle } from '../../components/ui';
import { MessagePresenter, SegmentedControl } from '../../components/kit';
import { invalidateProtocols, useOverview, useTargets, useTemplateDetail } from './api';
import { finalizeRecord } from './contextLogic';
import { protocolErrorKey } from './errors';
import { cleanRecord, initialValue, mintKey, type Obj } from './formModel';
import { PhotoField } from './PhotoField';
import { priceProposalPrefill, type TargetLink } from './priceTargets';
import { decidesStep, firstStepNeedsOk, isObj, startTemplateId, titlesInBoth } from './protocolLogic';
import { RecordForm, type FormEnv } from './StepForm';
import { PK } from './keys';

const TOURNAMENT_TYPES: TournamentVariant[] = ['type1', 'type2', 'type3'];

interface Idea {
  id: string;
  team: string;
  author_name: string | null;
  submitted_at: string;
  record: Obj;
  photos: string[];
}

function readIdeas(raw: unknown): Idea[] {
  const list = isObj(raw) && Array.isArray(raw.ideas) ? raw.ideas.filter(isObj) : [];
  return list
    .filter((i) => typeof i.id === 'string')
    .map((i) => ({
      id: i.id as string,
      team: typeof i.team === 'string' ? i.team : '',
      author_name: typeof i.author_name === 'string' ? i.author_name : null,
      submitted_at: typeof i.submitted_at === 'string' ? i.submitted_at : '',
      record: isObj(i.record) ? i.record : {},
      photos: Array.isArray(i.photos) ? i.photos.filter((p): p is string => typeof p === 'string') : [],
    }));
}

export function StartSheet({
  kind,
  variant: variantIn,
  change: changeIn,
  link = {},
  ideaId,
  changeChoices,
  onClose,
  onStarted,
}: {
  kind: ProtocolKind;
  variant?: TournamentVariant | null;
  change?: PriceChangeKind | null;
  link?: TargetLink;
  ideaId?: string | null;
  /** The change kinds this person may start (`priceChangeKinds(role)`). */
  changeChoices: readonly PriceChangeKind[];
  onClose: () => void;
  onStarted: (runId: string) => void;
}) {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [variant, setVariant] = useState<TournamentVariant | null>(kind === 'tournament' ? variantIn ?? 'type1' : null);
  const [change, setChange] = useState<PriceChangeKind | null>(
    kind === 'price_promo' ? (changeIn && changeChoices.includes(changeIn) ? changeIn : changeChoices[0] ?? null) : null,
  );
  const form = startForm(kind, { variant, change });
  const first = builtInStep(kind, firstStepKey(kind), variant);
  // Step 1's "Needs my OK" as the venue's template has it (null until read).
  const overview = useOverview();
  const templateId = startTemplateId(overview.data, kind, variant);
  const template = useTemplateDetail(templateId);
  const firstNeedsOk = firstStepNeedsOk(template.data, templateId, firstStepKey(kind));
  // Start waits for that read, so the form asks the decider's fields of the
  // right person; a failed read falls back to the built-in default.
  const templateLoading = templateId === null ? overview.isLoading : template.isLoading;
  const submitterDecides = decidesStep(staff?.role, firstNeedsOk ?? first?.needsOwnerOk ?? false);
  const both = titlesInBoth(staff?.role);

  const targets = useTargets(kind === 'price_promo' ? change : null);
  const ideas = useQuery({
    queryKey: PK.options(`ideas:${ideaId ?? ''}`),
    enabled: kind === 'product_release' && Boolean(ideaId),
    retry: false,
    queryFn: async () => readIdeas(await appRpc<unknown>('release_ideas_to_review', { p_venue_id: null })),
  });
  const idea = ideaId ? ideas.data?.find((i) => i.id === ideaId) ?? null : null;

  const [titleEn, setTitleEn] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [value, setValue] = useState<Obj>(() => initialValue(form.fields, kind === 'price_promo' && change ? { change } : null));
  const [photos, setPhotos] = useState<string[]>([]);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [key, setKey] = useState(() => mintKey('protocol.start'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // A price or promo start takes its target's figures once the targets load,
  // and again when the change kind is switched.
  const prefilledFor = useRef<string | null>(null);
  useEffect(() => {
    if (kind !== 'price_promo' || !change) return;
    const ready = change === 'promotion' || targets.data !== undefined;
    const tag = `${change}:${ready}`;
    if (!ready || prefilledFor.current === tag) return;
    prefilledFor.current = tag;
    const fields = startForm(kind, { change }).fields;
    setValue((prev) => initialValue(fields, { ...priceProposalPrefill(change, targets.data ?? { items: [], addons: [], promotions: [], rules: [], featured: null }, change === changeIn ? link : {}), reason: prev.reason ?? '', expected_effect: prev.expected_effect ?? '' }));
    setIssues([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, change, targets.data]);

  // A start from an idea takes its proposal and photos, once.
  const ideaApplied = useRef(false);
  useEffect(() => {
    if (!idea || ideaApplied.current) return;
    ideaApplied.current = true;
    setValue(initialValue(startForm(kind, {}).fields, idea.record));
    setPhotos(idea.photos);
  }, [idea, kind]);

  // A tournament type changes the plan's form (type 2 is the short one).
  function pickVariant(v: TournamentVariant) {
    setVariant(v);
    setValue((prev) => initialValue(startForm(kind, { variant: v }).fields, prev));
    setIssues([]);
  }

  const env: FormEnv = useMemo(
    () => ({
      kind,
      stepKey: firstStepKey(kind),
      variant,
      change,
      targets: targets.data,
      changeChoices,
      submitterDecides,
    }),
    [kind, variant, change, targets.data, changeChoices, submitterDecides],
  );

  const current = new Map<string, number | null>((targets.data?.items ?? []).flatMap((i) => i.sizes.map((s) => [s.variant_id, s.price_iqd] as const)));

  // A new item or a tournament left untitled takes the name it was given.
  const namesTitle = kind === 'product_release' || kind === 'tournament';

  async function start() {
    const record = finalizeRecord(kind, firstStepKey(kind), cleanRecord(form.fields, value), current);
    const fallback = (typed: string, name: unknown) => (typed.trim() !== '' ? typed.trim() : namesTitle && typeof name === 'string' ? name.trim() : '');
    const en = fallback(titleEn, record.name_en);
    const ar = fallback(titleAr, record.name_ar);
    const found = validateStart(
      { kind, variant, change, titleEn: en, titleAr: ar, record, byOwner: both },
      { photos: form.photosMax > 0 ? photos.length : undefined, submitterDecides },
      // A title left blank takes the name below, so a missing one is the name's
      // to say: "Write something first" under an optional box only confuses.
    ).filter((i) => !(namesTitle && i.field === 'title' && i.code === 'TEXT_REQUIRED'));
    setIssues(found);
    if (found.length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await appRpc<{ run_id: string; auto: boolean }>('start_protocol', {
        p_kind: kind,
        p_variant: variant,
        p_title_en: en === '' ? null : en,
        p_title_ar: ar === '' ? null : ar,
        p_data: idea ? { idea_id: idea.id } : {},
        p_first_record: record,
        p_photos: form.photosMax > 0 ? photos : [],
        p_venue_id: null,
        p_idempotency_key: key,
      });
      toast.ok(tr(res.auto ? 'ws.protocols.start.startedAuto' : 'ws.protocols.start.started'));
      setKey(mintKey('protocol.start'));
      await invalidateProtocols(qc);
      void qc.invalidateQueries({ queryKey: ['ideas'] });
      onStarted(res.run_id);
    } catch (e) {
      setError(e);
      if (e instanceof AppRpcError && e.hint && (e.code === 'RECORD_INVALID' || e.code === 'TEXT_TOO_LONG' || e.code === 'SPONSOR_DETAILS_REQUIRED')) {
        setIssues([{ field: e.hint, code: e.code as FieldIssue['code'] }]);
      }
    } finally {
      setBusy(false);
    }
  }

  const titleIssue = issues.find((i) => i.field === 'title');
  const firstName = first ? tr(`ws.protocols.start.firstStep.${kind}` as MessageKey) : '';

  return (
    <Modal
      title={tr('ws.protocols.start.title', { kind: tr(`work.protocol.kind.${kind}`) })}
      subtitle={tr(`ws.protocols.cards.lead.${kind}` as MessageKey)}
      onClose={onClose}
      dismissible={!busy}
      size="lg"
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button kind="primary" icon="play" busy={busy} disabled={templateLoading} onClick={() => void start()} data-testid="start-send">
            {tr('work.protocol.action.start')}
          </Button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }} data-testid="start-sheet">
        {idea && (
          <MessagePresenter
            tone="info"
            message={tr('ws.protocols.start.fromIdea', {
              name: idea.author_name ?? '—',
              team: tr(`work.team.${idea.team === 'kitchen' ? 'kitchen' : 'bar'}`),
              date: idea.submitted_at ? formatDate(new Date(idea.submitted_at), locale) : '—',
            })}
          />
        )}
        {ideaId && ideas.isSuccess && !idea && <MessagePresenter tone="refused" message={tr('ws.protocols.start.ideaGone')} />}

        {kind === 'tournament' && (
          <Field label={tr('ws.protocols.start.variant')} group>
            <SegmentedControl<TournamentVariant>
              value={variant ?? 'type1'}
              onChange={pickVariant}
              options={TOURNAMENT_TYPES.map((v) => ({ value: v, label: tr(`work.protocol.variant.${v}`) }))}
            />
          </Field>
        )}
        {kind === 'tournament' && variant && <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr(`ws.protocols.start.variantLead.${variant}` as MessageKey)}</p>}

        {kind === 'price_promo' && changeChoices.length > 1 && (
          <Field label={tr('ws.protocols.fields.change')} required>
            <Select<PriceChangeKind>
              value={change ?? ''}
              options={changeChoices.map((c) => ({ value: c, label: tr(`work.protocol.change.${c}`) }))}
              onChange={(c) => {
                setChange(c);
                prefilledFor.current = null;
              }}
            />
          </Field>
        )}

        <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
          <legend style={{ fontSize: 'var(--tp-fs-md)', fontWeight: 700, paddingInline: 0, marginBlockEnd: 'var(--tp-sp-1)' }}>{tr('ws.protocols.start.titleLegend')}</legend>
          <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
            {tr(both ? 'ws.protocols.start.titleBoth' : 'ws.protocols.start.titleOne')}
            {namesTitle && ` ${tr('ws.protocols.start.titleFromName')}`}
          </p>
          <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' }}>
            <Field label={tr('ws.protocols.start.titleEn')} required={both && !namesTitle} optional={!both || namesTitle} error={titleIssue ? tr(`op.errors.${titleIssue.code}` as MessageKey) : undefined}>
              <input style={inputStyle} dir="ltr" maxLength={140} value={titleEn} disabled={busy} onChange={(e) => setTitleEn(e.target.value)} data-testid="title-en" />
            </Field>
            <Field label={tr('ws.protocols.start.titleAr')} required={both && !namesTitle} optional={!both || namesTitle} error={titleIssue ? tr(`op.errors.${titleIssue.code}` as MessageKey) : undefined}>
              <input style={inputStyle} dir="rtl" maxLength={140} value={titleAr} disabled={busy} onChange={(e) => setTitleAr(e.target.value)} data-testid="title-ar" />
            </Field>
          </div>
        </fieldset>

        <section style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--tp-fs-md)', fontWeight: 700 }}>{firstName}</h3>
          {firstNeedsOk !== null && (
            <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }} data-testid="start-decider">
              {tr(submitterDecides ? 'ws.protocols.start.passesAtOnce' : 'ws.protocols.start.goesToDecider')}
            </p>
          )}
          {(kind !== 'price_promo' || change) && (
            <RecordForm fields={form.fields.filter((f) => f.name !== 'change')} value={value} onChange={setValue} issues={issues} env={env} disabled={busy} />
          )}
          {form.photoFolder && form.photosMax > 0 && (
            <PhotoField
              folder={form.photoFolder}
              paths={photos}
              onChange={setPhotos}
              min={form.photosMin}
              max={form.photosMax}
              disabled={busy}
              invalid={issues.some((i) => i.field === 'photos')}
            />
          )}
        </section>

        {issues.length > 0 && (
          <p role="alert" style={{ margin: 0, color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}>
            {tr('ws.protocols.form.checkMarked')}
          </p>
        )}
        {error != null && (
          <p role="alert" style={{ margin: 0, color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}>
            {tr(protocolErrorKey(error))}
          </p>
        )}
      </div>
    </Modal>
  );
}
