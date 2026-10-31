#!/usr/bin/env bash
# Install the unsigned Linux AppImage for the current user only, extracted so it
# needs no FUSE, with a desktop entry and icons so GNOME shows "DeepSeek Harness"
# with its own icon.
#
#   scripts/install-linux-local.sh [path/to/DeepSeek-Harness.AppImage]
#   scripts/install-linux-local.sh --uninstall
#   scripts/install-linux-local.sh --apparmor    (print the sudo commands that install the AppArmor profile)
#   scripts/install-linux-local.sh --desktop-entry   (rewrite only the desktop entry, e.g. after installing the profile)
#
# Writes only these paths (and --uninstall removes exactly these):
#   ~/Applications/DeepSeek-Harness/   (the extracted application, plus the generated deepseek-harness.apparmor)
#   ~/.local/share/applications/deepseek-harness.desktop
#   ~/.local/share/icons/hicolor/<size>/apps/deepseek-harness.png
set -euo pipefail

APP_ID=deepseek-harness
APPS_ROOT="$HOME/Applications"
INSTALL_DIR="$APPS_ROOT/DeepSeek-Harness"
EXECUTABLE="$INSTALL_DIR/$APP_ID"
DESKTOP_FILE="$HOME/.local/share/applications/$APP_ID.desktop"
ICON_ROOT="$HOME/.local/share/icons/hicolor"
ICON_SIZES=(16x16 24x24 32x32 48x48 64x64 128x128 256x256 512x512 1024x1024)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Ubuntu 23.10+ blocks unprivileged user namespaces for unconfined processes, which is
# what everything GNOME launches is, so Chromium falls back to the setuid chrome-sandbox
# and aborts. This per-app profile (the pattern of Ubuntu's own chrome profile) lifts
# that for the installed binary only; installing it needs root, so it is only printed.
APPARMOR_TEMPLATE="$SCRIPT_DIR/../packaging/linux/apparmor/$APP_ID"
APPARMOR_PROFILE="$INSTALL_DIR/$APP_ID.apparmor"
APPARMOR_SYSTEM_PROFILE="/etc/apparmor.d/$APP_ID"

# Data directory the app uses, outside the build tree so a clean rebuild cannot wipe it.
# Override with DSH_HOME_DIR (never ~/.dsh, which belongs to the npm dsh).
DSH_HOME_DIR="${DSH_HOME_DIR:-$HOME/.local/share/deepseek-harness}"

refresh_caches() {
	if command -v update-desktop-database >/dev/null; then update-desktop-database "$HOME/.local/share/applications"; fi
	if command -v gtk-update-icon-cache >/dev/null && [[ -f "$ICON_ROOT/index.theme" ]]; then gtk-update-icon-cache -f -t "$ICON_ROOT"; fi
}

write_apparmor_profile() {
	# The path is pasted into a quoted AppArmor attachment, so keep it free of glob and quote characters.
	[[ "$EXECUTABLE" =~ ^[A-Za-z0-9._/+@\ -]+$ ]] || { echo "cannot write an AppArmor profile for $EXECUTABLE" >&2; exit 1; }
	sed "s|@EXECUTABLE@|$EXECUTABLE|" "$APPARMOR_TEMPLATE" > "$APPARMOR_PROFILE"
	chmod 0644 "$APPARMOR_PROFILE"
}

print_apparmor_commands() {
	echo "To let $APP_ID keep Chromium's sandbox when launched from GNOME, run:"
	echo "  sudo install -m 644 '$APPARMOR_PROFILE' $APPARMOR_SYSTEM_PROFILE"
	echo "  sudo apparmor_parser -r $APPARMOR_SYSTEM_PROFILE"
	echo "  $SCRIPT_DIR/install-linux-local.sh --desktop-entry"
}

write_desktop_entry() {
	# With the profile installed, run the binary itself so Chromium keeps its sandbox. Without
	# it, go through AppRun, which adds --no-sandbox when `unshare -Ur true` fails. AppRun is a
	# bash script the profile does not cover, so its probe always fails from GNOME: it is only
	# the fallback.
	local launcher="$INSTALL_DIR/AppRun"
	if cmp -s "$APPARMOR_PROFILE" "$APPARMOR_SYSTEM_PROFILE"; then launcher="$EXECUTABLE"; fi
	# DSH_* names are accepted only from the launching environment, never from DSH_HOME/.env. Product analytics
	# exports to a closed local port even if re-enabled in config; DSH_TELEMETRY_DISABLED drops the session telemetry row.
	cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=DeepSeek Harness
Comment=DeepSeek Harness desktop app
Exec=env DSH_HOME="$DSH_HOME_DIR" DSH_PRODUCT_ANALYTICS_OTLP_URL=http://127.0.0.1:9/v1/logs DSH_TELEMETRY_DISABLED=1 "$launcher" %U
TryExec=$EXECUTABLE
Icon=$APP_ID
Terminal=false
Categories=Development;
StartupWMClass=$APP_ID
EOF
	chmod 0644 "$DESKTOP_FILE"
}

