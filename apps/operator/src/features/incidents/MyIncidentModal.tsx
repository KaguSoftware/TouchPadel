/**
 * One of the reporter's own reports, opened from its card on My reports (the
 * desk and the till, app.my_incidents). Read only: the review is management's
 * (IncidentSheet).
 *
 * It opens with the card's own band, larger, so the dialog reads as the card
 * opening: the kind on its tint with the icon large and faint behind it, the
 * place under it. Then the facts as tiles (when, where exactly, how many
 * photos), what happened, who was involved, the photos, and the manager's
 * review as a reply, or a dashed "waiting" box while there is none.
 */
import type { CSSProperties, ReactNode } from 'react';
import { formatDateTime, formatDayNumber, formatMonthShort, formatNumber, formatTime, formatWeekdayShort, isolate } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Button, Modal } from '../../components/ui';
import { Icon, type IconName } from '../../components/icons';
import { StaffPhoto } from '../checklists/StaffPhoto';
import { BESIDE_ICON, KIND_LOOK, placeText, type IncidentRow } from './incidentsLogic';

const sectionHead: CSSProperties = {
  margin: 0,
  fontSize: 'var(--tp-fs-xs)',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--tp-muted-fg)',
};
const prose: CSSProperties = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxInlineSize: '68ch', margin: 0 };
const raised = 'var(--tp-shadow-raised)';

function Divider() {
  return <div aria-hidden="true" style={{ blockSize: '1px', background: 'var(--tp-border)' }} />;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
      <h3 style={sectionHead}>{title}</h3>
      {children}
    </section>
  );
}

/**
 * Each fact on its own tint (existing pairs, each with a blue-mode value), so
 * the three read apart at a glance. An empty one stays, with a dash, so the
 * row never changes shape and a blank reads as blank.
 */
const FACT_TONE = {
  when: { fg: 'var(--tp-accent-soft-fg)', soft: 'var(--tp-accent-soft)' },
  where: { fg: 'var(--tp-tournament)', soft: 'var(--tp-tournament-soft)' },
  photos: { fg: 'var(--tp-lesson)', soft: 'var(--tp-lesson-soft)' },
} as const;

function Fact({ tone, icon, label, children }: { tone: keyof typeof FACT_TONE; icon: IconName; label: string; children: ReactNode }) {
  const t = FACT_TONE[tone];
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', alignContent: 'start', paddingBlock: 'var(--tp-sp-2-5)', paddingInline: 'var(--tp-sp-3)', borderRadius: 'var(--tp-radius-panel)', background: t.soft, minInlineSize: 0 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-xs)', fontWeight: 600, color: t.fg }}>
        <Icon name={icon} size={13} style={{ flex: 'none' }} />
        <span style={BESIDE_ICON}>{label}</span>
      </span>
      {children}
    </div>
  );
}

