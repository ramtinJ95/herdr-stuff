// The café's one plank (art/make.sh: wood.jpg), laid along the beam. The
// plank and its mirror cover half each, cropped where they meet. Their size
// comes from BOTH dimensions of the beam, not a fixed maximum image length.

import { div, image } from "gpui-kit";
import { ART } from "./look.js";

// The plank's shape: its length for its thickness.
const GRAIN = 2800 / 112;

/**
 * Wood `width` long and `height` thick at (x, y) in a relative parent, its
 * four corners rounded by `round`.
 */
export function lying(width, height, { x = 0, y = 0, round = 0 } = {}) {
  if (width <= 0 || height <= 0) return [];
  const half = width / 2;
  // Cover each half without distorting the grain, even when half the beam
  // is longer than a height-sized plank (ultrawide windows). The host fits
  // images inside their boxes and rounds to pixels: allow two logical px
  // of thickness as bleed, including at the app's minimum 0.5 zoom. A little
  // extra box height makes width decide the fit, rather than rounded height.
  const spare = 2;
  const length = Math.max(half, height * GRAIN) + spare * GRAIN;
  const thickness = length / GRAIN;
  // Round only the beam's outside corners, never the images' meeting edges.
  return [div().absolute().top(y).left(x).w(width).h(height).rounded(round).overflow_hidden()
    .children(["left", "right"].map((end) =>
      div().absolute().top(0).left(end === "left" ? 0 : half).w(half).h(height).overflow_hidden()
        .child(image(`${ART}/${end === "left" ? "wood" : "wood-r"}.jpg`).absolute()
          .top((height - thickness - spare) / 2)[end](0).w(length).h(thickness + spare))))];
}