if [[ "${1:-}" == "--uninstall" ]]; then
	rm -rf "$INSTALL_DIR"
	rm -f "$DESKTOP_FILE"
	for size in "${ICON_SIZES[@]}"; do rm -f "$ICON_ROOT/$size/apps/$APP_ID.png"; done
	refresh_caches
	echo "removed $APP_ID"
	if [[ -f "$APPARMOR_SYSTEM_PROFILE" ]]; then
		echo "the AppArmor profile is still installed; remove it with:"
		echo "  sudo apparmor_parser -R $APPARMOR_SYSTEM_PROFILE && sudo rm $APPARMOR_SYSTEM_PROFILE"
	fi
	exit 0
fi

if [[ "${1:-}" == "--apparmor" ]]; then
	[[ -x "$EXECUTABLE" ]] || { echo "$APP_ID is not installed; run this script without --apparmor first" >&2; exit 1; }
	write_apparmor_profile
	print_apparmor_commands
	exit 0
fi

if [[ "${1:-}" == "--desktop-entry" ]]; then
	[[ -x "$EXECUTABLE" ]] || { echo "$APP_ID is not installed; run this script without --desktop-entry first" >&2; exit 1; }
	write_apparmor_profile
	write_desktop_entry
	refresh_caches
	echo "wrote $DESKTOP_FILE: $(grep '^Exec=' "$DESKTOP_FILE")"
	exit 0
fi

SOURCE="${1:-}"
if [[ -z "$SOURCE" ]]; then
	ARTIFACTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.desktop-build/targets/linux-x64/unsigned-artifacts"
	SOURCE="$(ls -t "$ARTIFACTS"/*.AppImage 2>/dev/null | head -1 || true)"
fi
[[ -f "$SOURCE" ]] || { echo "no AppImage found; pass its path or run pnpm run package:linux:x64" >&2; exit 1; }
SOURCE="$(realpath "$SOURCE")"

# Extract beside the destination (same filesystem) so the swap below is a rename.
# --appimage-extract runs without FUSE.
mkdir -p "$APPS_ROOT" "$(dirname "$DESKTOP_FILE")"
STAGING="$(mktemp -d "$APPS_ROOT/.DeepSeek-Harness.staging.XXXXXX")"
trap 'rm -rf "$STAGING"' EXIT
(cd "$STAGING" && "$SOURCE" --appimage-extract >/dev/null)
NEW="$STAGING/squashfs-root"
[[ -x "$NEW/$APP_ID" ]] || { echo "the AppImage has no $APP_ID executable" >&2; exit 1; }
chmod 0755 "$NEW"

# Swap the new tree in atomically; the previous install (if any) ends up in staging and is removed.
if [[ -d "$INSTALL_DIR" ]]; then
	mv --exchange -T "$NEW" "$INSTALL_DIR"
else
	mv -T "$NEW" "$INSTALL_DIR"
fi

installed=0
for size in "${ICON_SIZES[@]}"; do
	icon="$INSTALL_DIR/usr/share/icons/hicolor/$size/apps/$APP_ID.png"
	[[ -f "$icon" ]] || continue
	install -D -m 0644 "$icon" "$ICON_ROOT/$size/apps/$APP_ID.png"
	installed=$((installed + 1))
done
[[ $installed -gt 0 ]] || { echo "the AppImage contains no $APP_ID icons" >&2; exit 1; }

write_apparmor_profile
write_desktop_entry

refresh_caches
echo "installed $APP_ID: $INSTALL_DIR ($installed icon sizes), DSH_HOME=$DSH_HOME_DIR"
cmp -s "$APPARMOR_PROFILE" "$APPARMOR_SYSTEM_PROFILE" || print_apparmor_commands

# The new runtime version can drop profile plugins whose compatibility exemption names only older versions;
# the app itself shows nothing when that happens, so the install fails here instead.
DSH_HOME_DIR="$DSH_HOME_DIR" "$SCRIPT_DIR/smoke-linux-profile.sh"
