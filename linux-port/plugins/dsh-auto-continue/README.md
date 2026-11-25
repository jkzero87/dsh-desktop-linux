# dsh-auto-continue

A Desktop profile plugin for the Linux port. When a turn is about to end because its last step hit the output limit (`max-tokens`), it steers the agent with one continuation message, so the task goes on without the user typing `continue`.

## What it does

- **Hook.** The upstream `agent/turn-stopping` serial event (`packages/core/agent/src/runtime-types.ts:401-418`, dispatched at `packages/core/agent-loop/src/agent.ts:401-404`). A listener that calls `agent.steer(...)` makes the loop run another step in the same turn. The upstream Claude Code Stop-hook bridge uses the same mechanism (`packages/experimental/hooks-claude-code/src/index.ts:275-282`), and `packages/core/agent-loop/tests/loop.spec.ts:1448-1500` covers it after a max-tokens step.
- **Trigger.** It continues only when the latest `assistant/message` of the stopping turn has a `finish` chunk with reason `max-tokens`. A completed step, a tool-call step, an aborted turn and an error never continue. Aborted and errored turns throw before the stopping boundary, so they never reach it.
- **Message.** A `user/message` with source `{kind: "auto-continue", form: "notice", summary: "Output limit reached: automatic continuation n/3"}` and this text: `Your previous turn was cut off by the output token limit. Continue the same task from where you stopped. Do not restate or redesign the plan in your reasoning: make the next tool call directly.` The loop logs it, so it can be rebuilt from the session log, and the chat renders it as an injected notice, not as a user prompt.
- **Cap.** At most `maxContinuations` consecutive continuations (default 3). The count resets when a `user/message` with source kind `user` is logged. The plugin's own message does not reset it. At the cap, the turn closes and waits for the user.
- **Children.** Sessions with `header.parentSession` (subagents and other delegated sessions) are left alone. The upstream `turn-stopping` consumers do not exclude them (`hooks-claude-code` Stop, `workspace-changes`). This plugin excludes them, using the convention the upstream loader smoke uses (`packages/test-support/loader-smoke/src/agent-turn.ts:55`).
- **Trace.** Each decision appends one line to `traceFile` (default `logs/auto-continue.log` under the DeepSeek Harness home), as dsh-cite-sources does. The forms are:
  - `continue session=<id> turn=<n> step=<n> seq=<seq> continuation=<k>/<cap>`
  - `cap ...`
  - `skip-child ... parent=<id>`

  `seq` is the cut `assistant/message`; the turn's `turn/end` is logged right after.

## Why

On 2026-11-24, session `65177965` turn 2 ended with `max-tokens` at seq 631 (19:44:41). Step 6 reasoned 26081 characters and was cut inside its first `edit` call; the app then sat idle until the user ran `/compact` and typed `continue` 1.4 min later.

The limit reached was the server context, not the 61440-token per-response `maxTokens`. The request header carried `maxTokens: 61440` and `reasoningEffort: medium`; the step produced 8381 output tokens on a 57152-token prompt. llama-server (`-c 65536`) logged task 108649 with `stop processing: n_tokens = 65535, truncated = 1`.

The continuation step therefore starts at a full context. The upstream between-step compaction (`agent/pre-step` pressure, `packages/compaction/compaction-basic/src/index.ts:157-175`, run by the profile's compaction-select row) is what makes room for it. In the same session it fired between steps at totals of 58414 and 58810. This has not yet been observed with an automatic continuation.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `maxContinuations` | 3 | Consecutive automatic continuations before the turn waits for the user. |
| `message` | the text above | The continuation text. |
| `traceFile` | `logs/auto-continue.log` | Trace file, relative to the DeepSeek Harness home or absolute. |

## Install and test

```sh
npm test                 # node --test: decisions on the real 65177965 seq 628-631 events (test/fixtures)
npm run test:loop        # the plugin inside the real upstream agent loop with the upstream MockAdapter (vitest)
./install_desktop.sh     # refuses to run while the app has DSH_HOME open; backs up and restores the profile on failure
../../../apps/desktop/scripts/smoke-linux-profile.sh
```

The fixture keeps every field the plugin reads verbatim. The reasoning text is cut and the stream delta arrays are dropped, because this repository is public.

## Upstream merges

The plugin touches no upstream file. After an upstream merge, check:
- that `agent/turn-stopping` still fires at the stop boundary and that `agent.steer` still runs another step: `npm run test:loop` fails otherwise;
- that `assistant/message` still records the finish reason as a `finish` chunk in `stream`, and that `FinishReasonMap` still names it `max-tokens`;
- that subagent sessions still carry `header.parentSession`;
- that the `engines.dsh` range in `package.json` covers the new runtime version. Otherwise the profile skips the bundle, and `smoke-linux-profile.sh` reports the skip.
