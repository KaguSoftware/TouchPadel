/**
 * The item editor's sections, drawn for the section dialog (SectionDialog):
 * what each section says, laid out for the person editing it. ItemForm owns
 * the state and the saves; these only draw and call back.
 *
 * Helper lines are an (i) beside the label (InfoTip), not a grey line under
 * the field. No panels inside the dialog: the dialog is the frame.
 */
import type { CSSProperties, ReactNode } from 'react';
import { formatNumber } from '@touch/i18n';
import { useLocale } from '../../../lib/i18n';
import { inputStyle } from '../../../components/ui';
import { Money, StatusBadge } from '../../../components/kit';
import { MoneyInput } from '../../../components/inputs';
import { ImageField } from '../../../components/ImageField';
import { InfoTip } from '../../../components/InfoTip';
import { Switch } from '../../../components/Switch';
import { Icon } from '../../../components/icons';
import { MARK, MARK_FG, MARK_SOFT } from '../../ops/OpsVisuals';
import { HIGHLIGHT_COLOR } from './chips';
import { DESCRIPTION_MAX, HOOK_MAX, NAME_MAX, marginBand, marginPct, type orderableState } from './menuLogic';
import type { Highlight } from './useAdminMenu';
import type { StockBlock } from './availability';

type Pair = { en: string; ar: string };

/** The dialog's text field: 48px tall, 12px corners, 16px text (the approved section designs). */
const field: CSSProperties = { ...inputStyle, minBlockSize: '3rem', borderRadius: '0.75rem', paddingInline: 'var(--tp-sp-3-5, 0.875rem)', fontSize: 'var(--tp-fs-lg)' };

const card: CSSProperties = {
  border: '1px solid var(--tp-border)',
  borderRadius: 'var(--tp-radius-panel)',
  padding: 'var(--tp-sp-4)',
  background: 'var(--tp-surface)',
};

