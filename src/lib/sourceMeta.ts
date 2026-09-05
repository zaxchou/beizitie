/**
 * 数据来源标注：decks.source_key 前缀 → 展示名 / 角标短名 / 完整署名。
 * shlib = 上海图书馆碑帖知识库（馆方官方标注，可信度最高档）；
 * ygsf = 以观书法（来源不明确，标注 YGSF 即可）。
 */
export interface SourceMeta {
  label: string;
  short: string;
  full: string;
  tone: 'museum' | 'community';
}

export const SOURCE_META: Record<string, SourceMeta> = {
  shlib: {
    label: '上海图书馆',
    short: '上图',
    full: '数据来源：上海图书馆碑帖知识库《翰墨瑰宝》（CC BY-NC-ND 3.0 CN）',
    tone: 'museum',
  },
  ygsf: {
    label: 'YGSF',
    short: 'YGSF',
    full: '数据来源：YGSF（以观书法）',
    tone: 'community',
  },
};

export function sourceMeta(sourceKey?: string | null): SourceMeta | null {
  if (!sourceKey) return null;
  return SOURCE_META[sourceKey.split(':')[0]] ?? null;
}
