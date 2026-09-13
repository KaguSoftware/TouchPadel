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
};
