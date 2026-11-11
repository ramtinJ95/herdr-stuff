#!/usr/bin/env bash
# Puts the cosy layout in the app's home: the mod as a real folder (the app
# hot-reloads real folders, not linked ones), the layout with its preview,
# and its theme. Run it again after a change.
#   mods/cosy/install.sh [app home]
set -euo pipefail
mod="$(cd "$(dirname "$0")" && pwd)"
repo="$(dirname "$(dirname "$mod")")"
home="${1:-${HERDR_APP_HOME:-$HOME/.config/herdr-app}}"
dst="$home/mods/cosy"
[[ -L $dst ]] && rm "$dst"
mkdir -p "$dst" "$home/layouts" "$home/themes"
rsync -a --delete --exclude navigation --exclude gpui-kit.d.ts --exclude jsconfig.json --exclude '*.test.js' --exclude install.sh --exclude make.sh "$mod/" "$dst/"
cp "$repo/layouts/cosy.json" "$repo/layouts/cosy.png" "$home/layouts/"
cp "$repo/themes/cosy.json" "$home/themes/cosy.json"
# Ctrl-f b / a / Tab: a mod can't import another mod's code, so the
# navigation mod's controller gets a copy beside the beam that hosts it.
nav="$home/mods/navigation"
if [[ -f $nav/controller.js && -f $nav/model.js ]]; then
  mkdir -p "$dst/navigation"
  cp "$nav/controller.js" "$nav/model.js" "$dst/navigation/"
else
  echo "cosy: no navigation mod in $home/mods; Ctrl-f b / a / Tab stay off" >&2
fi
