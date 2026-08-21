#!/usr/bin/env bash
# dsh-plugin-manager — POSIX 安装脚本 (macOS / Linux)
#
# 作用：把本插件挂载到当前 dsh 部署，启动 dsh 后自动加载（设置页「第三方插件」）。
#   1. 在 $DSH_HOME/profiles/node_modules 下建立 symlink 指向本插件目录
#   2. 在 $DSH_HOME/profiles/web/cordis.patch.yml 追加 insert row（幂等，不重复）
#   3. 提示重启 dsh
#
# 用法：
#   bash install.sh            # 使用 DSH_HOME 或 ~/.dsh
#   DSH_HOME=/path bash install.sh

set -euo pipefail

plugin_name="dsh-plugin-manager"
plugin_source="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---- resolve DSH_HOME ----
if [[ -z "${DSH_HOME:-}" ]]; then
  if [[ -n "${HOME:-}" ]]; then
    DSH_HOME="$HOME/.dsh"
  else
    echo "ERROR: cannot determine DSH home; set DSH_HOME" >&2
    exit 1
  fi
fi
if [[ ! -d "$DSH_HOME" ]]; then
  echo "ERROR: DSH home not found: $DSH_HOME (set DSH_HOME)" >&2
  exit 1
fi

profiles_node_modules="$DSH_HOME/profiles/node_modules"
target="$profiles_node_modules/$plugin_name"
profile_web="$DSH_HOME/profiles/web"
patch_file="$profile_web/cordis.patch.yml"

echo "DSH home       : $DSH_HOME"
echo "Plugin source  : $plugin_source"

# ---- 1. symlink into profiles/node_modules ----
mkdir -p "$profiles_node_modules"
if [[ -e "$target" || -L "$target" ]]; then
  if [[ -L "$target" && "$(readlink "$target")" == "$plugin_source" ]]; then
    echo "[ok] symlink already points at this source: $target"
  else
    echo "WARN: $target exists but is not a symlink to this source; leaving it in place." >&2
    echo "      Remove it first if you want this install to manage the link." >&2
  fi
else
  ln -s "$plugin_source" "$target"
  echo "[ok] symlink created: $target"
fi

# ---- 2. patch insert row (idempotent) ----
block=$(cat <<EOF

# dsh plugin manager — 第三方插件管理器（设置页「第三方插件」）
# 前置：$DSH_HOME/profiles/node_modules/$plugin_name -> $plugin_source
- insert:
    - id: $plugin_name
      name: '$plugin_name'
EOF
)

mkdir -p "$profile_web"
if [[ ! -f "$patch_file" ]]; then
  printf '%s\n' "$block" > "$patch_file"
  echo "[ok] created $patch_file with insert row"
elif grep -q "name: '$plugin_name'" "$patch_file"; then
  echo "[ok] insert row already present in $patch_file"
else
  printf '\n%s\n' "$block" >> "$patch_file"
  echo "[ok] appended insert row to $patch_file"
fi

echo ""
echo "Install complete. Restart dsh, then open Settings -> 第三方插件."
echo "Host half (webServer routes) loads on boot; the settings page loads after restart + browser refresh."
