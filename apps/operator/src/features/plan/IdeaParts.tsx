/**
 * The pieces of the content plan page (0362): one idea as a row, the idea
 * form, the day beside the calendar, and the whole month as a list.
 *
 * An idea row reads top to bottom as the owner and marketing both need it:
 * what kind of thing and where it goes, where it stands, the title, the
 * explanation, the owner's note when they left it out, and then the one or two
 * things the reader can do with it now. Rows are divided by a hairline, never
 * boxed: a day's ideas are one list, not a stack of cards.
 */
import { useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDate, formatNumber, formatWeekdayLong, isolate, type MessageKey } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { Button, ErrorText, Field, Select, inputStyle } from '../../components/ui';
import { StatusBadge } from '../../components/kit';
import { refreshPlan } from './api';
import { StageMark } from './PlanCalendar';
import {
  IDEA_DETAILS_MAX,
  IDEA_KINDS,
  IDEA_TITLE_MAX,
  STAGE_TONE,
  canCancelIdea,
  canSendResult,
  draftFromIdea,
  EMPTY_IDEA,
  ideaStage,
  saveIdeaArgs,
  validateIdea,
  weeklyDays,
  type IdeaDraft,
  type IdeaField,
  type IdeaKind,
  type IdeaStage,
  type MonthPlan,
  type PlanIdea,
} from './planLogic';
import { CONTENT_CHANNELS, type ContentChannel } from '../content/contentLogic';

const noon = (iso: string) => new Date(`${iso}T12:00:00Z`);
const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;

/** What the page lets the reader do; each row asks it rather than the role. */
export interface PlanActions {
  plan: MonthPlan;
  /** Marketing: writes ideas and sends results (editPlan). */
  writer: boolean;
  /** The owner, while the plan waits on them (can_decide). */
  deciding: boolean;
  leftOut: ReadonlySet<string>;
  toggleLeftOut: (id: string) => void;
  onEdit: (idea: PlanIdea) => void;
  onSendResult: (idea: PlanIdea) => void;
  /** Open the idea's result where the reader decides or revises it. */
  onOpenResult: (idea: PlanIdea) => void;
}

export function stageOf(idea: PlanIdea, a: Pick<PlanActions, 'plan' | 'leftOut'>): IdeaStage {
  return a.leftOut.has(idea.id) ? 'dropped' : ideaStage(idea, a.plan.today);
}

// ---------------------------------------------------------------------------
// One idea
// ---------------------------------------------------------------------------

export function IdeaRow({ idea, actions: a, dayLabel }: { idea: PlanIdea; actions: PlanActions; dayLabel?: string }) {
  const { tr } = useLocale();
  const stage = stageOf(idea, a);
  const gone = stage === 'dropped' || stage === 'cancelled';
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', paddingBlock: 'var(--tp-sp-3)', paddingInline: 'var(--tp-sp-3)' }} data-testid={`plan.idea.${idea.id}`}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
        <span style={{ ...muted, fontSize: 'var(--tp-fs-xs)', fontWeight: 600 }}>
          {[dayLabel, tr(`ws.plan.kind.${idea.kind}`), tr(`work.content.channel.${idea.channel}`)].filter(Boolean).join(' · ')}
        </span>
        <StatusBadge size="sm" tone={STAGE_TONE[stage]} label={tr(`ws.plan.stage.${stage}`)} />
      </div>
      <bdi style={{ fontWeight: 700, textDecoration: gone ? 'line-through' : undefined, color: gone ? 'var(--tp-muted-fg)' : undefined }}>{idea.title}</bdi>
      {idea.details && (
        <p dir="auto" style={{ ...muted, margin: 0, whiteSpace: 'pre-wrap', maxInlineSize: '70ch' }}>
          {idea.details}
        </p>
      )}
      {idea.status === 'dropped' && idea.dropNote && (
        <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)' }}>
          {tr('ws.plan.idea.ownerNote', { note: isolate(idea.dropNote) })}
        </p>
      )}
      <IdeaButtons idea={idea} stage={stage} a={a} />
    </div>
  );
}

