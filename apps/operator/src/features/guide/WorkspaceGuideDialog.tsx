/**
 * The workspace guide: one dialog, the active workspace's sections as tabs,
 * each a numbered list of steps a new person can tick off as they learn them.
 * Content and the role filtering live in guideContent.ts; the ticks in
 * guideProgress.ts. No route of its own, so the screen behind it (the kitchen
 * board included) stays live while it is open.
 */
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { formatNumber, type MessageKey, type TParams } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import type { StaffRole } from '../../lib/auth';
import { Button, Modal, Tabs, type TabItem } from '../../components/ui';
import { Kbd, StatusBadge, type Tone } from '../../components/kit';
import { Icon, type IconName } from '../../components/icons';
import {
  ALL_STEP_IDS,
  progressOf,
  stepLink,
  visibleGuide,
  type GuideBadge,
  type GuideStep,
  type GuideWorkspace,
} from './guideContent';
import { clearLearned, loadLearned, saveLearned, toggleLearned } from './guideProgress';

const BADGE: Record<GuideBadge, { tone: Tone; icon: IconName }> = {
  managerPin: { tone: 'warn', icon: 'lock' },
  ownPin: { tone: 'info', icon: 'lock' },
  managerJob: { tone: 'neutral', icon: 'shield' },
  online: { tone: 'accent', icon: 'globe' },
};

export interface WorkspaceGuideDialogProps {
  workspace: GuideWorkspace;
  staffId: string;
  role: StaffRole;
  /** The tab last left open in this workspace's guide. */
  tab?: string | null;
  onTab?: (sectionId: string) => void;
  onClose: () => void;
  /** Router navigation, owned by the shell so it outlives the dialog. */
  onNavigate: (to: string) => void;
}

export function WorkspaceGuideDialog({ workspace, staffId, role, tab, onTab, onClose, onNavigate }: WorkspaceGuideDialogProps) {
  const { tr, locale } = useLocale();
  const board = workspace === 'prep';
  const sections = useMemo(() => visibleGuide(workspace, role), [workspace, role]);
  const [learned, setLearned] = useState<Set<string>>(() => loadLearned(staffId, ALL_STEP_IDS));
  const [current, setCurrent] = useState<string>(() =>
    tab && sections.some((s) => s.id === tab) ? tab : (sections[0]?.id ?? ''),
  );
  // The Modal hands its animated close to the footer only; "Go there" in the
  // body borrows it so the dialog sinks out the same way the X closes it.
  const closeRef = useRef<() => void>(onClose);

  useEffect(() => {
    setLearned(loadLearned(staffId, ALL_STEP_IDS));
  }, [staffId]);

  const progress = progressOf(sections, learned);
  const section = sections.find((s) => s.id === current) ?? sections[0];

  const items: TabItem<string>[] = sections.map((s) => {
    const p = progress.bySection[s.id] ?? { done: 0, total: s.steps.length };
    return {
      id: s.id,
      label: tr(s.titleKey),
      countLabel: tr('ws.guide.chrome.tabCount', { done: formatNumber(p.done, locale), total: formatNumber(p.total, locale) }),
    };
  });

  function choose(id: string) {
    setCurrent(id);
    onTab?.(id);
  }

  function tick(stepId: string, on: boolean) {
    setLearned((cur) => {
      const next = toggleLearned(cur, stepId, on);
      saveLearned(staffId, next);
      return next;
    });
  }

  function startOver() {
    setLearned(clearLearned(staffId, `${workspace}.`));
  }

  function params(step: GuideStep): TParams | undefined {
    if (!step.params) return undefined;
    const out: TParams = {};
    for (const [name, value] of Object.entries(step.params)) {
      out[name] = typeof value === 'number' ? formatNumber(value, locale) : tr(value as MessageKey);
    }
    return out;
  }

  return (
    <Modal
      size="lg"
      tone={board ? 'board' : undefined}
      title={tr('ws.guide.chrome.title', { workspace: tr(`ws.shell.workspace.${workspace}`) })}
      subtitle={
        <span data-testid="guide-progress">
          {tr('ws.guide.chrome.progress', { done: formatNumber(progress.done, locale), total: formatNumber(progress.total, locale) })}
        </span>
      }
      onClose={onClose}
      footer={(close) => {
        closeRef.current = close;
        return (
          <>
            <Button kind="ghost" icon="undo" onClick={startOver} data-testid="guide-start-over" style={{ marginInlineEnd: 'auto' }}>
              {tr('ws.guide.chrome.startOver')}
            </Button>
            <Button kind="primary" onClick={close} data-testid="guide-close">
              {tr('ws.guide.chrome.close')}
            </Button>
          </>
        );
      }}
    >
      <div data-testid="workspace-guide" data-workspace-guide={workspace}>
        <Tabs value={section?.id ?? ''} onChange={choose} items={items} />
        {section && (
          <ol role="tabpanel" aria-label={tr(section.titleKey)} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
            {section.steps.map((step, i) => (
              <GuideStepRow
                key={step.id}
                step={step}
                index={i}
                board={board}
                title={tr(step.titleKey)}
                body={tr(step.bodyKey, params(step))}
                link={stepLink(step, role)}
                learned={learned.has(step.id)}
                onLearned={(on) => tick(step.id, on)}
                onGo={(to) => {
                  onNavigate(to);
                  closeRef.current();
                }}
                sectionIcon={section.icon}
              />
            ))}
          </ol>
        )}
      </div>
    </Modal>
  );
}

