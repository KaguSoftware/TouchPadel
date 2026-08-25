/**
 * Pure rendering tests for the Telegram helper shared by telegram-send /
 * telegram-callback (no DB, no network). The expected strings ARE the spec
 * (db-slice.md "Wave 4" templates) — change both together.
 */
import { describe, expect, it } from 'vitest';
import {
  callKeyboard,
  esc,
  fmtIqd,
  fmtTime,
  keyboardAfter,
  orderKeyboard,
  parseCallbackData,
  renderCall,
  renderOrder,
  renderTest,
  statusFooter,
  toastFor,
  truncateItems,
  type OrderPayload,
} from '../supabase/functions/_shared/telegram';

const ORDER_ID = '0f6a3c2e-1b2d-4c3e-8f9a-1234567890ab';
const CALL_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const order: OrderPayload = {
  order_id: ORDER_ID,
  short_id: '0F6A3C2E',
  table_number: '7',
  placed_at: '2026-08-25T11:05:00Z', // 14:05 Asia/Baghdad (UTC+3)
  total_iqd: 18500,
  items: [
    {
      qty: 2,
      name_en: 'Cappuccino',
      name_ar: 'كابتشينو',
      variant_en: 'Large',
      variant_ar: 'كبير',
      variant_count: 2,
      modifiers: [
        { name_en: 'Oat milk', name_ar: 'حليب شوفان', qty: 1 },
        { name_en: 'Extra shot', name_ar: 'جرعة إضافية', qty: 2 },
      ],
      notes: 'no <b>foam</b> & hot',
    },
    {
      qty: 1,
      name_en: 'Water',
      name_ar: 'ماء',
      variant_en: 'Regular',
      variant_ar: 'عادي',
      variant_count: 1,
      modifiers: [],
      notes: null,
    },
  ],
};

describe('formatting', () => {
  it('fmtIqd uses Latin digits with thousands separators', () => {
    expect(fmtIqd(12500)).toBe('12,500');
    expect(fmtIqd(0)).toBe('0');
    expect(fmtIqd(1234567)).toBe('1,234,567');
    expect(fmtIqd(-2500)).toBe('-2,500');
  });

  it('fmtTime renders HH:mm in Asia/Baghdad', () => {
    expect(fmtTime('2026-08-25T11:05:00Z')).toBe('14:05');
    expect(fmtTime('2026-08-25T21:30:00Z')).toBe('00:30');
    expect(fmtTime('2026-08-25T21:30:00Z', 'UTC')).toBe('21:30');
    expect(fmtTime('garbage')).toBe('--:--');
  });

  it('esc escapes only & < >', () => {
    expect(esc('a<b>&"c"')).toBe('a&lt;b&gt;&amp;"c"');
  });
});

describe('renderOrder', () => {
  it('matches the spec template (ar)', () => {
    const expected = [
      '🛎 <b>طلب جديد · New order</b>  #0F6A3C2E',
      '🪑 <b>طاولة 7</b> · Table 7',
      '🕒 14:05',
      '────────────',
      '2× كابتشينو / Cappuccino · كبير · حليب شوفان · جرعة إضافية ×2',
      '   📝 «no &lt;b&gt;foam&lt;/b&gt; &amp; hot»',
      '1× ماء / Water',
      '────────────',
      '💰 <b>المجموع: 18,500 د.ع</b> · Total 18,500 IQD',
      '💵 الدفع عند الكاشير · Pay at the desk',
    ].join('\n');
    expect(renderOrder(order, 'ar')).toBe(expected);
  });

  it('uses _en variant/modifier names with lang=en but keeps item lines bilingual', () => {
    const text = renderOrder(order, 'en');
    expect(text).toContain('2× كابتشينو / Cappuccino · Large · Oat milk · Extra shot ×2');
    expect(text).toContain('1× ماء / Water');
  });

  it('falls back to an em dash for an unknown table', () => {
    expect(renderOrder({ ...order, table_number: null })).toContain('🪑 <b>طاولة —</b> · Table —');
  });

  it('stays under 4000 chars with 60 items and appends the overflow marker', () => {
    const big: OrderPayload = {
      ...order,
      items: Array.from({ length: 60 }, (_, i) => ({
        qty: 1,
        name_en: `Item number ${i} with a fairly long English name`,
        name_ar: `صنف رقم ${i} باسم عربي طويل نسبياً`,
        variant_en: 'Large',
        variant_ar: 'كبير',
        variant_count: 2,
        modifiers: [{ name_en: 'Extra sauce', name_ar: 'صلصة إضافية', qty: 1 }],
        notes: null,
      })),
    };
    const text = renderOrder(big);
    expect(text.length).toBeLessThan(4000);
    expect(text).toMatch(/… و \d+ أصناف أخرى \/ \+\d+ more\n────────────/);
    expect(text).toContain('💵 الدفع عند الكاشير · Pay at the desk');
  });
});

