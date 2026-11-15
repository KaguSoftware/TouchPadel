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
import { formatDate, formatNumber, type MessageKey } from '@touch/i18n';
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
import { Field, Select, inputStyle } from '../../components/ui';
import { ReviewList, StepWizard, WizardChoice, WizardChoices, WizardNote, type WizardAt, type WizardStep } from '../../components/StepWizard';
import { invalidateProtocols, useOverview, useTargets, useTemplateDetail } from './api';
import { finalizeRecord } from './contextLogic';
import { protocolErrorKey } from './errors';
import { cleanRecord, initialValue, mintKey, type Obj } from './formModel';
import { PhotoField } from './PhotoField';
import { priceProposalPrefill, type TargetLink } from './priceTargets';
import { decidesStep, firstStepNeedsOk, isObj, startTemplateId, titlesInBoth } from './protocolLogic';
import { CARD, RecordForm, type FormEnv } from './StepForm';
import { PK } from './keys';
import { TournamentStartSheet } from '../tournaments/start/TournamentStartSheet';

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

type StartSheetProps = {
  kind: ProtocolKind;
  variant?: TournamentVariant | null;
  change?: PriceChangeKind | null;
  link?: TargetLink;
  ideaId?: string | null;
  /** The change kinds this person may start (`priceChangeKinds(role)`). */
  changeChoices: readonly PriceChangeKind[];
  onClose: () => void;
  onStarted: (runId: string) => void;
};

/** A tournament opens the section-menu sheet (tournaments/start); every other kind the generic form. */
export function StartSheet(props: StartSheetProps) {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  if (props.kind === 'tournament') {
    return (
      <TournamentStartSheet
        initialVariant={props.variant ?? null}
        byOwner={titlesInBoth(staff)}
        onClose={props.onClose}
        onStarted={(run) => {
          toast.ok(tr(run.auto ? 'ws.protocols.start.startedAuto' : 'ws.protocols.start.started'));
          void invalidateProtocols(qc);
          props.onStarted(run.run_id);
        }}
      />
    );
  }
  return <GenericStartSheet {...props} />;
}

