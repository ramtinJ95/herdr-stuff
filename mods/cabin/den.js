// The den: every agent is a pet on the rug by the fire, laid out like desktop
// icons. Its species is its program (Claude a fox, Pi a cat, ...), its fur and
// name its own, its scarf its status color, and it acts the status out:
// napping (idle), busy (working), hopping with a ! (needs you), a pleased ✓
// (done). Under it: its name, what it's on, and the status in words.
// Click: go to that agent. Right-click: Herdr's pane menu.

import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, terminals, spaces, run, openOverlay, setAgentOrder } from "herdr";
import { palette, alpha, mix, MOOD } from "./palette.js";
import { pet } from "./pixel.js";
import { petName } from "./pets.js";
import { PIXEL, px8, beat } from "./kit.js";
import { narrow, duration, RANK, task } from "./util.js";

// The agent's task when it tells something, else its tab's own name, else
// what it is and where.
export function label(a) {
  const tab = spaces().flatMap((s) => s.tabs).find((c) => c.id === a.tab);
  return task(a) ?? (tab?.named ? tab.name : `${a.program?.name ?? "agent"} in ${a.space_name}`);
}

// The weave's art size (rug/gen.mjs): the den at its widest, a tall window.
const RUG_W = 480;
const RUG_H = 1200;

export default class Den {
  init(_props, cx) {
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    cx.timer.every(30000, (cx) => cx.notify());
    this.t = 0;
    beat(cx, 1 / 2, (t) => { if (this.gone) return false; this.t = t; });
  }

  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  menu(a) {
    openOverlay({ mod: "menu", kind: "popup", width: 220, height: 260, props: { tab: "pane", target: { pane: a.pane, terminal: a.address } } });
  }

