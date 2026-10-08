/**
 * The per-question router (_shared/assistant/route.ts, cost lane H): a lookup
 * ("where is day close?") runs on claude-sonnet-5-5 at effort 'low' with the
 * system map retrieved up front; anything that asks for a figure, a
 * comparison, a trend, a person, a cause or advice (or is ambiguous) keeps the
 * chat's own default at effort 'medium'.
 *
 * Pure: no database, no network. Three sets:
 *   - every 'where' case of tests/assistant-eval/cases.json routes lookup and
 *     every 'numeric' and 'audit' case routes analysis, in both languages,
 *     with the scopes that case carries;
 *   - hand-written English, Modern Standard Arabic and Iraqi examples of each
 *     kind, including the tricky ones (the question words that look like a
 *     lookup but ask for a number, and the "اليوم" of "day close");
 *   - the shape of the route: model, effort, preRetrieve, the explicit model,
 *     the howto/docs scope rule.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOOKUP_MODEL, routeTurn, type TurnKind } from '../supabase/functions/_shared/assistant/route.ts';

interface EvalCase {
  id: string;
  kind: 'numeric' | 'where' | 'audit';
  lang: 'en' | 'ar';
  question: string;
  scopes: string[];
}

const cases = (
  JSON.parse(readFileSync(new URL('./assistant-eval/cases.json', import.meta.url), 'utf8')) as { cases: EvalCase[] }
).cases;

/** The scopes a normal chat has on (everything the owner ticks), so the text decides, not the scope rule. */
const FULL = ['money', 'courts', 'cafe', 'staff', 'stock', 'audit', 'howto'];

function kindOf(text: string, scopes: readonly string[] = FULL): TurnKind {
  return routeTurn({ text, scopes, explicitModel: null }).kind;
}

describe('eval cases', () => {
  it('has the three kinds in both languages', () => {
    for (const kind of ['numeric', 'where', 'audit'] as const) {
      for (const lang of ['en', 'ar'] as const) {
        expect(cases.some((c) => c.kind === kind && c.lang === lang), `${kind}/${lang}`).toBe(true);
      }
    }
  });

  for (const c of cases) {
    const want: TurnKind = c.kind === 'where' ? 'lookup' : 'analysis';
    it(`${c.id} (${c.kind}/${c.lang}) -> ${want}`, () => {
      const r = routeTurn({ text: c.question, scopes: c.scopes, explicitModel: null });
      expect(r.kind, `${c.question} [${r.reason}]`).toBe(want);
    });
    // The same question in a chat with every context on: the text alone must decide.
    it(`${c.id} with every scope on -> ${want}`, () => {
      const r = routeTurn({ text: c.question, scopes: FULL, explicitModel: null });
      expect(r.kind, `${c.question} [${r.reason}]`).toBe(want);
    });
  }
});

const LOOKUPS: string[] = [
  // English: where
  'Where do I set opening hours?',
  'where do I set opening hours',
  'Where is day close?',
  'Where is the audit log page?',
  'Where can I add a new court?',
  'Where can I find the staff leave requests?',
  'Where do I change the court prices?',
  'Where do I approve a wage advance?',
  'where is the promotions page',
  'Where can I see who changed what and why?',
  'Where do I close the trading day?',
  'Where do I turn on online deposits?',
  'Where do I find the revenue report?',
  'where is the assistant usage page?',
  'Where to add a coach?',
  'Where can I see how much the assistant cost this month?',
  'Where do I see how many bookings we had today?',
  'Show me where to edit the menu',
  'Where is the discount limit setting?',
  // English: how
  'How do I add a staff member?',
  'how do i reset a staff PIN',
  'How do I close the day?',
  'How to create a checklist?',
  'How can I change the booking deposit?',
  'How do I issue a refund on a cafe tab?',
  'How do I pin a chart to the dashboard?',
  'How do I see sales?',
  'How does the day close work?',
  'How is the cash variance calculated?',
  'Can I change the opening hours?',
  'Can we export the audit log?',
  'Is there a page for staff breaks?',
  'Which page lists the leave requests?',
  // English: meaning
  'What does the discount cap setting do?',
  'What does "cash variance" mean?',
  'What is the staff break allowance setting?',
  'What does day close mean?',
  'What is the cashier role allowed to do?',
  'Explain the wage advance rule',
  'Take me to the day close page',
  // Arabic: MSA
  'أين أسجل هدر المخزون؟',
  'أين أجد تقرير الإيرادات؟',
  'أين أضيف عرضاً ترويجياً جديداً؟',
  'أين أضبط ساعات العمل وأيام الإغلاق؟',
  'أين أرى كم كلّف المساعد هذا الشهر؟',
  'كيف أضيف موظفاً جديداً؟',
  'كيف يمكنني تغيير سعر الملعب؟',
  'كيف أغلق اليوم؟',
  'هل يمكنني تغيير ساعات العمل؟',
  'ما معنى فرق الصندوق؟',
  'ماذا يعني سقف الخصم؟',
  'اين صفحة سجل التدقيق',
  // Iraqi
  'شلون اسوي اغلاق اليوم',
  'وين صفحة الخصومات',
  'وين اغير اسعار الملاعب',
  'وين الاقي طلبات الاجازة',
  'منين اضيف موظف جديد',
  'شلون اغير رقم الموظف السري',
  'شلون اشوف المبيعات',
  'شنو يعني فرق الصندوق',
  'يعني شنو سقف الخصم',
  'شلون اضيف عرض جديد',
  'وين اشوف سجل التدقيق',
  'شلون اسوي قائمة تدقيق جديدة',
  'وين زر اغلاق اليوم',
];

