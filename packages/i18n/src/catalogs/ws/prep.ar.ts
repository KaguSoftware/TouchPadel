import type { prepEn } from './prep.en';
import type { DeepMessages } from './types';

export const prepAr: DeepMessages<typeof prepEn> = {
  title: 'شاشة المطبخ',
  open: '{count} مفتوحة',
  empty: {
    title: 'لا توجد تذاكر — كل شيء منجز',
    body: 'تظهر هنا الطلبات المرسلة من الموقع أو الكاشير فور إرسالها.',
  },
  error: {
    title: 'تعذّر تحميل التذاكر',
    hint: 'تحقق من اتصال هذه الشاشة بالشبكة. تعيد اللوحة المحاولة وحدها كل 30 ثانية.',
  },
  age: {
    fresh: 'في الوقت',
    warm: 'يقترب من التأخر',
    late: 'متأخر',
    hours: '{h}س {m}د',
    days: '{d} يوم',
  },
  exit: 'مغادرة شاشة المطبخ',
  ticket: {
    number: 'تذكرة {n}',
    selected: 'محددة',
    itemsDone: '{done} من {total} جاهزة',
    marksOffline: 'يعود تعليم الأصناف عند عودة الاتصال.',
  },
  keys: {
    legend: 'المفاتيح',
    ticket: 'اختيار تذكرة',
    prevNext: 'التذكرة التالية',
    items: 'الصنف التالي',
    toggle: 'تعليم الصنف',
    clear: 'إلغاء التحديد',
  },
};