  icon(p, a, kids, now) {
    const t = p.t;
    const mood = MOOD[a.status] ?? MOOD.idle;
    const since = this.changed[a.address]?.at;
    const when = since ? duration(now - since) : "";
    const name = petName(a.address);
    return v_flex()
      .id(`den-${a.address}`)
      .w(104)
      .flex_none()
      .py(4)
      .gap(2)
      .items_center()
      .cursor_pointer()
      .tooltip(`${name} · ${a.program?.name ?? a.app ?? "agent"}\n${label(a)}`)
      .hover((s) => s.bg(alpha(p.fire, 0.08)))
      .on_click(() => run("agent.focus", { terminal: a.address }))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu(a); })
      .child(pet(p, { status: a.status, address: a.address }, { px: 3, t: this.t, id: `den-pet-${a.address}` }))
      // The name tag; the agent you're on has it lit, like a selected icon.
      .child(div().px(4).py(1).bg(a.focused ? p.fire : alpha(p.ink, 0.55))
        .child(px8(name.toUpperCase(), a.focused ? p.ink : p.paper)))
      .child(div().w_full().px(2).text_center().truncate().text_size(10.5).text_color(mix(p.fg, p.muted, 0.35)).child(label(a)))
      .child(h_flex().gap(4).text_size(10).items_center()
        .child(div().text_color(mood.color(t)).when(a.status === "blocked", (d) => d.font_semibold()).child(mood.word))
        .when(Boolean(when), (el) => el.child(div().text_color(p.dim).child(when)))
        .when(kids > 0, (el) => el.child(div().text_color(p.dim).child(`+${kids}`))));
  }

  render() {
    const p = palette();
    const rail = narrow();
    const now = Date.now();
    const list = agents();
    this.track(list, now);
    const all = terminals();
    const kids = (addr) => all.filter((k) => k.parent === addr && k.state === "live").length;
    const sorted = [...list].sort((x, y) =>
      (y.pinned - x.pinned) || (RANK[y.status] ?? 0) - (RANK[x.status] ?? 0) || x.seq - y.seq);
    // Told only when it changes: the den redraws on every beat.
    const order = sorted.map((a) => a.address).join();
    if (order !== this.order) { this.order = order; setAgentOrder(sorted.map((a) => a.address)); }

    // The kilim's wools, from the fire's colors and the theme's.
    const wool = mix(p.ember, p.fire, 0.35);
    const rugEdge = mix(wool, p.wall, 0.45);
    const rugBand = mix(wool, p.wall, 0.62);
    const rugFace = mix(wool, p.wall, 0.8);
    const thread = mix(p.fire, p.flame, 0.4);
    const cream = mix(p.paper, wool, 0.25);
    const pets = sorted.length === 0
      ? v_flex().flex_1().items_center().justify_center().gap(8).px(12)
          .child(pet(p, { species: "cat", status: "idle", address: "den-empty" }, { px: 3, t: this.t, id: "den-empty" }))
          .when(!rail, (el) => el.child(div().text_center().text_size(11).text_color(p.muted).child("The rug is empty. Start an agent from the + by the tickets and it curls up here.")))
      : rail
        ? v_flex().id("den-list").flex_1().min_h(0).gap(4).py(4).items_center().overflow_y_scrollbar()
            .children(sorted.map((a) => div().id(`den-r-${a.address}`).cursor_pointer()
              .when(a.focused, (el) => el.bg(alpha(p.fire, 0.2)))
              .tooltip(`${petName(a.address)}: ${label(a)} · ${(MOOD[a.status] ?? MOOD.idle).word}`)
              .on_click(() => run("agent.focus", { terminal: a.address }))
              .child(pet(p, { status: a.status, address: a.address }, { px: 2, bubble: a.status !== "idle", t: this.t, id: `den-rp-${a.address}` }))))
        : h_flex().id("den-list").flex_1().min_h(0).flex_wrap().content_start().justify_center().gap(2).py(6).overflow_y_scrollbar()
            .children(sorted.map((a) => this.icon(p, a, kids(a.address), now)));

    // A woven kilim: fringe at both ends; a zigzag band across them and
    // diamonds down the sides, on a darker border; a lattice over the field.
    // The weave is one-color art (rug/*.svg, from rug/gen.mjs), tinted here.
    const weave = (name, color, w, h) => svg(`mods/cabin/rug/${name}.svg`).absolute().top(0).left(0).w(w).h(h).text_color(color);
    const strip = (el) => el.absolute().overflow_hidden();
    const fringe = (name) => div().relative().flex_none().h(6).mx(8).overflow_hidden().child(weave(name, cream, RUG_W, 6));
    const B = rail ? 4 : 14;
    const body = v_flex().relative().flex_1().min_h(0).bg(rugEdge).p(B)
      .when(!rail, (el) => el
        .child(div().absolute().top(2).left(2).right(2).bottom(2).bg(rugBand))
        .child(strip(div()).top(2).left(2).right(2).h(10).child(weave("zig", thread, RUG_W, 10)))
        .child(strip(div()).bottom(2).left(2).right(2).h(10).child(weave("zig", thread, RUG_W, 10)))
        .child(strip(div()).top(14).bottom(14).left(2).w(10).child(weave("col", cream, 10, RUG_H)))
        .child(strip(div()).top(14).bottom(14).right(2).w(10).child(weave("col", cream, 10, RUG_H))))
      .child(v_flex().relative().flex_1().min_h(0).bg(rugFace).overflow_hidden()
        // The lattice is an image, not a tinted svg(): big svg()s redraw every frame.
        .when(!rail, (el) => el.child(image("mods/cabin/rug/lattice.svg").absolute().top(0).left(0).w(RUG_W).h(RUG_H).opacity(0.13)))
        .child(pets));
    const rug = v_flex().flex_1().min_h(0)
      .when(!rail, (el) => el.child(fringe("fringe-up")))
      .child(body)
      .when(!rail, (el) => el.child(fringe("fringe")));
    return div().relative().size_full().overflow_hidden()
      .child(v_flex().absolute().top(0).left(0).size_full().px(rail ? 2 : 10).pb(10).pt(4).gap(4)
        .child(h_flex().h(22).items_center().justify_center()
          .child(px8(rail ? "DEN" : "THE DEN", alpha(p.paper, 0.85), rail ? 8 : 16)))
        .child(rug));
  }
}
