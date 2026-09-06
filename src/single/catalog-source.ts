/**
 * 目录数据装配（单文件版）：构建时内联全量目录 index.json，单字清单按需多源拉取。
 * mini 构建经 alias 换用 catalog-source.mini.ts（内置精选 + 离线清单，零网络）。
 */
import raw from '../../catalog/index.json?raw';
import type { ZitieGlyphList } from '../core/types';

export const catalogJson: string = raw;

/** mini 构建才非空：zitieId → 离线清单（单文件版恒为 null，走 fetchZitie 多源拉取） */
export const bundledZitie: Record<string, ZitieGlyphList> | null = null;
