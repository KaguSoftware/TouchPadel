import type { DeepMessages } from './ws/types';
import type { branchesEn } from './branches.en';

/**
 * `branches.*` بالعربية — فروع تتش كما يراها الضيف (منتقي الفرع في التطبيق وعلى
 * الموقع، وأسطر الفروع في موقع النادي). Mirrors branches.en.ts key-for-key.
 * Arabic drafts for review.
 */
export const branchesAr: DeepMessages<typeof branchesEn> = {
  common: {
    branch: 'الفرع',
    chooseBranch: 'اختر فرعًا',
    changeBranch: 'تغيير الفرع',
    allBranches: 'كل الفروع',
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
    menuPickerHint: 'امسح الرمز الموجود على طاولتك لتطلب منها مباشرة.',
    visitTitle: 'فروعنا',
    openNow: 'مفتوح اليوم',
  },
};
