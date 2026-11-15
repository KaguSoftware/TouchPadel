/**
 * The four steps of a product release that someone fills in (test, price,
 * marketing, launch), drawn to the approved mockup "Release step screens"
 * (Test B, Price B, Marketing B, Launch B). They read and write the same
 * record the generic form does (`value` is the form's working object), so what
 * is validated and sent does not change; only how it is asked.
 *
 * The send button lives in the run wizard's footer. `FooterSend` puts it
 * there through `SendSlot`, and falls back to drawing it in place when the
 * step is opened outside the wizard (/tasks).
 */
import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formatIQD, formatNumber, type MessageKey } from '@touch/i18n';
import { RECORD_CAPS, type FieldIssue } from '@touch/core/protocols';
import { appRpc, type AppFunctionName } from '../../lib/appRpc';
import { isImageFile } from '../../lib/image';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText, Select } from '../../components/ui';
import { Icon } from '../../components/icons';
import { digitsOnly } from '../../components/inputs';
import { PhotoViewer, useSignedPhoto } from '../checklists/StaffPhoto';
import { fromLocalInput, getAt, issueAt, setAt, toLocalInput, type Obj } from './formModel';
import { fieldLabelKey } from './labels';
import { discardRemovedPhoto, pickText } from './protocolLogic';
import { uploadStaffPhoto } from './PhotoField';
import { useCampaigns } from './api';
import type { StepContexts } from './StepContext';
import type { FormEnv } from './StepForm';

export const RELEASE_UI_STEPS = ['test', 'analysis', 'marketing', 'launch'] as const;
export type ReleaseUiStep = (typeof RELEASE_UI_STEPS)[number];

/** True for the release steps this file draws. */
export function hasReleaseUi(kind: string, stepKey: string | null): stepKey is ReleaseUiStep {
  return kind === 'product_release' && (RELEASE_UI_STEPS as readonly (string | null)[]).includes(stepKey);
}

// ── The footer's send button ─────────────────────────────────────────────────

export const SendSlot = createContext<HTMLElement | null>(null);

export function FooterSend({ busy, disabled, disabledReason, label, onClick }: { busy: boolean; disabled?: boolean; disabledReason?: string; label: string; onClick: () => void }) {
  const slot = useContext(SendSlot);
  const button = (
    <Button type="button" size="lg" className="tp-wiz-go" icon="check" busy={busy} disabled={disabled} disabledReason={disabledReason} onClick={onClick} data-testid="step-send">
      {label}
    </Button>
  );
  return slot ? createPortal(button, slot) : button;
}

/** A warning triangle filled bright amber with a black exclamation mark. The amber is fixed: the light theme's warn token is a dark brown that muddied the marker. */
function WarnMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.4 21.6 20H2.4Z" fill="#f5b431" stroke="#f5b431" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 9.6v4.4" stroke="var(--tp-brand-black)" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <circle cx="12" cy="17.2" r="1.4" fill="var(--tp-brand-black)" />
    </svg>
  );
}

// ── Shared pieces ────────────────────────────────────────────────────────────

type Tr = ReturnType<typeof useLocale>['tr'];

interface FormProps {
  stepKey: ReleaseUiStep;
  value: Obj;
  onChange: (next: Obj) => void;
  issues: readonly FieldIssue[];
  env: FormEnv;
  ctx: StepContexts;
  photos: string[];
  onPhotos: (next: string[]) => void;
  photoFolder?: string;
  photoMin: number;
  photoMax: number;
  disabled: boolean;
}

