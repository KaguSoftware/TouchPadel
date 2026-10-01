import type { DeepMessages } from './ws/types';
import type { branchesEn } from './branches.en';

/**
 * `branches.*` بالعربية: فروع تتش بادل كما يراها الضيف (منتقي الفرع في التطبيق وعلى
 * الموقع، وأسطر الفروع في موقع النادي). Mirrors branches.en.ts key-for-key.
 * Arabic reviewed 2026-09-27 (the website pass); the `mobile` lines are the app's.
 */
export const branchesAr: DeepMessages<typeof branchesEn> = {
  common: {
    branch: 'الفرع',
    chooseBranch: 'اختر فرعًا',
    changeBranch: 'تغيير الفرع',
    allBranches: 'جميع الفروع',
    address: 'العنوان',
    directions: 'الاتجاهات',
    call: 'اتصل بـ {name}',
  },
  mobile: {
    pickerTitle: 'أين تريد أن تلعب؟',
    pickerHint: 'يمكنك تغيير ذلك في أي وقت.',
    bookingAt: 'الحجز في {name}',
  },
  web: {
    menuPickerTitle: 'في أي فرع أنت؟',
    menuPickerHint: 'امسح الرمز الموجود على طاولتك لتطلب مباشرة من مكانك.',
    visitTitle: 'فروعنا',
    openNow: 'مفتوح اليوم',
  },
};
