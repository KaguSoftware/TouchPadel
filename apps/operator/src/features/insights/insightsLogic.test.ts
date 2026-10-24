import { describe, expect, it } from 'vitest';
import { allUnknown, demandAdvice, heatCells, levelKey, parseCount, parseInsights, shareWord, trendSize, trendTone, type Trend, type TrendDir } from './insightsLogic';

describe('parseInsights', () => {
  it('turns garbage into a safe empty shape', () => {
    const r = parseInsights(null);
    expect(r.demand.heat).toEqual([]);
    expect(r.demand.level).toBeNull();
    expect(r.demand.levelTrend).toEqual({ dir: 'unknown', size: null, unit: 'pts' });
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
      demand: { level: 3, levelPct: 68, levelTrend: 'up', levelTrendPts: 6, bookingsTrend: 'down', bookingsTrendPct: -12, heat: [{ dow: 2, hour: 19, level: 4 }, { dow: 9, hour: 1, level: 1 }], quiet: [{ dow: 1, hour: 10, level: 0 }], full: [] },
      guests: { active: { kind: 'about', value: 400 }, newShare: 30, returningShare: 70, frequency: [{ bucket: '1', share: 60 }] },
      offers: [{ id: 'a', nameEn: 'Happy hour', nameAr: 'ساعة', live: true, uses: { kind: 'few' }, verdict: 'little' }, { id: '', nameEn: 'x' }],
      events: { next: { nameEn: 'Cup', nameAr: 'كأس', startDate: '2026-11-01' } },
    });
    expect(r.demand.level).toBe(3);
    expect(r.demand.levelPct).toBe(68);
    expect(r.demand.levelTrend).toEqual({ dir: 'up', size: 6, unit: 'pts' });
    expect(r.demand.bookingsTrend).toEqual({ dir: 'down', size: -12, unit: 'pct' });
    expect(r.demand.heat).toEqual([{ dow: 2, hour: 19, level: 4 }]);
    expect(r.players.active).toEqual({ kind: 'about', value: 400 });
    expect(r.players.newShare).toBe(30);
    expect(r.offers).toHaveLength(1);
    expect(r.offers[0]!.verdict).toBe('little');
    expect(r.events.next?.startDate).toBe('2026-11-01');
  });

  it('refuses out-of-range levels and shares', () => {
    const r = parseInsights({ demand: { level: 7 }, guests: { newShare: 140 }, channels: { appShare: -5 } });
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
    const t = (dir: TrendDir): Trend => ({ dir, size: null, unit: 'pct' });
    expect(trendTone(t('up'))).toBe('success');
    expect(trendTone(t('up'), true)).toBe('danger');
    expect(trendTone(t('down'), true)).toBe('success');
    expect(trendTone(t('steady'))).toBe('neutral');
    expect(trendTone(t('unknown'), true)).toBe('neutral');
  });

  it('sizes a trend: percent, points, or a multiple once a thin base makes it huge (0365)', () => {
    expect(trendSize({ dir: 'up', size: 18, unit: 'pct' })).toEqual({ kind: 'pct', n: 18 });
    expect(trendSize({ dir: 'down', size: -6, unit: 'pts' })).toEqual({ kind: 'pts', n: 6 });
    expect(trendSize({ dir: 'up', size: 2700, unit: 'pct' })).toEqual({ kind: 'times', n: 28 });
    expect(trendSize({ dir: 'steady', size: 0, unit: 'pct' })).toBeNull();
    expect(trendSize({ dir: 'unknown', size: 40, unit: 'pct' })).toBeNull();
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

describe('people (0369)', () => {
  it('reads the shares, the coverage, the growing buckets and the biggest groups', () => {
    const p = parseInsights({
      people: {
        known: { kind: 'about', value: 120 },
        knownTrend: 'up',
        knownTrendPct: 14,
        coverage: 3,
        coveragePct: 72,
        coverageTrend: 'up',
        coverageTrendPts: 9,
        genders: [{ bucket: 'female', share: 58 }, { bucket: 'male', share: 42 }],
        ages: [{ bucket: '25_34', share: 50 }],
        levels: [{ bucket: 'intermediate', share: 40 }],
        interests: [{ bucket: 'courts', share: 90 }, { bucket: 'cafe', share: 30 }],
        judgedShare: 12,
        overClaimedShare: 25,
        growing: [{ bucket: 'female', trend: 'up', trendPct: 20 }, { bucket: 'late', trend: 'steady', trendPct: 1 }],
        top: [{ who: 'female', band: '25_34', level: 'intermediate', share: 30 }],
      },
    }).people;
    expect(p.known).toEqual({ kind: 'about', value: 120 });
    expect(p.knownTrend).toEqual({ dir: 'up', size: 14, unit: 'pct' });
    expect(p.coverage).toBe(3);
    expect(p.coveragePct).toBe(72);
    expect(p.coverageTrend).toEqual({ dir: 'up', size: 9, unit: 'pts' });
    expect(p.genders).toEqual([{ bucket: 'female', share: 58 }, { bucket: 'male', share: 42 }]);
    expect(p.interests.map((b) => b.bucket)).toEqual(['courts', 'cafe']);
    expect(p.judgedShare).toBe(12);
    expect(p.overClaimedShare).toBe(25);
    expect(p.growing).toEqual([
      { bucket: 'female', trend: { dir: 'up', size: 20, unit: 'pct' } },
      { bucket: 'late', trend: { dir: 'steady', size: 1, unit: 'pct' } },
    ]);
    expect(p.top).toEqual([{ who: 'female', band: '25_34', level: 'intermediate', share: 30 }]);
  });

  it('is empty, never broken, on a server without 0369', () => {
    const p = parseInsights({}).people;
    expect(p.known).toBeNull();
    expect(p.coverage).toBeNull();
    expect(p.coveragePct).toBeNull();
    expect(p.genders).toEqual([]);
    expect(p.ages).toEqual([]);
    expect(p.levels).toEqual([]);
    expect(p.interests).toEqual([]);
    expect(p.growing).toEqual([]);
    expect(p.top).toEqual([]);
    expect(p.knownTrend.dir).toBe('unknown');
  });

  it('drops a share outside 0..100 and a bucket with no name', () => {
    const p = parseInsights({
      people: { genders: [{ bucket: 'female', share: 140 }, { bucket: '', share: 10 }] },
    }).people;
    expect(p.genders).toEqual([{ bucket: 'female', share: null }]);
  });
});
