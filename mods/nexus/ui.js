// The panel's small parts, drawn from the theme so it follows light and dark.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";

export function kit(t) {
  const button = (id, text, action, look = {}) => h_flex().id(id).h(26).px(10).items_center().rounded(6).flex_none()
    .border_1().border_color(look.primary ? t.solid : look.danger ? t.blocked : t.input)
    .bg(look.primary ? t.solid : t.raised)
    .text_color(look.primary ? t.solid_foreground : look.danger ? t.blocked : t.foreground).text_size(12)
    .when(!look.disabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => action(cx)))
    .when(Boolean(look.disabled), (el) => el.opacity(0.45))
    .child(text);
  const chip = (id, text, on, action) => h_flex().id(id).min_h(26).px(10).py(3).items_center().rounded(13).cursor_pointer()
    .border_1().border_color(on ? t.accent : t.input).bg(on ? t.selected : t.surface)
    .text_size(12).text_color(on ? t.foreground : t.muted).on_click((_e, cx) => { action(cx); cx.notify(); }).child(text);
  const tone = (attention) => ({ failed: t.blocked, decision: t.blocked, parked: t.blocked, limited: t.ansi3, reply: t.done, working: t.working, waiting: t.accent })[attention] ?? t.idle;
  const dot = (color) => div().size(8).rounded(4).flex_none().bg(color);
  const heading = (text) => div().pt(12).pb(4).text_size(11).font_semibold().text_color(t.dim).child(text.toUpperCase());
  const empty = (text) => div().py(12).text_size(12.5).text_color(t.muted).child(text);
  const line = (text, color = t.muted) => div().pt(4).text_size(12).text_color(color).child(text);
  const card = (id, color = t.border) => div().id(id).mt(8).p(10).rounded(8).border_1().border_color(color).bg(t.raised);
  const row = (...children) => h_flex().gap(6).items_center().flex_wrap().children(children.filter((c) => c !== null));
  return { t, button, chip, tone, dot, heading, empty, line, card, row };
}
