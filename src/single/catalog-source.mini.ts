/**
 * 目录数据装配（mini 构建）：内置精选目录 + 各帖离线清单，构建期全部内联，运行时零网络请求。
 * 数据由 mini/build-data.mjs 产出：mini/data/catalog.json 与 mini/data/zitie-<zitieId>.json。
 */
import raw from '../../mini/data/catalog.json?raw';
import type { ZitieGlyphList } from '../core/types';

export const catalogJson: string = raw;

const modules = import.meta.glob('../../mini/data/zitie-*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Object.fromEntries 需 Chrome 73+，基线用 reduce
export const bundledZitie: Record<string, ZitieGlyphList> = Object.keys(modules).reduce(
  (acc, key) => {
    const d = JSON.parse(modules[key]) as ZitieGlyphList;
    acc[d.z] = d;
    return acc;
  },
  {} as Record<string, ZitieGlyphList>,
);
