#!/bin/bash
# YGSF 无人值守建库流水线（夜间自动运行）
# 阶段1：第二批关键词扫描 → 阶段2：全池书体分类 → 阶段3：按书体顺序（楷→行→草→隶→篆→章草）批量导入上架
# 安全：镜像永不在本流程执行；拉取不完整不入库；token 失效自动停止并记录
cd /opt/zi2anki || exit 1
LOG=/opt/zi2anki/ygsf-overnight.log
log(){ echo "[$(date '+%F %T')] $*" >> "$LOG"; }

log "===== PIPELINE START ====="

# ---- 阶段 1：关键词扫描 ----
npx tsx server/scripts/ygsf-catalog.ts --search-file server/scripts/keywords-all-batch2.txt > /tmp/ygsf-scan.out 2>&1
log "PHASE1 scan done (exit $?), tail: $(tail -1 /tmp/ygsf-scan.out)"

# ---- 阶段 2：全池分类（每轮 500，循环直到清零）----
for i in $(seq 1 15); do
  OUT=$(npx tsx server/scripts/ygsf-catalog.ts --classify 2>&1 | tr '\r' '\n' | tail -3)
  log "PHASE2 classify #$i: $(echo "$OUT" | tr '\n' ' | ')"
  echo "$OUT" | grep -q "待分类候选 0" && break
  sleep 5
done
log "PHASE2 classify done"

# ---- 阶段 3：按书体导入上架 ----
for S in 楷 行 草 隶 篆 章草; do
  log "PHASE3 import style=$S start"
  for r in $(seq 1 200); do
    OUT=$(npx tsx server/scripts/ygsf-catalog.ts --import-batch --style "$S" --batch 40 --publish 2>&1 | tr '\r' '\n' | tail -4)
    log "PHASE3 $S round$r: $(echo "$OUT" | tr '\n' ' | ')"
    echo "$OUT" | grep -q "NEED_TOKEN" && { log "PHASE3 STOP: token 失效，剩余书体未导入"; break 2; }
    echo "$OUT" | grep -qE "本轮完成：成功 0/" && break
    sleep 3
  done
  log "PHASE3 import style=$S done"
done
log "===== PIPELINE DONE ====="
