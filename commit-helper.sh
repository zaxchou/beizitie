#!/usr/bin/env bash
set -e
cd /z/BaiduNetdiskWorkspace/myagent-work/zcode/projectC/calligraphy-memory
git add -A
TREE=$(git write-tree)
COMMIT=$(git commit-tree "$TREE" -p HEAD -m "chore: remove one-off commit helper script")
git update-ref refs/heads/main "$COMMIT"
git push
echo "pushed: $(git log --oneline -1)"
