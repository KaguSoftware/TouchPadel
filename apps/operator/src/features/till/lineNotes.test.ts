import { describe, expect, it } from 'vitest';
import { NOTE_PRESET_GROUPS, NOTE_PRESET_IDS, composeNote, splitNote } from './lineNotes';

const LABELS = ['Extra espresso shot', 'No ice', 'Oat milk'];

describe('NOTE_PRESET_GROUPS', () => {
  it('lists every preset exactly once', () => {
    expect(new Set(NOTE_PRESET_IDS).size).toBe(NOTE_PRESET_IDS.length);
    expect(NOTE_PRESET_IDS.length).toBe(NOTE_PRESET_GROUPS.reduce((n, g) => n + g.presets.length, 0));
  });
});

describe('composeNote', () => {
  it('puts the chips first and the free text last', () => {
    expect(composeNote(['No ice', 'Oat milk'], 'in a glass')).toBe('No ice, Oat milk, in a glass');
  });

  it('drops empty halves', () => {
    expect(composeNote(['No ice'], '   ')).toBe('No ice');
    expect(composeNote([], 'no straw')).toBe('no straw');
    expect(composeNote([], '')).toBe('');
  });
});

describe('splitNote', () => {
  it('lights the chips it recognises and leaves the rest free', () => {
    expect(splitNote('No ice, Oat milk, in a glass', LABELS)).toEqual({
      chosen: ['No ice', 'Oat milk'],
      free: 'in a glass',
    });
  });

  it('matches a label whatever its case, and keeps the label spelling', () => {
    expect(splitNote('no ICE', LABELS).chosen).toEqual(['No ice']);
  });

  it('lights a repeated clause once and drops the duplicate', () => {
    expect(splitNote('No ice, No ice', LABELS)).toEqual({ chosen: ['No ice'], free: '' });
  });

  it('leaves a note written in another locale wholly in the free line', () => {
    expect(splitNote('بدون ثلج', LABELS)).toEqual({ chosen: [], free: 'بدون ثلج' });
  });

  it('round-trips a composed note', () => {
    const note = composeNote(['Extra espresso shot', 'Oat milk'], 'extra hot please');
    const back = splitNote(note, LABELS);
    expect(composeNote(back.chosen, back.free)).toBe(note);
  });

  it('reads an empty note as an empty dialog', () => {
    expect(splitNote('', LABELS)).toEqual({ chosen: [], free: '' });
  });
});
