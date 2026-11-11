// A notification, as a note left on the table: Herdr's own (an agent needs
// you) and every notify(). Click: it does what it's about (goes to the
// agent) and is gone. An agent that finished while you were away leaves no
// note: the green mark on its cup says so.

import { div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, run, closeOverlay } from "herdr";
import { look, SERIF } from "./look.js";

const MARK = { error: "blocked", warning: "working", success: "done", info: "accent" };
// Herdr's title for that one: "<program> finished".
const FINISHED = / finished$/;

export default class Toast {
  init(p) {
    this.dropped = FINISHED.test(p.title ?? "");
    if (this.dropped) closeOverlay(p.overlay);
  }

  render() {
    if (this.dropped) return div();
    const L = look();
    const p = props() ?? {};
    return h_flex().id("note").size_full().px(16).gap(12).items_center().cursor_pointer()
      .rounded(L.card.radius).bg(L.card.ground).border(1).border_color(L.card.edge).hover((s) => s.bg(L.card.lift))
      .on_click(() => {
        if (p.action?.name) run(p.action.name, p.action.args ?? {});
        closeOverlay(p.overlay);
      })
      // What kind of news: the program's icon, else a dot in the level's color.
      .child(p.icon ? image(p.icon).w(20).h(20).flex_none() : div().size(9).rounded(5).flex_none().bg(L.t[MARK[p.level] ?? "accent"]))
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().font_family(SERIF).text_size(19).line_height("23px").text_color(L.card.text).child(p.title ?? ""))
        .when(Boolean(p.body), (el) => el.child(div().truncate().text_size(11.5).text_color(L.card.dim).child(p.body))));
  }
}
