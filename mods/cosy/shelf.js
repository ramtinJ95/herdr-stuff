// The bookshelf (the sidebar): ivy over the top shelf, the spaces as a stack
// of books, the agents as cups under them (cups.js), and at its foot the
// table with the bun and the lamp. Click a book: go to that space;
// right-click: its menu.

import { div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, run } from "herdr";
import { look, serif, mix, alpha, hash, stop, ART, ICON, SERIF } from "./look.js";
import { openMenu } from "./menu.js";
import Cups from "./cups.js";

// Cloth covers, from the books in the painting.
const COVERS = ["#34466d", "#7b3b36", "#5d6339", "#8f6238", "#3f6168", "#5f4763", "#4a5c86", "#6e4a33"];
const BOOK = 44;
// The art cards' heights, as shares of the shelf's width (art/make.sh).
const IVY = 0.7;
const TABLE = 460 / 600;
const SHELVES = 1860 / 600;

export default class Shelf {
  init(_p, cx) {
    this.width = 298;
    this.height = 900;
    this.cups = new Cups();
    this.cups.init(cx);
  }

  book(L, s, full) {
    const h = hash(s.id);
    const base = COVERS[h % COVERS.length];
    const cover = s.active ? mix(base, "#ffffff", 0.05) : mix(base, "#120c08", 0.35);
    const dark = mix(cover, "#000000", 0.4);
    const gilt = alpha(L.gilt, s.active ? 0.9 : 0.5);
    // Books in a stack never line up: each has its own width and sits a
    // little in or out. The open space's book is pulled out, full width.
    const w = s.active ? full : full - 14 - (h % 4) * 7;
    const inset = s.active ? 0 : 4 + ((h >> 4) % 3) * 4;
    const lines = () => [div().w(2).h_full().flex_none().bg(gilt), div().w(1).h_full().flex_none().ml(2).bg(gilt)];
    const meta = s.branch ?? (s.tabs.length === 1 ? "1 tab" : `${s.tabs.length} tabs`);
    return v_flex().id(`book-${s.id}`).relative().flex_none().w(w).ml(inset).cursor_pointer()
      .hover((st) => st.opacity(0.9))
      .on_click(() => run("space.select", { id: s.id }))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openMenu("space", { id: s.id }); })
      .child(h_flex().h(BOOK).rounded(4).bg(cover).border_t(1).border_color(mix(cover, "#ffffff", 0.16)).items_center()
        .child(div().w(8).h_full().flex_none().rounded_l(4).bg(dark))
        .child(div().w(4).flex_none())
        .children(lines())
        .child(div().flex_1().min_w(0).pl(10).pr(6).truncate().font_family(SERIF).text_size(21).line_height("25px")
          .text_color(s.active ? L.lampHi : alpha(L.gilt, 0.75)).child(s.name))
        .child(div().flex_none().max_w(92).pr(8).truncate().text_size(10).text_color(alpha(L.cream, s.active ? 0.6 : 0.38)).child(meta))
        .children(lines())
        .child(div().w(24).flex_none().flex().justify_center().font_family(SERIF).text_size(15).text_color(gilt).child(String(s.index)))
        .child(div().w(6).h_full().flex_none().rounded_r(4).bg(dark)))
      // The spine's curve: its lower edge in shade.
      .child(div().absolute().left(0).right(0).top(BOOK - 7).h(7).rounded_b(4).bg("#00000030"))
      // The stack's shadow under each book.
      .child(div().h(4).mx(2).rounded_b(3).bg("#00000080"));
  }

  render() {
    const L = look();
    const W = this.width;
    const full = W - 32;
    // The heading sits a book's height up into the plant's shelf, so the
    // stack holds one more book before the cups give up room.
    const top = W * IVY - 62 - (BOOK + 4);
    const all = spaces();
    // A long stack scrolls in under half the shelf, so the cups keep their room.
    const stack = Math.min(all.length * (BOOK + 4) + 8, Math.max(2 * (BOOK + 4) + 8, (this.height - top - 40 - W * TABLE) * 0.45));
    return v_flex().id("shelf").relative().size_full().overflow_hidden()
      .on_size_change((size, cx) => { this.width = size.width; this.height = size.height; cx.notify(); })
      .child(image(`${ART}/shelves.webp`).absolute().top(0).left(0).w(W).h(W * SHELVES).rounded(13))
      .child(image(`${ART}/shelf.webp`).absolute().top(0).left(0).w(W).h(W * IVY))
      .child(div().h(top).flex_none())
      .child(h_flex().flex_none().h(40).pl(18).pr(12).items_center()
        .child(div().flex_1().child(serif("Spaces", 25, L.cream).italic()))
        .child(div().id("new-space").size(24).flex().items_center().justify_center().rounded(12).cursor_pointer()
          .text_color(L.muted).hover((st) => st.bg(alpha(L.cream, 0.1)).text_color(L.cream))
          .tooltip("New space").on_mouse_down("left", stop).on_click(() => run("space.new"))
          .child(svg(`${ICON}/plus.svg`).size(14))))
      .child(v_flex().id("books").flex_none().h(stack).px(16).pt(8).overflow_y_scrollbar()
        .children(all.map((s) => this.book(L, s, full))))
      .child(this.cups.render(L))
      .child(image(`${ART}/table.webp`).flex_none().w(W).h(W * TABLE));
  }
}