describe('truncateItems', () => {
  it('returns lines unchanged when they fit', () => {
    expect(truncateItems(['a', 'b'], 100)).toEqual(['a', 'b']);
  });
  it('drops from the end and reports the dropped count', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line-${i}-xxxxxxxxxx`);
    const out = truncateItems(lines, 120);
    expect(out.at(-1)).toMatch(/^… و (\d+) أصناف أخرى \/ \+\1 more$/);
    expect(out.length).toBeLessThan(lines.length + 1);
    expect(out.join('\n').length).toBeLessThanOrEqual(120);
  });
});

describe('renderCall / renderTest', () => {
  it('renders each reason line', () => {
    const base = { call_id: CALL_ID, table_number: '3', raised_at: '2026-08-25T11:05:00Z' };
    expect(renderCall({ ...base, reason: 'bill' })).toBe(
      ['🙋 <b>نداء نادل · Waiter call</b>', '🪑 <b>طاولة 3</b> · Table 3', '💳 الحساب · The bill', '🕒 14:05'].join('\n'),
    );
    expect(renderCall({ ...base, reason: 'order' })).toContain('🍽 يريد الطلب · Wants to order');
    expect(renderCall({ ...base, reason: 'water' })).toContain('💧 ماء · Water');
    expect(renderCall({ ...base, reason: 'assistance' })).toContain('🙋 مساعدة · Assistance');
  });

  it('renders the test message', () => {
    expect(renderTest({ sent_by: 'Ali <owner>', at: '2026-08-25T11:05:00Z' })).toBe(
      [
        '🔔 <b>رسالة تجريبية · Test message</b>',
        'تم ربط تتش كافيه بهذه المجموعة بنجاح ✅',
        'Touch Cafe is connected to this group.',
        '🕒 14:05 · بواسطة Ali &lt;owner&gt;',
      ].join('\n'),
    );
  });
});

describe('keyboards', () => {
  const bytes = (s: string) => new TextEncoder().encode(s).length;

  it('order keyboard has three buttons under the 64-byte callback cap', () => {
    const kb = orderKeyboard(ORDER_ID, 'new')!;
    expect(kb.inline_keyboard).toHaveLength(1);
    expect(kb.inline_keyboard[0]!.map((b) => b.callback_data)).toEqual([
      `o:seen:${ORDER_ID}`,
      `o:served:${ORDER_ID}`,
      `o:void:${ORDER_ID}`,
    ]);
    expect(kb.inline_keyboard[0]!.map((b) => b.text)).toEqual(['✅ شوهد', '🍽 تم التقديم', '❌ إلغاء']);
    for (const b of kb.inline_keyboard[0]!) expect(bytes(b.callback_data)).toBeLessThanOrEqual(64);
  });

  it('reduces per stage', () => {
    expect(orderKeyboard(ORDER_ID, 'order_seen')!.inline_keyboard[0]!.map((b) => b.text)).toEqual(['🍽 تم التقديم', '❌ إلغاء']);
    expect(orderKeyboard(ORDER_ID, 'order_final')).toBeNull();
    expect(callKeyboard(CALL_ID, 'new')!.inline_keyboard[0]!.map((b) => b.callback_data)).toEqual([`w:ack:${CALL_ID}`, `w:done:${CALL_ID}`]);
    expect(callKeyboard(CALL_ID, 'call_acked')!.inline_keyboard[0]!.map((b) => b.text)).toEqual(['✔️ تم']);
    expect(callKeyboard(CALL_ID, 'call_final')).toBeNull();
  });

  it('keyboardAfter maps apply_action keyboard stages', () => {
    expect(keyboardAfter('order_new', 'unchanged', ORDER_ID)).toBeUndefined();
    expect(keyboardAfter('order_new', 'order_final', ORDER_ID)).toBeNull();
    expect(keyboardAfter('waiter_call', 'call_acked', CALL_ID)!.inline_keyboard[0]!).toHaveLength(1);
  });
});

describe('callbacks', () => {
  it('parseCallbackData accepts the contract and rejects everything else', () => {
    expect(parseCallbackData(`o:seen:${ORDER_ID}`)).toEqual({ action: 'o:seen', refId: ORDER_ID });
    expect(parseCallbackData(`w:done:${CALL_ID}`)).toEqual({ action: 'w:done', refId: CALL_ID });
    expect(parseCallbackData(`o:nope:${ORDER_ID}`)).toBeNull();
    expect(parseCallbackData('o:seen:not-a-uuid')).toBeNull();
    expect(parseCallbackData(`o:seen:${ORDER_ID.toUpperCase()}`)).toBeNull();
    expect(parseCallbackData(undefined)).toBeNull();
  });

  it('toasts and footers', () => {
    expect(toastFor('applied')).toBe('تم ✅');
    expect(toastFor('duplicate')).toBe('سبق تسجيله');
    expect(toastFor('invalid')).toBe('غير ممكن الآن');
    expect(toastFor('not_found')).toBe('غير موجود');
    expect(toastFor('refused')).toBe('الطلب مدفوع — الإلغاء من الكاشير');
    expect(toastFor('???')).toBe('غير معروف');
    expect(statusFooter('o:seen', 'Ahmed <x>', '14:07')).toBe('✅ شوهد · Seen — Ahmed &lt;x&gt; · 14:07');
    expect(statusFooter('w:ack', 'Sara', '09:00')).toBe('✅ قادم · On the way — Sara · 09:00');
  });
});
