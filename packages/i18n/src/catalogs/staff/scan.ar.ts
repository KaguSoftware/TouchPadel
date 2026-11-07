import type { DeepMessages } from '../ws/types';
import type { staffScanEn } from './scan.en';

/** `staff.scan.*` بالعربية. Drafted by the build team; the client reviews the Arabic. */
export const staffScanAr: DeepMessages<typeof staffScanEn> = {
  take: 'التقاط صورة',
  library: 'اختيار صورة محفوظة',
  retake: 'إعادة التصوير',
  slips: {
    title: 'الأوراق',
    add: 'مسح طلب',
  },
  rows: {
    slip: 'مسح طلب',
    receipt: 'مسح إيصال',
  },
  slip: {
    tileTitle: 'صوّر ورقة الطلب',
    tileHint: 'يقرؤها الكاشير ويرسلها إلى المطبخ',
    title: 'مسح طلب',
    send: 'إرسال إلى كاشير الكافيه',
    sent: 'أُرسلت الورقة. وصلت إلى كاشير الكافيه.',
    mine: 'أوراقي اليوم',
    empty: 'لم تُرسل أي ورقة اليوم.',
    table: 'طاولة {number}',
    noTable: 'بلا طاولة',
    items: 'الأصناف: {count}',
    setAside: 'وُضعت جانبًا: {reason}',
  },
  receipt: {
    tileTitle: 'صوّر الإيصال',
    tileHint: 'يراجعه المدير في «استلام البضائع»',
    title: 'مسح إيصال',
    send: 'إرسال إلى استلام البضائع',
    sent: 'أُرسل الإيصال. سيراجعه المدير في «استلام البضائع».',
    mine: 'إيصالاتي',
    empty: 'لم يُرسل أي إيصال خلال آخر 30 يومًا.',
    supplier: 'لم يُقرأ اسم المورّد',
    setAside: 'وُضع جانبًا: {reason}',
  },
};
