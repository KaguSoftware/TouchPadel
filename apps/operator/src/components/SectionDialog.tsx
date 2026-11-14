/**
 * The step dialogs' frame (StepWizard's .tp-tour-start) for an EDIT form that
 * is not a sequence: a menu of sections on the side, any of them open at any
 * time, one section's fields on the right. No "Step n of N", no progress, no
 * Review page; the footer holds the form's own buttons (Close, Discard, Save).
 */
import { useId, useState, type ReactNode } from 'react';
import { useLocale } from '../lib/i18n';
import { Icon, type IconName } from './icons';
import { InfoTip } from './InfoTip';
import { Button, Modal } from './ui';
import { InSectionDialog, StatusBadge } from './kit';

export type DialogSection = {
  key: string;
  label: string;
  icon: IconName;
  /** An (i) beside the section's heading: the explanation that used to be a grey line. */
  tip?: ReactNode;
  /** Centre the content in the open area, both ways (a single photo, say). */
  center?: boolean;
  /** A refusal or a missing field sits in this section: the menu marks it with "!". */
  flagged?: boolean;
  content: ReactNode;
};

export function SectionDialog({
  title,
  meta,
  sections,
  notice,
  dirty,
  sideNote,
  busy = false,
  actions,
  onClose,
  canClose,
  testId,
}: {
  title: string;
  /** One line under the title in the side menu. */
  meta?: ReactNode;
  sections: readonly DialogSection[];
  /** Above the footer on every section: a refusal from the server, a release notice. */
  notice?: ReactNode;
  dirty: boolean;
  /** A card under the side menu, beside the unsaved badge (the item's default price). */
  sideNote?: ReactNode;
  busy?: boolean;
  /** The form's own buttons, at the end of the footer (Discard, Save). */
  actions: ReactNode;
  onClose: () => void;
  canClose?: () => boolean | Promise<boolean>;
  testId?: string;
}) {
  const { tr } = useLocale();
  const headingId = useId();
  const [at, setAt] = useState(sections[0]?.key ?? '');
  const current = sections.find((s) => s.key === at) ?? sections[0];

  return (
    <Modal
      title={title}
      onClose={onClose}
      canClose={canClose}
      dismissible={!busy}
      size="xl"
      bare={(close) => (
        <div className="tp-tour-start tp-wiz" data-testid={testId}>
          <aside className="tp-tour-start-side">
            <div
              style={{
                display: 'grid',
                gap: 'var(--tp-sp-1)',
                paddingInline: 'var(--tp-sp-3)',
                marginBlockEnd: 'var(--tp-sp-4)',
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: 'var(--tp-fs-2xl)',
                  fontWeight: 800,
                  lineHeight: 1.2,
                  textWrap: 'balance',
                }}
              >
                <bdi>{title}</bdi>
              </h2>
              {meta && (
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--tp-sp-2)',
                    flexWrap: 'wrap',
                    fontSize: 'var(--tp-fs-sm)',
                    color: 'var(--tp-muted-fg)',
                  }}
                >
                  {meta}
                </div>
              )}
            </div>
            <nav
              aria-label={tr('ws.kit.wizard.menu')}
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-1)' }}
            >
              {sections.map((s) => {
                const now = s.key === current?.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    className="tp-tour-start-nav"
                    aria-current={now ? 'step' : undefined}
                    onClick={() => setAt(s.key)}
                    data-testid={testId ? `${testId}.section.${s.key}` : undefined}
                  >
                    <span
                      className="tp-wiz-n"
                      data-state={s.flagged && !now ? 'warn' : now ? 'now' : undefined}
                      aria-hidden="true"
                    >
                      {s.flagged && !now ? '!' : <Icon name={s.icon} size={14} strokeWidth={2.6} />}
                    </span>
                    <span className="tp-wiz-label">
                      <span>{s.label}</span>
                    </span>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', minInlineSize: 0 }}>
                <h3
                  id={headingId}
                  style={{
                    margin: 0,
                    fontSize: 'var(--tp-fs-3xl)',
                    fontWeight: 700,
                    lineHeight: 1.2,
                    textWrap: 'balance',
                  }}
                >
                  {current?.label}
                </h3>
                {current?.tip && <InfoTip content={current.tip} label={`${tr('ws.kit.infoTip.label')}: ${current.label}`} style={{ flex: '0 0 auto' }} />}
              </div>
              <Button
                size="lg"
                icon="x"
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
              aria-labelledby={headingId}
              style={{
                flex: 1,
                minBlockSize: 0,
                overflowY: 'auto',
                padding: 'var(--tp-sp-5) var(--tp-sp-6)',
                display: 'grid',
                alignContent: current?.center ? 'center' : 'start',
                justifyItems: current?.center ? 'center' : undefined,
                gap: 'var(--tp-sp-4)',
              }}
            >
              <InSectionDialog.Provider value={true}>{current?.content}</InSectionDialog.Provider>
            </section>
            {notice && (
              <div
                style={{
                  display: 'grid',
                  gap: 'var(--tp-sp-2)',
                  paddingInline: 'var(--tp-sp-6)',
                  paddingBlockEnd: 'var(--tp-sp-4)',
                }}
              >
                {notice}
              </div>
            )}
          </div>

          <div className="tp-tour-start-sidefoot" style={{ gap: 'var(--tp-sp-1-5)', padding: 'var(--tp-sp-2-5) var(--tp-sp-3)' }}>
            {/* The row keeps its height whether or not there is something unsaved, so the bar never jumps. */}
            <div style={{ blockSize: '1.6rem', display: 'flex', alignItems: 'center' }}>
              {dirty && <StatusBadge tone="warn" label={tr('ws.kit.actions.unsaved')} />}
            </div>
            {sideNote && (
              <div className="tp-wiz-progress" style={{ padding: 'var(--tp-sp-2) var(--tp-sp-3)' }}>
                {sideNote}
              </div>
            )}
          </div>

          <footer className="tp-tour-start-foot" style={{ justifyContent: 'flex-end', paddingBlock: 'var(--tp-sp-3)' }}>
            <div style={{ display: 'flex', gap: 'var(--tp-sp-2)' }}>{actions}</div>
          </footer>
        </div>
      )}
    >
      {null}
    </Modal>
  );
}
