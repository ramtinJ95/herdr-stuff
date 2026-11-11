// The menu board (the counter's MENU): every everyday command, chalked up in
// sections, each with its key where one is bound. ↑/↓ move, Enter orders,
// Esc closes. Items: [label, action, command (for its key), stay open?]. Opened as a popup with props { role: "menu", overlay }.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, closeOverlay, run, openOverlay, spaces, keys, window } from "herdr";
import { palette, alpha } from "./palette.js";
import { bevel, px8, motion, cycleMotion } from "./kit.js";
import { toggleSidebar } from "./util.js";

function items() {
  const space = spaces().find((s) => s.active);
  const tab = space?.tabs.find((c) => c.active);
  const panel = (child) => () => { run("layout.select", { stack: "panel-body", child }); run("layout.show", { id: "panel" }); };
  const [name, fps] = motion();
  return [
    ["ORDERS", [
      ["New tab or agent", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }), "tab.new"],
      ["Rename this tab", () => run("tab.rename", { id: tab?.id }), "tab.rename"],
      ["Close this tab", () => run("tab.close", { id: tab?.id }), "tab.close"],
    ]],
    ["SPACES", [
      ["New space", () => run("space.new"), "space.new"],
      ["Find a space", () => run("mod.open", { name: "picker" })],
      ["Rename this space", () => run("space.rename", { id: space?.id }), "space.rename"],
    ]],
    ["THE HOUSE", [
      ["Files", panel("files")],
      ["Changes", panel("changes")],
      ["Fold the wall", toggleSidebar, "layout.toggle"],
      [`Motion: ${name}${fps ? ` (${fps} fps)` : ""}`, cycleMotion, "cabin.motion", true],
      ["Next layout", () => run("layout.switch"), "layout.switch"],
      ["All commands", () => run("app.palette"), "app.palette"],
      ["Settings", () => run("app.settings"), "app.settings"],
    ]],
  ];
}

function keyFor(command) {
  if (!command) return "";
  const b = keys().find((k) => (k.section === "global" || k.section === "layout:cabin") && (k.action === command || k.action.startsWith(command + ":")));
  if (!b) return "";
  const mac = window()?.platform === "macos";
  const mod = { cmd: "⌘", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+" };
  return b.keys.split("-").map((x) => mod[x.toLowerCase()] ?? x.toUpperCase()).join("");
}

export default class Menu {
  init(_props, cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  order([, fn, , stay]) {
    if (!stay) closeOverlay(props().overlay);
    fn();
  }

  render() {
    const p = palette();
    const flat = items().flatMap(([, list]) => list);
    let n = 0;
    const sections = items().map(([title, list]) => v_flex().gap(1)
      .child(div().pt(6).pb(2).child(px8(title, p.fire)))
      .children(list.map((item) => {
        const [label, , command] = item;
        const i = n++;
        const on = i === this.at;
        const key = keyFor(command);
        return h_flex().id(`menu-${i}`).h(24).px(6).gap(6).items_center().cursor_pointer()
          .when(on, (el) => el.bg(alpha(p.chalk, 0.1)))
          .on_hover((h, cx) => { if (h) { this.at = i; cx.notify(); } })
          .on_click(() => this.order(item))
          .child(div().text_size(12.5).text_color(on ? p.chalk : alpha(p.chalk, 0.78)).child(label))
          .child(div().flex_1().h(1).mt(6).bg(alpha(p.chalk, 0.12)))
          .child(div().text_size(10.5).text_color(alpha(p.chalk, 0.45)).child(key || "·"));
      })));
    const board = v_flex().id("menu-board").w_full().flex_1().min_h(0).bg(p.board).px(12).py(8)
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % flat.length;
        else if (e.key === "up") this.at = (this.at - 1 + flat.length) % flat.length;
        else if (e.key === "enter") return this.order(flat[this.at]);
        else if (e.key === "escape") return closeOverlay(props().overlay);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().justify_center().child(px8("~ MENU ~", p.chalk, 16)))
      .children(sections);
    return div().size_full().bg(p.frame)
      .child(bevel(board, { hi: p.frameHi, lo: p.frameLo, w: 3, fill: true }));
  }
}
