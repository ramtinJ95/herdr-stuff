// The counter along the bottom: the beam's twin. Same wood; a dark plate at
// each end (MENU, the house menu, mirrors the sign; the tray mirrors it with
// the agents' news and the clock); the same wooden knobs. Between them the
// tabs, as wooden buttons: raised, or pressed in and lit by the fire when
// shown, like a focused pane's title bar. Each has its key, its program, its
// name and a dot in its agents' status color. Click to show, double-click to
// rename, drag onto another to move, right-click for Herdr's tab menu, wheel
// to step. + is a new tab or agent; then Files and Changes.
//
// This role also keeps the layout's frames in the theme's colors (tailor.js).

import { div, svg, image } from "gpui-kit";
import { h_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, agents, terminals, focused, run, openOverlay, closeOverlay, nextCommand, shared, layout } from "herdr";
import { palette, alpha, textOn } from "./palette.js";
import { PIXEL, bevel, knob, cycleMotion } from "./kit.js";
import { find, stop, tabLabel, keyFor, tally } from "./util.js";
import { tailor } from "./tailor.js";

const clock = () => new Date().toTimeString().slice(0, 5);
const KNOB = 26;

export default class Counter {
  init(_props, cx) {
    // Ctrl-f navigation: the tab bar hosts it, as in the main layouts.
    // tabs / agents open the navigation mod's launcher; back needs its focus
    // history (model.js, copied beside this mod by dev-sync.sh).
    cx.spawn(async (cx) => {
      let model = null;
      try {
        model = await import("./navigation/model.js");
      } catch (e) {
        console.error("cabin: ctrl-f tab (back) needs navigation/model.js beside this mod:", e);
      }
      this.history = model ? new model.FocusHistory() : null;
      this.nav = model;
      for (;;) {
        const command = await nextCommand();
        this.observe();
        if (command === "tabs" || command === "agents") {
          if (this.navOverlay) closeOverlay(this.navOverlay);
          this.navOverlay = openOverlay({ mod: "navigation", kind: "dialog", width: 720, height: 560, props: { kind: command, space: focused()?.space } });
        } else if (command === "motion") {
          cycleMotion();
        } else if (command === "back") {
          const target = this.history?.previous(this.target(), (t) => this.nav.targetAlive(t, panes(), terminals()));
          if (this.navOverlay) closeOverlay(this.navOverlay);
          if (target) run(target.action.command, target.action.args);
        }
        cx.notify();
      }
    });
    this.pressed = null;
    this.scroll = ScrollHandle.new();
    this.memo = {};
    cx.timer.after(60000 - (Date.now() % 60000) + 50, (cx) => {
      cx.notify();
      cx.timer.every(60000, (cx) => cx.notify());
    });
  }

  target() { return this.nav?.focusTarget(focused(), panes(), agents(), terminals()); }
  observe() { if (this.history) this.history.observe(this.target()); }

