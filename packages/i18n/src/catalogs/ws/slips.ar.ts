import type { slipsEn } from './slips.en';
import type { DeepMessages } from './types';

/**
 * `ws.slips.*` بالعربية — «الطلبات الممسوحة» على الكاشير. Mirrors slips.en.ts key-for-key;
 * `DeepMessages` fails the typecheck on a missing or extra key. Drafted by the build team;
 * the client reviews the Arabic.
 */
export const slipsAr: DeepMessages<typeof slipsEn> = {
  panel: {
    title: 'الطلبات الممسوحة',
    badge: '{count} بالانتظار',
    from: '{name} · {time}',
    table: 'طاولة {number}',
    noTable: 'لا توجد طاولة على الورقة',
    lines: 'الأصناف المطابَقة: {matched} من {count}',
    open: 'فتح',
    strip: 'طلبات ممسوحة بالانتظار: {count}',
    sentToday: 'أُرسلت أو وُضعت جانباً اليوم ({count})',
    sentBy: 'أرسلها {name}',
  },
  status: {
    uploaded: 'بالانتظار',
    reading: 'جارٍ القراءة…',
    read: 'جاهز',
    failed: 'تعذّرت القراءة',
    sent: 'أُرسل',
    rejected: 'موضوع جانباً',
  },
  review: {
    title: 'طلب ممسوح',
    subtitle: 'من {name} · {time}',
    photo: 'ورقة الطلب',
    reading: 'تجري قراءة الورقة. قد يستغرق ذلك حتى دقيقة.',
    lead: 'طابق كل سطر مع الصورة، ثم أرسله إلى المطبخ. احذف كل ما شُطب أو ما ليس للمطبخ.',
    manualLead: 'اكتب الطلب من الصورة.',
    onSlip: 'في الورقة',
    qty: 'الكمية {qty}',
    item: 'الصنف',
    choose: 'اختر صنفاً…',
    size: 'الحجم',
    count: 'الكمية',
    notes: 'ملاحظة للمطبخ',
    options: 'الخيارات',
    optionsSet: 'الخيارات: {list}',
    addLine: 'إضافة صنف',
    removeLine: 'حذف السطر {n}',
    table: 'الطاولة',
    chooseTable: 'اختر طاولة…',
    tab: 'الحساب',
    chooseTab: 'لهذه الطاولة {count} حسابات مفتوحة. اختر واحداً.',
    tabLabel: 'فُتح {time}',
    newTab: 'يُفتح حساب جديد على هذه الطاولة.',
    onTab: 'يُضاف إلى حساب الطاولة المفتوح.',
    send: 'إرسال إلى المطبخ',
    sent: 'أُرسل الطلب إلى المطبخ',
    noLines: 'أضف صنفاً واحداً على الأقل.',
    reject: 'وضعها جانباً',
    rejectTitle: 'وضع هذه الورقة جانباً؟',
    rejectBody: 'لن يُرسل شيء إلى المطبخ. سيرى النادل أنها وُضعت جانباً.',
    rejected: 'وُضعت الورقة جانباً',
    readAgain: 'إعادة القراءة',
    gone: 'انتهت هذه الورقة',
    goneBody: 'أُرسلت إلى المطبخ أو وُضعت جانباً من قبل.',
    problem: {
      item: 'اختر الصنف',
      qty: 'رقم من 1 إلى 99',
      options: 'اختر الخيارات ({group})',
      table: 'اختر الطاولة',
      tab: 'اختر الحساب',
    },
    match: {
      sure: 'مطابَق',
      alias: 'مطابَق من ورقة سابقة',
      check: 'تحقّق من هذه المطابقة',
      none: 'لا مطابقة: اختر الصنف أو احذف السطر',
      manual: 'اختير يدوياً',
    },
    flag: {
      UNCLEAR: 'صعب القراءة: طابقه مع الصورة',
      NO_QTY: 'لا يوجد رقم: تُعتمد الكمية 1',
    },
  },
};
