#!/usr/bin/env bash
# Boot the installed Linux app's Desktop profile headless and fail when a bundle listed in the profile's
# package.json was skipped (e.g. for compatibility) or a required tool is missing. Needs the app closed,
# because the smoke Host would share the app's DSH_HOME. Like every app start, it rewrites the profile's
# generated cordis.yml.
#
#   scripts/smoke-linux-profile.sh
#
# Environment: DSH_HOME_DIR (default ~/.local/share/deepseek-harness), DSH_SMOKE_REQUIRED_TOOLS
# (comma-separated, default advanced_search,free_search_test,recall).
set -euo pipefail

INSTALL_DIR="$HOME/Applications/DeepSeek-Harness"
EXECUTABLE="$INSTALL_DIR/deepseek-harness"
RUNTIME_DIR="$INSTALL_DIR/resources/app.asar/dsh"
DSH_HOME_DIR="${DSH_HOME_DIR:-$HOME/.local/share/deepseek-harness}"
PROFILE_DIR="$DSH_HOME_DIR/profiles/desktop"
REQUIRED_TOOLS="${DSH_SMOKE_REQUIRED_TOOLS:-advanced_search,free_search_test,recall}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ -x "$EXECUTABLE" ]] || { echo "smoke-linux-profile: $EXECUTABLE is not installed" >&2; exit 1; }
[[ -f "$PROFILE_DIR/package.json" ]] || { echo "smoke-linux-profile: no Desktop profile at $PROFILE_DIR" >&2; exit 1; }
if pgrep -f -x "$EXECUTABLE" >/dev/null; then
	echo "smoke-linux-profile: DeepSeek Harness is running; close it and rerun $SCRIPT_DIR/smoke-linux-profile.sh" >&2
	exit 1
fi

cd "$PROFILE_DIR"
env -u ELECTRON_RUN_AS_NODE ELECTRON_RUN_AS_NODE=1 DSH_HOME="$DSH_HOME_DIR" DSH_TELEMETRY_DISABLED=1 \
	DSH_PRODUCT_ANALYTICS_OTLP_URL=http://127.0.0.1:9/v1/logs \
	timeout 180 "$EXECUTABLE" --expose-internals "$SCRIPT_DIR/linux-profile-smoke.mjs" \
	"$RUNTIME_DIR" "$PROFILE_DIR" "$REQUIRED_TOOLS"
