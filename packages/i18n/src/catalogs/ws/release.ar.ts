import type { releaseEn } from './release.en';
import type { DeepMessages } from './types';

export const releaseAr: DeepMessages<typeof releaseEn> = {
  variance: {
    productTest: 'تجارب الأصناف الجديدة',
  },
  ledger: {
    openRun: 'فتح إطلاق الصنف',
  },
  menu: {
    proposeItem: 'اقتراح صنف جديد',
    proposeHint: 'تمرّ أصناف الكافيه الجديدة بإطلاق صنف، ويطلقها المالك.',
    inReleaseBadge: 'قيد الإطلاق',
    inRelease: 'قيد الإطلاق: {run}',
    inReleaseBody: 'أسعاره تأتي من الإطلاق، ويُطرح للبيع عندما يطلقه المالك.',
    openRun: 'فتح الإطلاق',
    putOnSale: 'طرح للبيع',
    switch: {
      inRelease: 'يُطرح للبيع عندما يُتمّ المالك إطلاقه.',
      ownerLaunches: 'يُطرح للبيع عندما يطلقه المالك.',
      putOnSale: 'يُحفظ مخفيًا حتى يوافق المالك على سعره.',
      savedHidden: 'يُحفظ المنتج الجديد مخفيًا. أضف أحجامه وأسعاره، ثم اضغط «طرح للبيع». يُطرح المنتج للبيع عندما يوافق المالك على سعره.',
    },
    sizes: {
      changePrice: 'تغيير السعر',
      onSale: 'هذا الصنف معروض للبيع، لذلك تتغيّر أسعار أحجامه وأسماؤها عبر «تغيير السعر» بموافقة المالك.',
      inRelease: 'تُحدَّد هذه الأسعار في خطوة السعر من الإطلاق.',
    },
  },
};
