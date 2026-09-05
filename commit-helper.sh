#!/usr/bin/env bash
set -e
cd /z/BaiduNetdiskWorkspace/myagent-work/zcode/projectC/calligraphy-memory
git add -u
TREE=$(git write-tree)
COMMIT=$(git commit-tree "$TREE" -p HEAD -m "chore: remove one-off commit helper script (for real)")
git update-ref refs/heads/main "$COMMIT"
git push
echo "pushed"
