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
rsync -a --delete --exclude navigation --exclude appearance --exclude gpui-kit.d.ts --exclude jsconfig.json --exclude '*.test.js' --exclude install.sh --exclude make.sh "$mod/" "$dst/"
cp "$repo/layouts/cosy.json" "$repo/layouts/cosy.png" "$home/layouts/"
cp "$repo/themes/cosy.json" "$home/themes/cosy.json"
# The paper lists (find.js) read their rows with the navigation and appearance
# mods' own model.js; a mod can't import another mod's code, so each gets a
# copy beside it.
for other in navigation appearance; do
  if [[ -f $home/mods/$other/model.js ]]; then
    mkdir -p "$dst/$other"
    cp "$home/mods/$other/model.js" "$dst/$other/"
  else
    echo "cosy: no $other mod in $home/mods; its list will say so when opened" >&2
  fi
done
