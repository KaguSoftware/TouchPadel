/**
 * "Start: Tournament" (2026-10-05 redesign, the "C + D" mix): a section menu
 * on the inline start (Type, Name, Courts and time, Players and money, Risks
 * and notes, Sponsor) with a tick on each finished one, and beside it the
 * section open: the three types as cards, a courts-by-hours timeline to pick
 * the slots, capacity as two cards.
 *
 * Both starts open it: the court desk's on /tasks and a manager's on
 * /protocols (each StartSheet hands a tournament here). It sends the same
 * `start_protocol` call and `tournament.plan` record the generic form did
 * (planModel.ts builds it, `validateStart` checks it first); the run's
 * titles are the names, which the generic form fell back to as well.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { wallTimeToUtc } from '@touch/core';
import {
  TOURNAMENT_VARIANTS,
  validateStart,
  type FieldIssue,
  type TournamentVariant,
} from '@touch/core/protocols';
import {
  asciiDigits,
  countPhrase,
  formatDate,
  formatTimeRange,
  type MessageKey,
} from '@touch/i18n';
import { AppRpcError, appRpc } from '../../../lib/appRpc';
import { useLocale } from '../../../lib/i18n';
import { pickName } from '../tournamentLogic';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../../components/ui';
import { MessagePresenter } from '../../../components/kit';
import { Icon } from '../../../components/icons';
import { InfoTip } from '../../../components/InfoTip';
import { DateTile } from '../TournamentParts';
import { useTradingNight, tonightInTz } from '../../desk/useTradingNight';
import { shiftIsoDate } from '../../desk/weekLogic';
import { BLOCKING_STATUSES, guestNameOf } from '../../desk/deskLogic';
import {
  cellKey,
  emptyPlan,
  hourColumns,
  isFullPlan,
  planProgress,
  planRecord,
  sectionDone,
  sectionOfIssue,
  planSections,
  slotsOf,
  type PlanClass,
  type PlanFormat,
  type PlanSection,
  type PlanSlot,
  type PlanState,
  type PlanUnit,
} from './planModel';

const F = 'ws.team.tasks.form.field';
const CLASSES: readonly PlanClass[] = ['A', 'B', 'C'];
/** The court rows the desk labels by kind; another kind is said as "Already booked" alone. */
const KINDS = ['booking', 'hold', 'maintenance', 'lesson'] as const;
/** A class pill's colour by how hard it is: advanced red, intermediate orange, beginners green. */
const CLASS_TONE: Record<PlanClass, PillTone> = { A: 'danger', B: 'warn', C: 'success' };
/** A type pill's colour: the club's own blue, community green, a sponsor's amber. */
const TYPE_TONE: Record<TournamentVariant, PillTone> = {
  type1: 'accent',
  type2: 'success',
  type3: 'warn',
};
/** A format pill's colour: green where the app runs it, grey where it is a plan only. */
const FORMAT_TONE: Record<PlanFormat, PillTone> = {
  americano: 'success',
  mexicano: 'success',
  knockout: 'neutral',
  league: 'neutral',
};
const FORMATS: readonly PlanFormat[] = ['americano', 'mexicano', 'knockout', 'league'];

export interface StartedRun {
  run_id: string;
  auto?: boolean;
}

