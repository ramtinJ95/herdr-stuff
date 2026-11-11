// The menu card: a paper menu, commands as dishes with their keys where the
// prices go. One card for everything: the whole menu (kind "main"), a new
// tab's choices ("new": a terminal, or any agent installed here), and the
// right-click menus of a space, a tab and a pane. openMenu(kind, target)
// opens it at the pointer; a click on a line orders it.

import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, run, openOverlay, closeOverlay, spaces, panes } from "herdr";
import { look, alpha, keyFor, programIcon, SERIF } from "./look.js";

// The whole menu's size is also mod.json's overlay (what mod.open opens):
// 560 x height(card("main")). Change them together.
const ROW = 27;
const HEAD = 30;
const TOP = 58;
const PAD = 18;

const item = (label, command, args = {}, key = command) => ({ label, key: keyFor(key), act: () => run(command, args) });

// What each card lists: columns of sections of lines.
function card(kind, target, extra) {
  if (kind === "space") {
    const s = spaces().find((x) => x.id === target.id);
    return { title: s?.name ?? "Space", columns: [[{ items: [
      item("Rename", "space.rename", { id: target.id }),
      item("A new tab here", "tab.new", { space: target.id }),
      item("Close", "space.close", { id: target.id }),
    ] }]] };
  }
  if (kind === "tab") {
    const tabs = spaces().find((x) => x.id === target.space)?.tabs ?? [];
    const at = tabs.findIndex((c) => c.id === target.id);
    return { title: "This tab", columns: [[{ items: [
      item("Rename", "tab.rename", { id: target.id }),
      ...(at > 0 ? [item("Move left", "tab.move", { id: target.id, index: at }, "")] : []),
      ...(at >= 0 && at < tabs.length - 1 ? [item("Move right", "tab.move", { id: target.id, index: at + 2 }, "")] : []),
      item("Close", "tab.close", { id: target.id }),
    ] }]] };
  }
  if (kind === "pane") {
    const p = panes().find((x) => x.pane === target.pane);
    return { title: "This pane", columns: [[{ items: [
      item("Split right", "pane.split", { direction: "right", pane: target.pane }, "pane.split:right"),
      item("Split down", "pane.split", { direction: "down", pane: target.pane }, "pane.split:down"),
      item(p?.zoomed ? "Unzoom" : "Zoom", "pane.zoom", { pane: target.pane }),
      item("Close", "pane.close", { pane: target.pane }),
    ] }]] };
  }
  if (kind === "new") {
    return { title: "A new tab", columns: [[{ items: [
      { ...item("Terminal", "tab.new"), icon: null },
      ...(extra?.brews ?? []).map((a) => ({ label: a.name, key: "", program: a, act: () => run("tab.new", { argv: a.run }) })),
    ] }]] };
  }
  return { title: "Menu", columns: [
    [
      { title: "Tabs", items: [
        item("A new tab", "tab.new"),
        item("Rename", "tab.rename"),
        item("Next", "tab.next"),
        item("Close", "tab.close"),
      ] },
      { title: "The window", items: [
        item("Split right", "pane.split", { direction: "right" }, "pane.split:right"),
        item("Split down", "pane.split", { direction: "down" }, "pane.split:down"),
        item("Zoom", "pane.zoom"),
        item("Close pane", "pane.close"),
      ] },
    ],
    [
      { title: "The shelf", items: [
        item("A new space", "space.new"),
        item("Rename space", "space.rename"),
        item("Find anything", "mod.open", { name: "picker" }, "mod.open:picker"),
      ] },
      { title: "The house", items: [
        item("Every command", "app.palette"),
        item("Shortcuts", "app.help"),
        item("Settings", "app.settings"),
        item("Another layout", "layout.switch"),
      ] },
    ],
  ] };
}

const height = (c) => TOP + 2 * PAD + Math.max(...c.columns.map((col) =>
  col.reduce((h, sec) => h + (sec.title ? HEAD : 0) + sec.items.length * ROW, (col.length - 1) * 10)));

/** Opens the card of `kind` for `target` (a space, tab or pane), at the pointer unless `at`. */
export function openMenu(kind, target = null, { at, brews } = {}) {
  const c = card(kind, target, { brews });
  return openOverlay({ mod: "cosy", kind: "popup", frame: "none", at,
    width: c.columns.length > 1 ? 560 : 264, height: height(c),
    props: { role: "menu", kind, target, brews: brews ?? null } });
}

export default class Menu {
  line(L, it, id) {
    return h_flex().id(id).h(ROW).px(6).gap(7).items_center().rounded(4).cursor_pointer()
      .hover((s) => s.bg(alpha(L.ink, 0.09)))
      .on_click(() => { closeOverlay(props().overlay); it.act(); })
      .when(Boolean(it.program?.icon), (el) => el.child(programIcon(it.program, 15, L.ink, svg, image)))
      .child(div().flex_none().max_w(190).truncate().font_family(SERIF).text_size(19).line_height("22px").text_color(L.ink).child(it.label))
      // The dotted leader to the price.
      .child(div().flex_1().min_w(8).h(9).border_b(1).border_dashed().border_color(alpha(L.ink, 0.3)))
      .when(Boolean(it.key), (el) => el.child(div().flex_none().text_size(10.5).text_color(L.inkDim).child(it.key)));
  }

  render() {
    const pr = props() ?? {};
    // No kind: opened by mod.open (the menu's key), which is the whole menu.
    return this.sheet(look(), card(pr.kind ?? "main", pr.target, { brews: pr.brews }));
  }

  sheet(L, c) {
    return v_flex().id("menu").size_full().p(PAD).rounded(6).bg(L.paper).border(1).border_color(L.paperEdge).shadow_lg()
      .child(v_flex().h(TOP).flex_none().items_center()
        .child(div().max_w(220).truncate().font_family(SERIF).italic().text_size(30).line_height("34px").text_color(L.ink).child(c.title))
        // A double rule under the title, as on a printed menu.
        .child(div().mt(6).w_full().h(3).border_t(1).border_b(1).border_color(alpha(L.ink, 0.45))))
      .child(h_flex().flex_1().min_h(0).gap(26).items_start()
        .children(c.columns.map((col, ci) => v_flex().flex_1().min_w(0).gap(10)
          .children(col.map((sec, si) => v_flex()
            .when(Boolean(sec.title), (el) => el.child(div().h(HEAD).px(6).flex().items_center()
              .text_size(10).font_semibold().text_color(L.inkDim).child(sec.title.toUpperCase())))
            .children(sec.items.map((it, i) => this.line(L, it, `line-${ci}-${si}-${i}`))))))));
  }
}
