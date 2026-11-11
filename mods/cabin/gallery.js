// Every species in every fur and status, for drawing and checking the pets
// against a theme. Open it as a pane:
//   herdr-app do pane.split --direction right --mod cabin --props '{"role":"gallery"}'

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { palette } from "./palette.js";
import { pet } from "./pixel.js";
import { ALL_SPECIES, species } from "./pets.js";
import { cafeWindow, fireplace } from "./scene.js";

const STATUSES = ["idle", "working", "blocked", "done"];

export default class Gallery {
  init() {}

  render() {
    const p = palette();
    const rows = ALL_SPECIES.flatMap((name) => species(name).body.map((fur) =>
      h_flex().gap(14).items_end()
        .child(div().w(110).text_size(11).text_color(p.muted).child(`${name} · ${fur}`))
        .children(STATUSES.map((status) => pet(p, { species: name, fur, status, address: `${name}-${fur}-${status}` }, { px: 3, id: `g-${name}-${fur}-${status}` })))));
    return v_flex().id("gallery").size_full().p(16).gap(10).bg(p.wood).overflow_y_scrollbar()
      .child(h_flex().gap(16).items_end().child(cafeWindow(p)).child(fireplace(p)))
      .child(h_flex().gap(14).child(div().w(110)).children(STATUSES.map((s) => div().w(72).text_size(11).text_color(p.dim).child(s))))
      .children(rows);
  }
}
