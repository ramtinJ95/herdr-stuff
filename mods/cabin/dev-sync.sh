#!/usr/bin/env bash
# Copy this mod into the app's mods as a real folder: the app hot-reloads
# real folders, not linked ones. Run after each change while iterating.
set -euo pipefail
src="$(cd "$(dirname "$0")" && pwd)/"
dst="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/cabin/"
[[ -L ${dst%/} ]] && rm "${dst%/}"
mkdir -p "$dst"
nav="$(dirname "${dst%/}")/navigation"
rsync -a --delete --exclude navigation --exclude gpui-kit.d.ts --exclude jsconfig.json --exclude '*.test.js' --exclude dev-sync.sh --exclude gen.mjs "$src" "$dst"
# Ctrl-f back's focus history: dotfiles' navigation model, beside the counter.
if [[ -f $nav/model.js ]]; then
  mkdir -p "${dst}navigation"
  cp "$nav/model.js" "${dst}navigation/"
fi
