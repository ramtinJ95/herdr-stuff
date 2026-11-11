// The wall's scene: a snowy window and the fire, on the café's wall (the
// layout's background, so its planks run on behind every panel).
// Narrow (the rail), only the fire shows.
//
// It moves on the café's beat (kit.beat) at the scene's full rate.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { palette, alpha } from "./palette.js";
import { framedWindow, fireplace, woodpile, candle } from "./scene.js";
import { narrow } from "./util.js";
import { snowbank, BANK, LEDGE, beat, wave } from "./kit.js";

export default class Hearth {
  init(_props, cx) {
    this.t = 0;
    beat(cx, 1, (t) => { if (this.gone) return false; this.t = t; });
  }

  render() {
    const p = palette();
    const rail = narrow();
    const t = this.t;
    return div()
      .relative()
      .size_full()
      .overflow_hidden()
      // The fire's light on the floor and the wall around it.
      .when(!rail, (el) => el
        .child(div().absolute().bottom(-40).right(-40).w(260).h(120).rounded_full().bg(alpha(p.fire, 0.05)))
        .child(div().absolute().bottom(-24).right(0).w(180).h(70).rounded_full().bg(alpha(p.fire, 0.06))
          .opacity(wave(t, { from: 0.5, period: 2300 }))))
      .when(!rail, (el) => el.child(div().absolute().top(12).left(14)
        .child(framedWindow(p, { w: 160, h: 150, t }))
        // The sill, and a candle on it.
        .child(div().absolute().bottom(-6).left(-6).w(184).h(6).bg(p.frame).border_b(2).border_color(p.frameLo))
        // Snow banked on the sill: its ledge line on the sill's top.
        .child(div().absolute().bottom(LEDGE - BANK).left(-6).w(184).h(BANK).overflow_hidden().children(snowbank(p, -300)))
        .child(div().absolute().bottom(0).right(12).child(candle(p, { t })))))
      .child(
        h_flex()
          .absolute()
          .bottom(6)
          .left(0)
          .w_full()
          .px(rail ? 0 : 14)
          .items_end()
          .when(rail, (el) => el.justify_center())
          .when(!rail, (el) => el.justify_end().gap(4).child(woodpile(p, { px: 2 })))
          .child(fireplace(p, { px: rail ? 1.6 : 4, t })),
      )
      // The floor.
      .child(div().absolute().bottom(0).left(0).w_full().h(6).bg(p.frame).border_t(2).border_color(p.frameLo));
  }
}
