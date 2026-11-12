// The cups under the books: every agent is one. A cup steams while its agent
// works, gets a note leaning on it when the agent needs you, a green mark
// when it finished while you were away, and stands empty while it rests.
// The cups that need you come first. Click: go to that agent; right-click:
// its pane's menu. A cup has its program's mark printed on it, so Pi's cups
// and Claude Code's are told apart at a glance.

import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, run, setAgentOrder } from "herdr";
import { serif, alpha, ago, programIcon, MOOD, URGENCY, ICON } from "./look.js";
import { openMenu } from "./menu.js";

// Chestnut ink, the brown the café's paper is printed in: what a one-color
// mark is printed in on the cream cup (a program's own colors stay as they are).
const INK = "#80502c";

export default class Cups {
  init(cx) {
    // Since when each agent has had its status, kept across restarts.
    this.since = JSON.parse(localStorage.getItem("since") ?? "{}");
    // The ages count up by the minute.
    cx.timer.every(30000, (cx) => cx.notify());
  }

  // Notes status changes, so a cup can say since when it has had its own.
  track(list) {
    let changed = false;
    const live = new Set(list.map((a) => a.address));
    for (const a of list) {
      const was = this.since[a.address];
      if (was?.status === a.status) continue;
      this.since[a.address] = { status: a.status, at: Date.now() };
      changed = true;
    }
    for (const address of Object.keys(this.since)) if (!live.has(address)) { delete this.since[address]; changed = true; }
    if (changed) localStorage.setItem("since", JSON.stringify(this.since));
  }

  steam(L, left, period) {
    return svg(`${ICON}/steam.svg`).absolute().left(left).w(9).h(16).text_color(alpha(L.cream, 0.75))
      .loop("top", { from: 9, to: 1, period })
      .loop("opacity", { from: 0.15, to: 0.85, period });
  }

  cup(L, a) {
    const st = a.status;
    const resting = st === "idle";
    const title = a.title?.replace(/^[^\p{L}\p{N}]+/u, "") || a.program?.name || "agent";
    return h_flex().id(`cup-${a.address}`).flex_none().h(60).pl(4).pr(8).gap(8).items_center().rounded(10).cursor_pointer()
      .when(a.focused, (el) => el.bg("#00000050"))
      .hover((s) => s.bg(a.focused ? "#00000060" : "#00000036"))
      .on_click(() => run("pane.focus", { pane: a.pane }))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openMenu("pane", { pane: a.pane }); })
      .child(div().relative().flex_none().w(50).h(60)
        .when(st === "working", (el) => el.child(this.steam(L, 12, 2600)).child(this.steam(L, 23, 3400)))
        .child(image(`${ICON}/${resting ? "cup-empty" : "cup"}.svg`).absolute().left(0).bottom(2).w(48).h(40).when(resting, (el) => el.opacity(0.7)))
        // The mark, on the cup's front (the cup is drawn 48 x 40, its front around 20, 22).
        .when(Boolean(a.program?.icon), (el) => el.child(programIcon(a.program, 14, INK, svg, image)
          .absolute().left(13).bottom(13).when(resting, (m) => m.opacity(0.7))))
        .when(st === "blocked", (el) => el.child(image(`${ICON}/note.svg`).absolute().left(30).top(12).w(20).h(22)
          .loop("top", { from: 12, to: 8, period: 900 })))
        .when(st === "done", (el) => el.child(image(`${ICON}/ready.svg`).absolute().left(32).top(16).w(17).h(17))))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().truncate().text_size(12.5).when(a.focused, (el) => el.font_medium())
          .text_color(resting && !a.focused ? L.muted : L.cream).child(title))
        .child(div().truncate().text_size(10.5).text_color(L.dim)
          .child(`${a.program?.name ?? a.app ?? "agent"} · ${a.space_name} › ${a.tab_name}`))
        .child(h_flex().gap(5).items_center().text_size(10.5).text_color(L.t[st])
          .child(MOOD[st])
          .child(div().text_color(L.dim).child(`· ${ago(this.since[a.address]?.at ?? Date.now())}`))));
  }

  /** The heading and the cups: takes what height the shelf has left. */
  render(L) {
    const list = agents();
    this.track(list);
    // Most urgent first; within a status, the one that changed last.
    const sorted = [...list].sort((x, y) => URGENCY[y.status] - URGENCY[x.status] || y.seq - x.seq);
    setAgentOrder(sorted.map((a) => a.address));
    const needs = list.filter((a) => a.status === "blocked").length;
    return v_flex().flex_1().min_h(0)
      .child(h_flex().flex_none().h(40).mt(10).pl(18).pr(16).items_center()
        .child(div().flex_1().child(serif("Agents", 25, L.cream).italic()))
        .when(needs > 0, (el) => el.child(div().text_size(11).text_color(L.t.blocked).child(needs === 1 ? "1 needs you" : `${needs} need you`))))
      .child(v_flex().id("cups").flex_1().min_h(0).px(12).pt(4).gap(2).overflow_y_scrollbar()
        .children(sorted.map((a) => this.cup(L, a)))
        .when(list.length === 0, (el) => el.child(div().px(6).text_size(12).text_color(alpha(L.cream, 0.6))
          .child("No cups yet: agents show up here once they report what they're doing."))));
  }
}
