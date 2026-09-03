/** Deep shape of a catalog fragment with every leaf widened to `string`. */
export type DeepMessages<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepMessages<T[K]>;
};
