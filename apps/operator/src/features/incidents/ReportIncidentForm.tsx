/**
 * The incident report dialog (wave5-addendum-2026-09-25 §2.6, §5.2): what
 * happened, when, where (a court names which), what happened in words, who was
 * involved, and up to six photos. The desk and the till fill it in minutes
 * after something went wrong, often with the guest still there, so it asks in
 * the order a person tells it and nothing more.
 *
 * It is the tournament start's layout (TournamentStartSheet, the
 * .tp-tour-start* classes): a step menu on the side with a tick and the
 * answer on each finished step, the open step beside it, and a footer that
 * names the step before and after. The fourth step reviews the report, each
 * answer with a Change that opens its step, and Send lives there. A step is finished before the next one
 * opens: Next, or a later step in the menu, stays put on the first unfinished
 * step and shows what it is missing. Three steps: the kind (five cards in their
 * own colours), then what happened, who was involved and the photos, then
 * where and when (place and time as cards, the courts as chips, three quick
 * times and the picker behind "Pick a time"). Send checks everything and, when something
 * is missing, opens the step that holds it; a server refusal does the same.
 *
 * The privacy hint is the contract's sentence ("Write only what is needed. Do
 * not add phone numbers."): a report may name a guest, and it is kept a year.
 * Photos go to the `incidents` folder through the same upload the phone uses
 * (PhotoField), which the uploader and management may read.
 *
 * The idempotency key follows what is sent: a retry of the same report
 * reuses it, and an edit mints a new one. Once it is sent the dialog closes,
 * and the "Report sent" toast comes only when the exit has fully played.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate, formatNumber, formatTime, type MessageKey } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { fetchActiveCourts } from '../../lib/queries';
import { QK } from '../../lib/queryKeys';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { MessagePresenter } from '../../components/kit';
import { Icon } from '../../components/icons';
import { PhotoField } from '../tasks/PhotoField';
import { PhotoViewer, StaffPhotoThumb } from '../checklists/StaffPhoto';
import { refusalCode, refusalHint } from '../protocols/errors';
import { venueWallValue, wallValueToDate } from '../deductions/venueDate';
import { IK } from './api';
import {
  AHEAD_MS,
  BACK_MS,
  DESCRIPTION_MAX,
  DETAIL_MAX,
  INCIDENT_PLACES,
  KIND_LOOK,
  KIND_ORDER,
  PEOPLE_MAX,
  PHOTOS_MAX,
  QUICK_TIMES,
  FORM_STEPS,
  REPORT_STEPS,
  fieldsOfStep,
  reportArgs,
  reportRefusalField,
  stepDone,
  stepOfField,
  validateReport,
  type IncidentKind,
  type ReportDraft,
  type ReportField,
  type ReportIssueCode,
  type ReportStep,
  type WhenChoice,
} from './incidentsLogic';

const blankDraft = (): ReportDraft => ({
  kind: '',
  when: venueWallValue(),
  place: '',
  courtId: '',
  placeDetail: '',
  description: '',
  people: '',
  photos: [],
});

const ISSUE_KEY: Record<ReportIssueCode, MessageKey> = {
  required: 'ws.incidents.form.issue.required',
  whenRange: 'ws.incidents.form.issue.whenRange',
  tooLong: 'ws.incidents.form.issue.tooLong',
  tooMany: 'ws.incidents.form.issue.tooMany',
};

/** A missing required answer, said in its step's words; any other field keeps the generic line. */
const MISSING_KEY: Partial<Record<ReportField, MessageKey>> = {
  kind: 'ws.incidents.form.missing.kind',
  description: 'ws.incidents.form.missing.description',
  place: 'ws.incidents.form.missing.place',
  courtId: 'ws.incidents.form.missing.courtId',
  when: 'ws.incidents.form.missing.when',
};

const LIMIT: Partial<Record<ReportField, number>> = { description: DESCRIPTION_MAX, people: PEOPLE_MAX, placeDetail: DETAIL_MAX, photos: PHOTOS_MAX };