function GuideStepRow({
  step,
  index,
  board,
  title,
  body,
  link,
  learned,
  onLearned,
  onGo,
  sectionIcon,
}: {
  step: GuideStep;
  index: number;
  board: boolean;
  title: string;
  body: string;
  link: string | null;
  learned: boolean;
  onLearned: (on: boolean) => void;
  onGo: (to: string) => void;
  sectionIcon: IconName;
}) {
  const { tr, locale } = useLocale();
  const titleId = useId();
  const row: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    gap: 'var(--tp-sp-3)',
    alignItems: 'start',
    paddingBlock: 'var(--tp-sp-3)',
    paddingInline: 'var(--tp-sp-3)',
    border: '1px solid var(--tp-border)',
    borderRadius: 'var(--tp-radius-panel)',
    background: learned ? 'var(--tp-surface-2)' : 'var(--tp-surface)',
  };
  return (
    <li style={row} data-testid="guide-step" data-step-id={step.id} data-learned={learned || undefined}>
      <span
        aria-hidden="true"
        style={{
          display: 'grid',
          placeItems: 'center',
          inlineSize: '2.25rem',
          blockSize: '2.25rem',
          borderRadius: '50%',
          background: learned ? 'var(--tp-accent-soft)' : 'var(--tp-surface-3)',
          color: learned ? 'var(--tp-accent-soft-fg)' : 'var(--tp-muted-fg)',
        }}
      >
        {learned ? <Icon name="check" size={18} /> : <Icon name={step.icon ?? sectionIcon} size={18} />}
      </span>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', minInlineSize: 0 }}>
        <h3 id={titleId} style={{ fontSize: board ? 'var(--tp-fs-kds)' : 'var(--tp-fs-md)', fontWeight: 700, lineHeight: 1.3 }}>
          <span style={{ color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(index + 1, locale)}. </span>
          {title}
        </h3>
        <p style={{ fontSize: board ? 'var(--tp-fs-kds-sm)' : 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', lineHeight: 1.5 }}>{body}</p>
        {(step.badges?.length || step.keys?.length) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-1-5)', alignItems: 'center' }}>
            {step.badges?.map((b) => (
              <StatusBadge key={b} size="sm" tone={BADGE[b].tone} icon={BADGE[b].icon} label={tr(`ws.guide.chrome.badge.${b}`)} />
            ))}
            {step.keys && step.keys.length > 0 && (
              <span
                // Key names are Latin and read left to right in both languages:
                // their own run, never inside the Arabic sentence.
                dir="ltr"
                aria-label={tr('ws.guide.chrome.keys')}
                style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)', alignItems: 'center' }}
              >
                {step.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            )}
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--tp-sp-3)' }}>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--tp-sp-1-5)',
              fontSize: board ? 'var(--tp-fs-kds-sm)' : 'var(--tp-fs-sm)',
              fontWeight: 600,
              cursor: 'pointer',
              minBlockSize: 'var(--tp-row-h)',
            }}
          >
            <input
              type="checkbox"
              checked={learned}
              onChange={(e) => onLearned(e.target.checked)}
              aria-describedby={titleId}
              data-testid="guide-learned"
              style={{ inlineSize: '1.1rem', blockSize: '1.1rem' }}
            />
            {tr('ws.guide.chrome.learned')}
          </label>
          {link && (
            <Button kind="ghost" size="sm" iconEnd="arrowUpRight" onClick={() => onGo(link)} data-testid="guide-go">
              {tr('ws.guide.chrome.goThere')}
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}
