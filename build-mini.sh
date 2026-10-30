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
# 诊断版字体名收敛：包内引用只保留系统黑体/宋体（零字体文件，仅改产物里的字体名）
node -e "
const fs = require('fs');
const p = 'dist-mini/mini.html';
const MAP = [['Noto Serif SC','SimSun'],['Noto Sans SC','SimHei'],['Ma Shan Zheng','SimSun'],['KaiTi','SimSun'],['Kaiti','SimSun'],['楷体','宋体'],['Roboto','SimHei']];
let html = fs.readFileSync(p, 'utf-8');
for (const [a, b] of MAP) html = html.split(a).join(b);
fs.writeFileSync(p, html);
console.log('字体名已收敛为系统黑体/宋体');
"
cp dist-mini/mini.html dist-mini/index.html
rm -f dist-mini/mini.html

echo "== 3/3 打包 + 审计 =="
ZIP=beizitie-mini.zip
rm -f "$ZIP"
python - "$ZIP" <<'PY'
import zipfile, os, sys
ALLOWED = {'.html', '.css', '.js', '.json', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.woff', '.woff2'}
zp = sys.argv[1]
with zipfile.ZipFile(zp, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    htmls = []
    for root, dirs, files in os.walk('dist-mini'):
        for f in files:
            p = os.path.join(root, f)
            rel = os.path.relpath(p, 'dist-mini')
            if os.path.splitext(f)[1].lower() not in ALLOWED:
                print(f'ERROR: whitelist file: {rel}'); sys.exit(1)
            if f.lower().endswith('.html'):
                htmls.append(rel)
            z.write(p, rel)
    if htmls != ['index.html']:
        print('ERROR: html must be exactly [index.html] at root, got:', htmls); sys.exit(1)
    count = sum(len(files) for _, _, files in os.walk('dist-mini'))
    if count > 200:
        print('ERROR: file count', count, '> 200'); sys.exit(1)
    print('  files:', count, '/ 200')
size = os.path.getsize(zp)
print(f'  {zp}: {size/1048576:.2f} MiB / limit 10 MiB')
assert size <= 10 * 1024 * 1024, 'ERROR: over 10MiB'
PY

node "$HOME/.agents/skills/minitool-zip-builder/scripts/audit_artifact.mjs" "$ZIP" || {
  echo "❌ audit 未过"; exit 1;
}
echo "✅ beizitie-mini.zip 就绪（上传前请真机验证进度持久化）"
