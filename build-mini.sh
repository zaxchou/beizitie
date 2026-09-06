#!/usr/bin/env bash
# ============================================================
# 小红书离线包一键构建
#   1. node mini/build-data.mjs   下载/编码字图 + 清单（有缓存，增量快）
#   2. npm run build:mini         构建 dist-mini/mini.html（含内联数据）
#   3. 组装 zip（index.html 必须在 zip 根）+ audit 门禁
# 用法: bash build-mini.sh
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

echo "== 1/3 数据管线 =="
node mini/build-data.mjs

echo "== 2/3 构建 =="
npm run build:mini 2>&1 | tail -1
cp dist-mini/mini.html dist-mini/index.html
rm -f dist-mini/mini.html

echo "== 3/3 打包 + 审计 =="
ZIP=beizitie-mini.zip
rm -f "$ZIP"
python - "$ZIP" <<'PY'
import zipfile, os, sys
zp = sys.argv[1]
with zipfile.ZipFile(zp, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for root, dirs, files in os.walk('dist-mini'):
        for f in files:
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, 'dist-mini'))
size = os.path.getsize(zp)
print(f'  {zp}: {size/1048576:.2f} MiB / 上限 10 MiB')
assert size <= 10 * 1024 * 1024, '❌ 超过 10MiB 上限'
PY

node "$HOME/.agents/skills/minitool-zip-builder/scripts/audit_artifact.mjs" "$ZIP" || {
  echo "❌ audit 未过"; exit 1;
}
echo "✅ beizitie-mini.zip 就绪（上传前请真机验证进度持久化）"
