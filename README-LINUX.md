# DeepSeek Harness — Linux

Guide to building the Linux AppImage of the desktop app, installing it per
user, installing the AppArmor profile and uninstalling. Every path, flag and
script in this document exists in this repository.

The Linux patch set (AppImage target, raster worker, Office kit resolution, window identity, no mandatory-update policy) comes from [mtaech/dsh-linux-patch](https://github.com/mtaech/dsh-linux-patch) (MIT); this port applies its own commits on top. The license is the repository's `LICENSE`, unchanged.

## Build the AppImage

Build host requirements:

- **Node.js** `^22.19.0 || >=24.0.0` and **pnpm** `11.28.5` (see `engines` and
  `packageManager` in `package.json`).
- **Linux x64**: `package-target.ts` rejects `linux-x64` if the host is not
  Linux x64.

Packaging reads `apps/desktop/.env.linux`, which is in `.gitignore` and does
not come with the clone; without it packaging fails with `cannot read …/apps/desktop/.env.linux`.
Create it once with this minimal content (it holds no secrets; Linux signs
nothing):

```sh
cat > apps/desktop/.env.linux <<'EOF'
DSH_DESKTOP_APP_ID=com.deepseek.harness
DSH_DESKTOP_AUTO_UPDATE_ENV=test
DOWNLOAD_TEST_ORIGIN=
DOWNLOAD_TEST_RELEASE_ID=
EOF
```

The full template, with the optional fields, is
`apps/desktop/.env.linux.example`.

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
# create apps/desktop/.env.linux (above)
cd apps/desktop
pnpm exec tsx scripts/package-target.ts linux-x64 --unsigned
```

The build uses `--unsigned` on purpose: without that option
`electron-builder-config.mjs` resolves an update feed
(`resolveDesktopAutoUpdateConfig`) and records it in the package, and the `test` deployment requires
`DOWNLOAD_TEST_ORIGIN` (https) and a `DOWNLOAD_TEST_RELEASE_ID` of 32
hexadecimal characters. With `--unsigned` the package is built
with `publish: null`: no update feed and no signature. The
`package:linux:x64` script in `apps/desktop/package.json` does not pass `--unsigned`. The
whole sequence runs by itself: `pnpm run
build:official`, the `release:pack` packing steps (`dsh` and `vendor` families),
the `native/system` packing, `prepare:runtime`, `prepare:packages`,
`prepare:dsh`, and then electron-builder with `--config
electron-builder.config.mjs --linux --x64 --publish never` (target `AppImage`),
ending with the packaged-runtime smoke test
(`scripts/smoke-packaged-runtime.ts --unsigned`).

The artifact is written to:

```
apps/desktop/.desktop-build/targets/linux-x64/unsigned-artifacts/
  deepseek-harness-<version>-linux-x86_64-unsigned.AppImage
```

and the unpacked application `linux-unpacked/` is left next to it. The AppImage
includes the `deepseek-harness` executable and an `AppRun` that electron-builder
generates for the AppImage target.

If you only want to validate the tooling and the configuration without building, from
`apps/desktop/`:

```sh
pnpm run check:package -- linux-x64 --unsigned
```

## Product telemetry

As shipped by upstream, the desktop app reports product interactions: the `product-analytics` row in `packages/bundle/web-app/cordis.patch.yml` comes with `enabled: true` and has no control in the interface. The Host exports over OTLP every 30 s to `https://dsh-otel-collector.deepseeksvc.com/v1/logs` (row `desktop-product-telemetry`). Each event carries its name and attributes (`send_button_click` with `session_id`, `model_name` and reasoning level, `model_switch`, `plugin_install_click` with the typed text, among others) plus `device_id`, `user_id` if signed in, `app_version` and operating-system and CPU data. With a local model, `model_name` is the path of the model file, which includes your home directory. According to `packages/client/product-analytics/README.md`, prompts, responses and keys are not sent.

In this port the row comes with `enabled: false`: no events are recorded or sent. To turn it on, add this to the desktop profile patch (`<DSH_HOME>/profiles/desktop/cordis.patch.yml`), with the app closed:

```yaml
- id: product-analytics
  config:
    enabled: true
```

`DSH_PRODUCT_ANALYTICS_OTLP_URL` changes the exporter's destination. It is a `DSH_*` name, so only the environment that launches the app accepts it (for example the `Exec` line of the `.desktop` file), not `<DSH_HOME>/.env`.

## Session telemetry

As shipped by upstream, the `session-telemetry-otel` row in `packages/bundle/base/cordis.patch.yml` uses the `FEEDBACK_ONLY` mode: when you give explicit feedback on a session (rating, feedback text, note or its withdrawal), it uploads over OTLP to `https://dsh-otel-collector.deepseeksvc.com/v1/logs` the prefix of that session's records that had not been sent yet, with its context (messages, responses and tool results), together with the anonymous identifier from `<DSH_HOME>/.anonymous-user-id`. Without feedback it uploads nothing. This applies to the desktop app and to the CLI.

In this port the default mode is `DISABLED`: the exporter is not built and feedback stays local. To return to the upstream behavior, launch the app with `DSH_TELEMETRY_MODE=FEEDBACK_ONLY` in its environment (for example in the `Exec` line of the `.desktop` file). `DSH_TELEMETRY_DISABLED` with any non-empty value disables the row completely; `scripts/install-linux-local.sh` writes it into the `.desktop` file together with `DSH_PRODUCT_ANALYTICS_OTLP_URL=http://127.0.0.1:9/v1/logs`.

## Install per user

```sh
apps/desktop/scripts/install-linux-local.sh
```

or passing the AppImage explicitly:

```sh
apps/desktop/scripts/install-linux-local.sh path/to/deepseek-harness-<version>-linux-x86_64-unsigned.AppImage
```

Without an argument, the script looks for the most recent `*.AppImage` in
`apps/desktop/.desktop-build/targets/linux-x64/unsigned-artifacts/`.

The script extracts the AppImage without FUSE (`--appimage-extract`), places it
atomically in `~/Applications/DeepSeek-Harness/`, and also writes:

- `~/.local/share/applications/deepseek-harness.desktop` (desktop entry,
  `Name=DeepSeek Harness`, `Categories=Development;`,
  `StartupWMClass=deepseek-harness`).
- `deepseek-harness.png` icons in
  `~/.local/share/icons/hicolor/<16x16…1024x1024>/apps/`.
- `~/Applications/DeepSeek-Harness/deepseek-harness.apparmor`, generated from the
  template `apps/desktop/packaging/linux/apparmor/deepseek-harness`.

The app's data directory (`DSH_HOME`) defaults to
`~/.local/share/deepseek-harness`; it can be overridden at install time with the
environment variable `DSH_HOME_DIR` (never `~/.dsh`, which belongs to the npm package
`dsh`).

When it finishes, the script runs `apps/desktop/scripts/smoke-linux-profile.sh`, which starts the installed app's Host without a window, with the `desktop` profile of that `DSH_HOME`, and fails (exit code 1) if any bundle in `dsh.profile.bundles` of the profile's `package.json` was skipped or if the tools of the known plugins that the profile lists are missing: `advanced_search` and `free_search_test` from `dsh-free-search`, `recall` from `dsh-recall` (the list can be changed with `DSH_SMOKE_REQUIRED_TOOLS`). On a new installation there is no profile yet, because the app creates it on its first start: the script says so and ends without an error. The app shows nothing when it skips a bundle: the Host writes the notice to stderr and the app only keeps it for the crash report. A bundle is usually skipped after a version upgrade: its dsh requirements do not cover the new version and the exemption in `<DSH_HOME>/profiles/desktop/compatibility.json` only names earlier versions. In that case the message says which exact version to add and to which `package@version`. The smoke needs the app closed and can be repeated on its own with `apps/desktop/scripts/smoke-linux-profile.sh`.

## Install the AppArmor profile

Since Ubuntu 23.10+, unconfined processes cannot create unprivileged user
namespaces, so Chromium (launched from GNOME) falls back to the setuid
`chrome-sandbox` and aborts. The app's AppArmor profile (unconfined,
with the `userns` permission, like Ubuntu's own chrome profile) lifts that
restriction for the installed binary only. Installing it requires root, so
the script **prints** the commands instead of running them:

```sh
apps/desktop/scripts/install-linux-local.sh --apparmor
```

Then run the commands it prints:

```sh
sudo install -m 644 ~/Applications/DeepSeek-Harness/deepseek-harness.apparmor /etc/apparmor.d/deepseek-harness
sudo apparmor_parser -r /etc/apparmor.d/deepseek-harness
apps/desktop/scripts/install-linux-local.sh --desktop-entry
```

`--desktop-entry` rewrites only the desktop entry. If
`/etc/apparmor.d/deepseek-harness` matches the generated profile, `Exec`
points directly to the `deepseek-harness` binary (Chromium keeps its
sandbox). Without the profile, `Exec` uses the bundled `AppRun`, which adds
`--no-sandbox` when `unshare -Ur true` fails; it is only a fallback, because
`AppRun` is a bash script that the profile does not cover.

## Uninstall

```sh
apps/desktop/scripts/install-linux-local.sh --uninstall
```

It removes exactly what the installation wrote:

- `~/Applications/DeepSeek-Harness/` (extracted application, including the
  generated profile).
- `~/.local/share/applications/deepseek-harness.desktop`.
- `~/.local/share/icons/hicolor/<size>/apps/deepseek-harness.png`.

It does not touch the data in `DSH_HOME` (by default
`~/.local/share/deepseek-harness`). If the AppArmor profile is still installed
(`/etc/apparmor.d/deepseek-harness`), the script prints the commands to
remove it:

```sh
sudo apparmor_parser -R /etc/apparmor.d/deepseek-harness && sudo rm /etc/apparmor.d/deepseek-harness
```
