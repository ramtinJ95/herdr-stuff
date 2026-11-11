// A pane's top rail (the layout's pane header): each pane is one light of
// the café's window, and this is the wood above its glass. The program, the
// folder and branch it's in, what its agent is doing, and (on hover) knobs
// to split, zoom and close it. Click: focus the pane; right-click: its menu.

import { div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, home } from "herdr";
import { look, alpha, folder, programIcon, MOOD, ICON, SERIF } from "./look.js";
import { openMenu } from "./menu.js";

export default class Pane {
  init() { this.hovered = false; }

  knob(L, id, icon, tip, command, args) {
    return div().id(id).size(20).flex().items_center().justify_center().rounded(10).cursor_pointer()
      .text_color(L.muted).hover((s) => s.bg(alpha(L.cream, 0.14)).text_color(L.cream)).tooltip(tip)
      .on_click((_e, cx) => { cx.stop_propagation(); run(command, args); })
      .child(svg(`${ICON}/${icon}.svg`).size(13));
  }

  render() {
    const L = look();
    const p = panes().find((x) => x.pane === props()?.pane);
    if (!p) return div();
    const pane = p.pane;
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const st = p.status;
    const tag = st && st !== "idle";
    return h_flex().id(`rail-${pane}`).size_full().pl(12).pr(8).gap(9).items_center()
      .bg(p.focused ? "#3d2a1d" : "#2a1d15").border_b(1).border_color("#00000070")
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openMenu("pane", { pane }); })
      .when(Boolean(p.program?.icon), (el) => el.child(programIcon(p.program, 15, p.focused ? L.lampHi : L.muted, svg, image)))
      .child(div().flex_none().max_w(280).truncate().font_family(SERIF).text_size(18).line_height("22px")
        .text_color(p.focused ? L.lampHi : L.muted).child(name))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(L.dim).child(folder(p.cwd, home())))
      .when(Boolean(p.branch) && !this.hovered, (el) => el.child(h_flex().flex_none().max_w(220).gap(4).items_center().text_size(11.5).text_color(L.dim)
        .child(svg(`${ICON}/branch.svg`).size(12).flex_none()).child(div().truncate().child(p.branch))))
      .when(tag, (el) => el.child(h_flex().flex_none().h(18).px(7).gap(5).items_center().rounded(9).bg(alpha(L.t[st], 0.16))
        .text_size(10.5).text_color(L.t[st])
        .child(div().size(5).rounded(3).bg(L.t[st]).when(st !== "done", (d) => d.loop("opacity", { from: 0.35, to: 1, period: st === "blocked" ? 1100 : 1800 })))
        .child(MOOD[st])))
      .when(this.hovered, (el) => el
        .child(this.knob(L, `r-${pane}`, "split-right", "Split right", "pane.split", { direction: "right", pane }))
        .child(this.knob(L, `d-${pane}`, "split-down", "Split down", "pane.split", { direction: "down", pane }))
        .child(this.knob(L, `z-${pane}`, "zoom", p.zoomed ? "Unzoom" : "Zoom", "pane.zoom", { pane }))
        .child(this.knob(L, `x-${pane}`, "x", "Close", "pane.close", { pane })));
  }
}
