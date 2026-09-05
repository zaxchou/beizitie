/**
 * 市场上架口径（宁缺勿错）：YGSF 帖必须已通过 jizi 字图校验（jizi_verified），
 * 未校验的帖不在市场可见/不可订阅/不进目录。shlib（上图馆方标注）与其他来源不受限。
 *
 * 纯静态 SQL 片段：依赖外层查询的 decks 表别名 `d`，拼接时不得内插任何运行时输入。
 * 改动口径只改这里；此前散落 7 处的拷贝已收拢（2026-09-05 review）。
 */
export const MARKET_VERIFIED_SQL =
  "(d.source_key IS NULL OR d.source_key NOT LIKE 'ygsf:%' " +
  "OR d.source_key IN (SELECT 'ygsf:' || zitie_id FROM jizi_verified))";
