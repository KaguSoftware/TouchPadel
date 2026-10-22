/**
 * The stepped create dialog: the tournament start's frame (.tp-tour-start)
 * for every "add new" form (Sait, 2026-10-22). A menu of steps on the side,
 * one step at a time, "Step n of N" under its name, a progress card and a
 * footer whose buttons are named after the step before and after.
 *
 * Every wizard ends on a Review page that is NOT a step: it is the last row of
 * the menu, unnumbered, below a divider, and it is left out of "Step n of N"
 * and of the progress count (four steps and Review read "Step 1 of 4"). The
 * last step's button reads "Review →"; the Review page holds the submit.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { formatNumber } from '@touch/i18n';
import { useLocale } from '../lib/i18n';
import { Icon } from './icons';
import { Button, Modal } from './ui';
import { MessagePresenter } from './kit';
import { Switch } from './Switch';

export type WizardStep = {
  key: string;
  label: string;
  /** The answer in a few words, under the step's name once it is passed. */
  note?: string | null;
  /**
   * What keeps the person from leaving this step forward. Moving on (the next
   * button, a later row of the menu, the submit) stops here and lists them.
   */
  problems?: readonly string[];
  /** A refusal named a field on this step: the menu marks it with "!". */
  flagged?: boolean;
  content: ReactNode;
};

/** Where the wizard is: a step's index, or the Review page after the last one. */
export type WizardAt = number | 'review';

