#!/usr/bin/env bash
# ============================================================
# 单文件版版本发布（唯一发版入口）
#   1. 校验 CHANGELOG 已有该版本条目（防呆：先写日志再发版）
#   2. 写入 package.json 版本 → 重编 beizitie.html（版本注入应用内）
#   3. commit + tag vX.Y.Z + push
#   4. 创建 GitHub Release 并上传当版本 beizitie.html 附件
# 用法: bash scripts/release-version.sh <x.y.z> [发布标题]
# 前提: 源码改动已另行提交；CHANGELOG.md 已写好 "## v<x.y.z>" 小节
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

VER=${1:?用法: bash scripts/release-version.sh <x.y.z> [标题]}
TITLE=${2:-"背字帖 v$VER"}
TAG="v$VER"

[[ "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "❌ 版本号需为 x.y.z"; exit 1; }
grep -q "^## v$VER" CHANGELOG.md || { echo "❌ CHANGELOG.md 里没有 '## v$VER' 小节，先写更新日志再发版"; exit 1; }
[ -z "$(git status --porcelain -- CHANGELOG.md)" ] || { echo "❌ CHANGELOG.md 有未提交改动"; exit 1; }

python - "$VER" <<'PY'
import json, sys, io
v = sys.argv[1]
pkg = json.load(open('package.json', encoding='utf-8'))
if pkg['version'] == v:
    print(f'  package.json 已是 {v}')
else:
    pkg['version'] = v
    io.open('package.json', 'w', encoding='utf-8', newline='\n').write(json.dumps(pkg, indent=2, ensure_ascii=False) + '\n')
    print(f'  package.json: {pkg["version"]} -> {v}')
PY

echo "== 1/4 构建单文件版 =="
npm run build:single 2>&1 | tail -1
cp dist-single/single.html beizitie.html
grep -q "\"$VER\"" beizitie.html || { echo "❌ 构建产物里没有版本号 $VER，注入失败"; exit 1; }

echo "== 2/4 提交 + 打标签 =="
git add package.json CHANGELOG.md beizitie.html
git commit -m "release: v$VER" || echo "  （无变更可提交）"
git tag -f "$TAG"
git push origin main --tags

echo "== 3/4 创建 GitHub Release =="
TOKEN=$(sed -n 's|.*://[^:@/]*:\([^@]*\)@github\.com.*|\1|p' "$HOME/.git-credentials" | head -1)
[ -n "$TOKEN" ] || { echo "❌ ~/.git-credentials 里没有 GitHub token"; exit 1; }
NOTES=$(python - "$VER" <<'PY'
import re, sys, json
v = sys.argv[1]
s = open('CHANGELOG.md', encoding='utf-8').read()
m = re.search(rf'## v{re.escape(v)}.*?\n(.*?)(?=\n## v|\Z)', s, re.S)
print(json.dumps((m.group(1) if m else '').strip()))
PY
)
RELEASE_JSON=$(python - "$TAG" "$TITLE" "$NOTES" <<'PY'
import json, sys
print(json.dumps({'tag_name': sys.argv[1], 'name': sys.argv[2], 'body': json.loads(sys.argv[3])}))
PY
)
REL_ID=$(curl -s -X POST -H "Authorization: token $TOKEN" -H "Content-Type: application/json" \
  -d "$RELEASE_JSON" "https://api.github.com/repos/zaxchou/beizitie/releases" \
  | python -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))")
[ -n "$REL_ID" ] && [ "$REL_ID" != "None" ] || { echo "❌ Release 创建失败（token 权限或网络）"; exit 1; }

echo "== 4/4 上传附件 =="
curl -s -X POST -H "Authorization: token $TOKEN" -H "Content-Type: application/octet-stream" \
  --data-binary @beizitie.html \
  "https://uploads.github.com/repos/zaxchou/beizitie/releases/$REL_ID/assets?name=beizitie.html" \
  | python -c "import json,sys; d=json.load(sys.stdin); print('  附件:', d.get('name'), d.get('state'), d.get('size'))"

echo "✅ v$VER 发布完成"
echo "   Release: https://github.com/zaxchou/beizitie/releases/tag/$TAG"
echo "   稳定下载: https://github.com/zaxchou/beizitie/releases/latest/download/beizitie.html"
