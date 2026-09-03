/**
 * 字图离线缓存（单文件版）
 * - resolveImageSrc：渲染用。命中 IDB → blob objectURL；未命中 → 原网络地址即时显示 + 后台入队缓存
 * - warmDeckImages：学习开始时低并发预热整帖，实现断网可学
 * - 上限保护：超过 MAX_CACHED 跳过新缓存；开关 kv imageCacheEnabled 默认开
 */
import { clearImages, countImages, getImageBlob, kvGet, putImageBlob } from './db';

const MAX_CACHED = 8000;
const WARM_CONCURRENCY = 2;

/** objectURL 记忆：同一 url 稳定复用，避免每次渲染生成新 URL 泄漏内存 */
const objectUrlMemo = new Map<string, string>();

function objectUrlFor(url: string, blob: Blob): string {
  let u = objectUrlMemo.get(url);
  if (!u) {
    u = URL.createObjectURL(blob);
    objectUrlMemo.set(url, u);
    // 粗粒度防泄漏：超过 600 个时撤销最早的（当前卡片大概率仍在此范围外被复用前已重新生成）
    if (objectUrlMemo.size > 600) {
      const oldest = objectUrlMemo.keys().next().value as string;
      const old = objectUrlMemo.get(oldest);
      if (old) URL.revokeObjectURL(old);
      objectUrlMemo.delete(oldest);
    }
  }
  return u;
}

async function cacheEnabled(): Promise<boolean> {
  const v = await kvGet('imageCacheEnabled');
  return typeof v === 'boolean' ? v : true;
}

/** 下载并缓存一张字图（静默失败，不影响渲染） */
export async function cacheImage(url: string): Promise<void> {
  if (!url || !/^https?:/i.test(url)) return;
  if (objectUrlMemo.has(url)) return;
  try {
    if (!(await cacheEnabled())) return;
    if ((await countImages()) >= MAX_CACHED) return;
    if (await getImageBlob(url)) return;
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) return;
    const blob = await r.blob();
    await putImageBlob(url, blob);
  } catch {
    /* 离线/限流/隐私模式：静默跳过 */
  }
}

/** 渲染入口：返回 blob objectURL（命中）或原地址（未命中，同时触发后台缓存） */
export async function resolveImageSrc(url: string): Promise<string> {
  if (!url) return url;
  try {
    const blob = await getImageBlob(url);
    if (blob) return objectUrlFor(url, blob);
  } catch {
    return url;
  }
  void cacheImage(url);
  return url;
}

/** 整帖预热：低并发逐张缓存，已缓存的秒过；返回完成数（仅供测试/展示） */
export async function warmDeckImages(urls: string[], shouldAbort?: () => boolean): Promise<number> {
  let done = 0;
  const queue = [...new Set(urls.filter((u) => /^https?:/i.test(u)))];
  const workers = Array.from({ length: WARM_CONCURRENCY }, async () => {
    for (;;) {
      if (shouldAbort?.()) return;
      const next = queue.shift();
      if (!next) return;
      await cacheImage(next);
      done++;
    }
  });
  await Promise.all(workers);
  return done;
}

/** 清空缓存并撤销 objectURL */
export async function clearImageCache(): Promise<void> {
  for (const u of objectUrlMemo.values()) URL.revokeObjectURL(u);
  objectUrlMemo.clear();
  await clearImages();
}

export async function imageCacheCount(): Promise<number> {
  return countImages();
}
