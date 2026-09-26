/**
 * The degraded path of `analytics-insights`: no GROQ key, or the budget spent,
 * and the card still has to say something true. These sentences are templated
 * from the SAME payload the model would read (`insightsContract.ts`), so a
 * name, a weekday or an amount printed here is one the page also prints.
 *
 * Typed against the contract on purpose. The previous version read fields the
 * payload never carried (`name_en`, `business_date`, a numeric `weekday`) and
 * printed empty names and "Sunday" for every cell; the types make that drift a
 * compile error. Pure: no I/O, no Deno, so the DB vitest suite runs it.
 */
import {
  MIN_ATTACH_BOOKINGS,
  MIN_CELL_OPEN_DAYS,
  MIN_ITEM_UNITS,
  MIN_RATE_DENOM,
  type CafeInsightsPayload,
  type CourtsInsightsPayload,
  type InsightWire,
} from './insightsContract.ts';

export type FallbackLang = 'ar' | 'en';

export type FallbackRequest =
  | { scope: 'cafe'; lang: FallbackLang; data: CafeInsightsPayload }
  | { scope: 'courts'; lang: FallbackLang; data: CourtsInsightsPayload };

// Latin digits in both languages; IQD has no decimals.
const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const fmt = (v: number | null | undefined) => Math.round(n(v)).toLocaleString('en-US');
const money = (v: number | null | undefined, lang: FallbackLang) => (lang === 'ar' ? `${fmt(v)} د.ع` : `${fmt(v)} IQD`);
const hourLabel = (h: number) => `${String(Math.round(h)).padStart(2, '0')}:00`;

/** Deterministic findings from the payload, one scope or the other. */
export function templatedInsights(req: FallbackRequest): InsightWire[] {
  return req.scope === 'courts' ? templatedCourtsInsights(req.lang, req.data) : templatedCafeInsights(req.lang, req.data);
}