export function StepWizard({
  title,
  lead,
  steps,
  review,
  submitLabel,
  onSubmit,
  busy = false,
  submitBlocked,
  notice,
  onClose,
  canClose,
  at: atProp,
  onAtChange,
  finished = false,
  testId,
}: {
  title: string;
  lead?: ReactNode;
  steps: readonly WizardStep[];
  /** The Review page; `goTo` opens a step (its rows' Change buttons). */
  review: (goTo: (key: string) => void) => ReactNode;
  submitLabel: ReactNode;
  onSubmit: () => void;
  busy?: boolean;
  /** Why the submit cannot run yet, though every step is filled (offline, say). */
  submitBlocked?: string | null;
  /** A message above the footer: a refusal from the server, a conflict. */
  notice?: ReactNode;
  onClose: () => void;
  canClose?: () => boolean | Promise<boolean>;
  /** Controlled position, for a caller that jumps to the step a refusal names. */
  at?: WizardAt;
  onAtChange?: (at: WizardAt) => void;
  /** Sent: the dialog leaves through its exit, then `onClose` runs (a toast after it never overlaps it). */
  finished?: boolean;
  testId?: string;
}) {
  const { tr, locale } = useLocale();
  const headingId = useId();
  const [ownAt, setOwnAt] = useState<WizardAt>(0);
  const at = atProp ?? ownAt;
  const [seen, setSeen] = useState(0);
  const [shown, setShown] = useState<readonly string[]>([]);

  const total = steps.length;
  const idx = at === 'review' ? total : Math.min(at, total - 1);
  const step = at === 'review' ? null : steps[idx];

  const move = (next: WizardAt) => {
    const to = next === 'review' ? total : next;
    // Forward stops at the first step on the way that is not finished.
    if (to > idx) {
      for (let i = idx; i < to; i++) {
        const p = steps[i]?.problems ?? [];
        if (p.length > 0) {
          if (i !== idx) set(i);
          setShown(p);
          return;
        }
      }
    }
    set(next);
  };
  const set = (next: WizardAt) => {
    setShown([]);
    const n = next === 'review' ? total : next;
    setSeen((s) => Math.max(s, n));
    if (atProp === undefined) setOwnAt(next);
    onAtChange?.(next);
  };
  const goTo = (key: string) => {
    const i = steps.findIndex((s) => s.key === key);
    if (i >= 0) set(i);
  };

  // Ticked once passed (behind the open step, or seen before) and finished.
  const ticked = (i: number) => i !== idx && (i < idx || i <= seen) && (steps[i]?.problems?.length ?? 0) === 0;
  const done = steps.filter((_, i) => ticked(i)).length;
  const prev = idx > 0 ? steps[idx - 1] : null;
  const next = step ? (steps[idx + 1] ?? null) : null;
  const latin = locale !== 'ar';

  return (
    <Modal
      title={title}
      onClose={onClose}
      canClose={canClose}
      dismissible={!busy}
      size="xl"
      bare={(close) => (
        <form
          noValidate
          className="tp-tour-start tp-wiz"
          data-testid={testId}
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            if (step) {
              move(next ? idx + 1 : 'review');
              return;
            }
            if (submitBlocked) return;
            // A step left unfinished (reached through the menu) is opened, not sent.
            const open = steps.findIndex((s) => (s.problems?.length ?? 0) > 0);
            if (open >= 0) {
              set(open);
              setShown(steps[open]!.problems!);
              return;
            }
            onSubmit();
          }}
        >
          {finished && <CloseNow close={close} />}
          <aside className="tp-tour-start-side">
            <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', paddingInline: 'var(--tp-sp-3)', marginBlockEnd: 'var(--tp-sp-4)' }}>
              <h2 style={{ margin: 0, fontSize: 'var(--tp-fs-2xl)', fontWeight: 800, lineHeight: 1.2, textWrap: 'balance' }}>{title}</h2>
              {lead && <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{lead}</p>}
            </div>
            <nav aria-label={tr('ws.kit.wizard.menu')} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-1)' }}>
              {steps.map((s, i) => {
                const now = i === idx;
                const ok = ticked(i);
                const warn = !!s.flagged && !now;
                return (
                  <button
                    key={s.key}
                    type="button"
                    className="tp-tour-start-nav"
                    aria-current={now ? 'step' : undefined}
                    onClick={() => move(i)}
                    data-testid={testId ? `${testId}.step.${s.key}` : undefined}
                  >
                    <span className="tp-wiz-n" data-state={warn ? 'warn' : ok ? 'done' : now ? 'now' : undefined} aria-hidden="true">
                      {warn ? '!' : ok ? <Icon name="check" size={14} strokeWidth={3} /> : formatNumber(i + 1, locale)}
                    </span>
                    <span className="tp-wiz-label">
                      <span>{s.label}</span>
                      {ok && s.note && <bdi className="tp-wiz-note">{s.note}</bdi>}
                    </span>
                  </button>
                );
              })}
              <hr className="tp-wiz-sep" />
              <button
                type="button"
                className="tp-tour-start-nav"
                aria-current={step ? undefined : 'step'}
                onClick={() => move('review')}
                data-testid={testId ? `${testId}.step.review` : undefined}
              >
                <span className="tp-wiz-n" data-state="review" aria-hidden="true">
                  <Icon name="list" size={14} strokeWidth={2.6} />
                </span>
                <span className="tp-wiz-label">
                  <span>{tr('ws.kit.wizard.review')}</span>
                </span>
              </button>
            </nav>
          </aside>

          <div className="tp-tour-start-main">
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--tp-sp-4)', padding: 'var(--tp-sp-5) var(--tp-sp-6) 0' }}>
              <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', minInlineSize: 0 }}>
                <h3 id={headingId} style={{ margin: 0, fontSize: 'var(--tp-fs-3xl)', fontWeight: 700, lineHeight: 1.2, textWrap: 'balance' }}>
                  {step ? step.label : tr('ws.kit.wizard.review')}
                </h3>
                <span
                  style={{
                    fontSize: 'var(--tp-fs-sm)',
                    fontWeight: 700,
                    color: 'var(--tp-accent)',
                    // Capitals and tracking for Latin script only: they break Arabic's joins.
                    textTransform: latin ? 'uppercase' : undefined,
                    letterSpacing: latin ? '0.06em' : undefined,
                  }}
                >
                  {step
                    ? tr('ws.kit.wizard.stepOf', { n: formatNumber(idx + 1, locale), total: formatNumber(total, locale) })
                    : tr('ws.kit.wizard.allDone', { total: formatNumber(total, locale) })}
                </span>
              </div>
              <Button
                size="lg"
                icon="x"
                // A square box, as tall as the footer's buttons.
                style={{ inlineSize: '3rem', blockSize: '3rem', padding: 0, justifyContent: 'center', flexShrink: 0 }}
                aria-label={tr('common.close')}
                title={tr('common.close')}
                disabled={busy}
                onClick={close}
              />
            </header>

            <section
              aria-labelledby={headingId}
              style={{ flex: 1, minBlockSize: 0, overflowY: 'auto', padding: 'var(--tp-sp-5) var(--tp-sp-6)', display: 'grid', alignContent: 'start', gap: 'var(--tp-sp-4)' }}
            >
              {step ? step.content : review(goTo)}
            </section>

            {(shown.length > 0 || notice) && (
              <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-6)', paddingBlockEnd: 'var(--tp-sp-4)' }}>
                {shown.length > 0 && (
                  <MessagePresenter
                    rise
                    tone="error"
                    icon="info"
                    message={
                      <span style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
                        {shown.map((m) => (
                          <span key={m}>{m}</span>
                        ))}
                      </span>
                    }
                    style={{ border: '1px solid var(--tp-danger-mark)', alignItems: 'center', paddingBlock: 'var(--tp-sp-2-5)' }}
                  />
                )}
                {notice}
              </div>
            )}
          </div>

          <div className="tp-tour-start-sidefoot">
            <div className="tp-wiz-progress">
              <strong>{tr('ws.kit.wizard.progress', { done: formatNumber(done, locale), total: formatNumber(total, locale) })}</strong>
              <div className="tp-wiz-bar">
                <i style={{ inlineSize: `${Math.round((done / Math.max(total, 1)) * 100)}%` }} />
              </div>
            </div>
          </div>

          <footer className="tp-tour-start-foot">
            {step && prev ? (
              <Button size="lg" icon="arrowStart" disabled={busy} onClick={() => move(idx - 1)}>
                {prev.label}
              </Button>
            ) : !step && total > 0 ? (
              <Button size="lg" icon="arrowStart" disabled={busy} onClick={() => move(total - 1)}>
                {steps[total - 1]!.label}
              </Button>
            ) : (
              <Button size="lg" disabled={busy} onClick={close}>
                {tr('common.cancel')}
              </Button>
            )}
            {step ? (
              <Button size="lg" kind="primary" iconEnd="arrowEnd" disabled={busy} onClick={() => move(next ? idx + 1 : 'review')}>
                {next ? next.label : tr('ws.kit.wizard.review')}
              </Button>
            ) : (
              <Button
                size="lg"
                type="submit"
                className="tp-wiz-go"
                busy={busy}
                disabled={!!submitBlocked}
                disabledReason={submitBlocked ?? undefined}
                data-testid={testId ? `${testId}.submit` : undefined}
              >
                {submitLabel}
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

/** Asks the dialog to close once it is on screen and dismissible again (a send in flight refuses a close). */
function CloseNow({ close }: { close: () => void }) {
  useEffect(() => {
    close();
  }, [close]);
  return null;
}

/** One answer on the Review page: its name, what was given, and Change to open its step. */
export type ReviewRow = { label: string; value: ReactNode; step?: string };

export function ReviewList({ rows, goTo, busy }: { rows: readonly ReviewRow[]; goTo: (key: string) => void; busy?: boolean }) {
  const { tr } = useLocale();
  return (
    <dl className="tp-wiz-review">
      {rows.map((r) => (
        <div key={r.label}>
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
          {r.step ? (
            <Button size="sm" disabled={busy} onClick={() => goTo(r.step!)} aria-label={tr('ws.kit.wizard.changeLabel', { what: r.label })}>
              {tr('ws.kit.wizard.change')}
            </Button>
          ) : (
            <span />
          )}
        </div>
      ))}
    </dl>
  );
}

/** A choice as a card (the tournament start's .tp-tour-choice): its name, an optional tag, a line under it; a green tick once picked. */
export function WizardChoice({
  on,
  title,
  body,
  tag,
  disabled,
  onPick,
  testId,
}: {
  on: boolean;
  title: ReactNode;
  body?: ReactNode;
  tag?: ReactNode;
  disabled?: boolean;
  onPick: () => void;
  testId?: string;
}) {
  return (
    <button type="button" className="tp-tour-choice tp-wiz-choice" aria-pressed={on} disabled={disabled} onClick={onPick} data-testid={testId}>
      {on && (
        <span className="tp-wiz-tick" aria-hidden="true">
          <Icon name="check" size={14} strokeWidth={3} />
        </span>
      )}
      {tag && <span className="tp-wiz-tag">{tag}</span>}
      <strong className="tp-wiz-choice-title">{title}</strong>
      {body && <span className="tp-wiz-choice-body">{body}</span>}
    </button>
  );
}

/** A row of choice cards: as many to a row as fit; `small` for short names. */
export function WizardChoices({ small, label, children }: { small?: boolean; label?: string; children: ReactNode }) {
  return (
    <div className="tp-wiz-choices" data-small={small ? 'true' : undefined} role="group" aria-label={label}>
      {children}
    </div>
  );
}

/** Pill chips for a pick of short values (times, roles); `multi` toggles each. */
export function WizardChips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: ReactNode; disabled?: boolean }[];
  value: T | readonly T[];
  onChange: (next: T) => void;
  label?: string;
}) {
  const picked = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v);
  return (
    <div className="tp-wiz-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className="tp-wiz-chip" aria-pressed={picked(o.value)} disabled={o.disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The price or total in a framed box: the figure, then a line under it. */
export function WizardPrice({ figure, line }: { figure: ReactNode; line?: ReactNode }) {
  return (
    <div className="tp-wiz-price">
      <strong>{figure}</strong>
      {line && <span>{line}</span>}
    </div>
  );
}

/**
 * A note on a step, as the approved preview draws it: a soft box, no icon.
 * Tones follow MessagePresenter's names so a call site swaps one for the other.
 */
export function WizardNote({ tone = 'info', children, testId }: { tone?: 'info' | 'refused' | 'error' | 'success'; children: ReactNode; testId?: string }) {
  return (
    <div className="tp-wiz-msg" data-tone={tone} role={tone === 'error' ? 'alert' : 'status'} data-testid={testId}>
      {children}
    </div>
  );
}

/** A switch in its own box: the switch, then the name in bold and what it does under it. */
export function WizardToggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="tp-wiz-toggle">
      <Switch checked={checked} onChange={onChange} label={label} hideLabel disabled={disabled} />
      <div>
        <strong>{label}</strong>
        {hint && <span>{hint}</span>}
      </div>
    </div>
  );
}

/** Ticks in bordered rows, each with an optional tag at the end (a lesson type's kind). */
export function WizardChecks({
  label,
  optional,
  items,
  hint,
}: {
  label?: string;
  optional?: boolean;
  items: readonly { key: string; label: ReactNode; tag?: ReactNode; checked: boolean; disabled?: boolean; onChange: (next: boolean) => void; testId?: string }[];
  hint?: ReactNode;
}) {
  const { tr } = useLocale();
  return (
    <fieldset className="tp-wiz-checks">
      {label && (
        <legend>
          {label}
          {optional && <span className="tp-wiz-opt">{tr('op.common.optional')}</span>}
        </legend>
      )}
      {items.map((it) => (
        <label key={it.key} className="tp-wiz-check" data-disabled={it.disabled ? 'true' : undefined}>
          <input type="checkbox" checked={it.checked} disabled={it.disabled} onChange={(e) => it.onChange(e.target.checked)} data-testid={it.testId} />
          <span className="tp-wiz-check-label">{it.label}</span>
          {it.tag && <span className="tp-wiz-tag">{it.tag}</span>}
        </label>
      ))}
      {hint && <span className="tp-wiz-hint">{hint}</span>}
    </fieldset>
  );
}
