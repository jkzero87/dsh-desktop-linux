---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-08-todo-restore-source

[English](2026-11-08-todo-restore-source.md) | 中文

## 概述

新增 todo-restore 消息来源，用于 tool-todo 在压缩隐藏待办列表后重新注入该列表。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

已有记录仍然有效。该类型被声明为归属信息：读取方无需 tool-todo 也会保留消息内容和元数据，只有它自己的投影会检查该类型。Session 格式不变。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/todo/tool-todo：5 个文件、40 个测试通过。

<a id="dev-note"></a>
## 开发备注

无。
