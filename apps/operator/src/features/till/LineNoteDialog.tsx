/**
 * Line note dialog — opened by the note button on a basket line (and by the
 * same button on a line that already carries one). Presets are chips because
 * "extra shot" typed at a queue is four seconds the cashier does not have;
 * the free line stays under them because the presets will never cover the
 * guest who wants their latte in a takeaway cup with two straws.
 *
 * What the kitchen will read is shown, not implied: the preview line under the
 * field is the exact string that goes on the ticket, reserved at full height
 * so adding the first chip does not shove the footer down (rulebook 11.5).
 */
import { useMemo, useState } from 'react';
import { useLocale } from '../../lib/i18n';
import { Button, Field, Modal, inputStyle } from '../../components/ui';
import type { BasketLine } from './tillData';
import {
  NOTE_MAX_LENGTH,
  NOTE_PRESET_GROUPS,
  NOTE_PRESET_IDS,
  composeNote,
  splitNote,
} from './lineNotes';
import { muted, reasonedFooter, sectionTitle, touchTarget } from './tillStyles';

export function LineNoteDialog({
  line,
  onClose,
  onSave,
}: {
  line: BasketLine;
  onClose: () => void;
  onSave: (notes: string) => void;
}) {
  const { tr } = useLocale();

  // Labels are the identity of a chip once a note is a string, so they are
  // resolved once and both directions (split on open, compose on save) use
  // the same list.
  const labelOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const id of NOTE_PRESET_IDS) map.set(id, tr(`ws.cashier.till.note.preset.${id}`));
    return map;
  }, [tr]);
  const labels = useMemo(() => [...labelOf.values()], [labelOf]);

  const initial = useMemo(() => splitNote(line.notes, labels), [line.notes, labels]);
  const [chosen, setChosen] = useState<string[]>(initial.chosen);
  const [free, setFree] = useState(initial.free);

  const composed = composeNote(chosen, free);
  const changed = composed !== line.notes;

  function toggle(label: string) {
    setChosen((prev) => (prev.includes(label) ? prev.filter((c) => c !== label) : [...prev, label]));
  }

  return (
    <Modal
      title={tr('ws.cashier.till.note.title')}
      subtitle={`${line.qty}× ${line.itemName} (${line.variantName})`}
      onClose={onClose}
      footer={
        <div style={reasonedFooter}>
          <Button
            kind="ghost"
            icon="x"
            disabled={composed === ''}
            onClick={() => {
              setChosen([]);
              setFree('');
            }}
          >
            {tr('ws.cashier.till.note.clear')}
          </Button>
          <Button onClick={onClose}>{tr('common.cancel')}</Button>
          <Button kind="primary" size="lg" disabled={!changed} onClick={() => onSave(composed)}>
            {tr('ws.cashier.till.note.save')}
          </Button>
        </div>
      }
    >
      {NOTE_PRESET_GROUPS.map((g) => (
        <div key={g.id} style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>
          <p id={`note-group-${g.id}`} style={{ ...sectionTitle, marginBlockEnd: 'var(--tp-sp-1)' }}>
            {tr(`ws.cashier.till.note.group.${g.id}`)}
          </p>
          <div
            role="group"
            aria-labelledby={`note-group-${g.id}`}
            style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-1-5)' }}
          >
            {g.presets.map((id) => {
              const label = labelOf.get(id) ?? id;
              return (
                <Button
                  key={id}
                  size="lg"
                  aria-pressed={chosen.includes(label)}
                  onClick={() => toggle(label)}
                  style={touchTarget}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        </div>
      ))}

      <Field label={tr('ws.cashier.till.note.free')}>
        <input
          style={inputStyle}
          value={free}
          maxLength={NOTE_MAX_LENGTH}
          placeholder={tr('ws.cashier.till.note.freePlaceholder')}
          autoFocus
          onChange={(e) => setFree(e.target.value)}
          onKeyDown={(e) => {
            // Enter commits — a note is one field and the cashier's hand is
            // already leaving the keyboard for the next tile.
            if (e.key === 'Enter' && changed) {
              e.preventDefault();
              onSave(composed);
            }
          }}
        />
      </Field>

      {/* Reserved: two lines' worth, whether the note is empty or full. */}
      <p style={{ ...muted, minBlockSize: 'var(--tp-sp-6)', marginBlock: 'var(--tp-sp-1) 0' }}>
        {composed === '' ? (
          tr('ws.cashier.till.note.empty')
        ) : (
          <>
            {tr('ws.cashier.till.note.preview')} <bdi style={{ fontStyle: 'italic' }}>{composed}</bdi>
          </>
        )}
      </p>
    </Modal>
  );
}
