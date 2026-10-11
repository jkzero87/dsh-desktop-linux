#!/usr/bin/env bash
# Install the unsigned Linux AppImage for the current user only, extracted so it
# needs no FUSE, with a desktop entry and icons so GNOME shows "DeepSeek Harness"
# with its own icon.
#
#   scripts/install-linux-local.sh [path/to/DeepSeek-Harness.AppImage]
#   scripts/install-linux-local.sh --uninstall
#
# Writes only these paths (and --uninstall removes exactly these):
#   ~/Applications/DeepSeek-Harness/   (the extracted application)
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

# Data directory the app uses. This points at the development home for now;
# change it to your own data directory (never ~/.dsh, which belongs to the npm dsh).
DSH_HOME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.desktop-build/development/home"

refresh_caches() {
	if command -v update-desktop-database >/dev/null; then update-desktop-database "$HOME/.local/share/applications"; fi
	if command -v gtk-update-icon-cache >/dev/null && [[ -f "$ICON_ROOT/index.theme" ]]; then gtk-update-icon-cache -f -t "$ICON_ROOT"; fi
}

if [[ "${1:-}" == "--uninstall" ]]; then
	rm -rf "$INSTALL_DIR"
	rm -f "$DESKTOP_FILE"
	for size in "${ICON_SIZES[@]}"; do rm -f "$ICON_ROOT/$size/apps/$APP_ID.png"; done
	refresh_caches
	echo "removed $APP_ID"
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

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=DeepSeek Harness
Comment=DeepSeek Harness desktop app
Exec=env DSH_HOME="$DSH_HOME_DIR" "$EXECUTABLE" %U
TryExec=$EXECUTABLE
Icon=$APP_ID
Terminal=false
Categories=Development;
StartupWMClass=$APP_ID
EOF
chmod 0644 "$DESKTOP_FILE"

refresh_caches
echo "installed $APP_ID: $INSTALL_DIR ($installed icon sizes), DSH_HOME=$DSH_HOME_DIR"
