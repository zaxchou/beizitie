/**
 * 以观书法（YGSF）API 客户端
 *
 * 仅供服务端同步工具使用。响应为 AES-128-ECB 加密（密钥来自其公开前端代码），
 * 匿名可拉字帖前 4 页左右，完整枚举需要登录 token（环境变量 YGSF_TOKEN 或项目根 .ygsf-token）。
 * 图片直链本身是公开、无签名、永久有效的，展示不依赖 token。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const AES_KEY = Buffer.from('PkT!ihpN^QkQ62k%', 'utf8');
const API_BASE = 'https://api.ygsf.com/v2.4';
const PAGE_SIZE = 120;
const MAX_BATCHES = 200;

export interface YgsfGlyph {
  id: string;
  hanzi: string;
  font: string;
  author: string;
  colorImage: string;
}

export interface YgsfZuopin {
  zuopinId: string;
  name: string;
  author: string;
  coverUrl: string;
  zitieId: string; // 从封面 URL 提取的默认版本
}

export function decryptYgsf(payload: string): any {
  const b64 = payload.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/!/g, '=');
  const decipher = crypto.createDecipheriv('aes-128-ecb', AES_KEY, null);
  const json = Buffer.concat([
    decipher.update(Buffer.from(b64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(json);
}

export function loadYgsfToken(cliToken?: string): string {
  if (cliToken) return cliToken;
  if (process.env.YGSF_TOKEN) return process.env.YGSF_TOKEN;
  // 脚本约定从项目根目录运行（/opt/zi2anki 或本地仓库根）
  const tokenFile = path.resolve(process.cwd(), '.ygsf-token');
  try {
    return fs.readFileSync(tokenFile, 'utf-8').trim();
  } catch {
    return '';
  }
}

export async function ygsfGet(
  apiPath: string,
  params: Record<string, string | number>,
  token: string,
): Promise<any> {
  const qs = new URLSearchParams({ _plat: 'web' });
  if (token) qs.set('_token', token);
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const res = await fetch(`${API_BASE}${apiPath}?${qs.toString()}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`YGSF API HTTP ${res.status}: ${apiPath}`);
  const body = decryptYgsf(await res.text());
  if (body.stat !== 0) {
    const err: any = new Error(`YGSF API stat=${body.stat} ${body.error?.title || ''}: ${apiPath}`);
    err.isLoginWall = body.error?.title?.includes('登录');
    throw err;
  }
  return body.data;
}

/** 作品目录搜索（按名称关键词，loaded 为已加载偏移，120/页），自动翻全 */
export async function searchZuopin(
  key: string,
  token: string,
): Promise<{ total: number; items: YgsfZuopin[] }> {
  const items: YgsfZuopin[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (let loaded = 0; loaded < MAX_BATCHES * PAGE_SIZE; loaded += PAGE_SIZE) {
    const data = await ygsfGet('/zuopin/query', { key, loaded }, token);
    const list: any[] = Array.isArray(data) ? data : data?.list || [];
    total = data?.total ?? items.length;
    for (const z of list) {
      if (!z?._zuopin_id || seen.has(z._zuopin_id)) continue;
      seen.add(z._zuopin_id);
      const coverUrl: string = z._cover_url || '';
      const m = coverUrl.match(/zitie\/([0-9a-f]{16,})\/covers/);
      items.push({
        zuopinId: z._zuopin_id,
        name: (z._name || '').trim(),
        author: (z._author || '').trim(),
        coverUrl,
        zitieId: m ? m[1] : '',
      });
    }
    if (items.length >= total || list.length === 0) break;
  }
  return { total, items };
}

export interface YgsfZitieDetails {
  zitieId: string;
  zuopinId: string;
  name: string;
  author: string;
  dynasty: string;
  coverUrl: string;
  pageCount: number;
  free: boolean;
}

/** 字帖详情（含朝代、版本全名、封面、页数） */
export async function fetchZitieDetails(zid: string, token: string): Promise<YgsfZitieDetails | null> {
  try {
    const d = await ygsfGet('/zitie/details', { zid }, token);
    const images: string[] = d?._images || [];
    return {
      zitieId: d._zitie_id || zid,
      zuopinId: d._zuopin_id || '',
      name: (d._name || '').trim(),
      author: (d._author || '').trim(),
      dynasty: (d._dynasty || '').trim(),
      coverUrl: (d._cover_url || '').trim(),
      pageCount: images.length,
      free: d._free === 1,
    };
  } catch {
    return null;
  }
}

/** 拉取碑帖原文（逐页 _text 拼接，最多 maxPages 页） */
export async function fetchZitieText(
  zid: string,
  token: string,
  maxPages = 60,
): Promise<string> {
  const parts: string[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const d = await ygsfGet('/zitie/page/text', { zid, page }, token);
    const text = (d?._text || '').trim();
    if (!text) break;
    parts.push(text);
    await new Promise((r) => setTimeout(r, 150));
  }
  return parts.join('');
}

function toGlyph(g: any): YgsfGlyph {
  return {
    id: g._id,
    hanzi: (g._hanzi || '').trim(),
    font: (g._font || '').trim(),
    author: (g._author || '').trim(),
    colorImage: (g._color_image || '').trim(),
  };
}

/**
 * ⚠️ 数据源可靠性结论（2026-09-04 事故分析）：
 * - `zitie/page/glyphs`（快照接口）：标签稳定可信，page=1 通常一次返回全量。**唯一可信源。**
 * - `zitie/glyphs/query`（loaded 偏移接口）：第 1 页可能正确，第 2 页起 `_hanzi` 与 `_id`
 *   的配对会随机漂移（分片漂移，间歇性发作，连第 1 页都可能在坏窗口全乱）。
 *   2026-09-04 凌晨批量导入即被该接口污染 137 万+ 卡片。
 * 任何需要"字 ↔ 图"正确配对的场景，一律走 snapshot 快照。
 */

/** 快照接口：标签稳定可信的唯一数据源。翻页直至空/不满页，通常 page=1 即全量。 */
export async function fetchZitieGlyphsSnapshot(
  zid: string,
  token: string,
): Promise<{ glyphs: YgsfGlyph[]; limited: boolean }> {
  const out: YgsfGlyph[] = [];
  const seen = new Set<string>();
  let limited = false;
  for (let page = 1; page <= MAX_BATCHES; page++) {
    let list: any[];
    try {
      const data = await ygsfGet('/zitie/page/glyphs', { zid, page }, token);
      list = Array.isArray(data) ? data : data?.list || [];
    } catch (e: any) {
      if (e.isLoginWall) {
        limited = true;
        break;
      }
      throw e;
    }
    if (!Array.isArray(list) || list.length === 0) break;
    let fresh = 0;
    for (const g of list) {
      if (!g?._id || seen.has(g._id)) continue;
      seen.add(g._id);
      out.push(toGlyph(g));
      fresh++;
    }
    if (fresh === 0) break;
  }
  return { glyphs: out, limited };
}

/**
 * 拉取整本字帖的单字清单。
 * 主通道：page/glyphs 快照（标签稳定可信）；快照为空时才回退 glyphs/query 并标记 limited（其分页标签不可信）。
 * style 取出现最多的 _font。
 */
export async function fetchZitieGlyphs(
  zid: string,
  token: string,
): Promise<{ glyphs: YgsfGlyph[]; style: string; total: number; limited: boolean }> {
  // 主通道：稳定快照
  let { glyphs, limited } = await fetchZitieGlyphsSnapshot(zid, token);
  let total = glyphs.length;

  // 兜底：快照为空（极少数新帖/异常帖）才用 query 接口；其分页标签不可信，故标 limited 供调用方降级
  if (glyphs.length === 0) {
    const seen = new Set<string>();
    try {
      for (let loaded = 0; loaded < MAX_BATCHES * PAGE_SIZE; loaded += PAGE_SIZE) {
        const data = await ygsfGet('/zitie/glyphs/query', { zid, loaded }, token);
        const list: any[] = Array.isArray(data) ? data : data?.list || [];
        total = data?.total ?? glyphs.length;
        for (const g of list) {
          if (!g?._id || seen.has(g._id)) continue;
          seen.add(g._id);
          glyphs.push(toGlyph(g));
        }
        if (glyphs.length >= total || list.length === 0) break;
        await new Promise((r) => setTimeout(r, 120));
      }
    } catch (e: any) {
      if (!e.isLoginWall) throw e;
      limited = true;
    }
    if (glyphs.length > 0) limited = true; // query 来源标签不可信
  }

  glyphs = glyphs.filter((g) => g.hanzi && g.colorImage);
  const fontCount = new Map<string, number>();
  for (const g of glyphs) {
    if (!g.font) continue;
    fontCount.set(g.font, (fontCount.get(g.font) || 0) + 1);
  }
  const style = [...fontCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  return { glyphs, style, total, limited };
}
