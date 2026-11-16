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
## 兼容性

已有记录仍然有效。该类型被声明为归属信息：读取方无需 tool-todo 也会保留消息内容和元数据，只有它自己的投影会检查该类型。Session 格式不变。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/todo/tool-todo：5 个文件、40 个测试通过。

<a id="dev-note"></a>
## 开发备注

无。
