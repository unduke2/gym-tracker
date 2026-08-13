#!/bin/sh
# Full pre-flight. There is no build step and no test framework in this project,
# so this is it: syntax check, pure-logic assertions, then render every screen.
#
#   sh test/run.sh
#
# Requires node + network on first run (installs esbuild/react as devDeps).
set -e
cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  echo "→ installing dev dependencies (first run only)"
  npm install --silent --no-audit --no-fund
fi

echo
echo "─── syntax ────────────────────────────────────────────"
node -e '
const fs=require("fs");
const html=fs.readFileSync("index.html","utf8");
const b=html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/g)||[];
if (b.length!==1){console.error("expected 1 babel block, found "+b.length);process.exit(1);}
fs.writeFileSync("test/.tmp.syntax.jsx", html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/)[1]);
'
npx --yes esbuild --outfile=test/.tmp.syntax.out.js test/.tmp.syntax.jsx >/dev/null
echo "  ok   index.html parses as JSX"

echo
echo "─── logic ─────────────────────────────────────────────"
node test/logic.test.js

echo "─── render ────────────────────────────────────────────"
node test/render.test.js

rm -f test/.tmp.*
echo "═══ all green ═════════════════════════════════════════"