export function ReportIncidentDialog({ onClose }: { onClose: () => void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const headingId = useId();
  const [draft, setDraft] = useState<ReportDraft>(blankDraft);
  const [at, setAt] = useState<ReportStep>('kind');
  /**
   * The fields that were missing an answer when Next or Send was pressed. Only
   * these speak, and each falls silent once answered; a gap that opens later
   * (Court picked, no court yet) waits for the next press.
   */
  const [flagged, setFlagged] = useState<readonly ReportField[]>([]);
  const flag = (fields: readonly ReportField[]) => setFlagged((v) => [...new Set([...v, ...fields])]);
  const [whenChoice, setWhenChoice] = useState<WhenChoice>('now');
  const [viewingPhotos, setViewingPhotos] = useState(false);
  /** One key per report as sent: kept for a retry of it, renewed by an edit (claim_replay compares no payload). */
  const key = useRef<{ sig: string; key: string } | null>(null);
  /** The report went: the toast waits for the dialog to finish closing (Modal calls onClose after its exit). */
  const sent = useRef(false);
  const courtsQ = useQuery({ queryKey: QK.courts, queryFn: fetchActiveCourts, enabled: draft.place === 'court' });

  // The window's ends on the venue's clock, for the picker's bounds, taken
  // when the dialog opens; the server checks the same window against its own now.
  const [openedAt] = useState(() => Date.now());
  const bounds = useMemo(
    () => ({ min: venueWallValue(new Date(openedAt - BACK_MS)), max: venueWallValue(new Date(openedAt + AHEAD_MS)) }),
    [openedAt],
  );

  const occurredAt = wallValueToDate(draft.when);
  const issues = validateReport(draft, occurredAt, new Date());

  const send = useMutation({
    mutationFn: () => {
      const when = occurredAt ?? new Date();
      const sig = JSON.stringify(reportArgs(draft, when, ''));
      if (key.current?.sig !== sig) key.current = { sig, key: `incident.submit:${crypto.randomUUID()}` };
      return appRpc('submit_incident', reportArgs(draft, when, key.current.key));
    },
    onSuccess: () => {
      key.current = null;
      sent.current = true;
      void qc.invalidateQueries({ queryKey: IK.all });
    },
    onError: (e) => {
      // A refusal that names a field opens the step that holds it.
      const field = reportRefusalField(refusalCode(e), refusalHint(e));
      if (field) setAt(stepOfField(field));
    },
  });

  const serverField = reportRefusalField(refusalCode(send.error), refusalHint(send.error));
  const errorOf = (field: ReportField): string | undefined => {
    const issue = flagged.includes(field) ? issues.find((i) => i.field === field) : undefined;
    if (issue) return tr((issue.code === 'required' ? MISSING_KEY[field] : undefined) ?? ISSUE_KEY[issue.code], { limit: formatNumber(LIMIT[field] ?? 0, locale) });
    if (serverField === field && send.error) return tr(`ws.incidents.form.refused.${field}` as MessageKey);
    return undefined;
  };
  const set = (patch: Partial<ReportDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    if (send.isError) send.reset();
  };
  const busy = send.isPending;

  const pickWhen = (choice: WhenChoice) => {
    setWhenChoice(choice);
    const quick = QUICK_TIMES.find((q) => q.id === choice);
    if (quick) set({ when: venueWallValue(new Date(Date.now() - quick.minutes * 60_000)) });
  };
  const whenLabel = (choice: WhenChoice): string => {
    if (choice === 'now') return tr('ws.incidents.form.now');
    if (choice === 'm15') return tr('ws.incidents.form.minutesAgo', { count: formatNumber(15, locale) });
    if (choice === 'h1') return tr('ws.incidents.form.hourAgo');
    return tr('ws.incidents.form.pickTime');
  };

  const courtName = (id: string) => {
    const c = (courtsQ.data ?? []).find((x) => x.id === id);
    return c ? ((locale === 'ar' ? c.name_ar || c.name_en : c.name_en || c.name_ar) ?? '') : '';
  };
  const stepLabel = (s: ReportStep) => tr(`ws.incidents.form.steps.${s}`);
  const stepNote = (s: ReportStep): string => {
    if (s === 'kind') return draft.kind ? tr(`work.incident.kind.${draft.kind}`) : '';
    if (s === 'placeTime') {
      if (!draft.place) return '';
      const where = draft.place === 'court' && draft.courtId ? courtName(draft.courtId) : tr(`work.incident.place.${draft.place}`);
      return whenChoice === 'pick' ? where : `${where} · ${whenLabel(whenChoice)}`;
    }
    if (s === 'story') return draft.description.trim() ? tr('ws.incidents.form.written') : '';
    return '';
  };
  const whereText = () => {
    if (!draft.place) return '';
    const where = draft.place === 'court' && draft.courtId ? courtName(draft.courtId) : tr(`work.incident.place.${draft.place}`);
    return draft.placeDetail.trim() ? `${where} · ${draft.placeDetail.trim()}` : where;
  };
  /** When, as the review reads it: the date, then the time (a quick choice's moment, or the picked one). */
  const whenText = () => {
    const quick = QUICK_TIMES.find((q) => q.id === whenChoice);
    const at = quick ? new Date(openedAt - quick.minutes * 60_000) : occurredAt;
    return at ? `${formatDate(at, locale)} · ${formatTime(at, locale)}` : '—';
  };
  const done = (s: ReportStep) => stepDone(s, issues);
  // What the open step is missing, said once, in the box above the footer.
  const stepErrors = [...new Set(fieldsOfStep(at).map(errorOf).filter((m): m is string => m !== undefined))];
  // The progress counts the three steps that take answers; the review takes none.
  const doneCount = FORM_STEPS.filter(done).length;
  const idx = REPORT_STEPS.indexOf(at);
  const prev = REPORT_STEPS[idx - 1];
  const next = REPORT_STEPS[idx + 1];
  /** Back is always open; forward only past finished steps, else to the first unfinished one, with what it misses. */
  const goTo = (s: ReportStep) => {
    const blocker = REPORT_STEPS.slice(0, REPORT_STEPS.indexOf(s)).find((x) => !done(x));
    if (blocker === undefined) {
      setAt(s);
      return;
    }
    setAt(blocker);
    flag(issues.filter((i) => stepOfField(i.field) === blocker).map((i) => i.field));
  };

  return (
    <Modal
      title={tr('ws.incidents.form.title')}
      onClose={() => {
        onClose();
        // After the page has taken the dialog away (onClose comes at the end of
        // the exit, a moment before the unmount), so the toast never overlaps it.
        if (sent.current) setTimeout(() => toast.ok(tr('ws.incidents.form.sent')), 0);
      }}
      dismissible={!busy}
      size="xl"
      bare={(close) => (
        <form
          noValidate
          className="tp-tour-start"
          data-testid="incidents.form"
          onSubmit={(e) => {
            e.preventDefault();
            flag(issues.map((i) => i.field));
            const first = issues[0];
            if (first) {
              setAt(stepOfField(first.field));
              return;
            }
            if (occurredAt && !busy) send.mutate();
          }}
        >
          {/* Sent: close on the next render, once the dialog is dismissible again
              (it refuses a close while the send is in flight). */}
          {send.isSuccess && <CloseNow close={close} />}
          <aside className="tp-tour-start-side">
            <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', paddingInline: 'var(--tp-sp-3)', marginBlockEnd: 'var(--tp-sp-4)' }}>
              <h2 style={{ margin: 0, fontSize: 'var(--tp-fs-2xl)', fontWeight: 800 }}>{tr('ws.incidents.form.title')}</h2>
              <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.incidents.form.lead')}</p>
            </div>
            <nav aria-label={tr('ws.incidents.form.menu')} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-1)' }}>
              {REPORT_STEPS.map((s, i) => {
                const now = s === at;
                // Ticked only once passed: behind the open step and finished. The open
                // step, and any after it, show their number, even if filled before.
                const ok = i < idx && done(s);
                const warn = issues.some((i) => stepOfField(i.field) === s && flagged.includes(i.field));
                const note = stepNote(s);
                return (
                  <button key={s} type="button" className="tp-tour-start-nav" aria-current={now ? 'step' : undefined} onClick={() => goTo(s)} data-testid={`incidents.form.step.${s}`}>
                    <span
                      aria-hidden="true"
                      style={{
                        inlineSize: '1.75rem',
                        blockSize: '1.75rem',
                        flexShrink: 0,
                        borderRadius: 'var(--tp-radius-pill)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 'var(--tp-fs-xs)',
                        fontWeight: 800,
                        lineHeight: 1,
                        fontVariantNumeric: 'tabular-nums',
                        background: warn ? 'var(--tp-danger)' : ok ? 'var(--tp-accent-2)' : now ? 'var(--tp-accent-contrast)' : 'var(--tp-surface-3)',
                        color: warn ? 'var(--tp-danger-contrast)' : ok ? 'var(--tp-accent-2-contrast)' : now ? 'var(--tp-accent)' : 'var(--tp-muted-fg)',
                      }}
                    >
                      {warn ? '!' : ok ? <Icon name="check" size={14} strokeWidth={3} /> : formatNumber(i + 1, locale)}
                    </span>
                    <span style={{ flex: 1, minInlineSize: 0 }}>{stepLabel(s)}</span>
                    {warn ? (
                      <span style={{ fontSize: 'var(--tp-fs-xs)', color: now ? 'var(--tp-accent-contrast)' : 'var(--tp-danger-fg)', fontWeight: 600 }}>{tr('ws.incidents.form.needsLook')}</span>
                    ) : (
                      note && (
                        <bdi
                          style={{
                            fontSize: 'var(--tp-fs-xs)',
                            // White on the open step's blue row, grey elsewhere.
                            color: now ? 'var(--tp-accent-contrast)' : 'var(--tp-muted-fg)',
                            fontWeight: now ? 600 : 500,
                            maxInlineSize: '8rem',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {note}
                        </bdi>
                      )
                    )}
                  </button>
                );
              })}
            </nav>
          </aside>

          <div className="tp-tour-start-main">
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--tp-sp-4)', padding: 'var(--tp-sp-5) var(--tp-sp-6) 0' }}>
              <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', minInlineSize: 0 }}>
                <h3 id={headingId} style={{ margin: 0, fontSize: 'var(--tp-fs-3xl)', fontWeight: 700, lineHeight: 1.2 }}>
                  {stepLabel(at)}
                </h3>
                <span
                  style={{
                    fontSize: 'var(--tp-fs-sm)',
                    fontWeight: 700,
                    color: 'var(--tp-accent)',
                    // Capitals and tracking for Latin script only: they break Arabic's joins.
                    textTransform: locale === 'ar' ? undefined : 'uppercase',
                    letterSpacing: locale === 'ar' ? undefined : '0.06em',
                  }}
                >
                  {tr('ws.incidents.form.stepOf', { n: formatNumber(idx + 1, locale), total: formatNumber(REPORT_STEPS.length, locale) })}
                </span>
              </div>
              <Button
                size="lg"
                icon="x"
                style={{ inlineSize: '3rem', blockSize: '3rem', padding: 0, justifyContent: 'center', flexShrink: 0 }}
                aria-label={tr('common.close')}
                title={tr('common.close')}
                disabled={busy}
                onClick={close}
              />
            </header>

            <section aria-labelledby={headingId} style={{ flex: 1, minBlockSize: 0, overflowY: 'auto', padding: 'var(--tp-sp-5) var(--tp-sp-6)', display: 'grid', alignContent: 'start', gap: 'var(--tp-sp-2)' }}>
              {at === 'kind' && (
                // The step's heading names the cards; a label above them would say it twice.
                <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
                  <div role="group" aria-labelledby={headingId} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: 'var(--tp-sp-3)' }}>
                    {KIND_ORDER.map((k) => (
                      <KindCard key={k} kind={k} label={tr(`work.incident.kind.${k}`)} hint={tr(`ws.incidents.form.kindHint.${k}`)} pressed={draft.kind === k} disabled={busy} onClick={() => set({ kind: k })} />
                    ))}
                  </div>
                </div>
              )}

              {at === 'placeTime' && (
                <>
                  {/* Field's look by hand: the window ("Up to 7 days ago.") sits on the
                      label's line, at the end over the last card, not under the cards. */}
                  <div style={{ marginBlockEnd: 'var(--tp-sp-4)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--tp-sp-3)', marginBlockEnd: 'var(--tp-sp-2)' }}>
                      <span id={`${headingId}-when`} className="tp-req" style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: 'var(--tp-fg)' }}>
                        {tr('ws.incidents.form.when')}
                      </span>
                      <span id={`${headingId}-when-hint`} style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                        {tr('ws.incidents.form.whenHint')}
                      </span>
                    </div>
                    <div role="group" aria-labelledby={`${headingId}-when`} aria-describedby={`${headingId}-when-hint`} style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
                      <div style={cardRow}>
                        {([...QUICK_TIMES.map((q) => q.id), 'pick'] as const).map((c) => {
                          const quick = QUICK_TIMES.find((q) => q.id === c);
                          return (
                            <ChoiceCard key={c} pressed={whenChoice === c} disabled={busy} onClick={() => pickWhen(c)} testId={`incidents.form.when.${c}`}>
                              <strong>{whenLabel(c)}</strong>
                              {/* A quick time shows the clock time it means; "Pick a time" is just its word. */}
                              {quick && (
                                <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>
                                  {formatTime(new Date(openedAt - quick.minutes * 60_000), locale)}
                                </span>
                              )}
                            </ChoiceCard>
                          );
                        })}
                      </div>
                      {whenChoice === 'pick' && (
                        // The picker under its own label, so the box says what it is for.
                        <label style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', justifyItems: 'start', marginBlockStart: 'var(--tp-sp-1)' }}>
                          <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: 'var(--tp-fg)' }}>{tr('ws.incidents.form.pickTime')}</span>
                          <input
                            type="datetime-local"
                            value={draft.when}
                            min={bounds.min}
                            max={bounds.max}
                            disabled={busy}
                            onChange={(e) => set({ when: e.target.value })}
                            style={{ ...inputStyle, inlineSize: 'auto', minInlineSize: '14rem' }}
                            data-testid="incidents.form.when"
                          />
                        </label>
                      )}
                    </div>
                  </div>
                  <Field label={tr('ws.incidents.form.place')} required group>
                    <div role="group" style={cardRow}>
                      {INCIDENT_PLACES.map((p) => (
                        <ChoiceCard key={p} pressed={draft.place === p} disabled={busy} onClick={() => set({ place: p, courtId: p === 'court' ? draft.courtId : '' })}>
                          <strong>{tr(`work.incident.place.${p}`)}</strong>
                        </ChoiceCard>
                      ))}
                    </div>
                  </Field>
                  {draft.place === 'court' && (
                    <Field label={tr('ws.incidents.form.court')} required group>
                      <div role="group" style={cardRow}>
                        {courtsQ.isPending ? (
                          <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('common.loading')}</span>
                        ) : (
                          (courtsQ.data ?? []).map((c) => (
                            <ChoiceCard key={c.id} pressed={draft.courtId === c.id} disabled={busy} onClick={() => set({ courtId: c.id })}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
                                <Icon name="court" size={18} style={{ color: draft.courtId === c.id ? 'var(--tp-accent)' : 'var(--tp-muted-fg)', flexShrink: 0 }} />
                                <strong>
                                  <bdi>{(locale === 'ar' ? c.name_ar || c.name_en : c.name_en || c.name_ar) ?? ''}</bdi>
                                </strong>
                              </span>
                            </ChoiceCard>
                          ))
                        )}
                      </div>
                    </Field>
                  )}
                  {courtsQ.isError && <ErrorText error={courtsQ.error} />}
                  <Field label={tr('ws.incidents.form.placeDetail')} optional>
                    <input
                      value={draft.placeDetail}
                      maxLength={DETAIL_MAX}
                      dir="auto"
                      disabled={busy}
                      placeholder={tr('ws.incidents.form.placeDetailPlaceholder')}
                      onChange={(e) => set({ placeDetail: e.target.value })}
                      style={inputStyle}
                    />
                  </Field>
                </>
              )}

              {at === 'story' && (
                <>
                  {/* The contract's privacy line, once, above the fields it is about. */}
                  <p
                    style={{
                      display: 'flex',
                      gap: 'var(--tp-sp-2)',
                      alignItems: 'flex-start',
                      marginBlockEnd: 'var(--tp-sp-3)',
                      paddingBlock: 'var(--tp-sp-2)',
                      paddingInline: 'var(--tp-sp-3)',
                      borderRadius: 'var(--tp-radius-ctl)',
                      background: 'var(--tp-surface-2)',
                      fontSize: 'var(--tp-fs-sm)',
                    }}
                    data-testid="incidents.form.privacy"
                  >
                    <Icon name="shield" size={16} style={{ color: 'var(--tp-muted-fg)', marginBlockStart: '0.1rem' }} />
                    {tr('ws.incidents.form.privacyHint')}
                  </p>
                  <Field label={tr('ws.incidents.form.description')} required>
                    <GrowingTextarea
                      value={draft.description}
                      rows={4}
                      maxLength={DESCRIPTION_MAX}
                      dir="auto"
                      disabled={busy}
                      onChange={(e) => set({ description: e.target.value })}
                      data-testid="incidents.form.description"
                    />
                  </Field>
                  <Field label={tr('ws.incidents.form.people')} optional hint={tr('ws.incidents.form.peopleHint')}>
                    <GrowingTextarea
                      value={draft.people}
                      rows={2}
                      maxLength={PEOPLE_MAX}
                      dir="auto"
                      disabled={busy}
                      onChange={(e) => set({ people: e.target.value })}
                    />
                  </Field>
                  <PhotoField folder="incidents" paths={draft.photos} onChange={(photos) => set({ photos })} min={0} max={PHOTOS_MAX} disabled={busy} />
                </>
              )}

              {at === 'review' && (
                <>
                  <p style={{ margin: 0, marginBlockEnd: 'var(--tp-sp-2)', color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.incidents.form.reviewLead')}</p>
                  <dl style={{ margin: 0, borderRadius: 'var(--tp-radius-panel)', border: '1px solid var(--tp-border-strong)', background: 'var(--tp-surface)', overflow: 'hidden' }}>
                    {draft.kind && (
                      <ReviewRow label={tr('ws.incidents.form.kind')} onChange={() => setAt('kind')} busy={busy}>
                        {tr(`work.incident.kind.${draft.kind}`)}
                      </ReviewRow>
                    )}
                    <ReviewRow label={tr('ws.incidents.form.description')} onChange={() => setAt('story')} busy={busy}>
                      <span dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                        {draft.description.trim()}
                      </span>
                    </ReviewRow>
                    <ReviewRow label={tr('ws.incidents.form.people')} onChange={() => setAt('story')} busy={busy}>
                      <span dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                        {draft.people.trim() || '—'}
                      </span>
                    </ReviewRow>
                    {/* Where and when on one line, as the step asks them together. */}
                    <ReviewRow label={tr('ws.incidents.form.steps.placeTime')} onChange={() => setAt('placeTime')} busy={busy}>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        <bdi>{whereText()}</bdi> · {whenText()}
                      </span>
                    </ReviewRow>
                    <ReviewRow label={tr('ws.incidents.cols.photos')} onChange={() => setAt('story')} busy={busy} last>
                      {draft.photos.length > 0 ? (
                        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-2)' }}>
                          {draft.photos.map((p, i) => (
                            <StaffPhotoThumb key={p} path={p} label={tr('ws.incidents.sheet.photoAlt', { n: formatNumber(i + 1, locale) })} onClick={() => setViewingPhotos(true)} />
                          ))}
                        </span>
                      ) : (
                        '—'
                      )}
                    </ReviewRow>
                  </dl>
                  {viewingPhotos && draft.photos.length > 0 && (
                    <PhotoViewer title={tr('ws.incidents.sheet.photos', { count: formatNumber(draft.photos.length, locale) })} paths={draft.photos} onClose={() => setViewingPhotos(false)} />
                  )}
                </>
              )}

              {send.isError && serverField === null && <ErrorText error={send.error} />}
            </section>

            {/* One per step (keyed): a step's message never follows you to the next one. */}
            <StepMessage key={at} messages={stepErrors} step={at} />
          </div>

          {/* The bottom row: the progress beside the footer's buttons, on one line. */}
          <div className="tp-tour-start-sidefoot">
            <div style={{ padding: 'var(--tp-sp-3)', borderRadius: 'var(--tp-radius-panel)', background: 'var(--tp-surface)', border: '1px solid var(--tp-border)', display: 'grid', gap: 'var(--tp-sp-1-5)', fontSize: 'var(--tp-fs-sm)' }}>
              <strong>{tr('ws.incidents.form.progress', { done: formatNumber(doneCount, locale), total: formatNumber(FORM_STEPS.length, locale) })}</strong>
              <div style={{ blockSize: '0.375rem', borderRadius: 'var(--tp-radius-pill)', background: 'var(--tp-surface-3)', overflow: 'hidden' }}>
                <div style={{ blockSize: '100%', inlineSize: `${Math.round((doneCount / FORM_STEPS.length) * 100)}%`, background: 'var(--tp-accent-2)', transition: 'inline-size var(--tp-dur-base) var(--tp-ease-out)' }} />
              </div>
            </div>
          </div>

          <footer className="tp-tour-start-foot">
            {prev ? (
              <Button size="lg" icon="arrowStart" disabled={busy} onClick={() => setAt(prev)}>
                {stepLabel(prev)}
              </Button>
            ) : (
              <Button size="lg" disabled={busy} onClick={close}>
                {tr('common.cancel')}
              </Button>
            )}
            {/* One way on: the next step, and on the last step the report itself. */}
            {/* Two elements, keyed apart. One reused button turned into Send in the
                middle of Next's click (React re-renders before the browser acts on
                it), so the click then submitted the form and flagged the last step
                before anyone touched it. Next also cancels any default, to be sure. */}
            {next ? (
              <Button
                key="next"
                size="lg"
                kind="primary"
                iconEnd="arrowEnd"
                disabled={busy}
                onClick={(e) => {
                  e.preventDefault();
                  goTo(next);
                }}
                data-testid="incidents.form.next"
              >
                {stepLabel(next)}
              </Button>
            ) : (
              <Button key="send" size="lg" kind="primary" type="submit" icon="check" busy={busy} data-testid="incidents.form.submit">
                {tr('ws.incidents.form.submit')}
              </Button>
            )}
          </footer>
        </form>
      )}
    >
      {null}
    </Modal>
  );
}