export function Card({ title, children, flat, aside }: { title?: ReactNode; children: ReactNode; flat?: boolean; aside?: ReactNode }) {
  return (
    <section className="tp-rel-card" data-flat={flat || undefined}>
      {(title || aside) && (
        <div className="tp-rel-row">
          <h5 className="tp-rel-h">{title}</h5>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

function issueMessage(tr: Tr, issue: FieldIssue | null): string | undefined {
  if (!issue) return undefined;
  return issue.code === 'TEXT_TOO_LONG' ? tr('ws.protocols.form.fieldTooLong') : tr('ws.protocols.form.fieldInvalid');
}

/** A labelled box: the label above, the control, the refusal beneath. */
function Box({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: ReactNode }) {
  return (
    <div className="tp-rel-f">
      <label>
        {label}
        {required ? <em> *</em> : null}
      </label>
      {children}
      {error && (
        <span className="tp-rel-err" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function TextBox({ path, value, set, issues, disabled, dir, required, max, rows }: { path: (string | number)[]; value: Obj; set: (path: (string | number)[], next: unknown) => void; issues: readonly FieldIssue[]; disabled: boolean; dir?: 'ltr' | 'rtl'; required?: boolean; max?: number; rows?: number }) {
  const { tr } = useLocale();
  const key = fieldLabelKey(path);
  const v = getAt(value, path);
  const text = typeof v === 'string' ? v : '';
  const error = issueMessage(tr, issueAt(issues, path));
  const common = { className: 'tp-rel-in', value: text, disabled, dir, 'aria-invalid': error ? true : undefined, onChange: (e: { target: { value: string } }) => set(path, e.target.value) } as const;
  return (
    <Box label={key ? tr(key) : String(path[path.length - 1])} required={required} error={error}>
      {rows ? <textarea {...common} rows={rows} /> : <input type="text" {...common} />}
      {max !== undefined && (
        <span className="tp-rel-cnt" dir="ltr">
          {formatNumber(text.length, 'en')} / {formatNumber(max, 'en')}
        </span>
      )}
    </Box>
  );
}

// ── Photos: tiles ────────────────────────────────────────────────────────────

function Tile({ path, label, onOpen, selected, onRemove, removeLabel }: { path: string; label: string; onOpen: () => void; selected?: boolean; onRemove?: () => void; removeLabel?: string }) {
  const q = useSignedPhoto(path);
  return (
    <div className="tp-rel-tile" data-sel={selected || undefined}>
      <button
        type="button"
        style={{ position: 'absolute', inset: 0, inlineSize: '100%', blockSize: '100%', padding: 0, border: 0, background: 'none', color: 'inherit', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
        aria-label={label}
        aria-pressed={selected}
        onClick={onOpen}
      >
        {q.isSuccess ? <img src={q.data} alt="" style={{ display: 'block', inlineSize: '100%', blockSize: '100%', objectFit: 'cover' }} /> : <Icon name="image" size={22} />}
      </button>
      {selected && (
        <span className="tp-rel-pick" aria-hidden="true">
          <Icon name="check" size={12} strokeWidth={3} />
        </span>
      )}
      {onRemove && (
        <button type="button" className="tp-rel-x" aria-label={removeLabel} title={removeLabel} onClick={onRemove}>
          <Icon name="x" size={12} strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

/** Photos of a step as a grid of tiles: the ones sent so far, then Camera and Upload. */
export function PhotoTiles({ folder, paths, onChange, max, disabled, invalid }: { folder: string; paths: string[]; onChange: (next: string[]) => void; max: number; disabled: boolean; invalid?: boolean }) {
  const { tr, locale } = useLocale();
  const upload = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notImage, setNotImage] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const room = max - paths.length;

  async function add(files: FileList | null, input: HTMLInputElement | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setNotImage(false);
    setBusy(true);
    const added: string[] = [];
    try {
      for (const file of [...files].slice(0, Math.max(0, room))) {
        if (!isImageFile(file)) {
          setNotImage(true);
          continue;
        }
        added.push(await uploadStaffPhoto(file, folder));
      }
    } catch (e) {
      setError(e);
    } finally {
      if (added.length > 0) onChange([...paths, ...added]);
      setBusy(false);
      if (input) input.value = '';
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }} data-testid="photo-field">
      <div className="tp-rel-g4">
        {paths.map((p, i) => (
          <Tile
            key={p}
            path={p}
            label={tr('ws.protocols.photos.open', { n: formatNumber(i + 1, locale) })}
            onOpen={() => setViewing(p)}
            onRemove={
              disabled
                ? undefined
                : () => {
                    onChange(paths.filter((x) => x !== p));
                    // F-61: the removed photo leaves storage too (0391).
                    void discardRemovedPhoto(p, (fn, args) => appRpc(fn as AppFunctionName, args));
                  }
            }
            removeLabel={tr('ws.protocols.photos.remove', { n: formatNumber(i + 1, locale) })}
          />
        ))}
        {room > 0 && (
          <>
            <button type="button" className="tp-rel-tile" data-add="true" data-bad={invalid && paths.length === 0 ? true : undefined} disabled={busy || disabled} onClick={() => upload.current?.click()}>
              <Icon name="upload" size={22} />
              {busy ? tr('ws.protocols.rel.uploading') : tr('ws.protocols.rel.upload')}
            </button>
          </>
        )}
      </div>
      <input ref={upload} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden aria-hidden="true" tabIndex={-1} onChange={(e) => void add(e.target.files, upload.current)} />
      {invalid && <span className="tp-rel-err">{tr('ws.protocols.form.fieldInvalid')}</span>}
      {notImage && <span className="tp-rel-err">{tr('ws.protocols.photos.notImage')}</span>}
      {error != null &&
        (error instanceof Error && error.message === 'PHOTO_TOO_BIG' ? <span className="tp-rel-err">{tr('ws.protocols.photos.tooBig')}</span> : <ErrorText error={error} />)}
      {viewing && <PhotoViewer title={tr('ws.protocols.photos.label')} paths={[viewing]} onClose={() => setViewing(null)} />}
    </div>
  );
}

// ── Test B ───────────────────────────────────────────────────────────────────

function TestStep({ value, issues, env, ctx, photos, onPhotos, photoFolder, photoMax, disabled, set }: FormProps & { set: Setter }) {
  const { tr, locale } = useLocale();
  const sizes = env.sizes ?? [];
  const rows = (Array.isArray(value.servings) ? value.servings : []) as { variant_id: string; count: number | null }[];
  const countOf = (id: string) => rows.find((r) => r.variant_id === id)?.count ?? 0;
  const put = (id: string, count: number) =>
    set(
      ['servings'],
      sizes
        .map((s) => (s.variant_id === id ? { variant_id: id, count } : rows.find((r) => r.variant_id === s.variant_id)))
        .filter((r): r is { variant_id: string; count: number | null } => r !== undefined && r.count !== null && r.count !== 0),
    );
  const recipe = ctx.test?.sizes.filter((s) => s.lines.length > 0) ?? [];
  const servingsError = issueMessage(tr, issueAt(issues, ['servings']));
  const photosBad = issues.some((i) => i.field === 'photos');
  return (
    <>
      {recipe.length > 0 && (
        <Card title={tr('ws.protocols.rel.takeOut')}>
          {recipe.map((s) => (
            <div key={s.variant_id} style={{ display: 'grid', gap: 8 }}>
              {recipe.length > 1 && <strong style={{ fontSize: 13 }}>{pickText(locale, s.name_en, s.name_ar)}</strong>}
              {s.lines.map((l, i) => (
                <div key={i} className="tp-rel-ck">
                  <u aria-hidden="true">
                    <Icon name="check" size={20} strokeWidth={3.4} />
                  </u>
                  <bdi>{pickText(locale, l.name_en, l.name_ar)}</bdi>
                  <b style={{ marginInlineStart: 'auto' }} dir="ltr">
                    {formatNumber(l.qty, locale)} {l.unit}
                  </b>
                </div>
              ))}
            </div>
          ))}
        </Card>
      )}
      <Card title={tr('ws.protocols.rel.howMany')}>
        {sizes.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.protocols.form.noSizes')}</p>
        ) : (
          <div className="tp-rel-g2">
            {sizes.map((s) => {
              const n = countOf(s.variant_id);
              const name = pickText(locale, s.name_en, s.name_ar);
              return (
                <div key={s.variant_id} style={{ position: 'relative', minInlineSize: 0, display: 'grid' }}>
                  <button type="button" className="tp-rel-choice" aria-pressed={n > 0} disabled={disabled} onClick={() => put(s.variant_id, Math.min(50, n + 1))}>
                    <b>
                      <bdi>{name}</bdi>
                    </b>
                    <span>{n > 0 ? tr('ws.protocols.rel.made', { count: formatNumber(n, locale) }) : tr('ws.protocols.rel.tapToAdd')}</span>
                  </button>
                  {n > 0 && !disabled && (
                    <button type="button" className="tp-rel-minus" aria-label={tr('ws.protocols.rel.takeOne', { size: name })} title={tr('ws.protocols.rel.takeOne', { size: name })} onClick={() => put(s.variant_id, n - 1)}>
                      <Icon name="minus" size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {servingsError && <span className="tp-rel-err">{servingsError}</span>}
      </Card>
      {photoFolder && photoMax > 0 && (
        <Card title={tr('ws.protocols.rel.takePhoto')}>
          <PhotoTiles folder={photoFolder} paths={photos} onChange={onPhotos} max={photoMax} disabled={disabled} invalid={photosBad} />
        </Card>
      )}
      <TextBox path={['notes']} value={value} set={set} issues={issues} disabled={disabled} rows={3} />
    </>
  );
}

// ── Price B ──────────────────────────────────────────────────────────────────

/** The price that leaves this share of the price as margin, rounded up to 250 IQD. */
const TARGET_MARGIN = 0.6;
const suggestedPrice = (cost: number) => Math.ceil(cost / (1 - TARGET_MARGIN) / 250) * 250;

function PriceStep({ value, issues, env, ctx, disabled, set }: FormProps & { set: Setter }) {
  const { tr, locale } = useLocale();
  const sizes = env.sizes ?? [];
  const rows = (Array.isArray(value.prices) ? value.prices : []) as { variant_id: string; price_iqd: number | null }[];
  const priceOf = (id: string) => rows.find((r) => r.variant_id === id)?.price_iqd ?? null;
  const put = (id: string, price: number | null) => {
    const others = rows.filter((r) => r.variant_id !== id);
    set(
      ['prices'],
      sizes.map((s) => (s.variant_id === id ? { variant_id: id, price_iqd: price } : others.find((r) => r.variant_id === s.variant_id))).filter((r): r is { variant_id: string; price_iqd: number | null } => r !== undefined),
    );
  };
  const costOf = (id: string) => {
    const c = ctx.cost?.sizes.find((s) => s.variant_id === id);
    return c && c.cost_known && c.cost_iqd !== null ? c.cost_iqd : null;
  };
  const pricesError = issueMessage(tr, issueAt(issues, ['prices']));
  return (
    <>
      <div className="tp-rel-g2">
        {sizes.map((s) => {
          const price = priceOf(s.variant_id);
          const cost = costOf(s.variant_id);
          const pct = cost !== null && price !== null && price > 0 ? Math.round(((price - cost) / price) * 100) : null;
          const hint = cost !== null ? suggestedPrice(cost) : null;
          return (
            <Card key={s.variant_id}>
              <div className="tp-rel-row">
                <b style={{ fontSize: 18 }}>
                  <bdi>{pickText(locale, s.name_en, s.name_ar)}</bdi>
                </b>
                {pct !== null && (
                  <span className="tp-rel-pill" data-tone={pct >= 50 ? 'ok' : 'warn'}>
                    {tr('ws.protocols.rel.margin', { pct: formatNumber(pct, locale) })}
                  </span>
                )}
              </div>
              <Box label={tr('ws.protocols.rel.price')} required>
                <span className="tp-rel-money">
                  <input
                    className="tp-rel-in"
                    data-big="true"
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="off"
                    style={{ paddingInlineEnd: '3.5rem', fontVariantNumeric: 'tabular-nums' }}
                    value={price === null ? '' : price.toLocaleString('en-US')}
                    disabled={disabled}
                    aria-label={`${tr('ws.protocols.rel.price')} ${pickText(locale, s.name_en, s.name_ar)}`}
                    onChange={(e) => {
                      const digits = digitsOnly(e.target.value);
                      const n = Number(digits);
                      put(s.variant_id, digits === '' ? null : Number.isSafeInteger(n) ? n : price);
                    }}
                  />
                  <span className="tp-rel-unit">IQD</span>
                </span>
              </Box>
              <div className="tp-rel-sub">
                <span>{cost !== null ? tr('ws.protocols.rel.costLine', { amount: formatIQD(cost, locale) }) : tr('ws.protocols.rel.costUnknown')}</span>
                {hint !== null && (
                  <button type="button" className="tp-rel-go" style={{ marginInlineStart: 0 }} disabled={disabled} onClick={() => put(s.variant_id, hint)}>
                    {tr('ws.protocols.rel.suggested', { amount: formatNumber(hint, locale) })}
                  </button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      {pricesError && <span className="tp-rel-err">{pricesError}</span>}
      <div className="tp-rel-g2">
        <TextBox path={['name_en']} value={value} set={set} issues={issues} disabled={disabled} dir="ltr" required max={RECORD_CAPS.itemName} />
        <TextBox path={['name_ar']} value={value} set={set} issues={issues} disabled={disabled} dir="rtl" required max={RECORD_CAPS.itemName} />
      </div>
      <TextBox path={['notes']} value={value} set={set} issues={issues} disabled={disabled} rows={3} />
    </>
  );
}

// ── Marketing B ──────────────────────────────────────────────────────────────

function MarketingStep({ value, issues, photos, onPhotos, photoFolder, photoMax, disabled, set }: FormProps & { set: Setter }) {
  const { tr, locale } = useLocale();
  const campaigns = useCampaigns();
  const campaign = getAt(value, ['campaign_id']);
  return (
    <>
      <div className="tp-rel-g2">
        <Card title={tr('ws.protocols.rel.english')}>
          <TextBox path={['highlights_en']} value={value} set={set} issues={issues} disabled={disabled} dir="ltr" required rows={5} max={RECORD_CAPS.highlights} />
        </Card>
        <Card title={<span dir="rtl">{tr('ws.protocols.rel.arabic')}</span>}>
          <TextBox path={['highlights_ar']} value={value} set={set} issues={issues} disabled={disabled} dir="rtl" required rows={5} max={RECORD_CAPS.highlights} />
        </Card>
      </div>
      <div className="tp-rel-g2">
        <TextBox path={['hero', 'en']} value={value} set={set} issues={issues} disabled={disabled} dir="ltr" max={RECORD_CAPS.heroLine} />
        <TextBox path={['hero', 'ar']} value={value} set={set} issues={issues} disabled={disabled} dir="rtl" max={RECORD_CAPS.heroLine} />
        <TextBox path={['ticker', 'en']} value={value} set={set} issues={issues} disabled={disabled} dir="ltr" max={RECORD_CAPS.tickerLine} />
        <TextBox path={['ticker', 'ar']} value={value} set={set} issues={issues} disabled={disabled} dir="rtl" max={RECORD_CAPS.tickerLine} />
      </div>
      {campaigns.data && campaigns.data.length > 0 && (
        <Box label={tr(fieldLabelKey(['campaign_id']) ?? 'ws.protocols.form.noCampaign')}>
          <Select<string>
            value={typeof campaign === 'string' ? campaign : ''}
            disabled={disabled}
            options={[{ value: '', label: tr('ws.protocols.form.noCampaign') }, ...campaigns.data.map((c) => ({ value: c.id, label: pickText(locale, c.name_en, c.name_ar) }))]}
            onChange={(id) => set(['campaign_id'], id)}
          />
        </Box>
      )}
      {photoFolder && photoMax > 0 && (
        <Card title={tr('ws.protocols.rel.photos')} aside={<span className="tp-rel-chip" data-off="true">{tr('ws.protocols.rel.photosOptional', { max: formatNumber(photoMax, locale) })}</span>}>
          <PhotoTiles folder={photoFolder} paths={photos} onChange={onPhotos} max={photoMax} disabled={disabled} />
        </Card>
      )}
      <TextBox path={['notes']} value={value} set={set} issues={issues} disabled={disabled} rows={3} />
    </>
  );
}

// ── Launch B ─────────────────────────────────────────────────────────────────

function LaunchStep({ value, issues, env, ctx, disabled, set }: FormProps & { set: Setter }) {
  const { tr, locale } = useLocale();
  const photoCard = useRef<HTMLDivElement>(null);
  const [doneOpen, setDoneOpen] = useState(false);
  const when = value.when === 'date' ? 'date' : 'now';
  const chosen = typeof value.photo_path === 'string' ? value.photo_path : '';
  const photos = env.launchPhotos ?? [];
  const whenError = issueMessage(tr, issueAt(issues, ['at']));
  const photoBad = issueAt(issues, ['photo_path']) !== null;
  return (
    <>
      {ctx.readiness && (
        <Card title={tr('ws.protocols.rel.ready')}>
        <div className="tp-rel-list">
          {(() => {
            const doneCount = ctx.readiness.checks.filter((c) => c.ok).length;
            const left = ctx.readiness.checks.filter((c) => !c.ok);
            return (
              <>
                {doneCount > 0 && (
                  <>
                    <button type="button" className="tp-rel-ck" aria-expanded={doneOpen} onClick={() => setDoneOpen((o) => !o)}>
                      <u aria-hidden="true">
                        <Icon name="check" size={20} strokeWidth={3.4} />
                      </u>
                      <span>{left.length === 0 ? tr('ws.protocols.rel.allDone') : tr('ws.protocols.rel.checksDone', { count: formatNumber(doneCount, locale) })}</span>
                      <span className="tp-rel-go tp-rel-chev" data-open={doneOpen}>
                        <Icon name="chevronDown" size={16} />
                      </span>
                    </button>
                    <div className="tp-rel-fold" data-open={doneOpen} aria-hidden={!doneOpen}>
                      <div>
                        {ctx.readiness.checks
                          .filter((c) => c.ok)
                          .map((c) => (
                            <div key={c.key} className="tp-rel-ck" style={{ paddingInlineStart: 38 }}>
                              <u aria-hidden="true">
                                <Icon name="check" size={20} strokeWidth={3.4} />
                              </u>
                              <span>{tr(`ws.protocols.context.readiness.${c.key}` as MessageKey)}</span>
                              <span className="tp-rel-go">{tr('ws.protocols.rel.done')}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  </>
                )}
                {left.map((c) => (
                  <div key={c.key} className="tp-rel-ck">
                    <u data-warn="true" aria-hidden="true">
                      <WarnMark />
                    </u>
                    <span>{tr(`ws.protocols.context.readiness.${c.key}` as MessageKey)}</span>
                    {c.key === 'photo' ? (
                      <button type="button" className="tp-rel-go" onClick={() => photoCard.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
                        {tr('ws.protocols.rel.pick')}
                        <Icon name="arrowEnd" size={14} />
                      </button>
                    ) : (
                      <span className="tp-rel-go">{tr('ws.protocols.rel.missing')}</span>
                    )}
                  </div>
                ))}
              </>
            );
          })()}
          {ctx.readiness.warnings.map((w) => (
            <div key={w} className="tp-rel-ck">
              <u data-warn="true" aria-hidden="true">
                <WarnMark />
              </u>
              <span>{tr(`ws.protocols.context.readiness.warn_${w}` as MessageKey)}</span>
              <span className="tp-rel-go">{tr('ws.protocols.rel.check')}</span>
            </div>
          ))}
        </div>
        </Card>
      )}
      <div className="tp-rel-g2">
        <button type="button" className="tp-rel-choice" aria-pressed={when === 'now'} disabled={disabled} onClick={() => set(['when'], 'now')}>
          <b>{tr('ws.protocols.rel.launchNow')}</b>
          <span>{tr('ws.protocols.rel.launchNowBody')}</span>
        </button>
        <button type="button" className="tp-rel-choice" aria-pressed={when === 'date'} disabled={disabled} onClick={() => set(['when'], 'date')}>
          <b>{tr('ws.protocols.rel.pickDate')}</b>
          <span>{tr('ws.protocols.rel.pickDateBody')}</span>
        </button>
      </div>
      {when === 'date' && (
        <Box label={tr('ws.protocols.fields.at')} required error={whenError}>
          <input type="datetime-local" className="tp-rel-in" dir="ltr" value={toLocalInput(value.at)} disabled={disabled} aria-invalid={whenError ? true : undefined} onChange={(e) => set(['at'], fromLocalInput(e.target.value))} />
        </Box>
      )}
      <div ref={photoCard}>
        <Card title={<>{tr('ws.protocols.rel.menuPhoto')} <em>*</em></>}>
          {photos.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.protocols.form.noLaunchPhotos')}</p>
          ) : (
            <div className="tp-rel-g4">
              {photos.map((p, i) => (
                <Tile key={p} path={p} label={tr('ws.protocols.form.useLaunchPhoto', { n: formatNumber(i + 1, 'en') })} selected={p === chosen} onOpen={() => !disabled && set(['photo_path'], p)} />
              ))}
            </div>
          )}
          {photoBad && <span className="tp-rel-err">{tr('ws.protocols.form.fieldInvalid')}</span>}
        </Card>
      </div>
    </>
  );
}

// ── Entry ────────────────────────────────────────────────────────────────────

type Setter = (path: (string | number)[], next: unknown) => void;

export function ReleaseStepForm(props: FormProps) {
  const set: Setter = (path, next) => props.onChange(setAt(props.value, path, next) as Obj);
  return (
    <div className="tp-rel">
      {props.stepKey === 'test' && <TestStep {...props} set={set} />}
      {props.stepKey === 'analysis' && <PriceStep {...props} set={set} />}
      {props.stepKey === 'marketing' && <MarketingStep {...props} set={set} />}
      {props.stepKey === 'launch' && <LaunchStep {...props} set={set} />}
    </div>
  );
}

/** A blue note above a release step (you decide this step, a resubmission, covering). */
export function ReleaseNote({ children }: { children: ReactNode }) {
  return <div className="tp-rel-note">{children}</div>;
}
