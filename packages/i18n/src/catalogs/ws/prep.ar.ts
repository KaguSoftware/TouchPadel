import type { prepEn } from './prep.en';
import type { DeepMessages } from './types';

export const prepAr: DeepMessages<typeof prepEn> = {
  title: 'شاشة المطبخ',
  open: '{count} مفتوحة',
  empty: {
    title: 'لا توجد تذاكر نشطة — كل شيء منجز',
    body: 'تظهر هنا الطلبات المرسلة من الموقع أو الكاشير فور إرسالها.',
  },
  error: {
    title: 'تعذّر تحميل قائمة التذاكر',
    hint: 'تحقق من الشبكة. أثناء انقطاع الاتصال تستمر التذاكر بالوصول إلى هذه الشاشة من الكاشير عبر الشبكة المحلية.',
  },
  age: {
    fresh: 'في الوقت',
    warm: 'يتأخر',
    late: 'متأخر',
  },
  ticket: {
    number: 'تذكرة {n}',
    selected: 'محددة',
    itemsDone: '{done} من {total} جاهزة',
    marksOffline: 'تعود علامات الأصناف عند عودة الاتصال.',
  },
  keys: {
    legend: 'لوحة المفاتيح',
    ticket: 'اختيار تذكرة',
    prevNext: 'التذكرة السابقة / التالية',
    items: 'الصنف السابق / التالي',
    toggle: 'تعليم الصنف جاهزًا',
    start: 'ابدأ',
    ready: 'جاهز',
    complete: 'إنهاء',
    clear: 'إلغاء التحديد',
  },
};
