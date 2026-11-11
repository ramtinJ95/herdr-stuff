// The beam over the window: the menu card pinned at its left, the shown
// space's tabs as pendant lamps (the lit one is the tab you're in), and the
// knobs at its right (a new tab, find). Click a lamp: go
// there; drag one onto another: move it; double-click: rename; right-click:
// its menu; the wheel: the next or previous tab.

import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, run, window, knownAgents } from "herdr";
import { look, alpha, stop, programIcon, ICON, SERIF } from "./look.js";
import { openMenu } from "./menu.js";

export default class Tabs {
  init(_p, cx) {
    this.pressed = null;
    this.scroll = ScrollHandle.new();
    // The agents installed here, for the new tab card: asked once, up front,
    // so the card opens at its full size.
    this.brews = [];
    cx.spawn(async () => {
      try {
        this.brews = (await knownAgents()).filter((a) => a.installed);
      } catch (e) {
        console.log(`cosy: the new tab card lists no agents, the installed-agent check failed (${e})`);
      }
    });
    // Ctrl-f navigation (the navigation mod's controller), when install.sh
    // found it and put it beside this file: it takes cosy.tabs, cosy.agents
    // and cosy.back from here, and is this mod's only listener: a key
    // command goes to one waiting nextCommand(), so a second listener
    // anywhere in the mod would swallow every other press. Without it those
    // keys do nothing.
    cx.spawn(async (cx) => {
      try {
        const { NavigationController } = await import("./navigation/controller.js");
        this.navigation = new NavigationController(cx);
      } catch (e) {
        console.log(`cosy: Ctrl-f b / a / Tab are off, ./navigation/controller.js did not load (${e})`);
      }
    });
  }

  lamp(L, c, i, shown, space) {
    const program = panes().find((p) => p.tab === c.id && p.program?.agent)?.program ?? panes().find((p) => p.tab === c.id)?.program;
    const name = c.named ? c.name : program?.name ?? "Terminal";
    const lit = c.active;
    const text = lit ? L.ink : L.muted;
    // A dome shade: round on top, open below.
    const shade = h_flex().h(29).pl(13).pr(lit ? 8 : 13).gap(7).items_center().rounded_t(14).rounded_b(4)
      .bg(lit ? L.lamp : L.unlit).border_t(1).border_color(lit ? L.lampHi : alpha(L.cream, 0.12))
      .text_size(12.5).text_color(text)
      .child(div().flex_none().font_family(SERIF).text_size(15).text_color(lit ? alpha(L.ink, 0.6) : L.dim).child(String(c.index)))
      .when(Boolean(program?.icon), (el) => el.child(programIcon(program, 14, text, svg, image)))
      .child(div().max_w(170).truncate().when(lit, (el) => el.font_medium()).child(c.zoomed ? `${name} ·zoomed` : name))
      .when(c.status === "working", (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(lit ? L.ink : L.t.working).spin(900)))
      .when(c.status === "blocked" || c.status === "done", (el) =>
        el.child(div().size(7).flex_none().rounded(4).bg(L.t[c.status]).when(lit, (d) => d.border(1).border_color(L.ink))))
      .when(lit, (el) => el.child(div().id(`close-${c.id}`).size(16).flex().items_center().justify_center().rounded(8)
        .text_color(alpha(L.ink, 0.55)).hover((s) => s.bg(alpha(L.ink, 0.16)).text_color(L.ink))
        .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); })
        .child(svg(`${ICON}/x.svg`).size(10))));
    return v_flex().id(`tab-${c.id}`).relative().flex_none().h_full().items_center().cursor_pointer()
      .hover((s) => s.opacity(lit ? 1 : 0.82))
      .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
      .on_mouse_up("left", () => {
        const from = this.pressed;
        this.pressed = null;
        if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: i + 1 });
        else run("tab.select", { id: c.id });
      })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openMenu("tab", { id: c.id, space: space.id }); })
      // The lit lamp's light on the beam around it.
      .when(lit, (el) => el.child(image(`${ICON}/glow.svg`).absolute().top(0).left(0).size_full()))
      // Its cord and brass cap.
      .child(div().w(2).h(10).flex_none().bg("#0a0503"))
      .child(div().w(12).h(5).flex_none().rounded_t(3).bg(lit ? L.brass : alpha(L.brass, 0.45)))
      .child(div().px(7).child(shade))
      // The bulb's light in the shade's mouth.
      .child(div().h(3).w(lit ? 44 : 0).flex_none().rounded_b(3).bg(L.lampHi));
  }

  knob(L, id, tip, content, action) {
    return h_flex().id(id).h(26).px(8).gap(6).flex_none().items_center().rounded(6).cursor_pointer().text_size(12)
      .bg("#00000040").border(1).border_color(alpha(L.cream, 0.1))
      .text_color(L.muted).hover((s) => s.text_color(L.cream).bg(alpha(L.cream, 0.1)))
      .tooltip(tip).on_mouse_down("left", stop).on_click(action).children(content);
  }

  render() {
    this.navigation?.observe();
    const L = look();
    const space = spaces().find((s) => s.active);
    const shown = space?.tabs ?? [];
    const active = shown.findIndex((c) => c.active);
    if (shown[active]?.id !== this.selected) {
      this.selected = shown[active]?.id;
      if (active >= 0) this.scroll.scroll_to_item(active);
    }
    const w = window();
    return h_flex().id("beam").size_full().min_w(0).pl(14).pr(12).gap(10).items_center()
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel((e) => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(div().id("menu-card").flex_none().h(27).px(11).flex().items_center().rounded(3).cursor_pointer()
        .bg(L.paper).border_b(2).border_color(L.paperEdge).hover((s) => s.bg("#fbf1d9"))
        .font_family(SERIF).italic().text_size(18).text_color(L.ink)
        .tooltip("The menu").on_mouse_down("left", stop).on_click(() => openMenu("main"))
        .child("Menu"))
      .child(h_flex().id("lamps").flex_1().min_w(0).h_full().items_start().overflow_x_scroll().track_scroll(this.scroll)
        .children(shown.map((c, i) => this.lamp(L, c, i, shown, space))))
      .child(this.knob(L, "tab-new", "A new tab", [svg(`${ICON}/plus.svg`).size(13)], () => openMenu("new", null, { brews: this.brews })))
      .child(this.knob(L, "find", "Find a space, tab or agent", [svg("mods/workspace-chrome/search.svg").size(13)], () => run("mod.open", { name: "picker" })))
      .when(Boolean(w?.buttons), (el) => el
        .child(this.knob(L, "win-min", "Minimize", ["−"], () => run("window.minimize")))
        .child(this.knob(L, "win-max", "Maximize", ["□"], () => run("window.maximize")))
        .child(this.knob(L, "win-close", "Close", [svg(`${ICON}/x.svg`).size(12)], () => run("window.close"))));
  }
}
