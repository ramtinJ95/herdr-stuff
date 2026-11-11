// Cosy café: the whole window is one evening at a café by the window, this
// one mod in roles. The cosy layout (layouts/cosy.json) and the overlays
// give each copy props { role }:
//   shelf   the bookshelf: spaces as a stack of books, agents as cups
//           under them, steaming while they work
//   lights  the string of fairy lights down the shelf's post
//   tabs    the beam: tabs as pendant lamps, the lit one is shown
//   pane    the light on a pane: a veil on the ones you aren't in (the
//           layout's pane header, a hairline)
//   menu    the menu card: commands with their keys as prices (a popup;
//           also what mod.open shows, per mod.json)
//   ask     a question on a card: a name to write in, or a yes
//           before a space is closed (a dialog)
//   find    a list to pick from, on a card: the agents, this space's tabs,
//           the looks (a dialog)
//   toast   a note left on the table (the layout's "toast": no role prop)

import { View, div } from "gpui-kit";
import { props } from "herdr";
import Shelf from "./shelf.js";
import Lights from "./lights.js";
import Tabs from "./tabs.js";
import Pane from "./pane.js";
import Menu from "./menu.js";
import Toast from "./toast.js";
import Ask from "./ask.js";
import Find from "./find.js";

const ROLES = { shelf: Shelf, lights: Lights, tabs: Tabs, pane: Pane, menu: Menu, toast: Toast, ask: Ask, find: Find };

// Two copies come without a role: Herdr opens the layout's toast mod with the
// notification as props, and mod.open (the menu's key) opens the mod as the
// overlay mod.json describes, which is the menu card.
const roleOf = (pr) => pr.role ?? (pr.overlay ? ("title" in pr ? "toast" : "menu") : undefined);

export default class Cosy extends View {
  init(p, cx) {
    const pr = props() ?? p ?? {};
    const R = ROLES[roleOf(pr)];
    this.role = R ? new R() : null;
    this.role?.init?.(pr, cx);
  }

  render(cx) {
    if (!this.role) return div().child(`cosy: no role "${props()?.role}"`);
    return this.role.render(cx);
  }
}
