#!/usr/bin/env bash
# Install dsh-read-edit-whitespace into the desktop profile the way dsh-free-search, dsh-recall, dsh-cite-sources and
# dsh-biblioteca-cue are wired (copied from ~/biblioteca/plugin/dsh-biblioteca-cue/install_desktop.sh):
#   1. tgz in $DSH_HOME/.local-packages/
#   2. profiles/desktop/package.json: "dependencies" file: entry + "dsh.profile.bundles" entry (bundle patch = cordis.patch.yml)
#   3. no compatibility.json entry: package.json engines.dsh states the supported DSH range, which decides alone
#   4. pnpm install in profiles/desktop (updates pnpm-lock.yaml and node_modules; needs network), with the pnpm that
#      wrote the profile: node_modules/.modules.yaml records "packageManager": "pnpm@11.28.5", the version the app
#      bundles (resources/runtime/versions.json, $DSH_HOME/dsh-runtimes/dsh-primary-runtime/runtime.json); PATH pnpm
#      is used only when it reports that same version
#   5. packages patched in place after their install (NEXT.md: dsh-recall lib/index.js from ce2df4a, dsh-compaction-select)
#      are restored from the profile tarball if pnpm rewrote them
# Upgrade: when the profile already depends on $NAME through file:$LOCAL_PACKAGES/$NAME-<old>.tgz, the dependency,
# and the lockfile move to the new version; the lockfile may change only in $NAME's own
# entries, the installed copy must match the new tgz, and the old tgz is removed only after success.
# Refuses to run while the app (or anything else) has DSH_HOME open. Backs up every file it changes, plus a
# tarball of the whole profile directory; on any failure after the backup it restores the profile directory from that tarball.
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.local/share/deepseek-harness}"
PROFILE="$DSH_HOME/profiles/desktop"
LOCAL_PACKAGES="$DSH_HOME/.local-packages"
PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME=dsh-read-edit-whitespace
VERSION="$(node -p "require('$PKG_DIR/package.json').version")"
TGZ="$LOCAL_PACKAGES/$NAME-$VERSION.tgz"
TS="$(date +%Y%m%d-%H%M)"
TAG="bak-pre-read-edit-whitespace-$TS"
LOCKFILE_GUARD="$HOME/dsh-cite-sources/lockfile_guard.py"
[ -f "$LOCKFILE_GUARD" ] || { echo "install_desktop: $LOCKFILE_GUARD is missing" >&2; exit 1; }

die() { echo "install_desktop: $*" >&2; exit 1; }

# 1. The app must be fully closed: no DeepSeek Harness process, nothing holding files under DSH_HOME.
APP_PATTERN='Applications/DeepSeek-Harness/|deepseek-harness/dsh-runtimes/'
if pgrep -f "$APP_PATTERN" >/dev/null; then
  pgrep -af "$APP_PATTERN" | cut -c1-160 >&2
  die "DeepSeek Harness is running; quit it completely (including the tray) and retry"
fi
if command -v lsof >/dev/null && lsof +D "$DSH_HOME" 2>/dev/null | tail -n +2 | grep -q .; then
  lsof +D "$DSH_HOME" 2>/dev/null >&2 || true
  die "files under $DSH_HOME are open (listed above); close those processes and retry"
fi

[ -f "$PROFILE/package.json" ] || die "no profile at $PROFILE"

