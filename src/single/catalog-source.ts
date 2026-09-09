/**
 * 目录数据装配（单文件版）：构建时内联全量目录 index.json，单字清单按需多源拉取。
 * 小红书 mini 构建已下线（2026-09-08，六次拒审终止）；历史实现见 git。
 */
import raw from '../../catalog/index.json?raw';
import type { ZitieGlyphList } from '../core/types';

export const catalogJson: string = raw;

/** mini 构建才非空：zitieId → 离线清单（单文件版恒为 null，走 fetchZitie 多源拉取） */
export const bundledZitie: Record<string, ZitieGlyphList> | null = null;