/** Asks the dialog to close as soon as it is on screen. */
function CloseNow({ close }: { close: () => void }) {
  useEffect(() => {
    close();
  }, [close]);
  return null;
}

/** How long a leaving message waits for its animation before it goes anyway (reduced motion, a background tab). */
const MESSAGE_EXIT_FALLBACK_MS = 400;

/**
 * What the open step is missing, in one red box above the footer. It fades in
 * each time it says something new and fades out when there is nothing left to
 * say: the last messages stay up under [data-closing] (GlobalStyles' tpSink on
 * .tp-rise) until the animation ends.
 */
function StepMessage({ messages, step }: { messages: readonly string[]; step: ReportStep }) {
  const key = `${step}:${messages.join('|')}`;
  const [shown, setShown] = useState<{ key: string; messages: readonly string[] } | null>(null);
  // New messages replace what is up at once (adjusting state while rendering, not in an effect).
  if (messages.length > 0 && shown?.key !== key) setShown({ key, messages });
  const leaving = messages.length === 0 && shown !== null;

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setShown(null), MESSAGE_EXIT_FALLBACK_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  if (!shown) return null;
  return (
    <div data-closing={leaving ? 'true' : undefined} onAnimationEnd={leaving ? () => setShown(null) : undefined} style={{ paddingInline: 'var(--tp-sp-6)', paddingBlockEnd: 'var(--tp-sp-4)' }}>
      <MessagePresenter
        key={shown.key}
        rise
        tone="error"
        icon="info"
        message={
          <span style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
            {shown.messages.map((m) => (
              <span key={m}>{m}</span>
            ))}
          </span>
        }
        style={{ border: '1px solid var(--tp-danger-mark)', alignItems: 'center', paddingBlock: 'var(--tp-sp-2-5)' }}
      />
    </div>
  );
}

