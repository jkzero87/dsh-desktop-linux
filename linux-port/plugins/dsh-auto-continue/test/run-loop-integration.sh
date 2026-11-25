#!/usr/bin/env bash
# Run loop.integration.spec.ts against the real upstream agent loop (vitest only collects packages/*/*/tests).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../.." && pwd)"
copy="$root/packages/core/agent-loop/tests/zz-dsh-auto-continue.spec.ts"
trap 'rm -f "$copy"' EXIT
cp "$here/loop.integration.spec.ts" "$copy"
cd "$root"
npx vitest run --project thread-safe packages/core/agent-loop/tests/zz-dsh-auto-continue.spec.ts
