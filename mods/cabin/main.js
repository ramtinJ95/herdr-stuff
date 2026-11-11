// Herdr Café: a winter café by the fire, as one mod in roles. The cabin
// layout gives each block props { role }:
//   beam      the ceiling beam: the sign, where you are, buttons, bunting
//   board     the chalkboard of spaces
//   hearth    the snowy window and the fire
//   den       agents as pets on the rug
//   titlebar  a pane's title bar (the layout's pane header)
//   counter   the counter: MENU, tabs as order tickets, the tray
//   menu      the menu board (a popup the counter opens)
//   toast     swallows every notification (the layout's "toast": no role prop)
//   gallery   every pet in every fur and status (a mod pane, for drawing them)
// Every color comes from the theme (palette.js); tailor.js keeps the
// layout's frames in those colors too.

import { View, div } from "gpui-kit";
import { props } from "herdr";
import Beam from "./beam.js";
import Board from "./board.js";
import Hearth from "./hearth.js";
import Den from "./den.js";
import TitleBar from "./titlebar.js";
import Counter from "./counter.js";
import Menu from "./menu.js";
import Toast from "./toast.js";
import Gallery from "./gallery.js";
import { keepSprites } from "./pixel.js";

const ROLES = { beam: Beam, board: Board, hearth: Hearth, den: Den, titlebar: TitleBar, counter: Counter, menu: Menu, toast: Toast, gallery: Gallery };

// Herdr opens the layout's toast mod with the notification as props, no role.
const roleOf = (pr) => pr.role ?? (pr.overlay && "title" in pr ? "toast" : undefined);

export default class Cabin extends View {
  init(p, cx) {
    keepSprites(cx);
    this.start(props() ?? p ?? {}, cx);
  }

  // A reload keeps this view but not init: a role whose code changed is
  // started again from its new class.
  start(pr, cx) {
    // The old role's beat (kit.beat) sees this and stops.
    if (this.role) this.role.gone = true;
    const R = ROLES[roleOf(pr)];
    this.role = R ? new R() : null;
    this.role?.init?.(pr, cx);
  }

  render(cx) {
    const pr = props() ?? {};
    if (this.role?.constructor !== ROLES[roleOf(pr)]) this.start(pr, cx);
    if (!this.role) return div().child(`cabin: no role "${pr.role}"`);
    return this.role.render(cx);
  }
}