# The pnpm that wrote this profile.
WANT_PNPM="$(grep -o '"packageManager": "pnpm@[^"]*"' "$PROFILE/node_modules/.modules.yaml" | head -1 | sed 's/.*pnpm@//; s/"$//')"
[ -n "$WANT_PNPM" ] || die "cannot read packageManager from $PROFILE/node_modules/.modules.yaml"
APP_DIR="${DSH_APP_DIR:-$HOME/Applications/DeepSeek-Harness}"
PNPM=()
for runtime in "$DSH_HOME/dsh-runtimes/dsh-primary-runtime/dependencies" "$APP_DIR/resources/runtime/primary-runtime/dependencies"; do
  if [ -x "$runtime/node/bin/node" ] && [ -f "$runtime/pnpm/bin/pnpm.mjs" ] \
    && [ "$(cd /tmp && "$runtime/node/bin/node" "$runtime/pnpm/bin/pnpm.mjs" --version 2>/dev/null)" = "$WANT_PNPM" ]; then
    PNPM=("$runtime/node/bin/node" "$runtime/pnpm/bin/pnpm.mjs")
    break
  fi
done
if [ ${#PNPM[@]} -eq 0 ] && command -v pnpm >/dev/null && [ "$(cd /tmp && pnpm --version)" = "$WANT_PNPM" ]; then
  PNPM=(pnpm)
fi
[ ${#PNPM[@]} -gt 0 ] || die "no pnpm $WANT_PNPM found (app runtime under $DSH_HOME/dsh-runtimes or $APP_DIR, or PATH)"
echo "using pnpm $WANT_PNPM: ${PNPM[*]}"

# Network precheck: the selected pnpm's node must reach the npm registry (we no longer install offline).
NODE="${PNPM[0]}"
[ "$NODE" = pnpm ] && NODE="$(command -v node)"
[ -x "$NODE" ] || die "network precheck: cannot find a node binary (PNPM[0]=$NODE)"
"$NODE" -e "
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 10000);
  fetch('https://registry.npmjs.org/@deepseek-ai%2fcosmokit', { signal: c.signal })
    .then(r => { clearTimeout(t); process.exit(r.ok ? 0 : 1); })
    .catch(e => { clearTimeout(t); console.error('registry fetch failed:', e.message); process.exit(1); });
" || die "network precheck failed: could not fetch https://registry.npmjs.org/@deepseek-ai/cosmokit within 10 s; this install needs network (no --offline), check connectivity and retry"

MODE=install
OLD_VERSION=""
OLD_TGZ=""
if grep -q "\"$NAME\"" "$PROFILE/package.json"; then
  OLD_SPEC="$(node -p "require('$PROFILE/package.json').dependencies?.['$NAME'] ?? ''")"
  case "$OLD_SPEC" in
    "file:$LOCAL_PACKAGES/$NAME-"*.tgz) ;;
    *) die "$NAME is in $PROFILE/package.json but not as file:$LOCAL_PACKAGES/$NAME-<version>.tgz (found '$OLD_SPEC')" ;;
  esac
  OLD_TGZ="${OLD_SPEC#file:}"
  OLD_VERSION="${OLD_TGZ##*/"$NAME"-}"
  OLD_VERSION="${OLD_VERSION%.tgz}"
  [ "$OLD_VERSION" != "$VERSION" ] || die "$NAME@$VERSION is already installed; bump the version in $PKG_DIR/package.json"
  [ -f "$OLD_TGZ" ] || die "the installed dependency's tgz $OLD_TGZ is missing"
  MODE=upgrade
  echo "upgrading $NAME $OLD_VERSION -> $VERSION"
fi

# 2. Gate on the package's own tests (a real session case, no network).
(cd "$PKG_DIR" && npm test >/dev/null) || die "npm test failed in $PKG_DIR"

# 3. Pack. Refuse to overwrite a different tgz of the same version.
PACK_DIR="$(mktemp -d)"
BACKED_UP=0
DONE=0
on_exit() {
  local status=$?
  rm -rf "$PACK_DIR"
  if [ "$BACKED_UP" = 1 ] && [ "$DONE" = 0 ]; then
    echo "install_desktop: failed; restoring $PROFILE from desktop.$TAG.tgz" >&2
    rm -rf "$PROFILE"
    tar -C "$DSH_HOME/profiles" -xzf "$DSH_HOME/profiles/desktop.$TAG.tgz"
    if [ -n "${NEW_TGZ:-}" ]; then rm -f "$TGZ"; fi
  fi
  exit "$status"
}
trap on_exit EXIT
(cd "$PKG_DIR" && npm pack --silent --pack-destination "$PACK_DIR" >/dev/null)
if [ -e "$TGZ" ] && ! cmp -s "$TGZ" "$PACK_DIR/$NAME-$VERSION.tgz"; then
  die "$TGZ exists with different content; bump the version"
fi

# 4. Back up every file this script changes, and the whole profile directory.
for f in package.json pnpm-lock.yaml; do
  [ -e "$PROFILE/$f" ] && cp -p "$PROFILE/$f" "$PROFILE/$f.$TAG"
done
tar -C "$DSH_HOME/profiles" -czf "$DSH_HOME/profiles/desktop.$TAG.tgz" desktop
echo "backups: $PROFILE/{package.json,pnpm-lock.yaml}.$TAG and $DSH_HOME/profiles/desktop.$TAG.tgz"

BACKED_UP=1

if [ ! -e "$TGZ" ]; then
  cp "$PACK_DIR/$NAME-$VERSION.tgz" "$TGZ"
  NEW_TGZ=1
fi

# 5. package.json (JSON edit; key order otherwise preserved).
node - "$PROFILE" "$NAME" "$VERSION" "$TGZ" "$OLD_VERSION" <<'EOF'
const fs = require("node:fs");
const [profile, name, version, tgz, oldVersion] = process.argv.slice(2);
const pkgPath = `${profile}/package.json`;
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.dependencies[name] = `file:${tgz}`;
const bundles = pkg.dsh.profile.bundles;
if (!bundles.includes(name)) bundles.push(name);
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
EOF

# 6. Install from the local tgz only. Packages that are real directories (not links) are fingerprinted first,
#    because some were patched in place after install and a reinstall would revert them. $NAME itself is the
#    package being replaced, so it is not fingerprinted.
fingerprint() { (cd "$PROFILE/node_modules" && find "$1" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-64); }
declare -A BEFORE
for dir in "$PROFILE"/node_modules/dsh-*; do
  [ -d "$dir" ] && [ ! -L "$dir" ] || continue
  pkg="$(basename "$dir")"
  [ "$pkg" != "$NAME" ] || continue
  BEFORE[$pkg]="$(fingerprint "$pkg")"
done

# Lockfile guard: the install must not change any locked package or importer dependency outside $NAME.
BEFORE_LOCK="$PACK_DIR/lockfile.before"
AFTER_LOCK="$PACK_DIR/lockfile.after"
python3 "$LOCKFILE_GUARD" "$PROFILE/pnpm-lock.yaml" "$NAME" > "$BEFORE_LOCK" \
  || die "lockfile guard: cannot extract pinned set from $PROFILE/pnpm-lock.yaml"
(cd "$PROFILE" && "${PNPM[@]}" install)
for pkg in "${!BEFORE[@]}"; do
  if [ ! -d "$PROFILE/node_modules/$pkg" ] || [ "$(fingerprint "$pkg")" != "${BEFORE[$pkg]}" ]; then
    echo "pnpm rewrote node_modules/$pkg; restoring the pre-install copy from desktop.$TAG.tgz"
    rm -rf "$PROFILE/node_modules/$pkg"
    tar -C "$DSH_HOME/profiles" -xzf "$DSH_HOME/profiles/desktop.$TAG.tgz" "desktop/node_modules/$pkg"
    [ "$(fingerprint "$pkg")" = "${BEFORE[$pkg]}" ] || die "could not restore node_modules/$pkg"
  fi
done


python3 "$LOCKFILE_GUARD" "$PROFILE/pnpm-lock.yaml" "$NAME" > "$AFTER_LOCK" \
  || die "lockfile guard: cannot re-extract pinned set from $PROFILE/pnpm-lock.yaml"
if ! cmp -s "$BEFORE_LOCK" "$AFTER_LOCK"; then
  echo "install_desktop: lockfile guard: locked packages or importer dependencies changed outside $NAME:" >&2
  diff -u "$BEFORE_LOCK" "$AFTER_LOCK" >&2 || true
  die "lockfile guard failed; restore path below reverts $PROFILE"
fi

# Upgrade lockfile guard: the new lockfile must equal the pre-install one with $NAME-$OLD_VERSION.tgz renamed to
# $NAME-$VERSION.tgz everywhere and, in $NAME's own packages entry only, the resolution integrity replaced by the new
# tgz's sha512 and `version: $OLD_VERSION` by `version: $VERSION`; any other change fails.
if [ "$MODE" = upgrade ]; then
  python3 - "$PROFILE/pnpm-lock.yaml.$TAG" "$PROFILE/pnpm-lock.yaml" "$NAME" "$OLD_VERSION" "$VERSION" "$TGZ" <<'EOF' \
    || die "lockfile guard: pnpm-lock.yaml changed outside $NAME's own entries"
import base64, difflib, hashlib, re, sys
before_path, after_path, name, old, new, tgz = sys.argv[1:]
before = open(before_path, encoding="utf-8").read()
after = open(after_path, encoding="utf-8").read()
integrity = "sha512-" + base64.b64encode(hashlib.sha512(open(tgz, "rb").read()).digest()).decode()
old_file = re.escape(f"{name}-{old}.tgz")
# The packages entry: its key line and the indented lines below it, up to the blank line that ends it.
entry = re.compile(r"^  " + re.escape(name) + r"@file:[^\n]*/" + old_file + r":\n(?:    [^\n]*\n)*", re.M)
found = entry.findall(before)
if len(found) != 1:
    sys.exit(f"lockfile guard: expected one {name}-{old}.tgz packages entry in the pre-install lockfile, found {len(found)}")
block, n_int = re.subn(r"(resolution: \{integrity: )sha512-[A-Za-z0-9+/=]+(, tarball: file:[^}]*/" + old_file + r"\})",
                       lambda m: m.group(1) + integrity + m.group(2), found[0])
block, n_ver = re.subn(r"^    version: " + re.escape(old) + r"$", f"    version: {new}", block, flags=re.M)
if n_int != 1 or n_ver != 1:
    sys.exit(f"lockfile guard: {name}'s entry has {n_int} resolution and {n_ver} version lines; expected one of each")
expected = before.replace(found[0], block).replace(f"{name}-{old}.tgz", f"{name}-{new}.tgz")
if after != expected:
    sys.stderr.writelines(difflib.unified_diff(expected.splitlines(True), after.splitlines(True), "expected", "pnpm-lock.yaml"))
    sys.exit(1)
EOF
fi

[ -f "$PROFILE/node_modules/$NAME/lib/index.js" ] || die "pnpm did not install $NAME"
[ -f "$PROFILE/node_modules/$NAME/cordis.patch.yml" ] || die "installed package lacks cordis.patch.yml"
INSTALLED_VERSION="$(node -p "require('$PROFILE/node_modules/$NAME/package.json').version")"
[ "$INSTALLED_VERSION" = "$VERSION" ] || die "node_modules/$NAME is version $INSTALLED_VERSION, expected $VERSION"
WANT_LIB="$(tar -xzOf "$TGZ" package/lib/whitespace.js | sha256sum | cut -c1-64)"
GOT_LIB="$(sha256sum < "$PROFILE/node_modules/$NAME/lib/whitespace.js" | cut -c1-64)"
[ "$GOT_LIB" = "$WANT_LIB" ] || die "node_modules/$NAME/lib/whitespace.js sha256 $GOT_LIB differs from the new tgz's $WANT_LIB"

# Post-install summary.
echo "=== post-install summary ==="
echo "package.json: $NAME -> $(node -p "require('$PROFILE/package.json').dependencies['$NAME']")"
python3 - "$LOCKFILE_GUARD" "$PROFILE/pnpm-lock.yaml" "$NAME" <<'EOF'
import subprocess, sys
# Exclude a name no package has, so the guard prints $NAME's own lines for this filter.
out = subprocess.run([sys.executable, sys.argv[1], sys.argv[2], "--no-such-package--"],
                     capture_output=True, text=True, check=True).stdout
for line in out.splitlines():
    if line.split("\t", 1)[0].startswith(("P " + sys.argv[3], "I . " + sys.argv[3])):
        print("lockfile:", line.replace("\t", "  "))
EOF
echo "dsh.profile.bundles: $(node -p "JSON.stringify(require('$PROFILE/package.json').dsh.profile.bundles)")"
echo "node_modules/$NAME: version $INSTALLED_VERSION, lib/whitespace.js sha256 $GOT_LIB"
echo "dsh-recall fingerprint (after restore): $(fingerprint dsh-recall)"
DONE=1
if [ "$MODE" = upgrade ]; then
  rm -f "$OLD_TGZ"
  echo "removed $OLD_TGZ"
fi
echo "installed $NAME@$VERSION into $PROFILE; run apps/desktop/scripts/smoke-linux-profile.sh, start the app and check that read numbers lines as N<tab>text."
