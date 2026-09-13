import type { DeepMessages } from './types';
import type { analyticsEn } from './analytics.en';

export const analyticsAr: DeepMessages<typeof analyticsEn> = {
  tabs: {
    courts: 'الملاعب',
    cafe: 'الكافيه',
  },
  courts: {
    building: 'تحليلات الملاعب قيد الإنشاء',
    buildingBody: 'ستظهر هنا الحجوزات والإشغال والضيوف وربط الملعب بالكافيه. تبويب الكافيه جاهز.',
  },
  tips: {
    about: 'عن {title}',
  },
  kpi: {
    compareLabel: '{label}: الرقمان',
    compareValues: '{previous} سابقاً، {current} الآن',
  },
  twin: {
    table: 'عرض كجدول',
    chart: 'عرض كرسم',
    csv: 'تنزيل CSV',
  },
  heatmap: {
    hint: 'مرّر المؤشر فوق خلية لقراءة قيمتها',
    closed: 'مغلق',
    ofPeak: '{pct} من أكثر خلية ازدحاماً',
    cells: 'خلية',
    less: 'أقل',
    more: 'أكثر',
  },
};
