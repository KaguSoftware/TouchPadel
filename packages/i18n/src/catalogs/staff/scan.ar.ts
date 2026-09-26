import type { DeepMessages } from '../ws/types';
import type { staffScanEn } from './scan.en';

/** `staff.scan.*` بالعربية. Drafted by the build team; the client reviews the Arabic. */
export const staffScanAr: DeepMessages<typeof staffScanEn> = {
  rows: {
    slip: 'مسح طلب',
    receipt: 'مسح وصل',
  },
  slip: {
    title: 'مسح طلب',
    lead: 'صوّر ورقة الطلب وهي مسطّحة وفي إضاءة جيدة، ورقم الطاولة مكتوب عليها. يراجعها الكاشير ويرسلها إلى المطبخ.',
    photo: 'ورقة الطلب',
    send: 'إرسال إلى الكاشير',
    sent: 'أُرسلت. وصلت إلى الكاشير.',
    noPhoto: 'صوّر الورقة أولاً.',
    mine: 'أوراقي اليوم',
    empty: 'لم تُرسل أي ورقة اليوم.',
    table: 'طاولة {number}',
    noTable: 'بلا طاولة',
    items: 'الأصناف: {count}',
    setAside: 'وُضعت جانباً: {reason}',
  },
  receipt: {
    title: 'مسح وصل',
    lead: 'صوّر وصل المورّد أو فاتورته وهو مسطّح وفي إضاءة جيدة. يراجعه المدير في شاشة الوارد ويدخله إلى المخزون.',
    photo: 'صورة الوصل',
    send: 'إرسال إلى الوارد',
    sent: 'أُرسل. سيراجعه المدير في شاشة الوارد.',
    noPhoto: 'صوّر الوصل أولاً.',
    mine: 'وصولاتي',
    empty: 'لم تُرسل أي وصولات خلال آخر 30 يوماً.',
    supplier: 'لم يُقرأ اسم المورّد',
    setAside: 'وُضع جانباً: {reason}',
  },
};
