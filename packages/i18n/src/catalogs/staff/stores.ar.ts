import type { DeepMessages } from '../ws/types';
import type { staffStoresEn } from './stores.en';

export const staffStoresAr: DeepMessages<typeof staffStoresEn> = {
  countWaiting: 'لهذا المخزن جرد مفتوح أو بانتظار المدير. حاول مرة أخرى بعد أن ينهيه المدير.',
};