export function TournamentStartSheet({
  initialVariant,
  byOwner = false,
  holdStart = false,
  onClose,
  onStarted,
}: {
  initialVariant?: TournamentVariant | null;
  /** The owner titles a run in both languages (`titlesInBoth`); the names do that here. */
  byOwner?: boolean;
  /** Start waits (the /protocols sheet reading the venue's template). */
  holdStart?: boolean;
  onClose: () => void;
  onStarted: (run: StartedRun) => void;
}) {
  const { tr, locale } = useLocale();
  const [plan, setPlan] = useState<PlanState>(() => emptyPlan(initialVariant ?? 'type1'));
  const [at, setAt] = useState<PlanSection>('type');
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // Minted when the sheet opens, kept for a retry, replaced after a start.
  const key = useRef(`protocol.start:${crypto.randomUUID()}`);

  const [day, setDay] = useState<string | null>(null);
  const night = useTradingNight(day ?? '2000-01-01');
  // The first day shown is tonight's trading date, once the hours are read.
  useEffect(() => {
    if (day === null && night.settingsQ.data) {
      setDay(tonightInTz(night.tz, night.settingsQ.data.opening_hours));
    }
  }, [day, night.settingsQ.data, night.tz]);

  const courtOrder = useMemo(() => night.courts.map((c) => c.id), [night.courts]);
  const courtName = (id: string) => {
    const c = night.courts.find((x) => x.id === id);
    return c ? pickName(locale, c.name_en, c.name_ar) : '—';
  };
  const full = isFullPlan(plan.variant);
  const set = (patch: Partial<PlanState>) => setPlan((p) => ({ ...p, ...patch }));
  const progress = planProgress(plan);
  const order = planSections(plan.variant);
  const idx = order.indexOf(at);
  const sectionLabel = (s: PlanSection) =>
    tr(
      s === 'players' && !full
        ? 'ws.tournaments.start.sections.playersShort'
        : s === 'notes' && !full
          ? 'ws.tournaments.start.sections.notesShort'
          : `ws.tournaments.start.sections.${s}`,
    );
  const flagged = new Set(issues.map(sectionOfIssue));
  const issueFor = (path: string) => {
    const i = issues.find((x) => x.field === path || x.field.startsWith(`${path}.`));
    return i ? tr(`op.errors.${i.code}` as MessageKey) : undefined;
  };

  async function start() {
    const record = planRecord(plan, night.tz, courtOrder);
    const found = validateStart({
      kind: 'tournament',
      variant: plan.variant,
      change: null,
      titleEn: plan.nameEn.trim(),
      titleAr: plan.nameAr.trim(),
      record,
      byOwner,
      // A title is the name: a missing one is the name's to say.
    }).filter((i) => i.field !== 'title');
    setIssues(found);
    if (found.length > 0) {
      setAt(sectionOfIssue(found[0]!));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await appRpc<StartedRun>('start_protocol', {
        p_kind: 'tournament',
        p_variant: plan.variant,
        p_title_en: plan.nameEn.trim() || null,
        p_title_ar: plan.nameAr.trim() || null,
        p_data: {},
        p_first_record: record,
        p_photos: [],
        p_venue_id: null,
        p_idempotency_key: key.current,
      });
      key.current = `protocol.start:${crypto.randomUUID()}`;
      onStarted(res);
    } catch (e) {
      setError(e);
      if (e instanceof AppRpcError && e.hint) {
        const issue: FieldIssue = {
          field: e.hint,
          code: (e.code === 'SPONSOR_DETAILS_REQUIRED' || e.code === 'TEXT_TOO_LONG'
            ? e.code
            : 'RECORD_INVALID') as FieldIssue['code'],
        };
        setIssues([issue]);
        setAt(sectionOfIssue(issue));
      }
    } finally {
      setBusy(false);
    }
  }

  const prev = order[idx - 1];
  const next = order[idx + 1];

  return (
    <Modal
      title={tr('ws.tournaments.start.title')}
      onClose={onClose}
      dismissible={!busy}
      size="xl"
      bare={(close) => (
        <div className="tp-tour-start" data-testid="tournament-start">
          <aside className="tp-tour-start-side">
            <div
              style={{
                display: 'grid',
                gap: 'var(--tp-sp-1)',
                paddingInline: 'var(--tp-sp-3)',
                marginBlockEnd: 'var(--tp-sp-4)',
              }}
            >
              <h2 style={{ margin: 0, fontSize: 'var(--tp-fs-2xl)', fontWeight: 800 }}>
                {tr('ws.tournaments.start.title')}
              </h2>
              <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                {tr('ws.tournaments.start.lead')}
              </p>
            </div>
            <nav
              aria-label={tr('ws.tournaments.start.menu')}
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-1)' }}
            >
              {order.map((s, i) => {
                const now = s === at;
                const done = sectionDone(plan, s);
                const warn = flagged.has(s);
                const note =
                  s === 'type'
                    ? tr(`ws.tournaments.start.typeName.${plan.variant}`)
                    : s === 'name' && plan.cls
                      ? [
                          plan.cls,
                          full && plan.format
                            ? tr(`ws.team.tasks.form.option.${plan.format}`)
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : s === 'courts' && plan.picks.length > 0
                        ? countPhrase(
                            'ws.tournaments.start.slots',
                            slotsOf(plan.picks).length,
                            locale,
                          )
                        : s === 'notes' && !done
                          ? tr('ws.tournaments.start.optional')
                          : '';
                return (
                  <button
                    key={s}
                    type="button"
                    className="tp-tour-start-nav"
                    aria-current={now ? 'step' : undefined}
                    onClick={() => setAt(s)}
                  >
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
                        // The row's line height would push the digit off centre.
                        lineHeight: 1,
                        fontVariantNumeric: 'tabular-nums',
                        background: warn
                          ? 'var(--tp-danger)'
                          : done
                            ? 'var(--tp-accent-2)'
                            : now
                              ? 'var(--tp-accent-contrast)'
                              : 'var(--tp-surface-3)',
                        color: warn
                          ? 'var(--tp-danger-contrast)'
                          : done
                            ? 'var(--tp-accent-2-contrast)'
                            : now
                              ? 'var(--tp-accent)'
                              : 'var(--tp-muted-fg)',
                      }}
                    >
                      {warn ? (
                        '!'
                      ) : done ? (
                        <Icon name="check" size={14} strokeWidth={3} />
                      ) : (
                        String(i + 1)
                      )}
                    </span>
                    <span style={{ flex: 1, minInlineSize: 0 }}>{sectionLabel(s)}</span>
                    {warn ? (
                      <span
                        style={{
                          fontSize: 'var(--tp-fs-xs)',
                          color: now ? 'var(--tp-accent-contrast)' : 'var(--tp-danger-fg)',
                          fontWeight: 600,
                        }}
                      >
                        {tr('ws.tournaments.start.needsLook')}
                      </span>
                    ) : (
                      note && (
                        <span
                          style={{
                            fontSize: 'var(--tp-fs-xs)',
                            // White on the open section's dark blue row, grey elsewhere.
                            color: now ? 'var(--tp-accent-contrast)' : 'var(--tp-muted-fg)',
                            fontWeight: now ? 600 : 500,
                          }}
                        >
                          {note}
                        </span>
                      )
                    )}
                  </button>
                );
              })}
            </nav>
          </aside>

          <div className="tp-tour-start-main">
            <header
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 'var(--tp-sp-4)',
                padding: 'var(--tp-sp-5) var(--tp-sp-6) 0',
              }}
            >
              <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', minInlineSize: 0 }}>
                <h3
                  id="tour-start-heading"
                  style={{
                    margin: 0,
                    fontSize: 'var(--tp-fs-3xl)',
                    fontWeight: 700,
                    lineHeight: 1.2,
                  }}
                >
                  {sectionLabel(at)}
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
                  {tr('ws.tournaments.start.sectionOf', {
                    n: String(idx + 1),
                    total: String(order.length),
                  })}
                </span>
              </div>
              <Button
                size="lg"
                icon="x"
                // A square box, as tall as the footer's buttons.
                style={{
                  inlineSize: '3rem',
                  blockSize: '3rem',
                  padding: 0,
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
                aria-label={tr('common.close')}
                title={tr('common.close')}
                disabled={busy}
                onClick={close}
              />
            </header>

            <section
              aria-labelledby="tour-start-heading"
              style={{
                flex: 1,
                minBlockSize: 0,
                overflowY: 'auto',
                padding: 'var(--tp-sp-5) var(--tp-sp-6)',
                gap: 'var(--tp-sp-4)',
                // Courts & time is a column whose picked slots take the room
                // left down to the footer; every other step stacks from the top.
                ...(at === 'courts'
                  ? { display: 'flex', flexDirection: 'column' }
                  : { display: 'grid', alignContent: 'start' }),
              }}
            >
              {at === 'type' && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))',
                    gap: 'var(--tp-sp-3)',
                  }}
                >
                  {TOURNAMENT_VARIANTS.map((v) => (
                    <ChoiceCard
                      key={v}
                      on={plan.variant === v}
                      title={tr(`ws.tournaments.start.typeName.${v}`)}
                      tag={tr(`ws.tournaments.start.typeTag.${v}`)}
                      tagTone={TYPE_TONE[v]}
                      body={tr(`ws.team.tasks.start.variantHint.${v}`)}
                      onPick={() => {
                        set({ variant: v });
                        setIssues([]);
                      }}
                    />
                  ))}
                </div>
              )}

              {at === 'name' && (
                <>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
                      gap: '0 var(--tp-sp-3)',
                    }}
                  >
                    <Field label={tr(`${F}.name_en`)} required error={issueFor('name_en')}>
                      <input
                        style={inputStyle}
                        dir="ltr"
                        value={plan.nameEn}
                        disabled={busy}
                        onChange={(e) => set({ nameEn: e.target.value })}
                      />
                    </Field>
                    <Field label={tr(`${F}.name_ar`)} required error={issueFor('name_ar')}>
                      <input
                        style={inputStyle}
                        dir="rtl"
                        lang="ar"
                        value={plan.nameAr}
                        disabled={busy}
                        onChange={(e) => set({ nameAr: e.target.value })}
                      />
                    </Field>
                  </div>
                  <Field label={tr(`${F}.class`)} group required error={issueFor('class')}>
                    <div role="radiogroup" className="tp-tour-choices">
                      {CLASSES.map((c) => (
                        <ChoiceCard
                          key={c}
                          radio
                          on={plan.cls === c}
                          title={tr(`ws.team.tasks.form.option.class${c}`)}
                          tag={tr(`ws.tournaments.start.classes.${c}.tag`)}
                          tagTone={CLASS_TONE[c]}
                          body={tr(`ws.tournaments.start.classes.${c}.body`)}
                          onPick={() => set({ cls: c })}
                        />
                      ))}
                    </div>
                  </Field>
                  {full && (
                    <Field label={tr(`${F}.format`)} group required error={issueFor('format')}>
                      <div role="radiogroup" className="tp-tour-choices" data-cols="2">
                        {FORMATS.map((f) => (
                          <ChoiceCard
                            key={f}
                            radio
                            on={plan.format === f}
                            title={tr(`ws.team.tasks.form.option.${f}`)}
                            tag={tr(`ws.tournaments.start.formats.${f}.tag`)}
                            tagTone={FORMAT_TONE[f]}
                            body={tr(`ws.tournaments.start.formats.${f}.body`)}
                            onPick={() => set({ format: f })}
                          />
                        ))}
                      </div>
                    </Field>
                  )}
                </>
              )}

              {at === 'courts' && (
                <CourtsSection
                  day={day}
                  setDay={setDay}
                  night={night}
                  picks={plan.picks}
                  onPicks={(picks) => set({ picks })}
                  courtName={courtName}
                  courtOrder={courtOrder}
                  error={issueFor('ranges')}
                  disabled={busy}
                />
              )}

              {at === 'players' && (
                <>
                  <Field label={tr(`${F}.capacityUnit`)} group required>
                    <div
                      role="radiogroup"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))',
                        gap: 'var(--tp-sp-3)',
                      }}
                    >
                      {(['players', 'pairs'] as const satisfies readonly PlanUnit[]).map((u) => (
                        <ChoiceCard
                          key={u}
                          radio
                          on={plan.unit === u}
                          title={tr(`ws.team.tasks.form.option.${u}`)}
                          body={tr(
                            u === 'players'
                              ? 'ws.tournaments.start.capacityPlayers'
                              : 'ws.tournaments.start.capacityPairs',
                          )}
                          onPick={() => set({ unit: u })}
                        />
                      ))}
                    </div>
                  </Field>
                  <Grid>
                    <NumberField
                      label={tr(`${F}.capacityCount`)}
                      required
                      value={plan.count}
                      onChange={(count) => set({ count })}
                      error={issueFor('capacity')}
                      disabled={busy}
                    />
                    {full && (
                      <NumberField
                        label={tr(`${F}.expected_entries`)}
                        value={plan.expected}
                        onChange={(expected) => set({ expected })}
                        error={issueFor('expected_entries')}
                        disabled={busy}
                      />
                    )}
                    {full && (
                      <NumberField
                        label={tr(`${F}.entry_fee_iqd`)}
                        value={plan.fee}
                        onChange={(fee) => set({ fee })}
                        error={issueFor('entry_fee_iqd')}
                        disabled={busy}
                      />
                    )}
                  </Grid>
                  {full && (
                    <Grid>
                      <Field label={tr(`${F}.prizeText`)} optional error={issueFor('prize.text')}>
                        <input
                          style={inputStyle}
                          value={plan.prizeText}
                          disabled={busy}
                          onChange={(e) => set({ prizeText: e.target.value })}
                        />
                      </Field>
                      <NumberField
                        label={tr(`${F}.prizeIqd`)}
                        value={plan.prizeIqd}
                        onChange={(prizeIqd) => set({ prizeIqd })}
                        error={issueFor('prize.iqd')}
                        disabled={busy}
                      />
                      <NumberField
                        label={tr(`${F}.budget_iqd`)}
                        value={plan.budget}
                        onChange={(budget) => set({ budget })}
                        error={issueFor('budget_iqd')}
                        disabled={busy}
                      />
                    </Grid>
                  )}
                </>
              )}

              {at === 'notes' && (
                <>
                  {full && (
                    <Field label={tr(`${F}.risks`)} optional error={issueFor('risks')}>
                      <textarea
                        style={{ ...inputStyle, minBlockSize: '6rem', resize: 'none' }}
                        value={plan.risks}
                        disabled={busy}
                        onChange={(e) => set({ risks: e.target.value })}
                      />
                    </Field>
                  )}
                  <Field label={tr(`${F}.notes`)} optional error={issueFor('notes')}>
                    <textarea
                      style={{ ...inputStyle, minBlockSize: '6rem', resize: 'none' }}
                      value={plan.notes}
                      disabled={busy}
                      onChange={(e) => set({ notes: e.target.value })}
                    />
                  </Field>
                </>
              )}

              {at === 'sponsor' && plan.variant === 'type3' && (
                <>
                  {issueFor('sponsor') && (
                    <MessagePresenter tone="refused" message={issueFor('sponsor')!} />
                  )}
                  <Grid>
                    <Field label={tr(`${F}.sponsorName`)} required error={issueFor('sponsor.name')}>
                      <input
                        style={inputStyle}
                        value={plan.sponsor.name}
                        disabled={busy}
                        onChange={(e) =>
                          set({ sponsor: { ...plan.sponsor, name: e.target.value } })
                        }
                      />
                    </Field>
                    <Field label={tr(`${F}.contact`)} required error={issueFor('sponsor.contact')}>
                      <input
                        style={inputStyle}
                        value={plan.sponsor.contact}
                        disabled={busy}
                        onChange={(e) =>
                          set({ sponsor: { ...plan.sponsor, contact: e.target.value } })
                        }
                      />
                    </Field>
                    <NumberField
                      label={tr(`${F}.contribution_iqd`)}
                      required
                      value={plan.sponsor.contribution}
                      onChange={(contribution) =>
                        set({ sponsor: { ...plan.sponsor, contribution } })
                      }
                      error={issueFor('sponsor.contribution_iqd')}
                      disabled={busy}
                    />
                  </Grid>
                  <Field label={tr(`${F}.branding`)} optional error={issueFor('sponsor.branding')}>
                    <textarea
                      style={{ ...inputStyle, minBlockSize: '5rem', resize: 'none' }}
                      value={plan.sponsor.branding}
                      disabled={busy}
                      onChange={(e) =>
                        set({ sponsor: { ...plan.sponsor, branding: e.target.value } })
                      }
                    />
                  </Field>
                  <label style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={plan.sponsor.invoice}
                      disabled={busy}
                      onChange={(e) =>
                        set({ sponsor: { ...plan.sponsor, invoice: e.target.checked } })
                      }
                    />
                    {tr(`${F}.invoice`)}
                  </label>
                </>
              )}

              {issues.length > 0 && (
                <MessagePresenter tone="refused" message={tr('ws.tournaments.start.issues')} />
              )}
              {error != null && !(error instanceof AppRpcError && error.hint) && (
                <ErrorText error={error} />
              )}
            </section>
          </div>

          {/* The bottom row: the progress beside the footer's buttons, on one line. */}
          <div className="tp-tour-start-sidefoot">
            <div
              style={{
                padding: 'var(--tp-sp-3)',
                borderRadius: 'var(--tp-radius-panel)',
                background: 'var(--tp-surface)',
                border: '1px solid var(--tp-border)',
                display: 'grid',
                gap: 'var(--tp-sp-1-5)',
                fontSize: 'var(--tp-fs-sm)',
              }}
            >
              <strong>
                {tr('ws.tournaments.start.progress', {
                  done: String(progress.done),
                  total: String(progress.total),
                })}
              </strong>
              <div
                style={{
                  blockSize: '0.375rem',
                  borderRadius: 'var(--tp-radius-pill)',
                  background: 'var(--tp-surface-3)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    blockSize: '100%',
                    inlineSize: `${Math.round((progress.done / progress.total) * 100)}%`,
                    background: 'var(--tp-accent-2)',
                  }}
                />
              </div>
            </div>
          </div>

          <footer className="tp-tour-start-foot">
            {prev ? (
              <Button size="lg" icon="arrowStart" disabled={busy} onClick={() => setAt(prev)}>
                {sectionLabel(prev)}
              </Button>
            ) : (
              <Button size="lg" disabled={busy} onClick={close}>
                {tr('common.cancel')}
              </Button>
            )}
            {/* One way on: the next step, and on the last step the start itself. */}
            {next ? (
              <Button
                size="lg"
                kind="primary"
                iconEnd="arrowEnd"
                disabled={busy}
                onClick={() => setAt(next)}
              >
                {sectionLabel(next)}
              </Button>
            ) : (
              <Button
                size="lg"
                kind="primary"
                busy={busy}
                disabled={holdStart}
                onClick={() => void start()}
                data-testid="tournament-start-send"
              >
                {tr('ws.tournaments.start.submit')}
              </Button>
            )}
          </footer>
        </div>
      )}
    >
      {null}
    </Modal>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))',
        gap: '0 var(--tp-sp-3)',
      }}
    >
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  error,
  required,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <Field label={label} required={required} optional={!required} error={error}>
      <input
        style={inputStyle}
        inputMode="numeric"
        dir="ltr"
        value={value}
        disabled={disabled}
        // An Arabic keyboard's digits (١٥) fold to ASCII before the filter.
        onChange={(e) =>
          onChange(
            asciiDigits(e.target.value)
              .replace(/[^\d,]/g, '')
              .slice(0, 12),
          )
        }
      />
    </Field>
  );
}

