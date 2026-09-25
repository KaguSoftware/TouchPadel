import type { DeepMessages } from '../ws/types';
import type { staffMediaEn } from './media.en';

export const staffMediaAr: DeepMessages<typeof staffMediaEn> = {
  add: 'إضافة صورة',
  sourceTitle: 'إضافة صورة',
  camera: 'التقاط صورة',
  library: 'اختيار من المكتبة',
  cancel: 'إلغاء',
  uploading: 'جارٍ رفع الصورة…',
  photo: 'الصورة {n}',
  remove: 'إزالة الصورة {n}',
  count: 'الصور: {count} من {max}',
  cameraOff: 'الوصول إلى الكاميرا متوقف لتطبيق تتش بادل. فعّله من الإعدادات لالتقاط صورة العمل.',
  openSettings: 'فتح الإعدادات',
  unavailable: 'لا يستطيع هذا الإصدار من التطبيق إرفاق الصور. حدّث تتش بادل ثم حاول مرة أخرى.',
  failed: 'لم تُرفع الصورة. حاول مرة أخرى.',
};
