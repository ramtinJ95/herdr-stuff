#!/usr/bin/env bash
# Cuts the layout's art from the wallpaper it is built around (1586x992):
#   room.jpg      the whole room, out of focus, dimmed and toned in walnut: behind everything
#   street.jpg    the snowy street in walnut and amber: what the terminals' glass looks onto
#   wood.jpg      one long plank of the table's wood: the beam the lamps hang from (wood-r.jpg: its mirror)
#   shelf.webp    the ivy and the top shelf: head of the bookshelf (sidebar)
#   table.webp    the cup, the bun and the lamp: foot of the bookshelf
#   shelves.webp  the bookshelf's whole column in deep shadow, fading out at its foot: behind the books
# The two .webp cards carry their own rounded corners and fade to nothing
# where they meet the shelf, so they sit on whatever color it has.
#   mods/cosy/art/make.sh <wallpaper> [out dir]
set -euo pipefail
src="$1"
out="${2:-$(cd "$(dirname "$0")" && pwd)}"
W=600   # twice the sidebar's 300px
R=26    # twice the sidebar's corner radius

# Toned like the street: the night blue at the window would edge the panels.
magick "$src" -blur 0x26 -colorspace Gray -colorspace sRGB -type TrueColor -fill '#b87a45' -tint 100 -modulate 40,115 -quality 88 "$out/room.jpg"
# The street by lamplight: its night blue taken out and the whole view
# toned in the room's walnut and amber, so the glass belongs to the room.
magick "$src" -crop 696x560+890+0 +repage -resize 1400x -blur 0x1.2 \
  -colorspace Gray -colorspace sRGB -type TrueColor -fill '#d08a45' -tint 100 -modulate 52,125 -quality 86 "$out/street.jpg"
# The shelf draws this one itself, at its own shape (shelf.js: SHELVES), so
# it ends in a fade and not an edge where the shelf is taller.
magick "$src" -crop 320x992+506+0 +repage -resize 600x -blur 0x3 -modulate 30,90 \
  \( +clone -sparse-color Barycentric '0,0 white 0,%[fx:h-1] black' -sigmoidal-contrast 10x20% \) \
  -alpha off -compose CopyOpacity -composite -quality 86 -define webp:alpha-quality=100 "$out/shelves.webp"

# The café's plank: a clear patch of the table top, pulled out along its
# grain into one long board (shade at one end, lamplight at the other). Only
# its grain is kept, in the room's walnut: the painting's shade is mauve,
# which reads as another wood beside the shelf, and its lit end outshines a
# lit lamp. wood.js lays it from one end of the beam and its mirror from the
# other, so they meet in the middle whatever the width. The patch stops
# short of the table's shadowed edge, which would be a dark line along the
# beam's foot.
magick "$src" -crop 195x48+1156+884 +repage -resize '2800x112!' -unsharp 0x1.2+0.8+0 \
  -colorspace Gray -auto-level -sigmoidal-contrast 3x45% +level-colors '#1e130b,#754b29' -quality 88 "$out/wood.jpg"
magick "$out/wood.jpg" -flop -quality 88 "$out/wood-r.jpg"

# card <crop> <height> <top|bottom: the rounded, opaque end> <name>
card() {
  local crop="$1" h="$2" solid="$3" name="$4" fade round
  if [[ $solid == top ]]; then
    fade="gradient:white-black"; round="roundrectangle 0,0 $((W - 1)),$((h + R)) $R,$R"
  else
    fade="gradient:black-white"; round="roundrectangle 0,-$R $((W - 1)),$((h - 1)) $R,$R"
  fi
  magick "$src" -crop "$crop" +repage -resize "${W}x${h}!" \
    \( -size "${W}x${h}" "$fade" -sigmoidal-contrast 9x30% \) \
    \( -size "${W}x${h}" xc:black -fill white -draw "$round" \) \
    \( -clone 1 -clone 2 -compose Multiply -composite \) \
    -delete 1,2 -alpha off -compose CopyOpacity -composite \
    -quality 90 -define webp:alpha-quality=100 "$out/$name.webp"
}
card 320x224+506+0 420 top shelf
card 660x506+906+486 460 bottom table