/** A big choice: the type cards and the capacity unit. */
type PillTone = 'accent' | 'success' | 'warn' | 'danger' | 'neutral';

/** A pill's soft ground and its text, from the operator's status tokens (blue mode has each). */
const PILL: Record<PillTone, { bg: string; fg: string }> = {
  accent: { bg: 'var(--tp-accent-soft)', fg: 'var(--tp-accent-soft-fg)' },
  success: { bg: 'var(--tp-success-soft)', fg: 'var(--tp-success-fg)' },
  warn: { bg: 'var(--tp-warn-soft)', fg: 'var(--tp-warn-fg)' },
  danger: { bg: 'var(--tp-danger-soft)', fg: 'var(--tp-danger-fg)' },
  neutral: { bg: 'var(--tp-neutral-soft)', fg: 'var(--tp-neutral-fg)' },
};

function ChoiceCard({
  on,
  title,
  tag,
  tagTone,
  body,
  radio,
  onPick,
}: {
  on: boolean;
  title: string;
  tag?: string;
  /** A pill that keeps its own colour, selected or not (a type, class or format's tone). */
  tagTone?: PillTone;
  body: string;
  radio?: boolean;
  onPick: () => void;
}) {
  // A selected card is tinted light blue itself: a blue pill on it goes solid to stay seen.
  const pill = tagTone
    ? on && tagTone === 'accent'
      ? { bg: 'var(--tp-accent)', fg: 'var(--tp-accent-contrast)' }
      : PILL[tagTone]
    : null;
  return (
    <button
      type="button"
      role={radio ? 'radio' : undefined}
      aria-checked={radio ? on : undefined}
      aria-pressed={radio ? undefined : on}
      className="tp-tour-choice"
      // Its rows (title with its pill, description) sit on the row tracks of
      // the cards around it, so each starts at the same height on every card.
      style={{ gridRow: 'span 2', gridTemplateRows: 'subgrid' }}
      onClick={onPick}
    >
      {/* The name at the start of the line, its pill at the end. */}
      <span
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--tp-sp-4)',
        }}
      >
        <strong style={{ fontSize: 'var(--tp-fs-lg)', lineHeight: 1.3 }}>{title}</strong>
        {tag && (
          <span
            style={{
              // Text centred in the pill: no inherited line height, even padding.
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
              fontSize: 'var(--tp-fs-xs)',
              fontWeight: 700,
              padding: 'var(--tp-sp-1-5) var(--tp-sp-2-5)',
              borderRadius: 'var(--tp-radius-pill)',
              whiteSpace: 'nowrap',
              background: pill ? pill.bg : on ? 'var(--tp-accent)' : 'var(--tp-surface-2)',
              color: pill ? pill.fg : on ? 'var(--tp-accent-contrast)' : 'var(--tp-fg)',
            }}
          >
            {tag}
          </span>
        )}
      </span>
      <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', lineHeight: 1.5 }}>
        {body}
      </span>
    </button>
  );
}

