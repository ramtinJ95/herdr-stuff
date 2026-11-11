// A pane's title bar (the layout's pane header): a wooden beam with a bank
// of snow on it, lit by the fire when its pane is focused. On the beam: its
// pet (for an agent) or program icon, a dark nameplate like the counter's
// (name, folder, branch), a tag when its agent needs you or is done, and
// knobs to split right, split down, zoom and close. Click focuses,
// double-click zooms, right-click is Herdr's pane menu.

import { div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, openOverlay } from "herdr";
import { palette, alpha, mix, textOn } from "./palette.js";
import { pet } from "./pixel.js";
import { petName } from "./pets.js";
import { bevel, knob, snowbank, LEDGE } from "./kit.js";
import { folder } from "./util.js";

const TAG = { blocked: "needs you", done: "done" };

export default class TitleBar {
  init() {}

  render() {
    const p = palette();
    const t = p.t;
    const me = panes().find((x) => x.pane === props()?.pane);
    if (!me) return div();
    const pane = me.pane;
    const prog = me.program;
    const agent = Boolean(me.status && prog?.agent);
    const on = me.focused;
    const name = agent ? `${petName(me.terminal ?? pane)} · ${prog.name}` : ((prog?.shell && prog.name) || prog?.name || "shell");
    const face = on ? p.frameLit : p.frame;
    const where = [folder(me.cwd), me.branch].filter(Boolean).join("  ·  ");
    const tag = TAG[me.status];
    const shift = -([...pane].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7) % 1200);
    const pic = prog?.icon ? (prog.tint ? svg(prog.icon).size(13).flex_none().text_color(p.paper) : image(prog.icon).size(13).flex_none()) : null;
    const plate = bevel(
      h_flex().flex_1().min_w(0).h(18).px(8).gap(8).items_center().bg(p.ink)
        .when(!agent && Boolean(pic), (el) => el.child(pic))
        .child(div().flex_none().max_w(260).truncate().text_size(12).font_semibold().text_color(p.paper).child(name))
        .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().text_size(11.5).text_color(alpha(p.paper, 0.6)).child(where))),
      { hi: p.frameLo, lo: p.frameHi, w: 1, shrink: true },
    );
    return div()
      .id(`tb-${pane}`)
      .relative()
      .size_full()
      .overflow_hidden()
      .bg(face)
      .on_mouse_down("left", (e) => { if (e.click_count === 2) run("pane.zoom", { pane }); })
      .on_click(() => run("pane.focus", { pane }))
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        openOverlay({ mod: "menu", kind: "popup", width: 220, height: 260, props: { tab: "pane", target: { pane, terminal: me.terminal } } });
      })
      // Snow on the beam, under what's on it.
      .children(snowbank(p, shift))
      // The beam.
      .child(h_flex()
        .absolute()
        .top(LEDGE)
        .bottom(0)
        .left(0)
        .right(0)
        .pl(8)
        .pr(6)
        .gap(8)
        .items_center()
        .border_b(2)
        .border_color(on ? p.fire : p.frameLo)
        .when(agent, (el) => el.child(div().flex_none().mt(-8).child(pet(p, { status: me.status, address: me.terminal ?? pane }, { px: 1.25, bubble: false, still: true, id: `tb-pet-${pane}` }))))
        .child(plate)
        .when(Boolean(tag), (el) => el.child(div().flex_none().h(18).px(7).flex().items_center().bg(t[me.status])
          .child(div().text_size(11).font_semibold().text_color(textOn(p, t[me.status])).child(tag))))
        .child(div().flex_1())
        .child(h_flex().gap(3).flex_none()
          .child(knob(p, `tb-r-${pane}`, "mods/pane/split-right.svg", () => run("pane.split", { direction: "right", pane }), { tip: "Split right", lit: on }))
          .child(knob(p, `tb-d-${pane}`, "mods/pane/split-down.svg", () => run("pane.split", { direction: "down", pane }), { tip: "Split down", lit: on }))
          .child(knob(p, `tb-z-${pane}`, `mods/pane/${me.zoomed ? "unzoom" : "zoom"}.svg`, () => run("pane.zoom", { pane }), { tip: me.zoomed ? "Unzoom" : "Zoom", lit: on }))
          .child(knob(p, `tb-x-${pane}`, "mods/pane/close.svg", () => run("pane.close", { pane }), { tip: "Close", lit: on }))));
  }
}