function IdeaButtons({ idea, stage, a }: { idea: PlanIdea; stage: IdeaStage; a: PlanActions }) {
  const { tr } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => appRpc<{ status: 'removed' | 'cancelled' }>('remove_plan_idea', { p_id: idea.id }),
    onSuccess: (r) => {
      toast.ok(tr(r.status === 'cancelled' ? 'ws.plan.toast.cancelled' : 'ws.plan.toast.removed'));
      refreshPlan(qc);
    },
  });

  const buttons: ReactNode[] = [];
  if (a.deciding && idea.status === 'proposed') {
    const out = a.leftOut.has(idea.id);
    buttons.push(
      <Button key="leave" size="sm" kind={out ? 'soft' : 'ghost'} icon={out ? 'undo' : 'ban'} aria-pressed={out} onClick={() => a.toggleLeftOut(idea.id)} data-testid={`plan.idea.leave.${idea.id}`}>
        {tr(out ? 'ws.plan.idea.keep' : 'ws.plan.idea.leaveOut')}
      </Button>,
    );
  }
  if (a.writer) {
    if (canSendResult(stage)) {
      buttons.push(
        <Button key="send" size="sm" kind="primary" icon="upload" onClick={() => a.onSendResult(idea)} data-testid={`plan.idea.send.${idea.id}`}>
          {tr(stage === 'declined' ? 'ws.plan.idea.sendAgain' : 'ws.plan.idea.sendResult')}
        </Button>,
      );
    }
    if (idea.status === 'proposed' && a.plan.canEdit) {
      buttons.push(
        <Button key="edit" size="sm" icon="note" onClick={() => a.onEdit(idea)} data-testid={`plan.idea.edit.${idea.id}`}>
          {tr('ws.plan.idea.edit')}
        </Button>,
      );
    }
    const removable = a.plan.canEdit && (idea.status === 'proposed' || canCancelIdea(idea));
    if (removable) {
      buttons.push(
        <Button
          key="remove"
          size="sm"
          kind="ghost"
          icon="trash"
          busy={remove.isPending}
          onClick={async () => {
            const ok = await confirm({
              title: tr(idea.status === 'proposed' ? 'ws.plan.idea.confirmRemove' : 'ws.plan.idea.confirmCancel', { title: isolate(idea.title) }),
              confirmLabel: tr(idea.status === 'proposed' ? 'ws.plan.idea.remove' : 'ws.plan.idea.cancel'),
              kind: 'danger',
            });
            if (ok) remove.mutate();
          }}
          data-testid={`plan.idea.remove.${idea.id}`}
        >
          {tr(idea.status === 'proposed' ? 'ws.plan.idea.remove' : 'ws.plan.idea.cancel')}
        </Button>,
      );
    }
  }
  if (idea.result && (stage === 'sent' || stage === 'changes' || stage === 'done' || stage === 'declined')) {
    buttons.push(
      <Button key="open" size="sm" kind={a.writer && stage === 'changes' ? 'primary' : 'ghost'} iconEnd="arrowEnd" onClick={() => a.onOpenResult(idea)} data-testid={`plan.idea.open.${idea.id}`}>
        {tr(a.writer && stage === 'changes' ? 'ws.plan.idea.fixResult' : 'ws.plan.idea.openResult')}
      </Button>,
    );
  }
  if (buttons.length === 0 && !remove.isError) return null;
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', marginBlockStart: 'var(--tp-sp-1)' }}>
      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', alignItems: 'center' }}>{buttons}</div>
      {remove.isError && <ErrorText error={remove.error} style={{ marginBlock: 0 }} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The idea form
// ---------------------------------------------------------------------------

const ISSUE_KEY: Record<'required' | 'tooLong', MessageKey> = {
  required: 'ws.plan.form.issue.required',
  tooLong: 'ws.plan.form.issue.tooLong',
};
const LIMIT: Record<IdeaField, number> = { title: IDEA_TITLE_MAX, details: IDEA_DETAILS_MAX };

export function IdeaForm({ day, idea, onClose }: { day: string; idea: PlanIdea | null; onClose: () => void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<IdeaDraft>(idea ? draftFromIdea(idea) : EMPTY_IDEA);
  const [tried, setTried] = useState(false);
  // One key per idea as sent: a retry of the same one reuses it (claim_replay compares no payload).
  const key = useRef<{ sig: string; key: string } | null>(null);
  const keyFor = (sig: string) => {
    if (key.current?.sig !== sig) key.current = { sig, key: `plan.idea:${crypto.randomUUID()}` };
    return key.current.key;
  };
  const issues = validateIdea(draft);
  const weekly = weeklyDays(day);
  const save = useMutation({
    mutationFn: () => {
      const args = saveIdeaArgs(draft, day, idea?.id ?? null, null);
      return appRpc<{ ids: string[] }>('save_plan_idea', { ...args, p_idempotency_key: idea ? null : keyFor(JSON.stringify(args)) });
    },
    onSuccess: (r) => {
      const n = r.ids?.length ?? 1;
      toast.ok(idea ? tr('ws.plan.toast.saved') : n > 1 ? tr('ws.plan.toast.addedMany', { count: formatNumber(n, locale) }) : tr('ws.plan.toast.added'));
      refreshPlan(qc);
      onClose();
    },
  });
  const set = (patch: Partial<IdeaDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    if (save.isError) save.reset();
  };
  const errorOf = (field: IdeaField) => {
    const issue = tried ? issues.find((i) => i.field === field) : undefined;
    return issue ? tr(ISSUE_KEY[issue.code], { limit: formatNumber(LIMIT[field], locale) }) : undefined;
  };
  const busy = save.isPending;

  return (
    <form
      noValidate
      data-testid="plan.form"
      style={{ padding: 'var(--tp-sp-3)' }}
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (issues.length === 0 && !busy) save.mutate();
      }}
    >
      <h3 style={{ fontSize: 'var(--tp-fs-md)', fontWeight: 700, marginBlockEnd: 'var(--tp-sp-3)' }}>
        {idea ? tr('ws.plan.form.editTitle') : tr('ws.plan.form.newTitle', { date: formatDate(noon(day), locale, 'UTC') })}
      </h3>
      <Field label={tr('ws.plan.form.title')} required hint={tr('ws.plan.form.titleHint')} error={errorOf('title')}>
        <input
          value={draft.title}
          maxLength={IDEA_TITLE_MAX}
          dir="auto"
          disabled={busy}
          autoFocus
          onChange={(e) => set({ title: e.target.value })}
          style={inputStyle}
          data-testid="plan.form.title"
        />
      </Field>
      <div style={{ display: 'flex', gap: 'var(--tp-sp-3)', flexWrap: 'wrap' }}>
        <Field label={tr('ws.plan.form.kind')} style={{ flex: '1 1 9rem' }}>
          <Select<IdeaKind> value={draft.kind} disabled={busy} options={IDEA_KINDS.map((k) => ({ value: k, label: tr(`ws.plan.kind.${k}`) }))} onChange={(kind) => set({ kind })} />
        </Field>
        <Field label={tr('ws.plan.form.channel')} style={{ flex: '1 1 9rem' }}>
          <Select<ContentChannel>
            value={draft.channel}
            disabled={busy}
            options={CONTENT_CHANNELS.map((c) => ({ value: c, label: tr(`work.content.channel.${c}`) }))}
            onChange={(channel) => set({ channel })}
          />
        </Field>
      </div>
      <Field label={tr('ws.plan.form.details')} optional hint={tr('ws.plan.form.detailsHint')} error={errorOf('details')}>
        <textarea
          value={draft.details}
          rows={4}
          maxLength={IDEA_DETAILS_MAX}
          dir="auto"
          disabled={busy}
          onChange={(e) => set({ details: e.target.value })}
          style={{ ...inputStyle, minBlockSize: '6rem', resize: 'vertical', fontFamily: 'inherit' }}
          data-testid="plan.form.details"
        />
      </Field>
      {!idea && weekly.length > 1 && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', marginBlockEnd: 'var(--tp-sp-4)', cursor: 'pointer' }}>
          <input type="checkbox" checked={draft.weekly} disabled={busy} onChange={(e) => set({ weekly: e.target.checked })} data-testid="plan.form.weekly" />
          {tr('ws.plan.form.weekly', { weekday: formatWeekdayLong(noon(day), locale, 'UTC'), count: formatNumber(weekly.length, locale) })}
        </label>
      )}
      {save.isError && <ErrorText error={save.error} />}
      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <Button kind="ghost" onClick={onClose} disabled={busy}>
          {tr('common.cancel')}
        </Button>
        <Button kind="primary" type="submit" icon="check" busy={busy} data-testid="plan.form.submit">
          {tr(idea ? 'ws.plan.form.save' : 'ws.plan.form.add')}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// A day, and the month as a list
// ---------------------------------------------------------------------------

/** "Thursday 6 November". */
export function longDay(day: string, locale: 'en' | 'ar'): string {
  return `${formatWeekdayLong(noon(day), locale, 'UTC')} ${formatDate(noon(day), locale, 'UTC')}`;
}

export function IdeaList({ ideas, actions, withDays }: { ideas: readonly PlanIdea[]; actions: PlanActions; withDays?: boolean }) {
  const { locale } = useLocale();
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {ideas.map((i, n) => (
        <li key={i.id} style={{ borderBlockStart: n === 0 ? undefined : '1px solid var(--tp-border)' }}>
          <IdeaRow idea={i} actions={actions} dayLabel={withDays ? longDay(i.day, locale) : undefined} />
        </li>
      ))}
    </ul>
  );
}