const ANALYSES: string[] = [
  // English: figures and periods
  'How much revenue did we make last week?',
  'How many no-shows did we have?',
  'How many bookings today?',
  "How do I see last week's sales?",
  'Where did revenue drop?',
  'Where did the money go this month?',
  'Where are we losing money?',
  'Where can I save money?',
  'Where do I stand this month?',
  'What were our sales yesterday?',
  'What is the total cash in the till right now?',
  'Show me the top five items this week',
  'Which court is the busiest?',
  'Which customer spent the most?',
  'Compare this month to last month',
  'Best selling product in March',
  'Worst day for bookings',
  // English: who / why / what happened
  'Who cancelled the booking on 7 March?',
  'Who approved the wage advance?',
  'Why did sales drop?',
  'Why are bookings down on Thursdays?',
  'What happened to the cash drawer on Friday?',
  'Did we have any refunds today?',
  // English: advice, ambiguous
  'Should I open a second shift on weekends?',
  'What should I do about the slow Tuesdays?',
  'Give me three ideas to get more bookings',
  'How can I increase revenue?',
  'How do I make more money?',
  'Is it worth hiring another coach?',
  'Tell me about the club',
  'Hello',
  'revenue',
  'Where is the money coming from?',
  'Where do customers come from?',
  'How is business?',
  'How are we doing?',
  'What is our occupancy?',
  'Where is day close and how much did we close with yesterday?',
  // Arabic: MSA
  'كم بلغت المبيعات هذا الأسبوع؟',
  'كم عدد الحجوزات اليوم؟',
  'ما هي أرباح الشهر الماضي؟',
  'ما هو إيراد الكافيه أمس؟',
  'قارن مبيعات هذا الشهر بالشهر الماضي',
  'ما هو أفضل منتج مبيعاً؟',
  'لماذا انخفضت الإيرادات؟',
  'لماذا تراجعت الحجوزات يوم الخميس؟',
  'من ألغى الحجز يوم 7 آذار؟',
  'من وافق على سلفة الراتب؟',
  'هل يجب أن أفتح الملاعب صباحاً؟',
  'ماذا أفعل لزيادة المبيعات؟',
  'كيف كانت المبيعات اليوم؟',
  'ماذا حدث في الصندوق أمس؟',
  'أين ذهبت الأموال هذا الشهر؟',
  // Iraqi
  'كم بعنا اليوم',
  'شكد الايراد هالاسبوع',
  'شكد ربحنا هالشهر',
  'ليش نزلت المبيعات',
  'شنو اسوي حتى تزيد الحجوزات',
  'شنو اسوي بالثلاثاء الميت',
  'شلون المبيعات اليوم',
  'شلون اشوف مبيعات الاسبوع الماضي',
  'مين الغى الحجز',
  'مين اكثر زبون صرف',
  'شصار بالصندوق البارحة',
  'وين راحت الفلوس هالشهر',
  'وين اخسر فلوس',
  'وين اقدر اوفر مصاريف',
  'اكثر ملعب ينحجز',
  'شكد عدد الغيابات',
  'شلون كانت المبيعات',
  'اعطيني نصيحة للربح',
  'هل افتح الملاعب الصبح',
];

