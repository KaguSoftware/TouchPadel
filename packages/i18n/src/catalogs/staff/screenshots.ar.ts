import type { DeepMessages } from '../ws/types';
import type { staffScreenshotsEn } from './screenshots.en';

export const staffScreenshotsAr: DeepMessages<typeof staffScreenshotsEn> = {
  title: 'لقطات الشاشة',
  entry: 'لقطات الشاشة',
  entryPreview: 'من صوّر أي صفحة',
  intro: 'لا يستطيع الموظفون تصوير تطبيق الموظفين على أندرويد؛ وتُدرج هنا كل لقطة يسمح بها الآيفون وكل محاولة نعلم بها.',
  empty: 'لا توجد لقطات مُبلَّغ عنها.',
  loadFailed: 'تعذّر تحميل القائمة.',
  row: '{name} في {page}',
  unknownStaff: 'أحد الموظفين',
};
