#!/usr/bin/env bash
# install.sh — install dsh-plugin-manager into DeepSeek Harness (Linux/macOS)
#
# Usage (inside the cloned directory):
#   bash install.sh
#   # or override DSH home / profile:
#   DSH_HOME=/path/to/.dsh bash install.sh
#   DSH_PROFILE=headless bash install.sh
#
# Idempotent: links the package into node_modules and appends an insert row
# to cordis.patch.yml.
#
# $DSH_HOME defaults to $HOME/.dsh; $DSH_PROFILE defaults to 'web'.

set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${DSH_PROFILE:-web}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"

if [ ! -d "$PROFILE_DIR" ]; then
    echo "[dsh-plugin-manager] profile dir not found: $PROFILE_DIR"
    echo "  Run dsh at least once first (dsh web), then re-run this script."
    exit 1
fi

# ---- 1) node_modules symlink -> plugin directory ----
NODE_MODULES="$DSH_HOME/profiles/node_modules"
LINK="$NODE_MODULES/dsh-plugin-manager"
mkdir -p "$NODE_MODULES"

if [ -L "$LINK" ]; then
    if [ "$(readlink "$LINK")" = "$PLUGIN_DIR" ]; then
        echo "[dsh-plugin-manager] already linked to this directory."
    else
        rm "$LINK"
        ln -s "$PLUGIN_DIR" "$LINK"
        echo "[dsh-plugin-manager] symlink updated -> $PLUGIN_DIR"
    fi
elif [ -e "$LINK" ]; then
    echo "[dsh-plugin-manager] $LINK exists and is not a symlink; remove it manually, then re-run."
    exit 1
else
    ln -s "$PLUGIN_DIR" "$LINK"
    echo "[dsh-plugin-manager] symlink created -> $PLUGIN_DIR"
fi

# ---- 2) append insert row to cordis.patch.yml ----
PATCH="$PROFILE_DIR/cordis.patch.yml"
touch "$PATCH"
if grep -q 'id:[[:space:]]*dsh-plugin-manager' "$PATCH"; then
    echo "[dsh-plugin-manager] cordis.patch.yml already contains this plugin row; skipped."
else
    cat >> "$PATCH" <<'EOF'

# dsh plugin manager - host composition (settings page: third-party plugins)
- insert:
    - id: dsh-plugin-manager
      name: 'dsh-plugin-manager'
EOF
    echo "[dsh-plugin-manager] wrote: $PATCH"
fi

echo ""
echo "[dsh-plugin-manager] Install complete."
echo "  Restart dsh: press Ctrl+C on the running dsh, then run: dsh web"
echo "  After restart: Settings -> 第三方插件 page appears (pick a plugin library folder, scan, enable/disable)."
