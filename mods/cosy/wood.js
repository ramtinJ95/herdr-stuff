// The café's one plank (art/make.sh: wood.jpg), laid along the beam. The
// plank is 2800 x 112 and can't stretch to any width, so the beam's wood is
// two pieces: the plank from the left end and its mirror from the right,
// each cut where they meet in the middle.

import { div, image } from "gpui-kit";
import { ART } from "./look.js";

// The plank's shape: its length for its thickness.
const GRAIN = 2800 / 112;

/**
 * Wood `width` long and `height` thick at (x, y) in a relative parent, its
 * four corners rounded by `round`.
 */
export function lying(width, height, { x = 0, y = 0, round = 0 } = {}) {
  const half = width / 2;
  // An image is fitted whole inside its box, and the app rounds the fit to
  // whole pixels: in a box of exactly the plank's shape a hair off its
  // thickness is 25 hairs off its length, and the wood stops short of the
  // beam's end. So the box is a little thicker than the plank: its length
  // decides the fit, and the plank sits in the middle of the spare.
  const spare = 2;
  return ["left", "right"].map((end) =>
    div().absolute().top(y).left(end === "left" ? x : x + half).w(half).h(height).overflow_hidden()
      .child(image(`${ART}/${end === "left" ? "wood" : "wood-r"}.jpg`).absolute().top(-spare / 2)[end](0)
        .w(height * GRAIN).h(height + spare).rounded(round)));
}