describe('hand-written examples', () => {
  it('has at least 40 of each kind', () => {
    expect(LOOKUPS.length).toBeGreaterThanOrEqual(40);
    expect(ANALYSES.length).toBeGreaterThanOrEqual(40);
  });

  for (const q of LOOKUPS) {
    it(`lookup: ${q}`, () => {
      const r = routeTurn({ text: q, scopes: FULL, explicitModel: null });
      expect(r.kind, `[${r.reason}]`).toBe('lookup');
    });
  }

  for (const q of ANALYSES) {
    it(`analysis: ${q}`, () => {
      const r = routeTurn({ text: q, scopes: FULL, explicitModel: null });
      expect(r.kind, `[${r.reason}]`).toBe('analysis');
    });
  }
});

describe('the tricky pairs', () => {
  const pairs: Array<[string, TurnKind]> = [
    ['where did revenue drop', 'analysis'],
    ['how many no-shows', 'analysis'],
    ["how do I see last week's sales", 'analysis'],
    ['where do I set opening hours', 'lookup'],
    ['شلون اسوي اغلاق اليوم', 'lookup'],
    ['وين صفحة الخصومات', 'lookup'],
    ['شلون اسوي اغلاق اليوم وكم سكرنا اليوم', 'analysis'],
    ['اغلاق اليوم', 'analysis'],
    ['how do I close the day today', 'analysis'],
    ['how do I close the day', 'lookup'],
    ['Where do I change my phone number?', 'lookup'],
    ['What is the number of courts?', 'analysis'],
    ['where is the revenue report', 'lookup'],
    ['where is revenue', 'analysis'],
  ];
  for (const [q, want] of pairs) {
    it(`${q} -> ${want}`, () => {
      expect(kindOf(q)).toBe(want);
    });
  }

  it('Arabic letter forms do not matter', () => {
    // alef forms, ة/ه, ى/ي, diacritics, tatweel, Arabic-Indic digits
    expect(kindOf('اين أضيف عرضا ترويجيا')).toBe('lookup');
    expect(kindOf('أيـن أضيف عرضاً ترويجياً')).toBe('lookup');
    expect(kindOf('اين اضيف عرضا ترويجيه')).toBe('lookup');
    expect(kindOf('كم بلغت المبيعات في ٣ آذار')).toBe('analysis');
    expect(kindOf('كَمْ بلغت المبيعات')).toBe('analysis');
    expect(kindOf('إلى كم')).toBe('analysis');
  });

  it('one analysis part makes a mixed message analysis', () => {
    expect(kindOf('Where is the staff page, and how many staff do we have?')).toBe('analysis');
    expect(kindOf('Where do I add a coach and what does the coach role allow?')).toBe('lookup');
    expect(kindOf('Thanks. Where do I change the court prices?')).toBe('lookup');
    expect(kindOf('وين صفحة الخصومات وكم خصمنا اليوم')).toBe('analysis');
  });

  it('a very long message is never a lookup', () => {
    const long = `Where do I set opening hours? ${'because the club is busy and the staff are tired '.repeat(8)}`;
    expect(kindOf(long)).toBe('analysis');
  });
});

