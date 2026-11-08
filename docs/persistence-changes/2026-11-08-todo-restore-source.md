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
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "b74b850497d6b46440bf6e016b34dfe9abd705fa8ad63deefbe36f748d85028b"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "bbfb77dae43d889e93f4ae86417292c82863de6ae778b6d79592612e9414cf5d"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "cf238f30027538d595ad4268f06d5bfce7e4699133963ecc92cfdac0b35c1f55"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "cfad048409ae9717f91f267b5d2eb2267ed63c87e21344fe22a22d5a943141f6"
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
