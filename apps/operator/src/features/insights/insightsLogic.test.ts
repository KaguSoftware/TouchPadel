import { describe, expect, it } from 'vitest';
import { allUnknown, demandAdvice, heatCells, levelKey, parseCount, parseInsights, shareWord, trendTone } from './insightsLogic';

describe('parseInsights', () => {
  it('turns garbage into a safe empty shape', () => {
    const r = parseInsights(null);
    expect(r.demand.heat).toEqual([]);
    expect(r.demand.level).toBeNull();
    expect(r.demand.levelTrend).toBe('unknown');
    expect(r.players.active).toBeNull();
    expect(r.players.lapseDays).toBe(28);
    expect(r.offers).toEqual([]);
    expect(r.events.next).toBeNull();
    expect(r.loyalty.enabled).toBe(false);
  });

  it('reads the server payload', () => {
    const r = parseInsights({
      period: { from: '2026-09-22', to: '2026-10-21' },
      compare: { from: '2026-08-22', to: '2026-09-21' },
      legacy: false,
      demand: { level: 3, levelTrend: 'up', heat: [{ dow: 2, hour: 19, level: 4 }, { dow: 9, hour: 1, level: 1 }], quiet: [{ dow: 1, hour: 10, level: 0 }], full: [] },
      players: { active: { kind: 'about', value: 400 }, newShare: 30, returningShare: 70, frequency: [{ bucket: '1', share: 60 }] },
      offers: [{ id: 'a', nameEn: 'Happy hour', nameAr: 'ساعة', live: true, uses: { kind: 'few' }, verdict: 'little' }, { id: '', nameEn: 'x' }],
      events: { next: { nameEn: 'Cup', nameAr: 'كأس', startDate: '2026-11-01' } },
    });
    expect(r.demand.level).toBe(3);
    expect(r.demand.heat).toEqual([{ dow: 2, hour: 19, level: 4 }]);
    expect(r.players.active).toEqual({ kind: 'about', value: 400 });
    expect(r.players.newShare).toBe(30);
    expect(r.offers).toHaveLength(1);
    expect(r.offers[0]!.verdict).toBe('little');
    expect(r.events.next?.startDate).toBe('2026-11-01');
  });

  it('refuses out-of-range levels and shares', () => {
    const r = parseInsights({ demand: { level: 7 }, players: { newShare: 140 }, channels: { appShare: -5 } });
    expect(r.demand.level).toBeNull();
    expect(r.players.newShare).toBeNull();
    expect(r.channels.appShare).toBeNull();
  });
});

describe('parseCount', () => {
  it('keeps the three kinds and nothing else', () => {
    expect(parseCount({ kind: 'none' })).toEqual({ kind: 'none' });
    expect(parseCount({ kind: 'few', value: 3 })).toEqual({ kind: 'few' });
    expect(parseCount({ kind: 'about', value: '450' })).toEqual({ kind: 'about', value: 450 });
    expect(parseCount({ kind: 'about' })).toBeNull();
    expect(parseCount(12)).toBeNull();
  });
});

describe('words', () => {
  it('maps shares to plain words', () => {
    expect(shareWord(null)).toBeNull();
    expect(shareWord(0)).toBe('none');
    expect(shareWord(10)).toBe('oneInTen');
    expect(shareWord(30)).toBe('third');
    expect(shareWord(50)).toBe('half');
    expect(shareWord(80)).toBe('fourInFive');
    expect(shareWord(95)).toBe('nineInTen');
    expect(shareWord(100)).toBe('all');
  });

  it('names levels', () => {
    expect(levelKey(null)).toBeNull();
    expect(levelKey(0)).toBe('empty');
    expect(levelKey(4)).toBe('full');
  });

  it('colours a trend by whether up is good', () => {
    expect(trendTone('up')).toBe('success');
    expect(trendTone('up', true)).toBe('danger');
    expect(trendTone('down', true)).toBe('success');
    expect(trendTone('steady')).toBe('neutral');
    expect(trendTone('unknown', true)).toBe('neutral');
  });

  it('draws levels as heat values', () => {
    expect(heatCells([{ dow: 1, hour: 9, level: 2 }, { dow: 1, hour: 10, level: null }])).toEqual([{ dow: 1, hour: 9, value: 2 }]);
  });

  it('knows when a list has nothing to draw', () => {
    expect(allUnknown([{ bucket: '1', share: null }])).toBe(true);
    expect(allUnknown([{ bucket: '1', share: 0 }])).toBe(false);
  });

  it('picks the courts advice', () => {
    const base = parseInsights({}).demand;
    expect(demandAdvice(base)).toBe('none');
    expect(demandAdvice({ ...base, quiet: [{ dow: 1, hour: 10, level: 0 }] })).toBe('fillQuiet');
    expect(demandAdvice({ ...base, full: [{ dow: 4, hour: 20, level: 4 }] })).toBe('protectFull');
    expect(demandAdvice({ ...base, quiet: [{ dow: 1, hour: 10, level: 1 }], full: [{ dow: 4, hour: 20, level: 4 }] })).toBe('both');
  });
});