/**
 * A text box that grows with what is written, from `rows` lines up to a cap,
 * past which it scrolls; no resize handle. Measured after each change and when
 * the window resizes (wrapping changes with the width). Field's
 * aria-describedby and aria-invalid pass straight through.
 */
function GrowingTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { 'data-testid'?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.blockSize = 'auto';
    // scrollHeight leaves the border out; a layout-less renderer reports 0, and keeps `rows`.
    if (el.scrollHeight > 0) el.style.blockSize = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  };
  useLayoutEffect(fit, [props.value]);
  useEffect(() => {
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return <textarea ref={ref} {...props} style={{ ...inputStyle, resize: 'none', maxBlockSize: '18rem', overflowY: 'auto', fontFamily: 'inherit', lineHeight: 1.5 }} />;
}

/** One answer on the review: its label, what was given, and a Change that opens its step. */
function ReviewRow({ label, children, onChange, busy, last }: { label: string; children: ReactNode; onChange: () => void; busy?: boolean; last?: boolean }) {
  const { tr } = useLocale();
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '9rem minmax(0, 1fr) auto',
        gap: 'var(--tp-sp-3)',
        alignItems: 'center',
        paddingBlock: 'var(--tp-sp-3)',
        paddingInline: 'var(--tp-sp-4)',
        borderBlockEnd: last ? undefined : '1px solid var(--tp-border)',
      }}
    >
      <dt style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', fontWeight: 600 }}>{label}</dt>
      <dd style={{ margin: 0, fontWeight: 600, minInlineSize: 0 }}>{children}</dd>
      {/* Bordered, so it reads as a button beside the answer. */}
      <Button size="sm" disabled={busy} onClick={onChange} aria-label={tr('ws.incidents.form.changeLabel', { what: label })}>
        {tr('ws.incidents.form.change')}
      </Button>
    </div>
  );
}