export function MyIncidentModal({ row, onClose }: { row: IncidentRow; onClose: () => void }) {
  const { tr, locale } = useLocale();
  const look = KIND_LOOK[row.kind];
  const kind = tr(`work.incident.kind.${row.kind}`);
  const place = placeText({ ...row, placeDetail: null }, locale, (p) => tr(`work.incident.place.${p}`));
  const at = row.occurredAt ? new Date(row.occurredAt) : null;
  const showPhotos = row.photos.length > 0;
  const detail = row.redacted ? null : row.placeDetail;

  return (
    <Modal
      title={`${kind} · ${place}`}
      onClose={onClose}
      bare={(close) => (
        <>
          <div style={{ flex: 1, minBlockSize: 0, overflowY: 'auto' }}>
            {/* The card's band, larger: the kind on its tint, its icon large and faint behind. */}
            <div
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--tp-sp-3)',
                paddingBlock: 'var(--tp-sp-5)',
                paddingInlineStart: 'var(--tp-sp-5)',
                paddingInlineEnd: 'var(--tp-sp-5)',
                background: `linear-gradient(120deg, ${look.soft} 30%, color-mix(in oklch, ${look.soft} 78%, ${look.fg}))`,
                color: look.fg,
                overflow: 'hidden',
              }}
            >
              <Icon name={look.icon} size={160} style={{ position: 'absolute', insetInlineEnd: '-1rem', insetBlockEnd: 0, transform: 'translateY(30%)', opacity: 0.1, pointerEvents: 'none' }} />
              <span style={{ display: 'grid', placeItems: 'center', inlineSize: '2.75rem', blockSize: '2.75rem', flex: 'none', borderRadius: 'var(--tp-radius-panel)', background: 'var(--tp-surface)', boxShadow: raised }}>
                <Icon name={look.icon} size={22} />
              </span>
              <span style={{ ...BESIDE_ICON, display: 'grid', gap: 'var(--tp-sp-0)', flex: 1, minInlineSize: 0 }}>
                <strong style={{ fontSize: 'var(--tp-fs-2xl)' }}>{kind}</strong>
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1)', color: 'var(--tp-fg)', fontSize: 'var(--tp-fs-sm)', fontWeight: 600, minInlineSize: 0 }}>
                  <Icon name="pin" size={14} style={{ flex: 'none', opacity: 0.7 }} />
                  <bdi style={{ ...BESIDE_ICON, overflowWrap: 'anywhere' }}>{place}</bdi>
                </span>
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--tp-sp-2)', paddingBlockStart: 'var(--tp-sp-4)', paddingInline: 'var(--tp-sp-5)' }}>
              <Fact tone="when" icon="clock" label={tr('ws.incidents.sheet.happened')}>
                {at ? (
                  <>
                    <b style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTime(at, locale)}</b>
                    <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
                      {formatWeekdayShort(at, locale)} {formatDayNumber(at, locale)} {formatMonthShort(at, locale)}
                    </span>
                  </>
                ) : (
                  <b>—</b>
                )}
              </Fact>
              <Fact tone="where" icon="pin" label={tr('ws.incidents.form.placeDetail')}>
                <b dir="auto" style={{ overflowWrap: 'anywhere' }}>
                  {detail ?? '—'}
                </b>
              </Fact>
              <Fact tone="photos" icon="image" label={tr('ws.incidents.cols.photos')}>
                <b style={{ fontVariantNumeric: 'tabular-nums' }}>{showPhotos ? formatNumber(row.photos.length, locale) : '—'}</b>
              </Fact>
            </div>

            <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', paddingBlock: 'var(--tp-sp-4) var(--tp-sp-5)', paddingInline: 'var(--tp-sp-5)' }}>
              <Section title={tr('ws.incidents.sheet.whatHappened')}>
                {row.redacted ? (
                  <p style={{ ...prose, color: 'var(--tp-muted-fg)', fontStyle: 'italic' }}>{tr('ws.incidents.redactedText')}</p>
                ) : (
                  <p dir="auto" style={prose}>
                    {row.description}
                  </p>
                )}
              </Section>

              {!row.redacted && row.peopleInvolved && <Divider />}
              {!row.redacted && row.peopleInvolved && (
                <Section title={tr('ws.incidents.sheet.people')}>
                  <p dir="auto" style={prose}>
                    {row.peopleInvolved}
                  </p>
                </Section>
              )}

              {showPhotos && (
                <Section title={tr('ws.incidents.cols.photos')}>
                  {row.redacted ? (
                    <p style={{ ...prose, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.incidents.sheet.photosGoing')}</p>
                  ) : (
                    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', gridTemplateColumns: 'repeat(auto-fill, minmax(9rem, 1fr))' }}>
                      {row.photos.map((p, i) => {
                        const alt = tr('ws.incidents.sheet.photoAlt', { n: formatNumber(i + 1, locale) });
                        return (
                          <span key={p} style={{ position: 'relative', display: 'grid' }}>
                            <StaffPhoto path={p} alt={alt} style={{ minBlockSize: 0, aspectRatio: '4 / 3', borderRadius: 'var(--tp-radius-panel)' }} />
                            <span aria-hidden="true" style={{ position: 'absolute', insetInlineStart: 'var(--tp-sp-2)', insetBlockEnd: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-2)', borderRadius: 'var(--tp-radius-pill)', background: 'var(--tp-overlay)', color: 'var(--tp-brand-white)', fontSize: 'var(--tp-fs-xs)', fontWeight: 600 }}>
                              {alt}
                            </span>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </Section>
              )}

              <Divider />

              {row.status === 'reviewed' ? (
                <>
                  {/* Who reviewed it and when, on a green outline; then their note under its own label, outlined. */}
                  <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap', paddingBlock: 'var(--tp-sp-2-5)', paddingInline: 'var(--tp-sp-3)', borderRadius: 'var(--tp-radius-dialog)', border: '1px solid var(--tp-success-mark)', background: 'var(--tp-success-soft)', color: 'var(--tp-success-fg)', fontSize: 'var(--tp-fs-sm)', fontWeight: 700 }}>
                    <Icon name="checkCircle" size={16} style={{ flex: 'none' }} />
                    <span style={BESIDE_ICON}>{tr('ws.incidents.mine.reviewedBy', { name: isolate(row.reviewedByName ?? '—') })}</span>
                    {row.reviewedAt && (
                      <span style={{ ...BESIDE_ICON, marginInlineStart: 'auto', fontWeight: 600, opacity: 0.85, fontVariantNumeric: 'tabular-nums' }}>{formatDateTime(new Date(row.reviewedAt), locale)}</span>
                    )}
                  </span>
                  {row.reviewNote && (
                    <Section title={tr('ws.incidents.mine.review')}>
                      <p dir="auto" style={{ ...prose, maxInlineSize: 'none', paddingBlock: 'var(--tp-sp-3)', paddingInline: 'var(--tp-sp-3)', borderRadius: 'var(--tp-radius-dialog)', border: '1px solid var(--tp-border-strong)', background: 'var(--tp-surface)' }}>
                        {row.reviewNote}
                      </p>
                    </Section>
                  )}
                </>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', paddingBlock: 'var(--tp-sp-3)', paddingInline: 'var(--tp-sp-3)', borderRadius: 'var(--tp-radius-dialog)', border: '1px dashed var(--tp-warn-mark)', background: 'var(--tp-warn-soft)', color: 'var(--tp-warn-fg)', fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>
                  <Icon name="hourglass" size={16} style={{ flex: 'none' }} />
                  <span style={BESIDE_ICON}>{tr('ws.incidents.mine.waitingLong')}</span>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--tp-sp-2)', paddingBlock: 'var(--tp-sp-3)', paddingInline: 'var(--tp-sp-5)', borderBlockStart: '1px solid var(--tp-border)' }}>
            <Button kind="danger" onClick={close}>
              {tr('common.close')}
            </Button>
          </div>
        </>
      )}
    >
      {null}
    </Modal>
  );
}