describe('review fixes: data requests, advice and page asks that carry a figure', () => {
  const analysisQs = [
    // "can you ..." asks the assistant to fetch data
    'Can you show me the sales?',
    'Can you show me the cash?',
    'Can you show me the unpaid tabs?',
    'Could you find the bookings that were cancelled?',
    'Can you list the refunds?',
    // "where do we / you ..." with a comparison, period, advice or a money noun
    'Where do you think we should cut costs?',
    'Where do we see the most no-shows this month?',
    'Where do we get most of our revenue from?',
    'Where do we get the most bookings?',
    'Where do we get revenue from?',
    'وين نشوف اكثر الغيابات هالشهر',
    // a page noun in a data question
    "Where was the variance in yesterday's day close report?",
    'Where are the no-shows in the booking list this week?',
    "Where is the cash report and show me today's total",
    'وين تقرير المبيعات اليوم',
    // advice phrased as a how-to
    'How can we attract more players?',
    'How do we fill empty courts?',
    'How can I get players to come back?',
    'How can I increase revenue?',
    'How do I increase sales?',
    'كيف نزيد الحجوزات',
    'شلون نزيد الدخل',
    'شلون نجيب زباين',
    // a short data follow-up next to a lookup
    'Where is day close? Any refunds?',
    'Where is day close? Cancelled bookings?',
    'وين اغلاق اليوم؟ الخصومات؟',
  ];
  for (const q of analysisQs) {
    it(`analysis: ${q}`, () => {
      const r = routeTurn({ text: q, scopes: FULL, explicitModel: null });
      expect(r.kind, `[${r.reason}]`).toBe('analysis');
    });
  }

  const lookupQs = [
    'Can you change the opening hours?',
    'Could you add a coach for me?',
    'Where can we change the opening hours?',
    'Where do we add a new court?',
    'Where do you set the court prices?',
    'Where can we set the cash limit?',
    'Where is the day close report?',
    'Where is the revenue report?',
    'Where is the cash report page?',
    'وين صفحة التقارير',
    'وين نضيف ملعب جديد',
    'Thanks. Where is day close?',
    'شكرا. وين اغلاق اليوم؟',
  ];
  for (const q of lookupQs) {
    it(`lookup: ${q}`, () => {
      const r = routeTurn({ text: q, scopes: FULL, explicitModel: null });
      expect(r.kind, `[${r.reason}]`).toBe('lookup');
    });
  }
});

describe('the route shape', () => {
  it('a lookup runs on the lookup model at effort low with the map retrieved up front', () => {
    const r = routeTurn({ text: 'Where is day close?', scopes: FULL, explicitModel: null });
    expect(r).toMatchObject({ kind: 'lookup', model: LOOKUP_MODEL, effort: 'low', preRetrieve: true });
    expect(r.reason).toBe('where-pattern');
    expect(LOOKUP_MODEL).toBe('claude-sonnet-5-5');
  });

  it('an analysis defers to the chat default at effort medium with no pre-retrieval', () => {
    const r = routeTurn({ text: 'How much revenue did we make last week?', scopes: FULL, explicitModel: null });
    expect(r).toMatchObject({ kind: 'analysis', model: null, effort: 'medium', preRetrieve: false });
    expect(r.reason.length).toBeGreaterThan(0);
  });

  it('an explicit model beats the lookup model but changes nothing else', () => {
    const lookup = routeTurn({ text: 'Where is day close?', scopes: FULL, explicitModel: 'claude-opus-5-5' });
    expect(lookup).toMatchObject({ kind: 'lookup', model: 'claude-opus-5-5', effort: 'low', preRetrieve: true });
    const analysis = routeTurn({ text: 'How much revenue today?', scopes: FULL, explicitModel: 'claude-opus-5-5' });
    expect(analysis).toMatchObject({ kind: 'analysis', model: null, effort: 'medium', preRetrieve: false });
  });

  it('an empty explicit model counts as none', () => {
    expect(routeTurn({ text: 'Where is day close?', scopes: FULL, explicitModel: '' }).model).toBe(LOOKUP_MODEL);
  });

  it('a chat with only howto and/or docs scopes is a lookup whatever it says', () => {
    for (const scopes of [['howto'], ['docs'], ['howto', 'docs']]) {
      const r = routeTurn({ text: 'How much revenue did we make last week?', scopes, explicitModel: null });
      expect(r).toMatchObject({ kind: 'lookup', model: LOOKUP_MODEL, effort: 'low', preRetrieve: true });
      expect(r.reason).toBe('scopes-howto-only');
    }
  });

  it('a chat with a data scope on is decided by the text', () => {
    expect(kindOf('How much revenue did we make last week?', ['money', 'howto'])).toBe('analysis');
    expect(kindOf('Hello', ['howto', 'cafe'])).toBe('analysis');
  });

  it('no scopes at all is decided by the text', () => {
    expect(kindOf('Where do I set opening hours?', [])).toBe('lookup');
    expect(kindOf('How much revenue today?', [])).toBe('analysis');
  });

  it('empty or blank text is an analysis', () => {
    expect(routeTurn({ text: '', scopes: FULL, explicitModel: null })).toMatchObject({ kind: 'analysis', reason: 'empty' });
    expect(kindOf('   ')).toBe('analysis');
  });
});
