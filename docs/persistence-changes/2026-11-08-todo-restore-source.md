---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-08-todo-restore-source

English | [中文](2026-11-08-todo-restore-source.zh.md)

## Summary

Adds the todo-restore message source for the todo list that tool-todo re-enters after compaction hides it.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-08-todo-restore-source
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-27-retry-control-input"
    after: "b27c5c6ae3de6276ae9236de569033a88de4b67143410bbad728ef9a3aa79a2b"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-27-retry-control-input"
    after: "3f71d1d9c199756feb7deaccb3a291bb9f8da01ccf14ed0f7561f19afed666ed"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-27-retry-control-input"
    after: "bc821eca6108190f907d49219a7030183d7f5241fcb6760a098d39bf7addc8b2"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-27-retry-control-input"
    after: "17692e76e03e6f84403585ede80ab784033d99c03ae5c4de50f99e2853964321"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing records remain valid. The kind is qualified as attribution: readers preserve the message content and metadata without tool-todo, and only its own projection inspects the kind. The Session format remains unchanged.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/todo/tool-todo: 5 files and 40 tests passed.

<a id="dev-note"></a>
## Dev Note

None.
