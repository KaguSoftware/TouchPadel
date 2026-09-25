import type { releaseEn } from './release.en';
import type { DeepMessages } from './types';

export const releaseAr: DeepMessages<typeof releaseEn> = {
  variance: {
    productTest: 'تجارب الأصناف الجديدة',
  },
  ledger: {
    openRun: 'افتح إطلاق الصنف',
  },
  menu: {
    proposeItem: 'اقترح صنفًا جديدًا',
    proposeHint: 'تمرّ أصناف المقهى الجديدة بإطلاق صنف، والمالك هو من يطلقها.',
    inReleaseBadge: 'قيد الإطلاق',
    inRelease: 'قيد الإطلاق: {run}',
    inReleaseBody: 'أسعاره تأتي من الإطلاق، ويُطرح للبيع عندما يطلقه المالك.',
    openRun: 'افتح الإطلاق',
    putOnSale: 'اطرحه للبيع',
    switch: {
      inRelease: 'يُطرح للبيع عندما يُتمّ المالك إطلاقه.',
      ownerLaunches: 'يُطرح للبيع عندما يطلقه المالك.',
      putOnSale: 'يُحفظ مخفيًا حتى يوافق المالك على سعره.',
      savedHidden: 'يُحفظ المنتج الجديد مخفيًا. أضف مقاساته وأسعاره، ثم اضغط «اطرحه للبيع»: يُطرح للبيع عندما يوافق المالك على سعره.',
    },
    sizes: {
      changePrice: 'غيّر السعر',
      onSale: 'هذا الصنف معروض للبيع، فتتغيّر أسعاره عبر «غيّر السعر» بموافقة المالك.',
      inRelease: 'خطوة السعر في الإطلاق هي التي تحدد هذه الأسعار.',
    },
  },
};
