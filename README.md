# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## What differs from upstream

This repository is an unofficial Linux x86_64 build of the DeepSeek Harness desktop app. It is not affiliated with or endorsed by DeepSeek. The AppImage is unsigned. macOS and Windows behaviour is unchanged. Build, install, and uninstall steps are in [README-LINUX.md](README-LINUX.md).

The Linux patch set comes from [mtaech/dsh-linux-patch](https://github.com/mtaech/dsh-linux-patch) (MIT), tag `v0.2.1-rc.2-linux.1` on upstream `dsh-v0.2.1-rc.2`: the AppImage target, a plain-Node raster worker for pasted images (Sharp's libvips crashes inside Electron on Linux), Office kit resolution to unpacked files, the Linux window identity and icon, and no mandatory-update policy in Linux packages.

This repository adds:

- **Quit on close:** on Linux without a tray, closing the main window quits through the normal quit confirmation instead of hiding the window with no way back.
- **AppArmor:** Ubuntu 23.10+ blocks unprivileged user namespaces for apps launched from GNOME, so Chromium aborts. The installer generates a per-app profile and prints the `sudo` commands; until the profile is installed, the desktop entry launches through `AppRun`, which falls back to `--no-sandbox`.
- **Per-user installer:** `apps/desktop/scripts/install-linux-local.sh` extracts the AppImage (no FUSE needed), writes a desktop entry and sized icons, and keeps app data in `~/.local/share/deepseek-harness`.
- **tool-web:** `fetchMaxOutputChars` caps the converted page text instead of the raw HTML, and the raw input bound is the `fetchMaxSourceChars` setting.
- **Agent presets:** an optional `toolFilter` (`allow` / `deny`) restricts the tools of Agents bound to a preset.
- **Telemetry off by default:** Desktop product analytics (`enabled: false`) and session telemetry (`DISABLED`) send nothing to `dsh-otel-collector.deepseeksvc.com`. The desktop entry also sets `DSH_PRODUCT_ANALYTICS_OTLP_URL` to a closed local port and `DSH_TELEMETRY_DISABLED=1`. README-LINUX.md lists what each one sends upstream and how to enable it.
- **CI:** `.github/workflows/release-linux.yml` builds the unsigned AppImage on `v*` tags and keeps it as a workflow artifact.

Measured on 2026-10-19 on Ubuntu with GNOME on Wayland, with the app launched from the dock and a local model:

| Check | Previous port (`dsh-v0.2.1-alpha.2`) | This build |
|---|---|---|
| Host admission of a pasted 3840×2160 JPEG (5.6 MB) | 1,110 ms | 602–693 ms |
| Admitted image | 2730×1536 JPEG, 397,430 bytes | identical |
| Tools offered in a standard session that uses `web_fetch` | 22 | 22 |
| Connections to `dsh-otel-collector.deepseeksvc.com` in 2 minutes of use (`ss`, ~0.15 s sampling) | not measured | 0 |

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/4MrtZUhpxg">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits in one terminal, and `make help` lists the matching Make targets for Web and Desktop; the guide's application commands section owns the full table.

For agents, follow [AGENTS.md](AGENTS.md).

## Citation

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
