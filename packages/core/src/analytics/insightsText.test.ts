import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  dropExcludedMentions,
  dropLowConfidenceClaims,
  dropRejectedFindings,
  findingImpact,
  isStrongFinding,
  latinDigits,
  MAX_FINDINGS,
  normalizeFinding,
  rankFindings,
  rejectionKeys,
} from './insightsText';

const WEEKDAYS = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
};

describe('module contract', () => {
  it('has zero imports (shared by relative path with the Deno edge function)', () => {
    const src = readFileSync(fileURLToPath(new URL('./insightsText.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/^\s*import\b/m);
    expect(src).not.toMatch(/\brequire\(/);
  });
});

describe('latinDigits', () => {
  it('maps both Arabic digit sets and leaves the rest alone', () => {
    expect(latinDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(latinDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    expect(latinDigits('abc 42 عدد')).toBe('abc 42 عدد');
  });
});

describe('normalizeFinding', () => {
  it('lowercases, strips punctuation, collapses whitespace, trims', () => {
    expect(normalizeFinding('  Cappuccino sold 12,500 IQD — up 15%!  ')).toBe('cappuccino sold 12 500 iqd up 15');
    expect(normalizeFinding('A-B/C.D')).toBe('a b c d');
    expect(normalizeFinding('')).toBe('');
    expect(normalizeFinding('!!!')).toBe('');
  });

  it('maps Arabic-Indic digits to Latin', () => {
    expect(normalizeFinding('باع الكابتشينو ١٢٬٥٠٠ دينار')).toBe('باع الكابتشينو 12 500 دينار');
    expect(normalizeFinding('۱۲ وحدة')).toBe('12 وحدة');
  });

  it('removes tatweel and diacritics without leaving a gap', () => {
    // tatweel inside a word, fatha/shadda/sukun/damma on letters, superscript alef
    expect(normalizeFinding('كـابـتشـينو')).toBe('كابتشينو');
    expect(normalizeFinding('مُحَمَّدٌ')).toBe('محمد');
    expect(normalizeFinding('الرحمٰن')).toBe('الرحمن');
  });

  it('treats a changed figure as a different claim and punctuation/case as the same one', () => {
    expect(normalizeFinding('Kahi sells 8,000 IQD.')).toBe(normalizeFinding('KAHI SELLS 8,000 IQD'));
    expect(normalizeFinding('Kahi sells 8,000 IQD.')).not.toBe(normalizeFinding('Kahi sells 9,000 IQD.'));
  });

  it('matches the SQL twin on a mixed fixture', () => {
    // The same string is the fixture for `app.normalize_finding` parity in the DB slice.
    const fixture = 'الكَابتشينو (Cappuccino) — ١٢٬٥٠٠ د.ع؛ up 15%!';
    expect(normalizeFinding(fixture)).toBe('الكابتشينو cappuccino 12 500 د ع up 15');
  });
});

describe('findingImpact', () => {
  it('reads Latin and Arabic-Indic amounts next to a currency marker', () => {
    expect(findingImpact('Kahi brought 12,500 IQD this week')).toBe(12500);
    expect(findingImpact('IQD 1,250,000 across the period')).toBe(1_250_000);
    expect(findingImpact('الكاهي جلب ١٢٬٥٠٠ د.ع هذا الأسبوع')).toBe(12500);
    expect(findingImpact('خسارة ٤٥٠٠٠ دينار عراقي')).toBe(45000);
    expect(findingImpact('sold for 12.500 dinars')).toBe(12500);
  });

  it('ignores bare numbers and picks the largest amount', () => {
    expect(findingImpact('12 units sold, 40 views')).toBe(0);
    expect(findingImpact('lost 3,000 IQD on 200 units worth 900,000 IQD')).toBe(900_000);
    expect(findingImpact('')).toBe(0);
  });

  it('does not read a marker glued to letters', () => {
    expect(findingImpact('liquid 500 ml')).toBe(0);
  });
});

describe('rankFindings', () => {
  it('sorts by money at stake, stable on ties, capped', () => {
    const findings = ['no money here', 'worth 5,000 IQD', 'worth 90,000 IQD', 'another without', 'worth 5,000 IQD too'];
    expect(rankFindings(findings)).toEqual([
      'worth 90,000 IQD',
      'worth 5,000 IQD',
      'worth 5,000 IQD too',
      'no money here',
      'another without',
    ]);
    expect(rankFindings(findings, 2)).toEqual(['worth 90,000 IQD', 'worth 5,000 IQD']);
    expect(rankFindings(Array.from({ length: 20 }, (_, i) => `f${i} 1 IQD`))).toHaveLength(MAX_FINDINGS);
  });
});

describe('isStrongFinding', () => {
  it('requires a digit (any script) and some length', () => {
    expect(isStrongFinding('Cappuccino outsold Latte 3 to 1 this week')).toBe(true);
    expect(isStrongFinding('الكابتشينو تفوق على اللاتيه بنسبة ٣ إلى ١')).toBe(true);
    expect(isStrongFinding('Cappuccino is doing well lately')).toBe(false);
    expect(isStrongFinding('12 sold')).toBe(false);
  });
});

describe('dropRejectedFindings', () => {
  it('drops exact normalised matches only', () => {
    const banned = rejectionKeys(['Kahi sells 8,000 IQD.', '   ', '!!']);
    expect(banned.size).toBe(1);
    const { kept, dropped } = dropRejectedFindings(
      ['KAHI sells 8,000 IQD', 'Kahi sells 9,000 IQD.', 'Latte is flat'],
      banned,
    );
    expect(dropped).toEqual(['KAHI sells 8,000 IQD']);
    expect(kept).toEqual(['Kahi sells 9,000 IQD.', 'Latte is flat']);
  });

  it('keeps everything when nothing is rejected', () => {
    expect(dropRejectedFindings(['a', 'b'], new Set())).toEqual({ kept: ['a', 'b'], dropped: [] });
  });
});

describe('dropLowConfidenceClaims', () => {
  const basis = {
    salesDays: 5,
    weekdayCounts: [
      { day: 0, days: 1 },
      { day: 1, days: 0 },
      { day: 2, days: 0 },
      { day: 3, days: 0 },
      { day: 4, days: 0 },
      { day: 5, days: 4 },
      { day: 6, days: 0 },
    ],
  };

  it('drops weekday claims without enough occurrences, in either language', () => {
    const { kept, dropped } = dropLowConfidenceClaims(
      [
        'Fridays bring 40% of Kahi sales',
        'Sundays are quiet: 3 orders',
        'مبيعات الكاهي ترتفع يوم الجمعة إلى 40%',
        'يوم الأحد هادئ: 3 طلبات',
        'Saturday sees 10 waffles',
      ],
      basis,
      WEEKDAYS,
    );
    expect(kept).toEqual(['Fridays bring 40% of Kahi sales', 'مبيعات الكاهي ترتفع يوم الجمعة إلى 40%']);
    expect(dropped).toHaveLength(3);
  });

  it('accepts alternative Arabic spellings via extraWeekdayNames', () => {
    const r = dropLowConfidenceClaims(['يوم الإثنين ضعيف: 2 طلبات'], basis, WEEKDAYS, {
      extraWeekdayNames: [{ day: 1, name: 'الإثنين' }],
    });
    expect(r.dropped).toHaveLength(1);
  });

  it('drops trend claims when the period is too short, keeps them otherwise', () => {
    const texts = ['Sales rose 20% to 900,000 IQD', 'ارتفعت المبيعات 20%', 'Kahi is the best seller with 120 units'];
    expect(dropLowConfidenceClaims(texts, basis, WEEKDAYS).kept).toEqual(['Kahi is the best seller with 120 units']);
    expect(dropLowConfidenceClaims(texts, { ...basis, salesDays: 7 }, WEEKDAYS).kept).toEqual(texts);
  });

  it('honours a custom trend regex', () => {
    const r = dropLowConfidenceClaims(['Sales rose 20%', 'Sales jumped 20%'], basis, WEEKDAYS, { trendWords: /jumped/ });
    expect(r.kept).toEqual(['Sales rose 20%']);
  });
});

describe('dropExcludedMentions', () => {
  it('strips lines naming an excluded item, punctuation- and case-insensitively', () => {
    const texts = ['Meal Upgrade drives 30% of revenue', 'Kahi is strong', 'ترقية لوجبة تجلب 30%'];
    expect(dropExcludedMentions(texts, ['meal upgrade', 'ترقية لوجبة'])).toEqual(['Kahi is strong']);
    expect(dropExcludedMentions(texts, [])).toEqual(texts);
    expect(dropExcludedMentions(texts, ['a'])).toEqual(texts);
  });
});
