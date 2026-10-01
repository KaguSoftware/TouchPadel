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
  cameraOff: 'الوصول إلى الكاميرا غير مفعّل لتطبيق تتش بادل. فعّله من الإعدادات لالتقاط صورة العمل.',
  openSettings: 'فتح الإعدادات',
  unavailable: 'لا يدعم هذا الإصدار من التطبيق إرفاق الصور. حدّث تتش بادل ثم حاول مرة أخرى.',
  failed: 'تعذّر رفع الصورة. حاول مرة أخرى.',
  retry: 'إعادة رفع الصورة نفسها',
};
