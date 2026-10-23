/**
 * Two small pieces the desk's stepped create dialogs (CreateReservationDialog,
 * StartLessonDialog, AddStudentDialog, StartMatchDialog, AddSeatDialog) draw
 * as the approved preview does (operator-wizards.html, Sait 2026-10-22): the
 * hint under the customer search, and a row of link-style buttons separated
 * by "·" (Create customer · Find in the directory).
 */
import { Fragment } from 'react';
import { useLocale } from '../../lib/i18n';

/** The line under the customer search on a Who step, while no customer is linked. */
export function PickerHint() {
  const { tr } = useLocale();
  return (
    <span
      style={{
        display: 'block',
        // CustomerPicker keeps a field's space below itself; the hint sits under the search instead.
        marginBlockStart: 'calc(var(--tp-sp-1-5) - var(--tp-sp-4))',
        fontSize: 'var(--tp-fs-xs)',
        color: 'var(--tp-muted-fg)',
      }}
    >
      {tr('ws.courtDesk.create.wizard.pickerHint')}
    </span>
  );
}

/** Link-style buttons in a row, "·" between them (the preview's `links`). */
export function WizardLinks({ links, disabled }: { links: readonly { label: string; onClick: () => void }[]; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
      {links.map((l, i) => (
        <Fragment key={l.label}>
          {i > 0 && (
            <span aria-hidden="true" style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
              ·
            </span>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={l.onClick}
            style={{
              border: 0,
              background: 'none',
              padding: 0,
              font: 'inherit',
              fontWeight: 700,
              color: 'var(--tp-accent)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              textDecoration: 'underline',
              textUnderlineOffset: '3px',
            }}
          >
            {l.label}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
