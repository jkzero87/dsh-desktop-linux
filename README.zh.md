# DeepSeek Harness

[English](README.md) | 中文

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它构建于**一切皆插件**的架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。

文档：[https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## 与上游的差异

本仓库是 DeepSeek Harness 桌面应用的非官方 Linux x86_64 构建，与 DeepSeek 无隶属关系，也未获其认可。AppImage 未签名。macOS 与 Windows 的行为不变。构建、安装与卸载步骤见 [README-LINUX.md](README-LINUX.md)。

Linux 补丁集来自 [mtaech/dsh-linux-patch](https://github.com/mtaech/dsh-linux-patch)（MIT），标签 `v0.2.1-rc.2-linux.1`，基于上游 `dsh-v0.2.1-rc.2`：AppImage 目标、在纯 Node 中处理粘贴图片的栅格 worker（Sharp 的 libvips 在 Linux 的 Electron 内会崩溃）、Office kit 解析到解包文件、Linux 窗口身份与图标，以及 Linux 包不写入强制更新策略。

本仓库新增：

- **关闭即退出：** 在没有托盘的 Linux 上，关闭主窗口会经过正常的退出确认后退出，而不是隐藏窗口且无法找回。
- **AppArmor：** Ubuntu 23.10+ 会为从 GNOME 启动的应用阻止非特权用户命名空间，导致 Chromium 中止。安装脚本生成按应用的配置并打印 `sudo` 命令；在配置安装之前，桌面条目通过 `AppRun` 启动，它会回退到 `--no-sandbox`。
- **按用户安装：** `apps/desktop/scripts/install-linux-local.sh` 解包 AppImage（无需 FUSE），写入桌面条目与多尺寸图标，并把应用数据保存在 `~/.local/share/deepseek-harness`。
- **tool-web：** `fetchMaxOutputChars` 限制转换后的页面文本而不是原始 HTML，原始输入的上限由 `fetchMaxSourceChars` 设置。
- **Agent 预设：** 可选的 `toolFilter`（`allow` / `deny`）限制绑定到预设的 Agent 可用的工具。
- **默认关闭遥测：** 桌面产品分析（`enabled: false`）与会话遥测（`DISABLED`）不会向 `dsh-otel-collector.deepseeksvc.com` 发送任何内容。桌面条目还把 `DSH_PRODUCT_ANALYTICS_OTLP_URL` 指向一个关闭的本地端口，并设置 `DSH_TELEMETRY_DISABLED=1`。README-LINUX.md 列出两者在上游默认会发送什么以及如何开启。
- **CI：** `.github/workflows/release-linux.yml` 在 `v*` 标签上构建未签名的 AppImage，并将其保留为 workflow 制品。

2026-10-19 在 Ubuntu（GNOME，Wayland）上测得，应用从 Dock 启动，使用本地模型：

| 检查项 | 之前的移植（`dsh-v0.2.1-alpha.2`） | 本构建 |
|---|---|---|
| Host 接收一张粘贴的 3840×2160 JPEG（5.6 MB） | 1,110 ms | 602–693 ms |
| 接收后的图片 | 2730×1536 JPEG，397,430 字节 | 相同 |
| 使用 `web_fetch` 的标准会话提供的工具数 | 22 | 22 |
| 使用 2 分钟内到 `dsh-otel-collector.deepseeksvc.com` 的连接（`ss`，约 0.15 s 采样） | 未测量 | 0 |

## 开发者预览

DeepSeek Harness 处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

<a id="run"></a>

## 运行

### 通过 `npm` 运行

安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令默认会在 `http://127.0.0.1:3080` 启动 Web UI，本机启动时还会用默认浏览器打开页面。通过 SSH 启动时只打印宿主机 URL，因为本地转发地址由 SSH 客户端或编辑器持有。传入 `--no-open` 可仅运行服务器而不打开浏览器。详见 [Web UI 指南](docs/user/guide/index.zh.md)。

<a id="run-from-source"></a>

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。

## 社区与支持

- 通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群！扫描下方二维码填写入群问卷，小助手会定期发送入群邀请。

<table>
  <thead>
    <tr>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

`pnpm run dev:web` 会在一个终端里完成构建、启动，并在源码修改时重建 client bundle；`make help` 列出 Web 与 Desktop 对应的 Make target。完整表格见开发指南的「应用命令」一节。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 引用

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
