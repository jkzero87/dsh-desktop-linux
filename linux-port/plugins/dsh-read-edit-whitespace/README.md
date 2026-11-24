# dsh-read-edit-whitespace

A Desktop profile plugin for the Linux port. It makes the whitespace that `read` shows match the whitespace that `edit` compares, without patching the upstream fs tools.

## What it changes

- **`read` numbering.** Upstream `formatReadOutput` (`packages/fs/tool-fs/src/read-render.ts:163`) numbers lines as `N: text`. A model that copies everything after the colon keeps the separator space as indentation. This plugin rewrites each numbered line to `N\ttext`, so the line text starts right after the tab, as in `cat -n`. The `<path>`/`<type>`/`<content>` envelope, the blank line and the footer stay byte-identical, and the result `meta` (which the read card renders from) is untouched.
- **`edit` failures.** Upstream `applyLiteralEdit` (`packages/fs/fs-local/src/fsio.ts:860-862`) requires an exact match and reports only `old_string was not found`. When an edit fails with `FS_EDIT_NOT_FOUND`, this plugin reads the file through `ctx.fs`, resolved with the session working directory as the edit tool resolves it, and appends the closest match:
  - when only whitespace differs: the line range, one line per difference (`line 32, leading whitespace: old_string has 45 spaces, the file has 44 spaces.`) and the file line quoted as JSON so every space is visible;
  - when some lines match and then one differs in more than whitespace: the first differing line, both sides quoted;
  - when every non-empty `old_string` line starts with a read line number (`N\t` or `N: `): a hint to copy only the text after it.
  - The error keeps its first line and its `FS_EDIT_NOT_FOUND` code.

Both are `tools/post-execute` decisions that replace the result content. The session logs the replaced content as the `tool/result`, so what the model saw stays reconstructable from the log.

## Why

On 2026-11-24, in session `d636e7e1`, the edit at seq102 sent 45 leading spaces on lines 32 and 34 of `sql/030_silver.sql`, where the file has 44: exactly the space after `32:`. The model then spent about 5 minutes working around it with line-surgery scripts that failed twice for the same reason (seq284, seq308). The same class of failure happened on 2026-11-23 (`09242aea` seq91). The measurement is in `~/dsh-compare/rendimiento-agente-20261124.md`.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `maxReportedLines` | 6 | Differing lines described in one diagnosis; the rest are counted. |
| `maxDiagnosedBytes` | 2000000 | Larger files are not read for a diagnosis; the upstream error is returned unchanged. |

## Install and test

```sh
npm test                 # node --test, including the real d636e7e1 case (test/fixtures/d636e7e1-seq102.json)
./install_desktop.sh     # refuses to run while the app has DSH_HOME open; backs up and restores the profile on failure
../../../apps/desktop/scripts/smoke-linux-profile.sh
```

## Upstream merges

The plugin touches no upstream file. After an upstream merge, check:
- that `formatReadOutput` still emits `N: text` inside the same envelope. If upstream changes the separator, `rewriteReadText` stops matching and returns the text unchanged; the tests in `test/whitespace.test.js` pin the expected envelope;
- that `applyLiteralEdit` still throws `FS_EDIT_NOT_FOUND` for a missing `old_string`, and that `tools/post-execute` still lets a listener replace or block a failed result (`packages/core/tools/src/pipeline.ts`, the `tools/post-execute` waterfall);
- that the `engines.dsh` range in `package.json` covers the new runtime version. Otherwise the profile skips the bundle, and `smoke-linux-profile.sh` reports the skip.
