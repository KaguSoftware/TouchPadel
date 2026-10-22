/**
 * Dev-only: the stepped create dialog with every shared piece on it, so the
 * frame can be compared with the approved preview without a backend. Opened
 * from the gallery (`/gallery.html#wizard` opens it straight away). Static
 * sample values; not in the app bundle.
 */
import { useState } from 'react';
import { SegmentedControl } from './components/kit';
import { Field, Select, inputStyle } from './components/ui';
import {
  ReviewList,
  StepWizard,
  WizardChecks,
  WizardChips,
  WizardChoice,
  WizardChoices,
  WizardNote,
  WizardPrice,
  WizardToggle,
} from './components/StepWizard';

export function WizardDemo({ onClose }: { onClose: () => void }) {
  const [cat, setCat] = useState('open');
  const [join, setJoin] = useState<'now' | 'ask'>('now');
  const [types, setTypes] = useState({ p: true, g: true, c: false });
  const [inUse, setInUse] = useState(true);
  const [slot, setSlot] = useState('18:00');
  const [court, setCourt] = useState<'1' | '2'>('2');
  return (
    <StepWizard
      title="Start an open match"
      lead="Court 2 · Thu 23 Oct · 20:00–21:30"
      testId="demo"
      onClose={onClose}
      submitLabel="Start match"
      onSubmit={onClose}
      steps={[
        {
          key: 'who',
          label: 'Who plays',
          note: 'Open',
          content: (
            <>
              <Field label="Category">
                <WizardChoices small>
                  {[
                    ['open', 'Open', 'Anyone can take a seat.'],
                    ['w', 'Women', 'Every player is a woman.'],
                    ['m', 'Men', 'Every player is a man.'],
                  ].map(([v, t, b]) => (
                    <WizardChoice key={v} on={cat === v} title={t} body={b} onPick={() => setCat(v!)} />
                  ))}
                </WizardChoices>
              </Field>
              <Field label="Join">
                <SegmentedControl value={join} onChange={setJoin} options={[{ value: 'now', label: 'Anyone joins at once' }, { value: 'ask', label: 'Players ask to join' }]} />
              </Field>
              <Field label="Start">
                <WizardChips value={slot} onChange={setSlot} options={['17:00', '17:30', '18:00', '19:30'].map((v) => ({ value: v, label: v }))} />
              </Field>
            </>
          ),
        },
        {
          key: 'branches',
          label: 'Branches & lessons',
          note: '1 branch · 2 types',
          content: (
            <>
              <WizardChecks label="Branches" items={[{ key: 'b', label: 'Durrat Karbala', checked: true, onChange: () => {} }]} />
              <WizardChecks
                label="Lesson types at this branch"
                optional
                items={[
                  { key: 'p', label: 'Private 60 min', tag: 'Private', checked: types.p, onChange: (v) => setTypes({ ...types, p: v }) },
                  { key: 'g', label: 'Drills group', tag: 'Group', checked: types.g, onChange: (v) => setTypes({ ...types, g: v }) },
                  { key: 'c', label: 'Beginner course', tag: 'Course', checked: types.c, onChange: (v) => setTypes({ ...types, c: v }) },
                ]}
              />
              <WizardNote>The coach is asked in the app to accept being shown publicly. Until then guests don’t see them.</WizardNote>
            </>
          ),
        },
        {
          key: 'court',
          label: 'Court & time',
          note: '20:00 · 90 min',
          content: (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))', gap: '0 var(--tp-sp-3)' }}>
                <Field label="Court">
                  <Select value={court} onChange={setCourt} options={[{ value: '1', label: 'Court 1' }, { value: '2', label: 'Court 2' }]} />
                </Field>
                <Field label="Usable after prep (%)" hint="100 if nothing is trimmed or peeled off.">
                  <input style={inputStyle} defaultValue="100" />
                </Field>
              </div>
              <WizardPrice figure="Court 45,000 IQD · each player pays 11,250 IQD" line="At the desk. Players who join in the app use one ticket each; desk players need none." />
              <WizardNote tone="refused">Booking this court cancels the open match at 20:30 (2 in). Their tickets go back to them.</WizardNote>
              <WizardToggle checked={inUse} onChange={setInUse} label="In use" hint="Turn off to hide it from deliveries, recipes and counts." />
            </>
          ),
        },
      ]}
      review={(goTo) => (
        <ReviewList
          goTo={goTo}
          rows={[
            { label: 'Category', value: 'Open', step: 'who' },
            { label: 'Teaches', value: 'Private 60 min, Drills group', step: 'branches' },
            { label: 'Court', value: 'Court 2 · 20:00–21:30', step: 'court' },
          ]}
        />
      )}
    />
  );
}
