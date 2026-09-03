#!/usr/bin/env bash
# ============================================================
# 单文件版目录一键发版
#   生产库生成 catalog-out → 拉回仓库 catalog/ → 重编 beizitie.html → 提交推送
#   （GitHub Pages 自动发布；jsDelivr 随 main 分支自动生效）
# 用法：bash release-catalog.sh [--skip-build]   # --skip-build 跳过单文件重编（仅目录 JSON 变动时）
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

SSH_HOST="xcx"
ANKI_REMOTE="/opt/zi2anki"
SKIP_BUILD=false
[ "${1:-}" = "--skip-build" ] && SKIP_BUILD=true

echo "== 1/4 生产生成 catalog-out =="
ssh "$SSH_HOST" "cd $ANKI_REMOTE && npx tsx server/scripts/publish-catalog.ts"

echo "== 2/4 同步到本地 catalog/ =="
mkdir -p catalog
ssh "$SSH_HOST" "cd $ANKI_REMOTE/catalog-out && tar czf - ." | tar xzf - -C catalog/

echo "== 3/4 体检 =="
python - <<'PY'
import json, os
idx = json.load(open('catalog/index.json', encoding='utf-8'))
total = idx.get('total', 0)
zdir = os.path.join('catalog', 'zitie')
files = len(os.listdir(zdir)) if os.path.isdir(zdir) else 0
size = os.path.getsize('catalog/index.json')
assert total > 0, 'index.json total 为 0，拒绝发版'
assert files >= total * 0.95, f'zitie 文件数 {files} 明显少于目录 {total}，拒绝发版'
assert size < 3 * 1024 * 1024, f'index.json {size}B 超过 3MB（Pages/jsDelivr 会变慢），考虑裁剪'
print(f'  目录 {total} 帖 / zitie 文件 {files} 个 / index.json {size/1e6:.2f}MB — OK')
PY

echo "== 4/4 提交推送 =="
if [ -z "$(git status --porcelain catalog beizitie.html)" ]; then
  echo "  目录无变化，无需发版"
  exit 0
fi
if [ "$SKIP_BUILD" = false ]; then
  echo "  → 重编单文件版（index.json 是 ?raw 内联的）..."
  npm run build:single 2>&1 | tail -1
  cp dist-single/single.html beizitie.html
fi
git add catalog beizitie.html
git commit -q -m "chore(catalog): release catalog @ $(date +%Y-%m-%d) ($(python -c "import json;print(json.load(open('catalog/index.json',encoding='utf-8'))['total'])") 帖)"
git push -q
echo "  ✅ 已推送。Pages 1-2 分钟内生效："
echo "     https://zaxchou.github.io/beizitie/beizitie.html"
echo "     https://zaxchou.github.io/beizitie/catalog/index.json"
