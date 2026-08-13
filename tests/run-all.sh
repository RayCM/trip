#!/bin/sh
# 跑完全部測試。需要 node，不需要 npm 或任何套件。
#   sh tests/run-all.sh
#
# 這些測試都是從 ../index.html 的原始碼把函式抽出來 eval，
# 測到的是真正的程式碼而不是副本——所以不需要建置流程或測試框架。
cd "$(dirname "$0")" || exit 1
fail=0

for f in test-resequence test-moveday test-datevalidate test-dayform test-legacy test-render test-sheet-import test-sheet-e2e test-customs; do
  printf '%-20s ' "$f"
  out=$(node "$f.js" 2>&1)
  status=$?
  echo "$out" | tail -1
  if [ $status -ne 0 ]; then
    echo "$out" | grep '✗'
    fail=1
  fi
done

# 中文字串快照：確保介面文字與 baseline.json 完全一致。
# 若你是刻意修改文案，跑 `node tests/i18n-snapshot.js > tests/baseline.json` 更新基準線。
printf '%-20s ' 'i18n-snapshot'
if node i18n-snapshot.js > /tmp/tirp-snapshot-$$.json 2>&1 && diff -q baseline.json /tmp/tirp-snapshot-$$.json > /dev/null; then
  echo 'SNAPSHOT OK'
else
  echo 'SNAPSHOT MISMATCH'
  diff baseline.json /tmp/tirp-snapshot-$$.json | head -20
  fail=1
fi
rm -f /tmp/tirp-snapshot-$$.json

[ $fail -eq 0 ] && echo '\n全部通過' || echo '\n有測試失敗'
exit $fail
