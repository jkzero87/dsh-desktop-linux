#!/usr/bin/env bash
# Run the loop.*.integration.spec.ts files against the real upstream agent loop (vitest only collects
# packages/*/*/tests). loop.compaction.integration.spec.ts loads the installed dsh-compaction-select engine
# (override with DSH_COMPACTION_SELECT=<path to its lib/index.js>).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../.." && pwd)"
tests="$root/packages/core/agent-loop/tests"
select="${DSH_COMPACTION_SELECT:-${DSH_HOME:-$HOME/.local/share/deepseek-harness}/profiles/desktop/node_modules/dsh-compaction-select/lib/index.js}"
[ -f "$select" ] || { echo "run-loop-integration: no dsh-compaction-select at $select" >&2; exit 1; }
copies=("$tests/zz-dsh-compaction-select.ts")
trap 'rm -f "${copies[@]}"' EXIT
for spec in "$here"/loop.*integration.spec.ts; do
  copy="$tests/zz-dsh-auto-continue-$(basename "$spec" .integration.spec.ts).spec.ts"
  cp "$spec" "$copy"
  copies+=("$copy")
done
cp "$select" "${copies[0]}"
cd "$root"
npx vitest run --project thread-safe "$@" "${copies[@]#"$root/"}"