function GenericStartSheet({
  kind,
  change: changeIn,
  link = {},
  ideaId,
  changeChoices,
  onClose,
  onStarted,
}: StartSheetProps) {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  // A tournament never reaches this sheet (it has its own), so there is no variant here.
  const variant: TournamentVariant | null = null;
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
  const submitterDecides = decidesStep(staff, firstNeedsOk ?? first?.needsOwnerOk ?? false);
  const both = titlesInBoth(staff);

  const targets = useTargets(kind === 'price_promo' ? change : null);
  const ideas = useQuery({
    queryKey: PK.options(`ideas:${ideaId ?? ''}`),
    enabled: kind === 'product_release' && Boolean(ideaId),
    queryFn: async () => readIdeas(await appRpc<unknown>('release_ideas_to_review', { p_venue_id: null })),
  });
  const idea = ideaId ? ideas.data?.find((i) => i.id === ideaId) ?? null : null;

  const [titleEn, setTitleEn] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [value, setValue] = useState<Obj>(() => initialValue(form.fields, kind === 'price_promo' && change ? { change } : null));
  const [photos, setPhotos] = useState<string[]>([]);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [key, setKey] = useState(() => mintKey('protocol.start'));
  const [at, setAt] = useState<WizardAt>(0);
  // Steps whose fields show their marks: one someone was stopped on, or all after a refused send.
  const [revealed, setRevealed] = useState<readonly string[]>([]);
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

  const env: FormEnv = useMemo(
    () => ({
      kind,
      stepKey: firstStepKey(kind),
      variant,
      change,
      targets: targets.data,
      changeChoices,
      submitterDecides,
      stepTitled: kind === 'product_release',
    }),
    [kind, variant, change, targets.data, changeChoices, submitterDecides],
  );

  const current = new Map<string, number | null>((targets.data?.items ?? []).flatMap((i) => i.sizes.map((s) => [s.variant_id, s.price_iqd] as const)));

  // A new item or a tournament left untitled takes the name it was given.
  const namesTitle = kind === 'product_release' || kind === 'tournament';

  /** What would be sent, and what is wrong with it right now. */
  function prepare() {
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
    return { record, en, ar, found };
  }
  const live = prepare();

  // Which fields live on which step. A new item's proposal is split in four;
  // every other kind's first step is one.
  const split = kind === 'product_release';
  const ITEM = ['name_en', 'name_ar', 'item_kind'];
  const groups: Record<string, readonly string[]> = split
    ? { item: ITEM, recipe: ['lines'], sizes: ['sizes'] }
    : {};
  const fieldsOf = (stepKey: string) => {
    const base = form.fields.filter((f) => f.name !== 'change');
    if (!split) return stepKey === 'details' ? base : [];
    if (stepKey === 'about') return base.filter((f) => !ITEM.includes(f.name) && f.name !== 'lines' && f.name !== 'sizes');
    // The kind is drawn as cards (below), not by the record form.
    return base.filter((f) => groups[stepKey]?.includes(f.name) && f.name !== 'item_kind');
  };
  const stepOfIssue = (field: string): string => {
    const root = field.split(/[.[]/)[0]!;
    if (field === 'title') return 'title';
    if (field === 'variant') return 'title';
    if (!split) return 'details';
    if (ITEM.includes(root)) return 'item';
    if (root === 'lines') return 'recipe';
    if (root === 'sizes') return 'sizes';
    return 'about';
  };
  const issuesFor = (stepKey: string) => live.found.filter((i) => stepOfIssue(i.field) === stepKey);
  const shownIssues = issues.length > 0 ? issues : live.found.filter((i) => revealed.includes(stepOfIssue(i.field)));
  const check = (stepKey: string) => (issuesFor(stepKey).length > 0 ? [tr('ws.protocols.form.checkMarked')] : []);

  async function start() {
    const { record, en, ar, found } = live;
    setIssues(found);
    if (found.length > 0) {
      const first = steps.find((s) => (s.problems?.length ?? 0) > 0);
      if (first) {
        setRevealed((r) => [...r, first.key]);
        setAt(steps.indexOf(first));
      }
      return;
    }
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
        const named = stepOfIssue(e.hint);
        const i = steps.findIndex((st) => st.key === named);
        if (i >= 0) setAt(i);
      }
    } finally {
      setBusy(false);
    }
  }

  const titleIssue = shownIssues.find((i) => i.field === 'title');
  const firstName = first ? tr(`ws.protocols.start.firstStep.${kind}` as MessageKey) : '';
  const list = (name: string) => (Array.isArray(live.record[name]) ? (live.record[name] as Obj[]) : []);
  const nameOf = (o: Obj) => [o.name_en, o.name_ar].find((n) => typeof n === 'string' && n.trim() !== '') as string | undefined;
  const itemName = [live.record.name_en, live.record.name_ar].find((n) => typeof n === 'string' && n.trim() !== '') as string | undefined;
  const titleShown = live.en || live.ar;
  const recordForm = (stepKey: string, quiet?: boolean) => {
    const fields = fieldsOf(stepKey);
    if (fields.length === 0 || (kind === 'price_promo' && !change)) return null;
    return <RecordForm fields={fields} value={value} onChange={setValue} issues={shownIssues} env={env} disabled={busy} quiet={quiet} />;
  };
  const kindIssue = shownIssues.find((i) => i.field === 'item_kind');
  const kindCards = (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
      <span style={{ fontWeight: 600 }}>
        {tr('ws.protocols.fields.item_kind')} <span aria-hidden="true" style={{ color: 'var(--tp-danger-fg)' }}>*</span>
      </span>
      <WizardChoices small label={tr('ws.protocols.fields.item_kind')}>
        {(['drink', 'dessert', 'food'] as const).map((k) => (
          <WizardChoice
            key={k}
            on={value.item_kind === k}
            title={tr(`work.item.kind.${k}` as MessageKey)}
            disabled={busy}
            onPick={() => setValue((prev) => ({ ...prev, item_kind: k }))}
            testId={`item-kind-${k}`}
          />
        ))}
      </WizardChoices>
      {kindIssue && (
        <span role="alert" style={{ color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}>
          {tr(`op.errors.${kindIssue.code}` as MessageKey)}
        </span>
      )}
    </div>
  );
  const photoField =
    form.photoFolder && form.photosMax > 0 ? (
      <PhotoField
        folder={form.photoFolder}
        paths={photos}
        onChange={setPhotos}
        min={form.photosMin}
        max={form.photosMax}
        disabled={busy}
        invalid={shownIssues.some((i) => i.field === 'photos')}
      />
    ) : null;
  const ideaBanner = (
    <>
      {idea && (
        <WizardNote>
          {tr('ws.protocols.start.fromIdea', {
            name: idea.author_name ?? '—',
            team: tr(`work.team.${idea.team === 'kitchen' ? 'kitchen' : 'bar'}`),
            date: idea.submitted_at ? formatDate(new Date(idea.submitted_at), locale) : '—',
          })}
        </WizardNote>
      )}
      {ideaId && ideas.isSuccess && !idea && <WizardNote tone="refused">{tr('ws.protocols.start.ideaGone')}</WizardNote>}
    </>
  );
  const decider =
    firstNeedsOk !== null && !submitterDecides ? (
      <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }} data-testid="start-decider">
        {tr('ws.protocols.start.goesToDecider')}
      </p>
    ) : null;

  const changeStep: WizardStep | null =
    kind === 'price_promo' && changeChoices.length > 1
      ? {
          key: 'change',
          label: tr('ws.protocols.fields.change'),
          note: change ? tr(`work.protocol.change.${change}`) : null,
          problems: change ? [] : [tr('ws.protocols.form.checkMarked')],
          content: (
            <>
              {ideaBanner}
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
            </>
          ),
        }
      : null;

  const titleStep: WizardStep = {
    key: 'title',
    label: tr('ws.protocols.start.titleLegend'),
    note: titleShown || null,
    problems: check('title'),
    flagged: shownIssues.some((i) => stepOfIssue(i.field) === 'title'),
    content: (
      <>
        <WizardNote>
          {tr(both ? 'ws.protocols.start.titleBoth' : 'ws.protocols.start.titleOne')}
          {namesTitle && ` ${tr('ws.protocols.start.titleFromName')}`}
        </WizardNote>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' }}>
          <Field label={tr('ws.protocols.start.titleEn')} required={both && !namesTitle} optional={!both || namesTitle} error={titleIssue ? tr(`op.errors.${titleIssue.code}` as MessageKey) : undefined}>
            <input style={inputStyle} dir="ltr" maxLength={140} value={titleEn} disabled={busy} onChange={(e) => setTitleEn(e.target.value)} data-testid="title-en" />
          </Field>
          <Field label={tr('ws.protocols.start.titleAr')} required={both && !namesTitle} optional={!both || namesTitle} error={titleIssue ? tr(`op.errors.${titleIssue.code}` as MessageKey) : undefined}>
            <input style={inputStyle} dir="rtl" maxLength={140} value={titleAr} disabled={busy} onChange={(e) => setTitleAr(e.target.value)} data-testid="title-ar" />
          </Field>
        </div>
      </>
    ),
  };

  const flag = (k: string) => shownIssues.some((i) => stepOfIssue(i.field) === k);
  const recordSteps: WizardStep[] = split
    ? [
        {
          key: 'item',
          label: tr('ws.protocols.start.wizard.stepItem'),
          note: itemName ?? null,
          problems: check('item'),
          flagged: flag('item'),
          content: (
            <>
              {ideaBanner}
              {kindCards}
              {recordForm('item')}
              {decider}
            </>
          ),
        },
        {
          key: 'recipe',
          label: tr('ws.protocols.fields.lines'),
          note: tr('ws.protocols.start.wizard.ingredients', { count: formatNumber(list('lines').length, locale) }),
          problems: check('recipe'),
          flagged: flag('recipe'),
          content: (
            <>
              {recordForm('recipe')}
            </>
          ),
        },
        {
          key: 'sizes',
          label: tr('ws.protocols.fields.sizes'),
          note: list('sizes').map(nameOf).filter(Boolean).join(tr('ws.protocols.view.listJoin')) || null,
          problems: check('sizes'),
          flagged: flag('sizes'),
          content: (
            <>
              {recordForm('sizes')}
            </>
          ),
        },
        {
          key: 'about',
          label: tr('ws.protocols.start.wizard.stepAbout'),
          problems: check('about'),
          flagged: flag('about'),
          content: (
            <>
              <div style={CARD}>{recordForm('about', true)}</div>
              {photoField && <div style={CARD}>{photoField}</div>}
            </>
          ),
        },
      ]
    : [
        {
          key: 'details',
          label: firstName,
          problems: check('details'),
          flagged: flag('details'),
          content: (
            <>
              {firstNeedsOk !== null && !submitterDecides && (
                <WizardNote testId="start-decider">{tr('ws.protocols.start.goesToDecider')}</WizardNote>
              )}
              {recordForm('details')}
              {photoField}
            </>
          ),
        },
      ];

  // A new item is named first, and its optional run title comes last; every
  // other kind opens with its title.
  const steps: WizardStep[] = [
    ...(changeStep ? [changeStep] : []),
    ...(namesTitle ? [...recordSteps, titleStep] : [titleStep, ...recordSteps]),
  ];

  const reviewRows = () => [
    ...(changeStep ? [{ label: tr('ws.protocols.fields.change'), value: change ? tr(`work.protocol.change.${change}`) : '—', step: 'change' }] : []),
    { label: tr('ws.protocols.start.titleLegend'), value: <bdi>{titleShown || '—'}</bdi>, step: 'title' },
    ...(split
      ? [
          { label: tr('ws.protocols.fields.name_en'), value: <bdi>{(live.record.name_en as string | undefined) || '—'}</bdi>, step: 'item' },
          { label: tr('ws.protocols.fields.name_ar'), value: <bdi>{(live.record.name_ar as string | undefined) || '—'}</bdi>, step: 'item' },
          {
            label: tr('ws.protocols.fields.item_kind'),
            value: typeof live.record.item_kind === 'string' ? tr(`work.item.kind.${live.record.item_kind}` as MessageKey) : '—',
            step: 'item',
          },
          { label: tr('ws.protocols.fields.lines'), value: tr('ws.protocols.start.wizard.ingredients', { count: formatNumber(list('lines').length, locale) }), step: 'recipe' },
          { label: tr('ws.protocols.fields.sizes'), value: <bdi>{list('sizes').map(nameOf).filter(Boolean).join(tr('ws.protocols.view.listJoin')) || '—'}</bdi>, step: 'sizes' },
          { label: tr('ws.protocols.fields.audience'), value: <bdi>{(live.record.audience as string | undefined) || '—'}</bdi>, step: 'about' },
        ]
      : [{ label: firstName, value: issuesFor('details').length === 0 ? tr('ws.protocols.start.wizard.filled') : '—', step: 'details' }]),
    ...(form.photosMax > 0
      ? [{ label: tr('ws.protocols.photos.label'), value: formatNumber(photos.length, locale), step: split ? 'about' : 'details' }]
      : []),
  ];

  return (
    <StepWizard
      title={tr('ws.protocols.start.title', { kind: tr(`work.protocol.kind.${kind}`) })}
      lead={tr(`ws.protocols.cards.lead.${kind}` as MessageKey)}
      steps={steps}
      at={at}
      onAtChange={setAt}
      onBlocked={(k) => setRevealed((r) => (r.includes(k) ? r : [...r, k]))}
      busy={busy}
      onClose={onClose}
      submitLabel={tr('work.protocol.action.start')}
      submitBlocked={templateLoading ? tr('ws.kit.async.loading') : null}
      onSubmit={() => void start()}
      testId="start-sheet"
      notice={
        error != null ? (
          <WizardNote tone="error">{tr(protocolErrorKey(error))}</WizardNote>
        ) : undefined
      }
      review={(goTo) => (
        <>
          <ReviewList goTo={goTo} busy={busy} rows={reviewRows()} />
          {firstNeedsOk !== null && !submitterDecides && (
            <WizardNote testId="start-decider">{tr('ws.protocols.start.goesToDecider')}</WizardNote>
          )}
        </>
      )}
    />
  );
}
