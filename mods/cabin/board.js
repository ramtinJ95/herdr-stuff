// The chalkboard: today's spaces, chalked up in a wooden frame. Each says its
// key, its name, and under it its branch, tabs and what its agents
// are up to. The shown one is boxed; one with an agent at work has steam; one
// that needs you has a ! in the theme's alarm color. Click to go, double-click
// to rename, right-click for Herdr's space menu, "+ new space" at the bottom.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, machines, agents, run, openOverlay } from "herdr";
import { palette, alpha, mix } from "./palette.js";
import { PIXEL, bevel, px8, beat, step } from "./kit.js";
import { narrow, tally, keyFor } from "./util.js";

export default class Board {
  init(_props, cx) {
    this.t = 0;
    // Steam rises from a working space's mark, a step each half second.
    beat(cx, 1 / 4, (t) => { if (this.gone) return false; this.t = t; });
  }

  mark(p, s) {
    const t = p.t;
    if (s.status === "blocked") return div().flex_none().font_family(PIXEL).text_size(16).line_height(`${16}px`).text_color(t.blocked).child("!");
    if (s.status === "working") return div().flex_none().text_size(12).text_color(alpha(p.chalk, 0.6)).child(step(["≈", "∼", "~", " "], this.t, 0.5));
    return null;
  }

  /** "main · 3 tabs · 1 brewing": what's in a space, at a glance. */
  about(p, s) {
    const t = p.t;
    const tabs = s.tabs.filter((c) => !c.settled || c.active).length;
    const parts = [
      ...(s.branch ? [{ text: s.branch }] : []),
      { text: `${tabs} ${tabs === 1 ? "tab" : "tabs"}` },
      ...tally(agents().filter((a) => a.space === s.id)).map((x) => ({ text: x.text, color: x.status === "blocked" ? t.blocked : x.status === "done" ? t.done : null })),
    ];
    return h_flex().min_w(0).gap(5).text_size(11).text_color(alpha(p.chalk, 0.5)).overflow_hidden()
      .children(parts.flatMap((x, k) => [
        ...(k ? [div().flex_none().child("·")] : []),
        div().when(k === 0, (d) => d.min_w(0).truncate()).when(k > 0, (d) => d.flex_none()).when(Boolean(x.color), (d) => d.text_color(x.color)).child(x.text),
      ]));
  }

  row(p, s, i, rail) {
    const on = s.active;
    const mark = this.mark(p, s);
    const bound = keyFor(`space.select:${i + 1}`);
    const key = bound ? bound.split(" ").pop() : null;
    const cap = div().flex_none().w(18).h(18).flex().items_center().justify_center()
      .border(1).border_color(alpha(p.chalk, on ? 0.6 : 0.3)).rounded(3)
      .text_size(11).font_semibold().text_color(alpha(p.chalk, on ? 0.9 : 0.6))
      .child(key ?? "·");
    return h_flex()
      .id(`board-${s.id}`)
      .flex_none()
      .h(rail ? 30 : 42)
      .px(rail ? 0 : 8)
      .gap(8)
      .items_center()
      .when(rail, (el) => el.justify_center())
      .tooltip(bound ? `${s.name} · ${bound}` : s.name)
      .hover((x) => x.bg(alpha(p.chalk, 0.06)))
      .cursor_pointer()
      .on_mouse_down("left", (e, cx) => { if (e.click_count === 2) { cx.stop_propagation(); run("space.rename", { id: s.id }); } })
      .on_click(() => run("space.select", { id: s.id }))
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: s.id } } });
      })
      .child(cap)
      .when(!rail, (el) => el.child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().truncate().text_size(13.5).text_color(on ? p.chalk : alpha(p.chalk, 0.8)).when(on, (d) => d.font_semibold()).child(s.name))
        .child(this.about(p, s))))
      .when(Boolean(mark), (r) => r.child(mark));
  }

  render() {
    const p = palette();
    const rail = narrow();
    const all = spaces();
    const groups = new Map();
    for (const s of all) {
      const m = s.machine ?? null;
      if (!groups.has(m)) groups.set(m, []);
      groups.get(m).push(s);
    }
    const many = groups.size > 1 || machines().some((m) => m.name);
    const list = [];
    let n = 0;
    for (const [m, ss] of groups) {
      if (many && !rail) list.push(div().pt(6).pb(1).px(8).text_size(11).italic().text_color(alpha(p.chalk, 0.5)).child(m ?? "this computer"));
      for (const s of ss) list.push(this.row(p, s, n++, rail));
    }
    const board = v_flex()
      .w_full()
      .bg(p.board)
      .px(rail ? 2 : 6)
      .py(6)
      .gap(2)
      .child(h_flex().pb(4).justify_center()
        .child(px8(rail ? "SP" : "TODAY'S SPACES", p.chalk, rail ? 8 : 16)))
      .child(div().h(1).mx(10).mb(4).bg(alpha(p.chalk, 0.25)))
      .child(v_flex().id("board-list").flex_1().min_h(0).gap(2).overflow_y_scrollbar().children(list))
      .child(h_flex().id("board-new").h(24).flex_none().px(8).gap(6).items_center().cursor_pointer()
        .when(rail, (el) => el.justify_center().tooltip("New space"))
        .text_color(alpha(p.chalk, 0.55)).hover((s) => s.text_color(p.chalk))
        .on_click(() => run("space.new"))
        .child(svg("mods/workspace-chrome/plus.svg").size(12))
        .when(!rail, (el) => el.child(div().text_size(12).child("New space"))))
      // The chalk tray.
      .child(div().h(3).mx(4).mt(2).bg(mix(p.frame, p.chalk, 0.15)));
    return div().relative().size_full().p(rail ? 4 : 12)
      .child(bevel(board.flex_1().min_h(0), { hi: p.frameHi, lo: p.frameLo, w: 4, fill: true }));
  }
}