/**
 * The courts-by-hours timeline for one day: press on an hour and drag across
 * to pick (or, starting on a picked hour, to clear); a booked hour cannot be
 * picked. The keyboard toggles one hour at a time. The picks of every day
 * show underneath as slots that can be taken off.
 */
function CourtsSection({
  day,
  setDay,
  night,
  picks,
  onPicks,
  courtName,
  courtOrder,
  error,
  disabled,
}: {
  day: string | null;
  setDay: (d: string) => void;
  night: ReturnType<typeof useTradingNight>;
  picks: readonly string[];
  onPicks: (p: string[]) => void;
  courtName: (id: string) => string;
  courtOrder: readonly string[];
  error?: string;
  disabled?: boolean;
}) {
  const { tr, locale } = useLocale();
  const drag = useRef<{ add: boolean } | null>(null);
  const picked = useMemo(() => new Set(picks), [picks]);
  const columns = day ? hourColumns(night.openMin, night.closeMin) : [];
  const tz = night.tz;

  // A booked court-hour, and why: each booking that blocks the court over the
  // hour, as its kind, who it is for (a court block: its reason) and when.
  const booked = useMemo(() => {
    const out = new Map<string, BookedWhy[]>();
    if (!day) return out;
    for (const r of night.reservations) {
      if (!BLOCKING_STATUSES.has(r.status)) continue;
      const s = Date.parse(r.start_at);
      const e = Date.parse(r.end_at);
      const who = r.kind === 'maintenance' ? r.notes?.trim() || null : guestNameOf(r);
      const kind = (KINDS as readonly string[]).includes(r.kind)
        ? tr(`ws.courtDesk.detail.kindLabel.${r.kind}`)
        : null;
      const why: BookedWhy = {
        what: [kind, who].filter(Boolean).join(' · '),
        when: formatTimeRange(new Date(s), new Date(e), locale, tz),
      };
      for (const m of columns) {
        const from = wallTimeToUtc(day, m, tz).getTime();
        const key = `${r.court_id}|${m}`;
        if (s < from + 3_600_000 && e > from) out.set(key, [...(out.get(key) ?? []), why]);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [night.reservations, day, tz, locale, columns.join(',')]);

  useEffect(() => {
    const end = () => {
      drag.current = null;
    };
    window.addEventListener('pointerup', end);
    return () => window.removeEventListener('pointerup', end);
  }, []);

  function apply(k: string, add: boolean) {
    const has = picked.has(k);
    if (add === has) return;
    onPicks(add ? [...picks, k] : picks.filter((x) => x !== k));
  }

  // The hour alone ("18"): a full "18:00" crowds a square's width.
  const hourLabel = (m: number) => String(Math.floor(m / 60) % 24).padStart(2, '0');
  const slots = slotsOf(picks, courtOrder);
  const slotText = (s: PlanSlot) =>
    `${formatDate(wallTimeToUtc(s.date, 720, tz), locale, tz)} · ${formatTimeRange(
      wallTimeToUtc(s.date, s.startMin, tz),
      wallTimeToUtc(s.date, s.endMin, tz),
      locale,
      tz,
    )} · ${s.courtIds.map(courtName).join(locale === 'ar' ? '، ' : ', ')}`;

  return (
    <>
      <div
        style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <Button
          icon="chevronStart"
          aria-label={tr('ws.tournaments.start.courts.prevDay')}
          title={tr('ws.tournaments.start.courts.prevDay')}
          disabled={!day || disabled}
          onClick={() => day && setDay(shiftIsoDate(day, -1))}
        />
        <input
          type="date"
          aria-label={tr('ws.tournaments.start.courts.day')}
          style={{ ...inputStyle, inlineSize: 'auto' }}
          value={day ?? ''}
          disabled={disabled}
          onChange={(e) => e.target.value && setDay(e.target.value)}
        />
        <Button
          icon="chevronEnd"
          aria-label={tr('ws.tournaments.start.courts.nextDay')}
          title={tr('ws.tournaments.start.courts.nextDay')}
          disabled={!day || disabled}
          onClick={() => day && setDay(shiftIsoDate(day, 1))}
        />
      </div>

      {/* How to use the timetable and its legend, on one line under the day
          picker and above the table. */}
      <div
        style={{ display: 'flex', gap: 'var(--tp-sp-3)', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          {tr('ws.tournaments.start.courts.hint')}
        </p>
        <span
          style={{
            marginInlineStart: 'auto',
            display: 'flex',
            gap: 'var(--tp-sp-3)',
            fontSize: 'var(--tp-fs-xs)',
            color: 'var(--tp-muted-fg)',
            alignItems: 'center',
          }}
        >
          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)', alignItems: 'center' }}>
            <span
              className="tp-tour-cell"
              data-on="true"
              style={{ inlineSize: '0.875rem', blockSize: '0.875rem' }}
            />
            {tr('ws.tournaments.start.courts.picked')}
          </span>
          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)', alignItems: 'center' }}>
            <span
              className="tp-tour-cell"
              data-booked="true"
              style={{ inlineSize: '0.875rem', blockSize: '0.875rem' }}
            />
            {tr('ws.tournaments.start.courts.booked')}
          </span>
        </span>
      </div>

      {day === null || night.courtsQ.isLoading ? (
        <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>
          {tr('ws.tournaments.start.courts.loading')}
        </p>
      ) : night.closed || columns.length === 0 ? (
        <MessagePresenter tone="info" message={tr('ws.tournaments.start.courts.closed')} />
      ) : (
        // Squares like a contribution graph: the hours across the top, the
        // courts down the side, one rounded square per court-hour
        // (.tp-tour-tt in components/GlobalStyles.tsx).
        <div className="tp-tour-tt">
          <div
            role="grid"
            aria-label={tr('ws.tournaments.start.sections.courts')}
            className="tp-tour-tt-grid"
            style={{
              gridTemplateColumns: `auto repeat(${columns.length}, minmax(0, 1fr))`,
            }}
          >
            <span role="presentation" className="tp-tour-tt-corner" />
            {columns.map((m) => (
              <span key={m} role="columnheader" className="tp-tour-tt-hour" dir="ltr">
                {hourLabel(m)}
              </span>
            ))}
            <span role="presentation" className="tp-tour-tt-pad" data-side="" />
            <span role="presentation" className="tp-tour-tt-pad" data-fill="" />
            {night.courts.map((c) => (
              <div key={c.id} role="row" style={{ display: 'contents' }}>
                <span role="rowheader" className="tp-tour-tt-court">
                  {pickName(locale, c.name_en, c.name_ar)}
                </span>
                {columns.map((m) => {
                  const k = cellKey(day, c.id, m);
                  const on = picked.has(k);
                  const reasons = booked.get(`${c.id}|${m}`);
                  const busy = reasons !== undefined;
                  const why = reasons
                    ?.map((r) => [r.what, r.when].filter(Boolean).join(' · '))
                    .join('; ');
                  const label = tr('ws.tournaments.start.courts.cell', {
                    court: pickName(locale, c.name_en, c.name_ar),
                    time: formatTimeRange(
                      wallTimeToUtc(day, m, tz),
                      wallTimeToUtc(day, m + 60, tz),
                      locale,
                      tz,
                    ),
                  });
                  const cell = (
                    <button
                      key={m}
                      type="button"
                      role="gridcell"
                      className="tp-tour-tt-cell"
                      data-on={on || undefined}
                      data-booked={busy || undefined}
                      aria-selected={on}
                      // A booked hour says why in the kit's hover card (InfoTip),
                      // so it stays hoverable and focusable: aria-disabled and
                      // no-op handlers rather than `disabled`.
                      aria-label={
                        busy
                          ? `${label} · ${tr('ws.tournaments.start.courts.booked')} · ${why}`
                          : label
                      }
                      title={busy ? undefined : label}
                      aria-disabled={busy || undefined}
                      disabled={disabled}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        if (busy) return;
                        drag.current = { add: !on };
                        apply(k, !on);
                      }}
                      onPointerEnter={() => {
                        if (drag.current && !busy) apply(k, drag.current.add);
                      }}
                      onClick={(e) => {
                        // A pointer press already toggled; the keyboard's Enter or Space lands here.
                        if (e.detail === 0 && !busy) apply(k, !on);
                      }}
                    />
                  );
                  return reasons ? (
                    <InfoTip key={m} content={<BookedCard reasons={reasons} />}>
                      {cell}
                    </InfoTip>
                  ) : (
                    cell
                  );
                })}
              </div>
            ))}
            <span role="presentation" className="tp-tour-tt-pad" data-side="" />
            <span role="presentation" className="tp-tour-tt-pad" data-fill="" />
          </div>
        </div>
      )}
      {error && (
        <p
          role="alert"
          style={{ margin: 0, color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}
        >
          {error}
        </p>
      )}

      {/* Fills the step's remaining height; its list scrolls only when the cards do not fit. */}
      <div
        style={{
          flex: '1 1 auto',
          minBlockSize: '8rem',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--tp-sp-2)',
        }}
      >
        <strong style={{ fontSize: 'var(--tp-fs-md)' }}>
          {tr('ws.tournaments.start.courts.slots')}
        </strong>
        {slots.length === 0 ? (
          <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
            {tr('ws.tournaments.start.courts.none')}
          </span>
        ) : (
          // Each slot a blue card, like a chosen choice card: its day as the
          // list's date tile, the hours large, its courts as pills. The card
          // opens its day on the timeline; the × takes the slot off.
          <ul className="tp-tour-slots">
            {slots.map((s) => {
              const text = slotText(s);
              return (
                <li
                  key={`${s.date}|${s.startMin}|${s.endMin}|${s.courtIds.join(',')}`}
                  className="tp-tour-slot"
                >
                  <button
                    type="button"
                    className="tp-tour-slot-open"
                    onClick={() => setDay(s.date)}
                    aria-label={text}
                  >
                    <DateTile
                      at={wallTimeToUtc(s.date, 720, tz).toISOString()}
                      tz={tz}
                      status="open"
                      size="sm"
                    />
                    <span style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', minInlineSize: 0 }}>
                      <span
                        style={{ fontSize: 'var(--tp-fs-md)', fontWeight: 700, lineHeight: 1.25 }}
                      >
                        {formatTimeRange(
                          wallTimeToUtc(s.date, s.startMin, tz),
                          wallTimeToUtc(s.date, s.endMin, tz),
                          locale,
                          tz,
                        )}
                      </span>
                      <span style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
                        {s.courtIds.map((id) => (
                          <span key={id} className="tp-tour-slot-court">
                            {courtName(id)}
                          </span>
                        ))}
                      </span>
                    </span>
                  </button>
                  <Button
                    size="sm"
                    kind="ghost"
                    icon="x"
                    aria-label={tr('ws.tournaments.start.courts.remove', { slot: text })}
                    title={tr('ws.tournaments.start.courts.remove', { slot: text })}
                    disabled={disabled}
                    onClick={() => onPicks(picks.filter((k) => !s.keys.includes(k)))}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

interface BookedWhy {
  /** The booking's kind and who it is for ("Booking · Sara K."), a block's reason. */
  what: string;
  /** When it holds the court. */
  when: string;
}

/** The hover card on a booked hour: what holds the court, for whom and when. */
function BookedCard({ reasons }: { reasons: readonly BookedWhy[] }) {
  const { tr } = useLocale();
  return (
    <span style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
      <strong style={{ fontSize: 'var(--tp-fs-sm)' }}>
        {tr('ws.tournaments.start.courts.booked')}
      </strong>
      {reasons.map((r, i) => (
        <span key={i} style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
          {r.what && <span style={{ fontWeight: 600 }}>{r.what}</span>}
          <span style={{ color: 'var(--tp-muted-fg)' }}>{r.when}</span>
        </span>
      ))}
    </span>
  );
}
