// The light on a pane. A pane has no rail of its own: its glass runs up to
// the frame. The lamp is on over the pane you're in, and the others' glass
// gets a veil of dusk. The layout gives this a hairline at the pane's top
// (the pane header, 1 px) to hang the veil from: Herdr clips it to the pane
// and writes the terminal's text over it, undimmed.

import { div } from "gpui-kit";
import { panes, props } from "herdr";

export default class Pane {
  render() {
    const p = panes().find((x) => x.pane === props()?.pane);
    return div().relative().size_full()
      .when(Boolean(p) && !p.focused, (el) => el.child(div().absolute().top_full().left(0).w_full().h(8000).bg("#0e080566")));
  }
}