/** A label with its (i) and, at the end, a counter or "optional". */
function Label({ text, tip, tipLabel, end, required }: { text: string; tip?: ReactNode; tipLabel?: string; end?: ReactNode; required?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--tp-sp-2)', marginBlockEnd: 'var(--tp-sp-1)' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', fontSize: 'var(--tp-fs-sm)', fontWeight: 700 }}>
        <span className={required ? 'tp-req' : undefined}>{text}</span>
        {tip && <InfoTip content={tip} label={tipLabel ?? text} />}
      </span>
      {end && <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>{end}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ Details */

export function DetailsSection({
  name,
  desc,
  hook,
  onName,
  onDesc,
  onHook,
  hookError,
  readOnly,
}: {
  name: Pair;
  desc: Pair;
  hook: Pair;
  onName: (next: Pair) => void;
  onDesc: (next: Pair) => void;
  onHook: (next: Pair) => void;
  hookError?: string;
  readOnly: boolean;
}) {
  const { tr, locale } = useLocale();
  const count = (v: string, max: number) => `${formatNumber(v.length, locale)} / ${formatNumber(max, locale)}`;
  const langs = [
    { k: 'en' as const, title: tr('ws.kit.bilingual.en'), dir: 'ltr' as const },
    { k: 'ar' as const, title: tr('ws.kit.bilingual.ar'), dir: 'rtl' as const },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(17rem, 1fr))', gap: 'var(--tp-sp-4)', alignItems: 'start' }}>
      {langs.map(({ k, title, dir }) => (
        <div key={k} style={{ ...card, display: 'grid', gap: 'var(--tp-sp-4)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)', fontWeight: 800, fontSize: 'var(--tp-fs-sm)' }}>
            <span
              aria-hidden="true"
              style={{ background: 'var(--tp-accent-soft)', color: 'var(--tp-accent-soft-fg)', borderRadius: 'var(--tp-radius-sm)', paddingBlock: '0.1rem', paddingInline: 'var(--tp-sp-1-5)', fontSize: 'var(--tp-fs-xs)' }}
            >
              {k.toUpperCase()}
            </span>
            {title}
          </span>
          <div>
            <Label text={tr('ws.manager.menu.form.name')} required end={count(name[k], NAME_MAX)} />
            <input
              style={field}
              dir={dir}
              lang={k === 'ar' ? 'ar' : undefined}
              value={name[k]}
              maxLength={NAME_MAX}
              disabled={readOnly}
              aria-label={`${tr('ws.manager.menu.form.name')}: ${title}`}
              onChange={(e) => onName({ ...name, [k]: e.target.value })}
            />
          </div>
          <div>
            <Label text={tr('ws.manager.menu.form.description')} end={count(desc[k], DESCRIPTION_MAX)} />
            <textarea
              style={{ ...field, minBlockSize: '6rem', resize: 'none', lineHeight: 1.45, paddingBlock: 'var(--tp-sp-3)', fontFamily: 'inherit' }}
              dir={dir}
              lang={k === 'ar' ? 'ar' : undefined}
              value={desc[k]}
              maxLength={DESCRIPTION_MAX}
              disabled={readOnly}
              aria-label={`${tr('ws.manager.menu.form.description')}: ${title}`}
              onChange={(e) => onDesc({ ...desc, [k]: e.target.value })}
            />
          </div>
          <div>
            <Label
              text={tr('ws.manager.menu.form.hook')}
              tip={tr('ws.manager.menu.form.hookHint', { max: HOOK_MAX })}
              end={count(hook[k], HOOK_MAX)}
            />
            <input
              style={field}
              dir={dir}
              lang={k === 'ar' ? 'ar' : undefined}
              value={hook[k]}
              maxLength={HOOK_MAX}
              disabled={readOnly}
              aria-label={`${tr('ws.manager.menu.form.hook')}: ${title}`}
              onChange={(e) => onHook({ ...hook, [k]: e.target.value })}
            />
          </div>
        </div>
      ))}
      {hookError && (
        <span role="alert" style={{ gridColumn: '1 / -1', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-danger-fg)' }}>
          {hookError}
        </span>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- Photo, highlight */

const HIGHLIGHTS: readonly Highlight[] = ['none', 'blue', 'brown'];

export function PhotoSection({
  photo,
  onPhoto,
  photoBusy,
  ownerId,
  highlight,
  onHighlight,
  itemName,
  price,
  readOnly,
}: {
  photo: string | null;
  onPhoto: (next: string | null) => void;
  photoBusy: boolean;
  ownerId: string;
  highlight: Highlight;
  onHighlight: (h: Highlight) => void;
  /** What the card calls the item: the name as typed so far. */
  itemName: string;
  price: number | null;
  readOnly: boolean;
}) {
  const { tr } = useLocale();
  const pill: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--tp-sp-2)',
    borderRadius: 'var(--tp-radius-pill)',
    fontWeight: 700,
    fontSize: 'var(--tp-fs-sm)',
  };
  const ring = highlight === 'none' ? 'var(--tp-border-strong)' : HIGHLIGHT_COLOR[highlight];
  return (
    /* The stage: the item as a guest sees it, in the middle, ringed in the highlight colour. */
    <div style={{ inlineSize: '100%', display: 'flex', justifyContent: 'center', padding: 'var(--tp-sp-5)', borderRadius: 'var(--tp-radius-panel)', background: 'var(--tp-surface-2)' }}>
      <div
        style={{
          inlineSize: '100%',
          maxInlineSize: '27.5rem',
          borderRadius: 'var(--tp-radius-panel)',
          background: 'var(--tp-surface)',
          border: `3px solid ${ring}`,
          boxShadow: '0 0.6rem 1.75rem color-mix(in oklab, var(--tp-fg) 14%, transparent)',
          overflow: 'hidden',
          transition: 'border-color var(--tp-dur-fast) var(--tp-ease-out)',
        }}
      >
        <ImageField
          label={tr('op.menu.photo')}
          hideLabel
          framed
          value={photo}
          onChange={onPhoto}
          folder="items"
          ownerId={ownerId}
          aspect="16:9"
          disabled={readOnly || photoBusy}
          style={{ marginBlockEnd: 0 }}
          stage={{
            flush: true,
            actionsTop: true,
            topStart: (
              <span style={{ ...pill, paddingBlock: 'var(--tp-sp-1)', paddingInlineStart: 'var(--tp-sp-3)', paddingInlineEnd: 'var(--tp-sp-1)', background: 'color-mix(in oklab, var(--tp-fg) 70%, transparent)', color: 'var(--tp-accent-contrast)', fontSize: 'var(--tp-fs-xs)' }}>
                {tr('op.menu.photo')}
                <InfoTip content={tr('op.menu.photoHint')} label={tr('op.menu.photo')} style={{ color: 'var(--tp-accent-contrast)', marginBlock: 0 }} />
              </span>
            ),
          }}
        />
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--tp-sp-3)', padding: 'var(--tp-sp-3) var(--tp-sp-4)' }}>
          <strong style={{ fontSize: 'var(--tp-fs-xl)', minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <bdi>{itemName}</bdi>
          </strong>
          {price !== null && (
            <span style={{ fontSize: 'var(--tp-fs-lg)', fontWeight: 700, color: 'var(--tp-success-fg)' }}>
              <Money amount={price} />
            </span>
          )}
        </div>
        <div
          role="group"
          aria-label={tr('op.menu.highlight')}
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-3)', padding: 'var(--tp-sp-3) var(--tp-sp-4)', borderBlockStart: '1px solid var(--tp-border)', background: 'var(--tp-surface-2)' }}
        >
          <span style={{ marginInlineEnd: 'auto', display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', fontSize: 'var(--tp-fs-sm)', fontWeight: 700 }}>
            {tr('op.menu.highlight')}
            <InfoTip content={tr('op.menu.highlightHint')} label={tr('op.menu.highlight')} style={{ marginBlock: 0 }} />
          </span>
          {HIGHLIGHTS.map((h) => {
            const selected = highlight === h;
            // 'brown' is a stored value; the guest menu paints it green (chips.tsx).
            const label = h === 'none' ? tr('op.menu.highlightNone') : h === 'blue' ? tr('op.menu.highlightBlue') : tr('op.menu.highlightBrown');
            return (
              <label key={h} title={label} style={{ display: 'inline-flex', cursor: readOnly ? 'not-allowed' : 'pointer' }}>
                <input
                  type="radio"
                  name="highlight"
                  value={h}
                  checked={selected}
                  disabled={readOnly}
                  aria-label={label}
                  onChange={() => onHighlight(h)}
                  style={{ position: 'absolute', opacity: 0, inlineSize: 0, blockSize: 0 }}
                />
                <span
                  aria-hidden="true"
                  style={{
                    display: 'grid',
                    placeItems: 'center',
                    inlineSize: '2.1rem',
                    blockSize: '2.1rem',
                    borderRadius: '50%',
                    background: HIGHLIGHT_COLOR[h],
                    border: h === 'none' ? '2px dashed var(--tp-muted-fg)' : 'none',
                    outline: `3px solid ${selected ? 'var(--tp-accent)' : 'transparent'}`,
                    outlineOffset: '3px',
                    color: h === 'brown' ? 'var(--tp-accent-2-contrast)' : 'var(--tp-accent-contrast)',
                  }}
                >
                  {selected && h !== 'none' && <Icon name="check" size={16} strokeWidth={3.2} />}
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Cost, status */

export function CostSection({
  price,
  cost,
  onCost,
  onCostBlur,
  costBusy,
  isActive,
  onActive,
  activeDisabled,
  activeHint,
  activeAction,
  readOnly,
  showFigures,
}: {
  price: number | null;
  cost: number | null;
  onCost: (next: number | null) => void;
  onCostBlur: () => void;
  costBusy: boolean;
  isActive: boolean;
  onActive: (next: boolean) => void;
  activeDisabled: boolean;
  activeHint: ReactNode;
  activeAction?: ReactNode;
  readOnly: boolean;
  /** A saved item has a price and a margin to show; a new one does not yet. */
  showFigures: boolean;
}) {
  const { tr, locale } = useLocale();
  const pct = marginPct(price, cost);
  const band = marginBand(pct);
  const marginTone = band === 'good' ? 'success' : band === 'ok' ? 'warn' : band === 'bad' ? 'danger' : null;
  const unit = tr('ws.manager.menu.form.iqd');
  const key: CSSProperties = { fontSize: 'var(--tp-fs-xs)', fontWeight: 700, color: 'var(--tp-muted-fg)' };
  const figure: CSSProperties = { fontSize: 'var(--tp-fs-3xl)', fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 };
  const money = (amount: number | null) =>
    amount === null ? (
      <span style={{ color: 'var(--tp-muted-fg)' }}>—</span>
    ) : (
      <>
        <Money amount={amount} unit={false} /> <small style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: 'var(--tp-muted-fg)' }}>{unit}</small>
      </>
    );
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
      <div style={{ ...card, padding: 'var(--tp-sp-5)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))', gap: 'var(--tp-sp-8, 2rem)', alignItems: 'center' }}>
        <div>
          <Label text={tr('ws.manager.menu.form.costPerServing')} tip={tr('op.menu.costHint')} end={tr('op.common.optional')} />
          {/* The box and its IQD end are one control, as in the approved design. */}
          <span
            onBlur={onCostBlur}
            style={{ display: 'flex', alignItems: 'stretch', border: '1px solid var(--tp-border-strong)', borderRadius: '0.75rem', overflow: 'hidden', background: 'var(--tp-surface)' }}
          >
            <MoneyInput
              value={cost}
              onChange={onCost}
              allowEmpty
              bare
              disabled={readOnly || costBusy}
              aria-label={tr('op.menu.cost')}
              style={{ flex: 1, minInlineSize: 0 }}
              inputStyle={{ border: 'none', borderRadius: 0, background: 'transparent', minBlockSize: '3.5rem', fontSize: 'var(--tp-fs-2xl)', fontWeight: 700 }}
            />
            <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', paddingInline: 'var(--tp-sp-4)', fontSize: 'var(--tp-fs-sm)', fontWeight: 700, color: 'var(--tp-muted-fg)', background: 'var(--tp-surface-2)' }}>
              {unit}
            </span>
          </span>
        </div>
        {showFigures && (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cost !== null ? 3 : 1}, minmax(0, 1fr))`, gap: 'var(--tp-sp-3)' }}>
              <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
                <span style={key}>{tr('op.menu.defaultPrice')}</span>
                <span style={figure}>{money(price)}</span>
              </div>
              {cost !== null && (
                <>
                <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
                  <span style={key}>{tr('ws.manager.menu.form.costShort')}</span>
                  <span style={figure}>{money(cost)}</span>
                </div>
                <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
                  <span style={key}>{tr('ws.manager.menu.form.marginShort')}</span>
                  <span style={{ ...figure, color: marginTone ? MARK_FG[marginTone] : 'var(--tp-muted-fg)' }}>{pct !== null ? `${formatNumber(pct, locale)}%` : '—'}</span>
                </div>
                </>
              )}
            </div>
            {pct !== null && (
              <>
                <div
                  role="img"
                  aria-label={`${tr('ws.manager.menu.form.costShort')} ${formatNumber(100 - pct, locale)}%, ${tr('ws.manager.menu.form.marginShort')} ${formatNumber(pct, locale)}%`}
                  style={{ display: 'flex', blockSize: '0.75rem', borderRadius: 'var(--tp-radius-pill)', overflow: 'hidden', background: 'var(--tp-surface-3)' }}
                >
                  <i style={{ display: 'block', inlineSize: `${Math.min(100, Math.max(0, 100 - pct))}%`, background: MARK.warn }} />
                  <i style={{ display: 'block', inlineSize: `${Math.min(100, Math.max(0, pct))}%`, background: MARK.success }} />
                </div>
                <div style={{ display: 'flex', gap: 'var(--tp-sp-4)', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                  <span>
                    {tr('ws.manager.menu.form.costShort')} {formatNumber(100 - pct, locale)}%
                  </span>
                  <span>
                    {tr('ws.manager.menu.form.marginShort')} {formatNumber(pct, locale)}%
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <div style={{ ...card, padding: 'var(--tp-sp-5)', display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-5)', flexWrap: 'wrap' }}>
        <Switch checked={isActive} disabled={readOnly || activeDisabled} onChange={onActive} label={tr('op.menu.isActive')} hideLabel />
        <div style={{ flex: '1 1 14rem', display: 'grid', gap: 'var(--tp-sp-0)' }}>
          <strong style={{ fontSize: 'var(--tp-fs-lg)' }}>{tr('ws.manager.menu.form.onSale')}</strong>
          <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{activeHint}</span>
        </div>
        {activeAction}
        <StatusBadge tone={isActive ? 'success' : 'neutral'} label={isActive ? tr('op.menu.isActive') : tr('ws.manager.menu.inactive')} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Availability */

export function AvailabilitySection({
  saved,
  state,
  soldOut,
  onSoldOut,
  offToday,
  backOn,
  onOffToday,
  offBusy,
  stockBlock,
  readOnly,
  ingredientNames,
}: {
  saved: boolean;
  state: ReturnType<typeof orderableState>;
  soldOut: boolean;
  onSoldOut: (next: boolean) => void | Promise<void>;
  offToday: boolean;
  backOn: string | null;
  /** true restores the item, false marks it off for today. */
  onOffToday: (available: boolean) => void;
  offBusy: boolean;
  stockBlock: StockBlock;
  readOnly: boolean;
  ingredientNames: string[];
}) {
  const { tr } = useLocale();
  if (!saved) return <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.manager.menu.form.saveFirst')}</p>;
  const ok = state === 'orderable';
  const tone = ok ? 'success' : 'warn';
  const blocked = stockBlock.blocked;
  // One row of the controls: what it does, what it will do, and its switch.
  const row = (key: string, title: string, hint: ReactNode, control: ReactNode, last = false) => (
    <div
      key={key}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--tp-sp-4)',
        paddingBlock: 'var(--tp-sp-4)',
        borderBlockEnd: last ? undefined : '1px solid var(--tp-border)',
      }}
    >
      <div style={{ flex: 1, minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-0)' }}>
        <strong style={{ fontSize: 'var(--tp-fs-md)' }}>{title}</strong>
        <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{hint}</span>
      </div>
      {control}
    </div>
  );
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
      {/* The answer first, and when stock is the reason, the reason with it. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--tp-sp-4)',
          padding: 'var(--tp-sp-4)',
          borderRadius: 'var(--tp-radius-panel)',
          background: MARK_SOFT[tone],
          border: `1px solid ${MARK[tone]}`,
        }}
      >
        <span style={{ display: 'grid', placeItems: 'center', inlineSize: '3rem', blockSize: '3rem', borderRadius: '50%', background: 'var(--tp-surface)', flex: '0 0 auto' }}>
          <Icon name={ok ? 'checkCircle' : 'ban'} size={24} style={{ color: MARK[tone] }} />
        </span>
        <div style={{ flex: 1, minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
          <strong style={{ fontSize: 'var(--tp-fs-xl)', color: MARK_FG[tone] }}>{tr(`ws.manager.menu.form.now.${state}`)}</strong>
          {blocked && ingredientNames.length > 0 && (
            <span style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
              {ingredientNames.map((n) => (
                <bdi
                  key={n}
                  style={{ paddingBlock: 'var(--tp-sp-0)', paddingInline: 'var(--tp-sp-2-5)', borderRadius: 'var(--tp-radius-pill)', background: 'var(--tp-surface)', border: `1px solid ${MARK[tone]}`, color: MARK_FG[tone], fontWeight: 600, fontSize: 'var(--tp-fs-sm)' }}
                >
                  {n}
                </bdi>
              ))}
            </span>
          )}
        </div>
        {blocked && <InfoTip content={tr('ws.manager.menu.form.blockedBody')} label={`${tr('ws.kit.infoTip.label')}: ${tr('ws.manager.menu.form.blockedTitle')}`} />}
      </div>

      {/* The two things a manager can change here, as two switches in one list. */}
      <div style={{ ...card, paddingBlock: 0 }}>
        {row(
          'sold',
          tr('op.menu.soldOutShort'),
          tr('ws.manager.menu.form.soldOutHint'),
          <Switch checked={soldOut} disabled={readOnly} onChange={onSoldOut} label={tr('op.menu.soldOutShort')} hideLabel tone="danger" />,
        )}
        {row(
          'today',
          tr('ws.manager.menu.form.markOff'),
          offToday ? <bdi>{tr('ws.manager.menu.form.offTodayUntil', { date: backOn ?? '' })}</bdi> : tr('ws.manager.menu.form.offTodayHint'),
          <Switch checked={offToday} disabled={readOnly || offBusy} onChange={(next) => onOffToday(!next)} label={tr('ws.manager.menu.form.markOff')} hideLabel tone="danger" />,
          true,
        )}
      </div>
    </div>
  );
}
