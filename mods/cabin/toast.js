// The café shows no notifications: the den, the board and the counter already
// say what agents are up to (and Herdr plays its sounds). The layout root's
// "toast": "cabin" sends every notify() here, Herdr's own included, so the
// shipped toast never pops up either; each one closes as it opens.

import { div } from "gpui-kit";
import { props, closeOverlay } from "herdr";

export default class Toast {
  init() {
    closeOverlay(props()?.overlay);
  }

  render() {
    return div();
  }
}
