import type { DeepMessages } from '../ws/types';
import type { staffScanEn } from './scan.en';

/** `staff.scan.*` بالعربية. Drafted by the build team; the client reviews the Arabic. */
export const staffScanAr: DeepMessages<typeof staffScanEn> = {
  rows: {
    slip: 'مسح طلب',
    receipt: 'مسح إيصال',
  },
  slip: {
    title: 'مسح طلب',
    lead: 'صوّر ورقة الطلب وهي مفرودة وفي إضاءة جيدة، وعليها رقم الطاولة. يراجعها الصندوق ويرسلها إلى المطبخ.',
    photo: 'ورقة الطلب',
    send: 'إرسال إلى الصندوق',
    sent: 'أُرسلت الورقة. وصلت إلى الصندوق.',
    noPhoto: 'صوّر الورقة أولًا.',
    mine: 'أوراقي اليوم',
    empty: 'لم تُرسل أي ورقة اليوم.',
    table: 'طاولة {number}',
    noTable: 'بلا طاولة',
    items: 'الأصناف: {count}',
    setAside: 'وُضعت جانبًا: {reason}',
  },
  receipt: {
    title: 'مسح إيصال',
    lead: 'صوّر إيصال المورّد أو فاتورته وهو مفرود وفي إضاءة جيدة. يراجعه المدير في «استلام البضائع» ويُدخله إلى المخزون.',
    photo: 'صورة الإيصال',
    send: 'إرسال إلى استلام البضائع',
    sent: 'أُرسل الإيصال. سيراجعه المدير في «استلام البضائع».',
    noPhoto: 'صوّر الإيصال أولًا.',
    mine: 'إيصالاتي',
    empty: 'لم يُرسل أي إيصال خلال آخر 30 يومًا.',
    supplier: 'لم يُقرأ اسم المورّد',
    setAside: 'وُضع جانبًا: {reason}',
  },
};
