// The string of fairy lights down the post between the shelf and the window.

import { image } from "gpui-kit";
import { v_flex } from "gpui-base";
import { ICON } from "./look.js";

const STEP = 46;

export default class Lights {
  init() { this.height = 900; }

  render() {
    const n = Math.ceil(this.height / STEP);
    return v_flex().id("lights").size_full().items_center().overflow_hidden()
      .on_size_change((size, cx) => { this.height = size.height; cx.notify(); })
      .children(Array.from({ length: n }, (_, i) =>
        // The wire sways: bulbs sit a little left and right of the post's
        // middle, and every third one is dimmer, as on a real string.
        image(`${ICON}/bulb.svg`).w(24).h(STEP).flex_none().ml([0, 5, -3, 4, -5, 2][i % 6]).opacity(i % 3 === 1 ? 0.72 : 1)));
  }
}
