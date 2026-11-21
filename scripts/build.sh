#!/usr/bin/env bash
# src/*.js 를 파일 이름(앞 번호) 순서대로 이어 붙여 site/app.js 를 만든다.
# 모든 파일이 하나의 함수 안에 들어가므로 파일끼리 변수·함수를 그대로 공유하고, 브라우저 전역에는 노출되지 않는다.
# GitHub Actions(배포)가 자동으로 실행하므로 평소에는 직접 돌릴 필요가 없다.
set -euo pipefail
export LC_ALL=C
cd "$(dirname "$0")/.."
out=site/app.js
{
  echo '// 자동 생성 파일 — 직접 고치지 말고 src/ 를 고친 뒤 scripts/build.sh 를 실행하세요.'
  echo '(function () {'
  echo "'use strict';"
  for f in src/*.js; do
    echo
    echo "/* ===== $f ===== */"
    cat "$f"
  done
  echo '})();'
} > "$out"
echo "built $out ($(wc -l < "$out") lines)"