export function templatedCafeInsights(lang: FallbackLang, data: CafeInsightsPayload): InsightWire[] {
  const out: InsightWire[] = [];
  const ar = lang === 'ar';

  const best = data.best_sellers.find((b) => b.name && n(b.qty) > 0);
  if (best) {
    out.push({
      text: ar
        ? `${best.name} كان الأكثر مبيعاً: ${fmt(best.qty)} وحدة بإيراد ${money(best.revenue_iqd, lang)} (${n(best.share_pct)}% من الكمية المباعة).`
        : `${best.name} was the best seller: ${fmt(best.qty)} sold for ${money(best.revenue_iqd, lang)} (${n(best.share_pct)}% of units).`,
      kind: 'summary',
      subjects: [best.name],
      metrics: { qty: n(best.qty), revenue_iqd: n(best.revenue_iqd), share_pct: n(best.share_pct) },
      confidence: n(best.qty) >= MIN_ITEM_UNITS ? 'high' : 'low',
      sample: n(best.qty),
    });
  }

  const costed = (data.margins?.items ?? []).filter((i) => i.name && i.has_cost && n(i.qty) > 0 && i.margin_iqd !== null);
  if (costed.length) {
    const worst = costed.reduce((a, b) => (n(b.margin_pct) < n(a.margin_pct) ? b : a));
    const below = n(worst.margin_iqd) < 0;
    out.push({
      text: ar
        ? below
          ? `${worst.name} يُباع بأقل من كلفته: هامش ${money(worst.margin_iqd, lang)} على ${fmt(worst.qty)} وحدة — راجع السعر أو الكلفة.`
          : `${worst.name} صاحب أضعف هامش بين الأصناف المُكلَّفة: ${n(worst.margin_pct)}% (${money(worst.margin_iqd, lang)} من ${money(worst.revenue_iqd, lang)}) — فكّر برفع السعر أو خفض الكلفة.`
        : below
          ? `${worst.name} sells below cost: margin ${money(worst.margin_iqd, lang)} across ${fmt(worst.qty)} units — review its price or cost.`
          : `${worst.name} has the thinnest margin among costed items: ${n(worst.margin_pct)}% (${money(worst.margin_iqd, lang)} of ${money(worst.revenue_iqd, lang)}) — consider a small price rise or a cheaper portion.`,
      kind: 'profit',
      subjects: [worst.name],
      metrics: { margin_pct: n(worst.margin_pct), margin_iqd: n(worst.margin_iqd), qty: n(worst.qty) },
      confidence: n(worst.qty) >= MIN_ITEM_UNITS ? 'medium' : 'low',
      sample: n(worst.qty),
    });
  }

  const pair = data.bought_together.find((p) => p.a && p.b && n(p.both) > 0);
  if (pair) {
    const lift = pair.lift === null ? null : Math.round(n(pair.lift) * 10) / 10;
    out.push({
      text: ar
        ? `${pair.a} و${pair.b} طُلبا معاً ${fmt(pair.both)} مرة (${n(pair.confidence_pct)}% من طلبات ${pair.a}${lift !== null ? `، رفع ${lift}×` : ''}) — جرّب اقتراح أحدهما عند إضافة الآخر.`
        : `${pair.a} and ${pair.b} were ordered together ${fmt(pair.both)} times (${n(pair.confidence_pct)}% of orders with ${pair.a}${lift !== null ? `, lift ${lift}×` : ''}) — try suggesting one when the other is added.`,
      kind: 'structural',
      subjects: [pair.a, pair.b],
      metrics: { both: n(pair.both), confidence_pct: n(pair.confidence_pct), ...(lift !== null ? { lift } : {}) },
      confidence: n(pair.both) >= 10 ? 'medium' : 'low',
      sample: n(pair.both),
    });
  }

  if (data.promo && n(data.promo.qty) > 0) {
    const p = data.promo;
    out.push({
      text: ar
        ? `الأصناف المروَّجة باعت ${fmt(p.qty)} وحدة بإيراد ${money(p.revenue_iqd, lang)} مقابل خصومات بقيمة ${money(p.discount_iqd, lang)} في ${fmt(p.orders)} طلب.`
        : `Promoted items sold ${fmt(p.qty)} units for ${money(p.revenue_iqd, lang)}, giving away ${money(p.discount_iqd, lang)} in discounts across ${fmt(p.orders)} orders.`,
      kind: 'pricing',
      subjects: [],
      metrics: { qty: n(p.qty), revenue_iqd: n(p.revenue_iqd), discount_iqd: n(p.discount_iqd), orders: n(p.orders) },
      confidence: n(p.orders) >= MIN_RATE_DENOM ? 'medium' : 'low',
      sample: n(p.orders),
    });
  }

  const busiest = data.daily
    .filter((d) => d.date && n(d.revenue_iqd) > 0)
    .reduce<CafeInsightsPayload['daily'][number] | null>((a, b) => (!a || n(b.revenue_iqd) > n(a.revenue_iqd) ? b : a), null);
  if (busiest) {
    out.push({
      text: ar
        ? `أعلى يوم مبيعاً كان ${busiest.date}: ${money(busiest.revenue_iqd, lang)} عبر ${fmt(busiest.orders)} طلب.`
        : `Busiest day was ${busiest.date}: ${money(busiest.revenue_iqd, lang)} across ${fmt(busiest.orders)} orders.`,
      kind: 'movement',
      subjects: [busiest.date],
      metrics: { revenue_iqd: n(busiest.revenue_iqd), orders: n(busiest.orders) },
      confidence: 'high',
      sample: n(busiest.orders),
    });
  }
  return out;
}

