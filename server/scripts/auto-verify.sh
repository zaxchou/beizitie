#!/usr/bin/env bash
# 全量自动核验修复驱动：多轮 pass，直到剩余清单收敛
# 每 pass：跑 majority-verify --apply（第1轮全部未验帖，之后只跑上轮未决清单）
# 轮间 sleep 让源站窗口轮转；报告按 pass 归档到 /opt/zi2anki/
#
# 数据库口令：读服务器本地未入库文件 /opt/zi2anki/.db-password（或环境变量 PGPASSWORD）。
# 禁止把口令写进本脚本——本仓库是公开的。
set -u
cd /opt/zi2anki || exit 1
export PATH=$PATH:/usr/bin

DB_PASS_FILE=/opt/zi2anki/.db-password
if [ -z "${PGPASSWORD:-}" ] && [ -f "$DB_PASS_FILE" ]; then
  PGPASSWORD=$(tr -d '[:space:]' < "$DB_PASS_FILE")
  export PGPASSWORD
fi
if [ -z "${PGPASSWORD:-}" ]; then
  echo "[driver] 缺少数据库口令：请设置 PGPASSWORD 或写入 $DB_PASS_FILE"
  exit 1
fi

PASS_MAX=${1:-14}
SLEEP_MIN=${2:-25}
echo "[driver] 启动 $(date) pass_max=$PASS_MAX"

for pass in $(seq 1 "$PASS_MAX"); do
  echo "=== pass $pass 开始 $(date) ==="
  if [ "$pass" -eq 1 ]; then
    timeout 54000 npx tsx server/scripts/ygsf-majority-verify.ts --apply --skip-verified --remaining-after remaining.1.json > pass.1.log 2>&1
  else
    PREV=$((pass - 1))
    if [ ! -f "remaining.$PREV.json" ]; then echo "no remaining.$PREV.json, done"; break; fi
    REMAIN_N=$(python3 -c "import json;print(len(json.load(open('remaining.$PREV.json'))))" 2>/dev/null || echo 0)
    if [ "$REMAIN_N" -eq 0 ]; then echo "[driver] 剩余 0，完成"; break; fi
    timeout 54000 npx tsx server/scripts/ygsf-majority-verify.ts --apply --list "remaining.$PREV.json" --remaining-after "remaining.$pass.json" > "pass.$pass.log" 2>&1
  fi
  cp majority-report.json "report.$pass.json" 2>/dev/null

  # pass 摘要
  REMAIN_N=$(python3 -c "import json;print(len(json.load(open('remaining.$pass.json'))))" 2>/dev/null || echo 0)
  VERIFIED_N=$(psql -U zi2anki -h localhost -d zi2anki -tA -c "SELECT COUNT(*) FROM jizi_verified" 2>/dev/null | head -1)
  echo "[driver] pass $pass 结束 $(date) | 剩余 $REMAIN_N | 已放行集字 $VERIFIED_N 帖"

  # 收敛判定：剩余不再减少且已 ≥3 轮 → 结束
  if [ "$REMAIN_N" -gt 0 ] && [ "$pass" -ge 3 ]; then
    PREV_N=$(python3 -c "import json;print(len(json.load(open('remaining.$((pass-1)).json'))))" 2>/dev/null || echo $REMAIN_N)
    if [ "$PREV_N" -le "$REMAIN_N" ]; then
      echo "[driver] 剩余未减少($PREV_N→$REMAIN_N)且已$pass轮，结束"
      break
    fi
  fi
  if [ "$REMAIN_N" -eq 0 ]; then echo "[driver] 全部完成"; break; fi

  echo "[driver] 睡眠 ${SLEEP_MIN} 分钟等源站窗口轮转..."
  sleep $((SLEEP_MIN * 60))
done

echo "[driver] 最终 $(date) | 已放行 $(psql -U zi2anki -h localhost -d zi2anki -tA -c 'SELECT COUNT(*) FROM jizi_verified' 2>/dev/null | head -1) 帖"
echo "[driver] 剩余清单: $(ls remaining.*.json 2>/dev/null | tail -1)"
echo "[driver] DONE"
