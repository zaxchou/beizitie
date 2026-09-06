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

export const bundledZitie: Record<string, ZitieGlyphList> = Object.fromEntries(
  Object.entries(modules).map(([_p, rawJson]) => {
    const d = JSON.parse(rawJson) as ZitieGlyphList;
    return [d.z, d];
  }),
);