export function templatedCourtsInsights(lang: FallbackLang, data: CourtsInsightsPayload): InsightWire[] {
  const out: InsightWire[] = [];
  const ar = lang === 'ar';
  const slotLabel = (cell: { weekday_label: string; hour: number }) => `${cell.weekday_label} ${hourLabel(cell.hour)}`;
  const openCells = (cells: CourtsInsightsPayload['heatmap_top']) => cells.filter((c) => c.weekday_label && n(c.open_days) > 0 && c.occupancy_pct !== null);

  const fullest = openCells(data.heatmap_top).reduce<CourtsInsightsPayload['heatmap_top'][number] | null>(
    (a, b) => (!a || n(b.occupancy_pct) > n(a.occupancy_pct) ? b : a),
    null,
  );
  if (fullest && n(fullest.bookings) > 0) {
    const slot = slotLabel(fullest);
    out.push({
      text: ar
        ? `أكثر ساعة امتلاءً كانت ${slot}: إشغال ${n(fullest.occupancy_pct)}% عبر ${fmt(fullest.open_days)} يوم مفتوح (${fmt(fullest.bookings)} حجز)؛ الطلب هنا يفوق العرض، ففكّر برفع سعر هذه الساعة أو توجيه الحجوزات إلى الساعة المجاورة.`
        : `Fullest open hour was ${slot}: ${n(fullest.occupancy_pct)}% occupancy across ${fmt(fullest.open_days)} open days (${fmt(fullest.bookings)} bookings); demand outruns supply here, so consider pricing this hour up or steering bookings to the hour beside it.`,
      kind: 'occupancy',
      subjects: [slot],
      metrics: { occupancy_pct: n(fullest.occupancy_pct), bookings: n(fullest.bookings), open_days: n(fullest.open_days) },
      confidence: n(fullest.open_days) >= MIN_CELL_OPEN_DAYS ? 'high' : 'low',
      sample: n(fullest.open_days),
    });
  }

  const emptiest = openCells(data.heatmap_bottom).reduce<CourtsInsightsPayload['heatmap_bottom'][number] | null>(
    (a, b) => (!a || n(b.occupancy_pct) < n(a.occupancy_pct) ? b : a),
    null,
  );
  if (emptiest) {
    const slot = slotLabel(emptiest);
    out.push({
      text: ar
        ? `أقل ساعة إشغالاً كانت ${slot}: إشغال ${n(emptiest.occupancy_pct)}% عبر ${fmt(emptiest.open_days)} يوم مفتوح (${fmt(emptiest.bookings)} حجز)؛ سعر مخفّض خارج الذروة أو حجز ثابت أسبوعي قد يملؤها.`
        : `Emptiest open hour was ${slot}: ${n(emptiest.occupancy_pct)}% occupancy across ${fmt(emptiest.open_days)} open days (${fmt(emptiest.bookings)} bookings); a cheaper off-peak rate or a standing weekly booking would fill it.`,
      kind: 'occupancy',
      subjects: [slot],
      metrics: { occupancy_pct: n(emptiest.occupancy_pct), bookings: n(emptiest.bookings), open_days: n(emptiest.open_days) },
      confidence: n(emptiest.open_days) >= MIN_CELL_OPEN_DAYS ? 'medium' : 'low',
      sample: n(emptiest.open_days),
    });
  }

  const canc = data.endings?.cancellations;
  if (canc && n(canc.total) > 0) {
    const bookedTotal = n(data.kpis.booked_total);
    const seg = (canc.top_segments ?? []).find((s) => s.label && s.rate_pct !== null);
    const worst = seg ? { label: seg.label, rate: n(seg.rate_pct) } : null;
    const rate = canc.rate_pct !== null ? `${n(canc.rate_pct)}%` : ar ? `${fmt(canc.total)} من ${fmt(bookedTotal)}` : `${fmt(canc.total)} of ${fmt(bookedTotal)}`;
    out.push({
      text: ar
        ? `أُلغي ${fmt(canc.total)} حجزاً (${rate} من كل الحجوزات)${worst ? `، والأسوأ في ${worst.label} بنسبة ${worst.rate}%` : ''}؛ اطلب تأكيداً قبل يوم من الموعد حيث تتكرر الإلغاءات.`
        : `${fmt(canc.total)} bookings were cancelled (${rate} of all bookings)${worst ? `, worst in ${worst.label} at ${worst.rate}%` : ''}; ask for a confirmation the day before where it clusters.`,
      kind: 'reliability',
      subjects: worst ? [worst.label] : [],
      metrics: { cancellations: n(canc.total), booked_total: bookedTotal, ...(canc.rate_pct !== null ? { rate_pct: n(canc.rate_pct) } : {}), ...(worst ? { segment_rate_pct: worst.rate } : {}) },
      confidence: bookedTotal >= MIN_RATE_DENOM ? 'medium' : 'low',
      sample: bookedTotal,
    });
  }

  const cafe = data.cafe;
  const attachCourts = cafe ? cafe.per_court.filter((c) => c.name && c.attach_pct !== null && n(c.live_bookings) > 0) : [];
  if (cafe && cafe.attach_pct !== null && attachCourts.length) {
    const lowest = attachCourts.reduce((a, b) => (n(b.attach_pct) < n(a.attach_pct) ? b : a));
    out.push({
      text: ar
        ? `نسبة ربط الكافيه بالحجوزات ${n(cafe.attach_pct)}%، والأدنى في ${lowest.name} بنسبة ${n(lowest.attach_pct)}%؛ فتح حساب كافيه عند الوصول لحجوزات هذا الملعب هو أرخص طريقة لرفعها.`
        : `Cafe attach is ${n(cafe.attach_pct)}% of bookings, lowest on ${lowest.name} at ${n(lowest.attach_pct)}%; opening a cafe tab at check-in for that court's bookings is the cheapest lift.`,
      kind: 'attach',
      subjects: [lowest.name],
      metrics: { attach_pct: n(cafe.attach_pct), court_attach_pct: n(lowest.attach_pct), live_bookings: n(lowest.live_bookings) },
      confidence: n(lowest.live_bookings) >= MIN_ATTACH_BOOKINGS ? 'medium' : 'low',
      sample: n(lowest.live_bookings),
    });
  }
  return out;
}
