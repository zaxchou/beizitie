/**
 * 集字索引构建：jizi_index 是 cards 的预计算缓存（hanzi 规范化 + 元数据快照），
 * 让 /api/jizi/match 从全表扫描变成索引命中。
 *
 * 用法：
 *   npx tsx server/scripts/jizi-index-build.ts --full         # 全量重建（事务内 DELETE+重建）
 *   npx tsx server/scripts/jizi-index-build.ts --incremental  # 增量：新增/修改卡片 + 刷新市场元数据
 */
import { getDb, waitForDb } from '../db.js';
import { buildFull, buildIncremental } from '../services/jiziIndex.js';

async function main() {
  const mode = process.argv.includes('--full') ? 'full' : process.argv.includes('--incremental') ? 'incremental' : null;
  if (!mode) {
    console.error('用法: npx tsx server/scripts/jizi-index-build.ts --full | --incremental');
    process.exit(2);
  }
  const db = getDb();
  await waitForDb();
  console.log(`[jizi-index] ${mode} 开始...`);
  const verifiedOnly = process.argv.includes('--verified-only');
  const result = mode === 'full' ? await buildFull(db, verifiedOnly) : await buildIncremental(db);
  console.log(`[jizi-index] ${mode} 完成: indexed=${result.indexed} 耗时=${(result.ms / 1000).toFixed(1)}s`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[jizi-index] 失败:', err);
  process.exit(1);
});
