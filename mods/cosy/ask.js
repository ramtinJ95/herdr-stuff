// A question on a card, cut from the menu's stock: a name
// to write in (kind "prompt") or a yes before something ends ("confirm").
// Enter answers, Esc leaves it. The answer runs props.command, a prompt's
// with the written name added.

import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { props, run, openOverlay, closeOverlay } from "herdr";
import { look, alpha, onCard, heading, field, SERIF } from "./look.js";

const open = (kind, height, spec) =>
  openOverlay({ mod: "cosy", kind: "dialog", frame: "none", width: 380, height, props: { role: "ask", kind, ...spec } });

/** Asks for a tab's name ("" when it has none of its own). */
export const askTabName = (tab) => open("prompt", 202, {
  title: "Name this tab", value: tab.named ? tab.name : "", hint: "Empty: called by what runs in it.",
  yes: "Save", command: { name: "tab.rename", args: { id: tab.id } },
});

/** Asks for a space's name. */
export const askSpaceName = (space) => open("prompt", 202, {
  title: "Name this space", value: space.name, hint: "Empty: called after its folder.",
  yes: "Save", command: { name: "space.rename", args: { id: space.id } },
});

/** Asks before a space is closed (Herdr would ask too, in its own dialog). */
export const askSpaceClose = (space) => open("confirm", 178, {
  title: `Close ${space.name}?`,
  detail: space.tabs.length === 1 ? "Its tab and what runs in it end." : `Its ${space.tabs.length} tabs and what runs in them end.`,
  yes: "Close it", command: { name: "space.close", args: { id: space.id, confirmed: true } },
});

export default class Ask {
  init(pr, cx) {
    this.handle = cx.focus_handle();
    if (pr.kind !== "prompt") { this.handle.focus(); return; }
    const text = pr.value ?? "";
    this.input = InputState.new({ value: text });
    if (text) this.input.set_selected_range({ start: 0, end: text.length });
    this.input.on("submit", () => this.yes());
    this.input.focus();
    // The overlay takes the keyboard as it opens; take it back once it has.
    cx.timer.after(600, () => this.input.focus());
  }

  yes() {
    const p = props();
    closeOverlay(p.overlay);
    run(p.command.name, this.input ? { ...p.command.args, name: this.input.value() } : p.command.args);
  }

  button(L, id, label, solid, act) {
    return h_flex().id(id).h(28).px(13).items_center().rounded(4).cursor_pointer()
      .font_family(SERIF).text_size(18).line_height("22px")
      .text_color(solid ? L.card.solidText : L.card.text).bg(solid ? L.card.solid : alpha(L.card.wash, 0))
      .hover((s) => (solid ? s.opacity(0.88) : s.bg(alpha(L.card.wash, 0.08))))
      .on_click(act).child(label);
  }

  render() {
    const L = look();
    const p = props() ?? {};
    const leave = () => closeOverlay(p.overlay);
    return onCard(L, v_flex().id("ask").track_focus(this.handle).size_full().p(18))
      .on_key_down((e, cx) => {
        if (e.key === "escape") leave();
        else if (e.key === "enter" && !this.input) this.yes();
        else return;
        cx.stop_propagation();
      })
      .child(heading(L, p.title ?? "", 26))
      .when(Boolean(this.input), (el) => el.child(field(L, Input.new(this.input)).mt(14)))
      .child(div().flex_1().min_h(0).pt(this.input ? 6 : 14).text_size(this.input ? 11.5 : 13)
        .text_color(this.input ? L.card.dim : L.card.text).child((this.input ? p.hint : p.detail) ?? ""))
      .child(h_flex().flex_none().gap(6).items_center()
        .child(div().flex_1().text_size(10.5).text_color(L.card.dim).child("Esc"))
        .child(this.button(L, "ask-no", "Never mind", false, leave))
        .child(this.button(L, "ask-yes", p.yes ?? "Yes", true, () => this.yes())));
  }
}