  tab(p, space, shown, c, i) {
    const t = p.t;
    const program = panes().find((x) => x.tab === c.id && x.program?.agent)?.program ?? panes().find((x) => x.tab === c.id)?.program;
    const name = tabLabel(c);
    const on = c.active;
    const face = on ? p.frameLit : p.frame;
    const ink = textOn(p, face);
    const key = keyFor(`tab.select:${c.index}`);
    const dot = c.status && c.status !== "idle" ? t[c.status] : null;
    const button = h_flex()
      .flex_1()
      .min_w(0)
      .h(26)
      .pl(6)
      .pr(8)
      .gap(7)
      .items_center()
      .bg(face)
      .when(on, (el) => el.border_b(2).border_color(p.fire))
      .when(Boolean(key), (el) => el.child(keycap(key.split(" ").pop(), ink)))
      .when(Boolean(program?.icon), (el) => el.child(program.tint ? svg(program.icon).size(13).flex_none().text_color(ink) : image(program.icon).size(13).flex_none()))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(on ? ink : alpha(ink, 0.8)).when(on, (d) => d.font_semibold())
        .child(c.zoomed ? `${name} ⤢` : name))
      .when(Boolean(dot), (el) => el.child(div().flex_none().size(8).rounded_full().bg(dot).border(1).border_color(alpha(p.ink, 0.5))))
      .when(on, (el) => el.child(div().id(`tab-x-${c.id}`).flex_none().text_color(alpha(ink, 0.55)).hover((s) => s.text_color(ink))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); })
        .child(svg("mods/pane/close.svg").size(11))));
    return div()
      .id(`tab-${c.id}`)
      .flex()
      .flex_shrink_1()
      .min_w(84)
      .max_w(196)
      .cursor_pointer()
      .tooltip(key ? `${name} · ${key}` : name)
      .hover((s) => s.opacity(on ? 1 : 0.88))
      .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
      .on_mouse_up("left", () => {
        const from = this.pressed;
        this.pressed = null;
        if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex((x) => x.id === c.id) + 1 });
        else run("tab.select", { id: c.id });
      })
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } });
      })
      .child(bevel(button, { hi: p.frameHi, lo: p.frameLo, w: 2, pressed: on, shrink: true }).flex_1());
  }

  tray(p) {
    const t = p.t;
    const list = agents();
    const news = tally(list);
    const inner = h_flex().h(26).px(10).gap(10).items_center().bg(p.ink)
      .when(news.length === 0, (el) => el.child(div().text_size(11.5).text_color(alpha(p.paper, 0.55)).child(list.length ? "all napping" : "no agents")))
      .children(news.map((x) => h_flex().gap(5).items_center()
        .child(div().size(7).rounded_full().bg(t[x.status]))
        .child(div().text_size(11.5).text_color(x.status === "blocked" ? t.blocked : alpha(p.paper, 0.75)).child(x.text))))
      .child(div().w(1).h(14).bg(alpha(p.paper, 0.2)))
      .child(div().font_family(PIXEL).text_size(16).line_height(`${18}px`).text_color(p.paper).child(clock()));
    return bevel(inner, { hi: p.frameHi, lo: p.frameLo, w: 2, pressed: true });
  }

  panelKnobs(p) {
    const root = layout();
    const panel = find(root, "panel");
    const body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    const panelKnob = (id, icon, tip) => {
      const on = Boolean(panel && !panel.hidden && body?.active === id);
      return knob(p, `tray-${id}`, icon, () => {
        if (on) run("layout.hide", { id: "panel" });
        else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
      }, { tip, size: KNOB, lit: on });
    };
    return [["files", "mods/files/file.svg", "Files"], ["changes", "mods/changes/changes.svg", "Changes"]]
      .filter(([id]) => enabled.includes(id)).map(([id, icon, tip]) => panelKnob(id, icon, tip));
  }

  render(cx) {
    const p = palette();
    tailor(p, this.memo, cx);
    this.observe();
    const space = spaces().find((s) => s.active);
    const shown = (space?.tabs ?? []).filter((c) => !c.settled || c.active);
    const active = shown.findIndex((c) => c.active);
    if (shown[active]?.id !== this.selected) {
      this.selected = shown[active]?.id;
      if (active >= 0) this.scroll.scroll_to_item(active);
    }
    const menu = div().id("menu-button").flex_none().cursor_pointer().tooltip("Menu: every command")
      .hover((s) => s.opacity(0.88))
      .on_mouse_down("left", stop)
      .on_click(() => openOverlay({ mod: "cabin", kind: "popup", width: 260, height: 495, props: { role: "menu" } }))
      .child(bevel(h_flex().h(26).px(10).gap(7).items_center().bg(p.ink)
        .child(svg("mods/cabin/mug.svg").size(15).text_color(p.fire))
        .child(div().font_family(PIXEL).text_size(16).line_height(`${18}px`).text_color(p.paper).child("MENU")), { hi: p.frameHi, lo: p.frameLo, w: 2 }));
    const add = knob(p, "tab-new", "mods/workspace-chrome/plus.svg",
      () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }), { tip: "New tab or agent", size: KNOB });
    return h_flex()
      .id("counter")
      .relative()
      .size_full()
      .min_w(0)
      .px(10)
      .gap(10)
      .items_center()
      .bg(p.frame)
      .border_t(2)
      .border_color(p.frameLo)
      .on_mouse_up("left", () => { this.pressed = null; })
      .child(menu)
      .child(h_flex().id("tab-row").flex_1().min_w(0).h_full().gap(6).items_center()
        .overflow_x_scrollbar().track_scroll(this.scroll)
        .on_scroll_wheel((e) => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
        .children(shown.map((c, i) => this.tab(p, space, shown, c, i))))
      .child(h_flex().flex_none().gap(4).items_center().child(add).child(div().w(6)).children(this.panelKnobs(p)))
      .child(this.tray(p));
  }
}

/** A key's last part ("4" of "Ctrl 4") in a small cap, as on the board. */
function keycap(text, ink) {
  return div().flex_none().min_w(16).h(16).px(3).flex().items_center().justify_center()
    .border(1).border_color(alpha(ink, 0.35)).rounded(2)
    .text_size(10.5).font_semibold().text_color(alpha(ink, 0.75)).child(text);
}
