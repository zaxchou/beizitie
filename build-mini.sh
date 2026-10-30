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
# 容器 CSP 合规 + 字体名收敛（产物：mini.html / app.js / index.css）
# CSP 硬约束（zip-artifact-spec §3）：脚本必须外置经典脚本——内联 <script> 与 type="module" 均被禁止；
# 违规症状 = 容器内 JS 完全不执行（七连拒的真正根因，见 HANDOFF 补记 26）
node -e "
const fs = require('fs');
const files = ['dist-mini/mini.html', 'dist-mini/app.js', 'dist-mini/index.css'].filter(f => fs.existsSync(f));
const MAP = [['Noto Serif SC','SimSun'],['Noto Sans SC','SimHei'],['Ma Shan Zheng','SimSun'],['KaiTi','SimSun'],['Kaiti','SimSun'],['楷体','宋体'],['Roboto','SimHei']];
for (const p of files) {
  let s = fs.readFileSync(p, 'utf-8');
  for (const [a, b] of MAP) s = s.split(a).join(b);
  if (p.endsWith('.html')) {
    s = s.replace(/ type=\"module\"/g, '').replace(/ crossorigin/g, '');
    // 经典脚本在 <head> 同步执行时 #root 尚未存在（React #299 空白）——移到 </body> 前，与规范模板一致
    const tag = '<script src=\"./app.js\"></script>';
    if (!s.includes(tag)) { console.error('❌ 未找到脚本标签', tag); process.exit(1); }
    s = s.replace(tag, '');
    if (!s.includes('</body>')) { console.error('❌ 未找到 </body>'); process.exit(1); }
    s = s.replace('</body>', tag + '</body>');
  }
  fs.writeFileSync(p, s);
}
console.log('字体名收敛 + CSP 合规处理完成:', files.join(', '));
"
# 门禁：入口 html 禁内联 <script> / type="module"，脚本必须为外置 ./app.js
node -e "
const fs = require('fs');
const html = fs.readFileSync('dist-mini/mini.html', 'utf-8');
const scripts = html.match(/<script\b[^>]*>/gi) || [];
const inline = scripts.filter(t => !/\bsrc=/.test(t));
if (inline.length) { console.error('❌ 入口存在内联 <script>（容器 CSP 禁止）:', inline.join(' ')); process.exit(1); }
if (/type=[\"']?module/i.test(html)) { console.error('❌ type=module（容器 CSP 禁止）'); process.exit(1); }
if (!/<script src=\"\.\/app\.js\"><\/script>/.test(html)) { console.error('❌ 未找到 <script src=\"./app.js\">'); process.exit(1); }
console.log('✅ CSP 合规：外置经典脚本', scripts.length, '个');
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