/** A row of choice cards: as many to a row as fit. */
const cardRow = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(7.5rem, 1fr))', gap: 'var(--tp-sp-2)' } as const;

/** A place or a time as the tournament start's choice card (.tp-tour-choice). */
function ChoiceCard({ pressed, disabled, onClick, testId, children }: { pressed: boolean; disabled?: boolean; onClick: () => void; testId?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className="tp-tour-choice tp-incident-choice"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      style={{ rowGap: 'var(--tp-sp-1)', paddingBlock: pressed ? 'calc(var(--tp-sp-3) - 1px)' : 'var(--tp-sp-3)' }}
    >
      {children}
    </button>
  );
}

/** A kind as a choice card in its own colour: the word and its icon, the line under it. */
function KindCard({ kind, label, hint, pressed, disabled, onClick }: { kind: IncidentKind; label: string; hint: string; pressed: boolean; disabled?: boolean; onClick: () => void }) {
  const look = KIND_LOOK[kind];
  return (
    <button
      type="button"
      className="tp-tour-choice tp-incident-kind"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      data-testid={`incidents.form.kind.${kind}`}
      // Hovered and picked, the card takes its kind's colour, not the accent (GlobalStyles .tp-incident-kind).
      style={{ '--tp-kind-fg': look.fg, '--tp-kind-soft': look.soft } as CSSProperties}
    >
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--tp-sp-4)' }}>
        <strong style={{ fontSize: 'var(--tp-fs-lg)', lineHeight: 1.3 }}>{label}</strong>
        <KindIcon kind={kind} size="lg" />
      </span>
      <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{hint}</span>
    </button>
  );
}

/** The kind's icon on its tint; the page's report cards use it too. */
export function KindIcon({ kind, size = 'md' }: { kind: IncidentKind; size?: 'md' | 'lg' }) {
  const look = KIND_LOOK[kind];
  const box = size === 'lg' ? '2.75rem' : '2.25rem';
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'grid',
        placeItems: 'center',
        inlineSize: box,
        blockSize: box,
        flex: 'none',
        borderRadius: 'var(--tp-radius-panel)',
        background: look.soft,
        color: look.fg,
      }}
    >
      <Icon name={look.icon} size={size === 'lg' ? 22 : 18} />
    </span>
  );
}
