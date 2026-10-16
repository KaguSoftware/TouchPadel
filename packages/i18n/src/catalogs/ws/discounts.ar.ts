import type { DeepMessages } from './types';
import type { discountsEn } from './discounts.en';

/**
 * `ws.discounts.*` بالعربية. Mirrors discounts.en.ts key-for-key (a missing key fails typecheck).
 *
 * «خصم الزبون» is the customer's own standing discount; «الكافيه» and «رسوم الملعب» are the
 * words the till and the desk already use for the two parts.
 */
export const discountsAr: DeepMessages<typeof discountsEn> = {
  action: 'خصم الزبون',
  offline: 'الخصومات تحتاج إلى اتصال.',
  reason: {
    sponsored: 'برعاية النادي',
    family: 'أقارب',
    coach: 'مدرّب',
    staff: 'موظف',
    other: 'سبب آخر',
  },
  part: {
    cafe: 'الكافيه والمتجر',
    court: 'رسوم الملعب',
    cafeShort: 'الكافيه',
    courtShort: 'الملعب',
  },
  editor: {
    none: 'بلا خصم',
    percent: '%',
    amount: 'د.ع.',
    typeLabel: '{part}: نوع الخصم',
    valueLabel: '{part}: قيمة الخصم',
    percentPlaceholder: 'مثلًا 20',
    amountPlaceholder: 'مثلًا 5000',
    perBill: 'من كل فاتورة',
    perBooking: 'من كل حجز',
    reason: 'السبب',
    note: 'ملاحظة',
    notePlaceholder: 'مثلًا: يلعب في فريق النادي',
    errors: {
      empty: 'اكتب قيمة الخصم.',
      percentRange: 'اكتب نسبة من 1 إلى 100.',
      amountRange: 'اكتب مبلغًا لا يقل عن 1 دينار.',
      parts: 'حدّد خصمًا على الكافيه أو رسوم الملعب أو كليهما.',
      reason: 'اختر السبب.',
      note: 'لا تتجاوز الملاحظة 120 حرفًا.',
    },
  },
  card: {
    title: 'الخصم',
    none: 'لا يوجد خصم',
    noneLead: 'زبون برعاية النادي أو من الأقارب أو مدرّب؟ حدّد سعره مرة واحدة وتأخذه كل فواتيره.',
    set: 'تحديد',
    change: 'تعديل',
    fullPrice: 'السعر الكامل',
    setBy: 'حدّده {name} · {date}',
    someone: 'أحد الموظفين',
    badge: 'خصم · {reason}',
  },
  record: {
    title: 'الخصم',
    lead: 'تأخذه كل فواتيره، في كل الفروع.',
    save: 'حفظ الخصم',
    remove: 'إلغاء الخصم',
    saved: 'حُفظ الخصم لـ {name}.',
    removed: 'أُلغي الخصم عن {name}.',
    self: 'لا يمكنك تحديد خصم لنفسك. اطلب ذلك من زميل.',
  },
  bill: {
    keep: 'اعتمده لـ {name} على كل فاتورة',
    keepHint: 'يُحفظ في سجله، وتأخذه كل فواتيره من الآن.',
    onceHint: 'لهذه الفاتورة فقط، ويبقى سجله كما هو.',
    standing: 'في سجله: {parts}',
    apply: 'تطبيق',
    remove: 'إزالته من هذه الفاتورة',
    noCustomer: 'لا يوجد زبون على هذه الفاتورة بعد.',
    noCustomerLead: 'أضف العضو إلى الفاتورة أولًا (زر «عضو» على الفاتورة)، ثم أعطه الخصم.',
    self: 'هذه فاتورتك أنت، فلا يعطيك الخصم إلا زميل.',
    courtClosed: 'لا يمكن تغيير خصم الملعب الآن: دُفعت فاتورة هذا الحجز بهذا الخصم.',
    nothing: 'لا يوجد في هذه الفاتورة ما يُخصم منه.',
    savedKeep: 'حُفظ لـ {name}، وتأخذه كل فواتيره.',
    savedOnce: 'أُضيف الخصم إلى هذه الفاتورة.',
    removed: 'أُزيل الخصم من هذه الفاتورة.',
    row: 'خصم الزبون',
    once: 'هذه الفاتورة',
    courtNote: 'يشمل {label}: {amount} من رسوم الملعب',
    cafeWaived: 'الكافيه بالسعر الكامل على هذه الفاتورة',
    courtWaived: 'رسوم الملعب بالسعر الكامل لهذا الحجز',
  },
};
