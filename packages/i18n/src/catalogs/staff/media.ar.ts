import type { DeepMessages } from '../ws/types';
import type { staffMediaEn } from './media.en';

export const staffMediaAr: DeepMessages<typeof staffMediaEn> = {
  add: 'إضافة صورة',
  sourceTitle: 'إضافة صورة',
  camera: 'التقاط صورة',
  library: 'اختيار من المعرض',
  cancel: 'إلغاء',
  uploading: 'جارٍ رفع الصورة…',
  photo: 'الصورة {n}',
  remove: 'إزالة الصورة {n}',
  count: 'الصور: {count} من {max}',
  cameraOff: 'إذن الكاميرا مغلق لتطبيق تتش بادل. يمكنك تفعيله من الإعدادات لالتقاط صورة العمل.',
  openSettings: 'فتح الإعدادات',
  unavailable: 'لا يدعم هذا الإصدار من التطبيق إرفاق الصور. يمكنك تحديث تتش بادل ثم إعادة المحاولة.',
  failed: 'تعذّر رفع الصورة. يمكنك المحاولة مرة أخرى.',
  retry: 'إعادة رفع الصورة نفسها',
};
