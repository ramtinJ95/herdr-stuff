#!/usr/bin/env bash
# Cuts the layout's art from the wallpaper it is built around (1586x992):
#   room.jpg      the whole room, out of focus, dimmed and toned in walnut: behind everything
#   street.jpg    the snowy street in walnut and amber: what the terminals' glass looks onto
#   beam.jpg      walnut grain, drawn and not cut: the beam the lamps hang from (beam-r.jpg: its mirror)
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

# The beam's grain is noise pulled along its length over the beam's own
# gradient (layouts/cosy.json), since a strip of the painting's table would
# have to stretch over any width. tabs.js lays the strip from the left end and
# its mirror from the right, so they meet in the middle whatever the width.
magick -size 2800x112 xc: -seed 7 +noise Random -colorspace Gray -resize '70x112!' -blur 0x1.4 \
  -resize '2800x112!' -blur 3x0.6 -auto-level +level 72%,100% "$out/grain.png"
magick -size 2800x112 gradient:'#4c3321-#261910' "$out/grain.png" -compose Multiply -composite -quality 88 "$out/beam.jpg"
magick "$out/beam.jpg" -flop -quality 88 "$out/beam-r.jpg"
rm "$out/grain.png"

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
