/** 生产环境功能开关 — 本地懒加载缓存 */
import { fetchProductionFeatures, type ProductionFeatures } from './api';

let cached: ProductionFeatures | null = null;
let promise: Promise<ProductionFeatures> | null = null;

export function loadProductionFeatures(): Promise<ProductionFeatures> {
  if (cached) return Promise.resolve(cached);
  if (!promise) {
    promise = fetchProductionFeatures()
      .then((f) => { cached = f; return f; })
      .catch(() => {
        cached = { guestMode: false, filing: null };
        return cached!;
      });
  }
  return promise;
}

export function getProductionFeatures(): ProductionFeatures | null {
  return cached;
}
