/**
 * A sent record, read back in words (build-contracts-2026-09-23 §5.4 "the run
 * sheet: … records"). Walked from the same field list the form is drawn from,
 * so a field reads under the label it was asked with. An id reads as the thing
 * it names when this screen knows it (a size, a court, a section, an
 * ingredient, a campaign); an id it cannot name is left out rather than shown
 * as a code.
 *
 * Free text is shown as typed, isolated, in its own direction (§4).
 */
import type { ReactNode } from 'react';
import { formatDate, formatDateTime, formatIQD, formatNumber } from '@touch/i18n';
import { stepForm, type FieldDef, type PriceChangeKind, type ProtocolKind, type TournamentVariant } from '@touch/core/protocols';
import { useLocale } from '../../lib/i18n';
import { DescriptionList } from '../../components/kit';
import { fieldLabelKey, optionLabelKey } from './labels';
import { isObj, isPurged, pickText } from './protocolLogic';
import { useCafeCategories, useCourts, useIngredients } from './api';
import { PhotoStrip } from './PhotoField';

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Names this screen already holds, by id (sizes of the item, candidates, add-ons). */
export type NameBook = Record<string, { en: string; ar: string }>;

export function RecordView({
  kind,
  stepKey,
  variant,
  record,
  names,
}: {
  kind: ProtocolKind;
  stepKey: string | null;
  variant: TournamentVariant | null;
  record: Record<string, unknown>;
  names?: NameBook;
}) {
  const { tr, locale } = useLocale();
  const change = typeof record.change === 'string' ? (record.change as PriceChangeKind) : null;
  const form = stepForm(kind, stepKey, { variant, change });
  const wantsIngredients = Array.isArray(record.lines);
  const courts = useCourts(JSON.stringify(record).includes('court'));
  const categories = useCafeCategories(typeof record.category_id === 'string');
  const ingredients = useIngredients(wantsIngredients);

  const book: NameBook = { ...(names ?? {}) };
  for (const c of courts.data ?? []) book[c.id] = { en: c.name_en, ar: c.name_ar };
  for (const c of categories.data ?? []) book[c.id] = { en: c.name_en, ar: c.name_ar };
  for (const i of ingredients.data ?? []) book[i.id] = { en: i.name_en, ar: i.name_ar };
  const nameOf = (id: unknown): string | null => {
    if (typeof id !== 'string') return null;
    const n = book[id];
    return n ? pickText(locale, n.en, n.ar) : null;
  };

  const label = (path: string[]) => {
    const k = fieldLabelKey(path);
    return k ? tr(k) : path[path.length - 1] ?? '';
  };

  function show(def: FieldDef, value: unknown, path: string[]): ReactNode {
    if (value === undefined || value === null || value === '') return null;
    switch (def.type) {
      case 'text':
      case 'longText':
      case 'url':
        if (typeof value !== 'string') return null;
        // The launch names the photo it put on the menu: shown, never as its storage path.
        if (def.name === 'photo_path') return <PhotoStrip paths={[value]} title={label(path)} />;
        return (
          <bdi dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
            {isPurged(value) ? tr('work.protocol.noteDeleted') : value}
          </bdi>
        );
      case 'enum': {
        const k = optionLabelKey(path, String(value));
        return k ? tr(k) : String(value);
      }
      case 'iqd':
        return typeof value === 'number' ? <span dir="ltr">{formatIQD(value, locale)}</span> : null;
      case 'int':
      case 'number':
        return typeof value === 'number' ? formatNumber(value, locale) : null;
      case 'date':
        return typeof value === 'string' ? formatDate(new Date(`${value}T12:00:00`), locale) : null;
      case 'datetime':
        return typeof value === 'string' ? formatDateTime(new Date(value), locale) : null;
      case 'time':
        return typeof value === 'string' ? <span dir="ltr">{value.slice(0, 5)}</span> : null;
      case 'bool':
        return tr(value === true ? 'common.yes' : 'common.no');
      case 'uuid':
        return nameOf(value);
      case 'uuids': {
        const list = Array.isArray(value) ? value.map(nameOf).filter((x): x is string => x !== null) : [];
        return list.length > 0 ? list.join(tr('ws.protocols.view.listJoin')) : null;
      }
      case 'ints':
        if (!Array.isArray(value)) return null;
        if (value.length === 0 || value.length === 7) return tr('ws.protocols.view.everyDay');
        return value
          .filter((d): d is number => typeof d === 'number' && d >= 0 && d <= 6)
          .map((d) => tr(`op.days.${WEEKDAYS[d]!}`))
          .join(tr('ws.protocols.view.listJoin'));
      case 'priceMap':
        if (!isObj(value)) return null;
        return (
          <ul style={{ margin: 0, paddingInlineStart: '1.1rem' }}>
            {Object.entries(value)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([m, p]) => (
                <li key={m}>
                  {tr('ws.protocols.form.minutes', { n: formatNumber(Number(m), locale) })}: <span dir="ltr">{typeof p === 'number' ? formatIQD(p, locale) : '—'}</span>
                </li>
              ))}
          </ul>
        );
      case 'object': {
        if (!isObj(value)) return null;
        const items = (def.fields ?? [])
          .map((m) => ({ label: label([...path, m.name]), value: show(m, value[m.name], [...path, m.name]) }))
          .filter((x) => x.value !== null);
        return items.length > 0 ? <DescriptionList columns={items.length > 3 ? 2 : 1} items={items} /> : null;
      }
      case 'list': {
        if (!Array.isArray(value) || value.length === 0) return null;
        return (
          <ul style={{ margin: 0, paddingInlineStart: '1.1rem', display: 'grid', gap: 'var(--tp-sp-0)' }}>
            {value.map((el, i) => {
              if (!isObj(el)) return null;
              // A recipe line reads as "Whole milk · 200 ml".
              if ('qty' in el && 'unit' in el) {
                const name = nameOf(el.ingredient_id) ?? (typeof el.label === 'string' ? el.label : null);
                const unitKey = optionLabelKey([...path, 'unit'], String(el.unit));
                const amount = typeof el.qty === 'number' ? `${formatNumber(el.qty, locale)} ${unitKey ? tr(unitKey) : String(el.unit)}` : null;
                return (
                  <li key={i}>
                    {name ? <bdi>{name}</bdi> : null}
                    {name && amount ? ' · ' : null}
                    {amount ? <span dir="ltr">{amount}</span> : null}
                  </li>
                );
              }
              const parts = (def.fields ?? [])
                .map((m) => {
                  const shown = show(m, el[m.name], [...path, m.name]);
                  if (shown === null) return null;
                  // A size or an add-on names the row; figures follow it.
                  return m.type === 'uuid' || m.name === 'label' || m.name.startsWith('name_') ? shown : <>{label([...path, m.name])}: {shown}</>;
                })
                .filter((x) => x !== null);
              if (parts.length === 0) return null;
              return (
                <li key={i}>
                  {parts.map((p, j) => (
                    <span key={j}>
                      {j > 0 && ' · '}
                      {p}
                    </span>
                  ))}
                </li>
              );
            })}
          </ul>
        );
      }
    }
  }

  const fields = form?.fields ?? [];
  const items = fields
    .map((f) => ({ label: label([f.name]), value: show(f, record[f.name], [f.name]) }))
    .filter((x) => x.value !== null);
  if (items.length === 0) return <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.protocols.view.nothingTyped')}</p>;
  return <DescriptionList columns={items.length > 4 ? 2 : 1} items={items} />;
}