/** The month's ideas by day, for reading the whole plan in one go (the owner's default while deciding). */
export function MonthList({ actions, onPickDay }: { actions: PlanActions; onPickDay: (day: string) => void }) {
  const { tr, locale } = useLocale();
  const days: { day: string; ideas: PlanIdea[] }[] = [];
  for (const i of actions.plan.ideas) {
    const last = days[days.length - 1];
    if (last && last.day === i.day) last.ideas.push(i);
    else days.push({ day: i.day, ideas: [i] });
  }
  if (days.length === 0) {
    return <p style={{ ...muted, margin: 0, padding: 'var(--tp-sp-4)' }}>{tr('ws.plan.list.empty')}</p>;
  }
  return (
    <div data-testid="plan.list">
      {days.map(({ day, ideas }) => (
        <section key={day} style={{ borderBlockStart: '1px solid var(--tp-border)' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', margin: 0, paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)', background: 'var(--tp-surface-2)', fontSize: 'var(--tp-fs-sm)', fontWeight: 700 }}>
            <button type="button" onClick={() => onPickDay(day)} style={{ all: 'unset', cursor: 'pointer' }}>
              {longDay(day, locale)}
            </button>
            {ideas.map((i) => (
              <StageMark key={i.id} stage={stageOf(i, actions)} />
            ))}
          </h3>
          <IdeaList ideas={ideas} actions={actions} />
        </section>
      ))}
    </div>
  );
}
