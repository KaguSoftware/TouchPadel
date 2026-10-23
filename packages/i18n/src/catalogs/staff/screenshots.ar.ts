import type { DeepMessages } from '../ws/types';
import type { staffScreenshotsEn } from './screenshots.en';

export const staffScreenshotsAr: DeepMessages<typeof staffScreenshotsEn> = {
  title: 'لقطات الشاشة',
  entry: 'لقطات الشاشة',
  entryPreview: 'من صوّر أي صفحة',
  intro: 'لا يستطيع الموظفون تصوير شاشة تطبيق الموظفين على أندرويد. وتظهر هنا كل لقطة يسمح بها الآيفون، وكل محاولة تصلنا.',
  empty: 'لم يُبلَّغ عن أي لقطة شاشة.',
  loadFailed: 'تعذّر تحميل القائمة.',
  row: '{name} في {page}',
  unknownStaff: 'أحد الموظفين',
};
