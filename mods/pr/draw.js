import { div } from "gpui-kit";
import { Input, Scrollbar, TextView, h_flex, h_resizable, resizable_panel, v_flex, v_virtual_list } from "gpui-base";
import { settings, theme } from "herdr";
import { CUT_COLUMNS, ROLES, cutSpans, rowNumber, wrapSpans } from "./diff.js";
import { duration, hasSteps, plural, summarize } from "./model.js";
import { KINDS, activeAnnotation, askWords, countByPath, stretch, toSend } from "./review.js";
import { aboutLine, ago, blockerWords, currentStep, failureLines, headlineOf, liveShown, reviewerWords, selectedRow, stepLink } from "./view.js";

export const WIDE_PX = 720;
/** The narrowest the list is dragged to beside a diff or a check's steps, in px. */
const LIST_MIN_PX = 160;

const GLYPHS = { pass: "✓", fail: "✕", pending: "●", skipping: "–", cancel: "⊘" };
const waiting = (item) => item.bucket === "pending" && item.startedAt === null;
const glyphOf = (item) => (waiting(item) ? "○" : GLYPHS[item.bucket]);
/** The pane stands on the terminal background, so status ink comes from the terminal palette: a theme may set done or accent for its grey chrome only. */
const toneInk = (t, tone) => ({ working: t.ansi3, blocked: t.ansi1, done: t.ansi2, idle: t.dim }[tone]);
const inkOf = (t, item) => (waiting(item) ? t.dim : { pass: t.ansi2, fail: t.ansi1, pending: t.ansi3, skipping: t.dim, cancel: t.muted }[item.bucket]);
const stateWords = (state) => state.toLowerCase().replaceAll("_", " ");
const short = (sha) => sha.slice(0, 7);
const folder = (cwd) => cwd.split("/").filter(Boolean).at(-1) ?? cwd;
const open = (url) => (_e, cx) => cx.open_url(url);

const dot = (t, tone, look) => div().size(9).rounded(5).flex_none().bg(toneInk(t, tone))
  .when(look === "pulse", (el) => el.loop("opacity", { from: 0.3, to: 1, period: 1600 }))
  .when(look === "faded", (el) => el.opacity(0.45));

const line = (text, color) => div().text_size(12).text_color(color).child(text);

function notice(t, tone, look, headline, lines) {
  return v_flex().p(14).gap(4)
    .child(h_flex().gap(8).items_center().child(dot(t, tone, look)).child(div().text_size(13).text_color(t.foreground).child(headline)))
    .children(lines.filter((l) => l !== null).map(([text, color]) => line(text, color).pl(17)));
}

const where = (t, place) => [`${place.pin ?? `${place.branch ?? "no branch"} · ${folder(place.cwd)}`}${place.machine === null ? "" : ` on ${place.machine}`}`, t.dim];

function failed(app, t, failure, now, place) {
  const { headline, tone, fix } = failureLines(failure, app.resetAt, now, place.pin);
  const named = place.pin !== null && headline.includes(place.pin);
  return notice(t, tone, "still", headline, [fix === null ? null : [fix, t.muted], named ? null : where(t, place)]);
}

/** What stands in the pane while there is no pull request to draw. */
const PLACEHOLDERS = {
  idle: (_app, t) => notice(t, "idle", "still", "No terminal in this tab to follow", []),
  locating: (_app, t, s) => notice(t, "idle", "pulse", "Finding this branch's pull request", [where(t, s.place)]),
  failed: (app, t, s, now) => failed(app, t, s.trouble.failure, now, s.place),
  "no-pr": (_app, t, s) => notice(t, "idle", "still", `No pull request for ${s.place.branch ?? "this branch"} yet`, [["It shows here once one is opened.", t.muted], where(t, s.place)]),
  showing: (app, t, s, now) => (s.trouble !== null ? failed(app, t, s.trouble.failure, now, s.place)
    : notice(t, "idle", "pulse", `Reading #${s.target.number}`, [where(t, s.place)])),
  replay: (_app, t, s) => (s.trouble !== null ? notice(t, "blocked", "still", "The replay frame did not load", [[s.trouble.failure.text, t.muted], [s.file, t.dim]])
    : notice(t, "idle", "pulse", "Reading the replay frame", [[s.file, t.dim]])),
  "bad-pin": (_app, t, s) => notice(t, "blocked", "still", "This pane was given a pull request it cannot read", [[s.text, t.muted]]),
};

export function drawPane(app, now) {
  const t = theme();
  const s = app.state;
  return v_flex().id("pr").track_focus(app.handle).size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
    .on_size_change((size, cx) => app.resized(size, cx))
    .on_key_down((e, cx) => app.key(e, cx))
    .on_modifiers_changed((e) => {
      app.shift = e.modifiers.shift;
    })
    .on_mouse_down("left", (_e, cx) => app.pressed(cx))
    .child("shown" in s && s.shown !== null ? snapshotView(app, t, s, now) : PLACEHOLDERS[s.phase](app, t, s, now));
}

const CHECK_ROWS = ["group", "check", "hidden"];

function snapshotView(app, t, s, now) {
  const { snapshot } = s.shown;
  const clock = s.shown.source === "replay" ? s.shown.fetchedAt : now;
  const sum = summarize(snapshot, { localHead: s.phase === "showing" ? s.localHead : null });
  const rows = app.rows();
  const selected = selectedRow(rows, app.selected);
  const check = selected?.kind === "check" ? selected.check : null;
  const file = app.detailFile();
  const pane = v_flex().size_full().min_h(0).child(header(app, t, s, sum, now));
  // A diff wants the pane's width: in a narrow pane it stands in place of the list until Esc.
  if (!app.wide && file !== null) return pane.child(diffPane(app, t, file));
  const noted = countByPath(app.notes().annotations);
  // Each row is one child of the list, whatever opens under it, so a row's place in `rows` is the child scroll_to_item reveals.
  const items = rows.map((row) => {
    const drawn = rowView(app, t, row, row === selected, clock, noted);
    const under = row.kind === "about" && row.open ? aboutBlock(t, s, now)
      : row.kind === "files" && row.open && s.shown.files === null ? filesNote(t, s)
      : !app.wide && app.expanded && row === selected && check !== null
        ? div().id("details-under").ml(24).mr(12).my(4).rounded(6).bg(t.raised).child(details(t, check, s, clock))
        : null;
    return under === null ? drawn : v_flex().flex_none().child(drawn).child(under);
  });
  const list = v_flex().id("checks").min_w(0).min_h(0).py(4).overflow_y_scrollbar().track_scroll(app.scroll)
    .children(rows.some((r) => CHECK_ROWS.includes(r.kind)) ? items : [...items, line("No checks reported for this commit.", t.muted).px(14).py(8)]);
  if (!app.wide || !rows.some((r) => CHECK_ROWS.includes(r.kind) || r.kind === "file")) return pane.child(list.flex_1());
  const side = file !== null ? div().size_full().min_w(0).child(diffPane(app, t, file))
    : v_flex().id("details").size_full().min_w(0).overflow_y_scrollbar()
      .child(check !== null ? details(t, check, s, clock) : line("Select a check to see its steps, or a file to see its diff.", t.dim).p(12));
  // The divider between the two is dragged. Herdr keeps where it was left under the group's name, so a pane and a
  // window, which differ in width, each have their own; the width it starts at is the one last dragged to anywhere.
  // The group has no size of its own: the room that is left is given to it.
  return pane.child(h_resizable(app.overlay === null ? "pr-split" : "pr-split-window").flex_1().min_h(0)
    .on_resize((sizes) => app.splitResized(sizes))
    .child(resizable_panel().size(app.listWidth()).size_range(LIST_MIN_PX).child(list.size_full()))
    .child(resizable_panel().child(side)));
}

function header(app, t, s, sum, now) {
  const { snapshot, fetchedAt, source } = s.shown;
  const pr = snapshot.pr;
  const trouble = s.phase === "locating" ? null : s.trouble;
  const live = liveShown(s.shown, trouble);
  const look = !live && source !== "replay" ? "faded" : sum.ci.kind === "pending" ? "pulse" : "still";
  const age = source === "replay" ? `replay, recorded ${ago(fetchedAt, now)}` : live ? null : `as of ${ago(fetchedAt, now)}`;
  const blockers = blockerWords(sum);
  const pin = s.phase === "showing" ? s.place.pin : null;
  const repo = pin === null ? "" : `${s.target.owner}/${s.target.name}, pinned · `;
  const fine = (text) => div().pl(17).truncate().text_size(11.5).text_color(t.dim).child(text);
  // A floating window is dragged by its header: a press anywhere else in it is the pane's own.
  return v_flex().id("header").flex_none().px(14).pt(10).pb(10).gap(3).border_b_1().border_color(t.border)
    .when(app.overlay !== null, (el) => el.on_mouse_down("left", () => {
      app.grip = true;
    }))
    .child(h_flex().gap(8).items_center()
      .child(dot(t, sum.tone, look))
      .child(h_flex().id("title").flex_1().min_w(0).gap(6).cursor_pointer().on_click(open(pr.url))
        .child(div().flex_none().text_size(13).text_color(t.muted).child(`#${pr.number}`))
        .child(div().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).hover((x) => x.text_color(t.muted)).child(pr.title)))
      .when(age !== null, (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(age)))
      .when(app.overlay !== null, (el) => el.child(div().id("close-window").flex_none().px(4).cursor_pointer().text_size(12).text_color(t.dim)
        .hover((x) => x.text_color(t.foreground)).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(() => app.closePane()).child("✕"))))
    .child(div().pl(17).text_size(13).text_color(live || source === "replay" ? t.foreground : t.muted).child(headlineOf(sum)))
    .when(blockers.length > 0, (el) => el.child(line(blockers.join(" · "), t.muted).pl(17)))
    .child(fine(`${repo}${pr.headRef} → ${pr.baseRef} · ${short(pr.head)} · +${pr.additions} −${pr.deletions} · ${plural(pr.files, "file")}`))
    .when(sum.stale, (el) => el.child(line(`Your checkout is at ${short(s.localHead)}, not ${short(pr.head)}, the commit CI ran.`, t.muted).pl(17)))
    .when(trouble !== null, (el) => {
      const { headline, fix } = failureLines(trouble.failure, app.resetAt, now, pin);
      return el.child(line(fix === null ? headline : `${headline}. ${fix}`, t.muted).pl(17));
    })
    .children(mergeRow(app, t, now));
}

/** A press on the button is not a press on the pane, which would take back the first press of Merge; it still gives the pane the keyboard, so `m` can be the second. */
function mergeButton(app, t, text, look) {
  return h_flex().id("merge").h(26).px(10).items_center().rounded(6).flex_none().text_size(12)
    .border_1().border_color(look === "armed" ? t.solid : t.input).bg(look === "armed" ? t.solid : t.raised)
    .text_color(look === "armed" ? t.solid_foreground : t.foreground)
    .on_mouse_down("left", (_e, cx) => {
      app.handle.focus();
      cx.stop_propagation();
    })
    .when(look !== "off", (el) => el.cursor_pointer().hover((x) => x.opacity(0.85)).on_click((_e, cx) => app.pressMerge(cx)))
    .when(look === "off", (el) => el.opacity(0.45))
    .child(text);
}

/** The Merge row, drawn from the same offer a press goes by. */
function mergeRow(app, t, now) {
  const offer = app.offer(now);
  if (offer.look === "none") return [];
  if (offer.look === "done") return [line(offer.text, toneInk(t, offer.ok ? "done" : "blocked")).pl(17).pt(4)];
  const row = (...children) => [h_flex().pl(17).pt(5).gap(10).items_center().children(children)];
  if (offer.look === "note") return row(line(offer.note, t.muted));
  const note = "note" in offer && offer.note !== null ? [line(offer.note, offer.look === "armed" ? t.foreground : t.dim)] : [];
  return row(mergeButton(app, t, offer.label, offer.look), ...note);
}

function rowView(app, t, row, selected, now, noted) {
  const base = h_flex().id(row.key).h(26).flex_none().pr(14).gap(8).items_center().cursor_pointer()
    .when(selected, (el) => el.bg(t.selected)).hover((x) => x.bg(t.hover))
    .on_click((_e, cx) => app.clickRow(cx, row));
  const fold = (title, count) => base.pl(14)
    .child(div().w(10).flex_none().text_size(11).text_color(t.dim).child(row.open ? "▾" : "▸"))
    .child(div().text_size(12).font_semibold().text_color(t.muted).child(title))
    .children(count === null ? [] : [line(String(count), t.dim)]);
  if (row.kind === "group") return fold(row.group.title, row.group.checks.length);
  if (row.kind === "about") return fold("Description", null);
  if (row.kind === "files") return fold("Files", row.count);
  if (row.kind === "more-files") return base.pl(32).child(line(`${plural(row.count, "more file")}: open the PR's files page`, t.dim).truncate());
  if (row.kind === "file") {
    const { file } = row;
    const at = file.path.lastIndexOf("/") + 1;
    return base.pl(32)
      .child(fileMark(t, file))
      .child(h_flex().flex_1().min_w(0).text_size(12.5)
        .child(div().min_w(0).truncate().text_color(t.dim).child(file.path.slice(0, at)))
        .child(div().flex_none().max_w_full().truncate().text_color(t.foreground).child(file.path.slice(at))))
      .children(noted.has(file.path) ? [div().flex_none().text_size(11).text_color(t.ansi3).child(plural(noted.get(file.path), "note"))] : [])
      .children(fileCounts(t, file));
  }
  if (row.kind === "hidden") {
    return base.pl(32).child(line(`${plural(row.count, "more check")} GitHub did not return: open the PR's checks page`, t.dim).truncate());
  }
  const c = row.check;
  const step = currentStep(c);
  return base.pl(32)
    .child(div().w(14).flex_none().text_size(12).text_color(inkOf(t, c)).child(glyphOf(c)))
    .child(div().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(c.name))
    .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(step === null ? t.dim : t.muted).child(step ?? c.workflow ?? c.app ?? ""))
    .when(c.required, (el) => el.child(div().flex_none().text_size(10).text_color(t.dim).child("req")))
    .child(div().flex_none().w(52).text_right().text_size(11.5).text_color(t.dim).child(duration(c.startedAt, c.completedAt, now)));
}

const FILE_MARKS = { added: "A", removed: "D", renamed: "R", copied: "C", modified: "M", changed: "M", unchanged: "·" };
const fileMark = (t, file) => div().w(14).flex_none().text_size(11).text_color({ added: t.ansi2, removed: t.ansi1 }[file.status] ?? t.ansi3).child(FILE_MARKS[file.status]);
const fileCounts = (t, file) => [
  ...file.additions > 0 ? [div().flex_none().text_size(11).text_color(t.ansi2).child(`+${file.additions}`)] : [],
  ...file.deletions > 0 ? [div().flex_none().text_size(11).text_color(t.ansi1).child(`−${file.deletions}`)] : [],
];

function filesNote(t, s) {
  const error = s.phase === "showing" ? s.filesError : null;
  return line(s.phase === "replay" ? "A replay frame has no files." : error !== null ? `The files did not load: ${error}` : "Reading the files…", t.dim).pl(32).pr(14).pb(8);
}

/** How strongly a row is tinted, as the alpha of its colour: an added or removed line, and the part of it that differs. */
const DIFF_INK = { add: "18", del: "18", changed: "40" };
/** The colour of each role in code, by its place in ROLES, from the theme the pane stands in. */
const ROLE_INK = { plain: "foreground", comment: "dim", string: "ansi2", constant: "ansi3", keyword: "ansi5", function: "ansi4", type: "ansi6", punctuation: "muted" };
const roleInks = (t) => ROLES.map((role) => t[ROLE_INK[role]]);

/** The height of one line of a diff. A row is as many of them as its text folds into. */
export const lineHeight = () => Math.ceil((settings().font_size ?? 13) * 1.8);
/** What the scrollbar takes of a diff's width. */
const SCROLLBAR_PX = 14;

/**
 * A diff's measures in px: a character's width, taken a little wide of the font's own so that a folded line never
 * runs past the edge, the line-number column, and all that stands left of a line's text.
 */
function measures(digits) {
  const size = settings().font_size ?? 13;
  const char = size * 0.64, gutter = Math.ceil(digits * char) + 2;
  return { size, char, gutter, left: 6 + char + gutter + 10 + char + 10 };
}

/** The characters of a line that fit across a diff `width` px wide; a whole cut line until its width is known. */
export function wrapColumns(width, digits) {
  if (width === null) return CUT_COLUMNS;
  const { char, left } = measures(digits);
  return Math.max(20, Math.floor((width - left - SCROLLBAR_PX) / char));
}

/** A comment takes no side, so it has no colour: blue, the palette's fourth, is too dark to read on some terminals' black. */
const KIND_INK = { issue: "ansi1", suggestion: "ansi2", question: "ansi3", comment: "muted" };
const HINTS = ["v range", "c comment", "s suggestion", "i issue", "a ask", "o on the whole", "h l between them", "n p files"];

/** One file's diff, filling the space it is given, with what is noted on it among its lines and the review's bar under it. */
function diffPane(app, t, file) {
  const reading = app.reader();
  const hint = reading !== null ? "Esc for the list" : !app.wide ? "Enter to annotate · Esc for the list" : app.overlay !== null ? "Enter to annotate · Esc closes" : "Enter to annotate";
  const top = h_flex().flex_none().h(30).px(12).gap(8).items_center().border_b_1().border_color(t.border)
    .child(fileMark(t, file))
    .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(file.previous === null ? file.path : `${file.previous} → ${file.path}`))
    .children(fileCounts(t, file))
    .children(file.patch === null ? [] : [div().flex_none().text_size(11).text_color(t.dim).child(hint)]);
  const pane = v_flex().size_full().min_h(0).child(top);
  if (file.patch === null) {
    return pane.child(line(file.additions + file.deletions > 0 ? "GitHub gives no diff for this file: it is too large. Press o to open the pull request's files."
      : "No text diff: a binary file, or one that only moved.", t.muted).p(12));
  }
  const { digits, why } = app.diff(file);
  const { items, sizes, columns } = app.listing(file);
  const inks = roleInks(t);
  const picked = reading === null ? null : stretch(reading.cursor, reading.anchor);
  const noted = why === null ? pane : pane.child(line(why, t.dim).flex_none().px(12).py(4).truncate().border_b_1().border_color(t.border));
  const { size, char, gutter, left } = measures(digits);
  const height = lineHeight();
  const id = `diff:${file.path}`;
  const draw = (item) => {
    if (item.type === "annotation") {
      const { annotation: one, moved } = item;
      const asked = askWords(one, app.sending);
      return h_flex().w_full().h(height).flex_none().pl(left).pr(SCROLLBAR_PX).gap(8).items_center()
        .bg(one.id === app.activeId ? t.selected : t.raised)
        .child(div().flex_none().text_color(t[KIND_INK[one.kind]]).child(`${KINDS[one.kind].glyph} ${KINDS[one.kind].label}`))
        // What there is to say of it stands before its words, which are cut at the row's end; the bar under the diff has them whole.
        .children([moved ? `${one.target.where} at an earlier commit` : null, asked].filter((x) => x !== null).map((words) => div().flex_none().text_color(t.dim).child(words)))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(one.body));
    }
    const { row, index, mark } = item;
    const on = picked !== null && index >= picked.start && index <= picked.end;
    const at = reading !== null && index === reading.cursor;
    // The cursor and its range are a strip at the row's edge as well as a ground: a theme's `selected` may be its background.
    const strip = div().w(3).h_full().flex_none().when(on, (el) => el.bg(at ? t.foreground : t.dim));
    const marked = div().w(char).ml(3).flex_none().text_color(mark === null ? t.dim : t[KIND_INK[mark]]).child(mark === null ? "" : KINDS[mark].glyph);
    if (row.kind === "hunk" || row.kind === "note") {
      return h_flex().w_full().h(height).flex_none().items_center().bg(on ? t.selected : t.raised).text_color(at ? t.foreground : t.dim)
        .child(strip).child(marked).child(div().flex_1().min_w(0).pl(6).pr(SCROLLBAR_PX).truncate().child(row.text));
    }
    // A line longer than the diff is wide is folded at the edge, as a terminal folds it; its number stands by its first line.
    const lines = wrapSpans(cutSpans(row.spans ?? [[0, row.text, 0]], CUT_COLUMNS), columns);
    const tint = (row.kind === "add" ? t.ansi2 : t.ansi1) + DIFF_INK.changed;
    return h_flex().w_full().h(lines.length * height).flex_none().items_start()
      .when(row.kind === "add", (el) => el.bg(t.ansi2 + DIFF_INK.add)).when(row.kind === "del", (el) => el.bg(t.ansi1 + DIFF_INK.del))
      .when(on, (el) => el.bg(t.selected))
      .child(strip)
      .child(h_flex().h(height).flex_none().items_center()
        .child(marked)
        .child(div().w(gutter).flex_none().text_right().text_color(at ? t.foreground : t.dim).child(String(rowNumber(row))))
        .child(div().w(char).ml(10).flex_none().text_color(row.kind === "add" ? t.ansi2 : row.kind === "del" ? t.ansi1 : t.dim).child(row.kind === "add" ? "+" : row.kind === "del" ? "−" : "")))
      .child(v_flex().flex_1().min_w(0).ml(10).children(lines.map((spans) => h_flex().h(height).flex_none().items_center().overflow_hidden()
        .children(spans.map(([role, part, changed]) => div().flex_none().text_color(inks[role]).when(changed === 1, (el) => el.bg(tint)).child(part))))));
  };
  return noted.child(div().flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(size)
    .on_size_change((box, cx) => app.diffResized(box, cx))
    .child(v_virtual_list(id, items.length, sizes, (i) => String(i), (range) => items.slice(range.start, range.end).map(draw)).size_full()
      .track_scroll(app.lines).on_item_click((key, cx) => app.clickLine(cx, file, key)))
    .child(Scrollbar.vertical(id).viewport_from_layout().absolute().inset_0()))
    .children(reviewBar(app, t, file, reading));
}

/**
 * What stands under a diff while it is read: the field an annotation is typed in, the question before the review is
 * sent, what the last key did, the annotation the cursor is on in full, else the keys.
 */
function reviewBar(app, t, file, reading) {
  const { annotations } = app.notes();
  if (reading === null && app.draft === null && app.activeId === null && app.notice === null && !app.sending.has("review")) return [];
  const bar = (...children) => [v_flex().flex_none().px(12).py(7).gap(5).border_t_1().border_color(t.border).children(children)];
  const tag = (kind, target, extra) => h_flex().gap(8).items_center()
    .child(div().flex_none().text_size(12).font_semibold().text_color(t[KIND_INK[kind]]).child(`${KINDS[kind].glyph} ${KINDS[kind].label}`))
    .child(line([target === null ? "the whole pull request" : target.where, extra].filter((x) => x !== null).join(" · "), t.dim).min_w(0).truncate());
  const to = app.agent();
  if (app.draft !== null) {
    const { kind, target } = app.draft;
    const enter = kind !== "question" ? "Enter keeps it, Esc gives it up" : to.terminal === null ? to.why : `Enter asks ${to.name}, Esc gives it up`;
    return bar(tag(kind, target, enter),
      div().id("annotation").h(30).px(8).flex().items_center().rounded(6).border_1().border_color(app.typing ? t.accent : t.input).cursor_text()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(Input.new(app.input).h_full().text_size(12.5).text_color(t.foreground)));
  }
  const count = toSend(annotations).length;
  if (app.confirming) return bar(line(`Send ${plural(count, "annotation")} to ${to.terminal === null ? "the agent" : to.name}? Enter sends them, Esc keeps them here.`, t.foreground));
  if (app.sending.has("review")) return bar(line("Sending the review…", t.muted));
  if (app.notice !== null) return bar(line(app.notice, t.muted));
  const head = app.state.shown.files.head;
  const one = activeAnnotation(annotations, app.activeId, file.path, head, reading?.cursor ?? -1);
  if (one !== null) {
    return bar(tag(one.kind, one.target, askWords(one, app.sending)),
      div().text_size(12.5).text_color(t.foreground).child(one.body),
      line("r to change it · x to delete it", t.dim));
  }
  return bar(line([...count > 0 ? [`${plural(count, "annotation")}: y sends ${count === 1 ? "it" : "them"}`] : [], ...HINTS].join(" · "), t.dim).truncate());
}

function aboutBlock(t, s, now) {
  const say = (text) => line(text, t.dim).pl(32).pr(14).pb(8);
  if (s.phase === "replay") return say("A replay frame has no description.");
  const { about } = s.shown;
  const error = s.phase === "showing" ? s.aboutError : null;
  if (about === null) return say(error !== null ? `The description did not load: ${error}` : "Reading the description…");
  const reviewers = reviewerWords(about);
  return v_flex().pl(32).pr(14).pb(10).gap(4)
    .child(line(aboutLine(about, now), t.muted))
    .when(reviewers.length > 0, (el) => el.child(h_flex().flex_wrap().gap_x(12).gap_y(2).children(reviewers.map((r) => h_flex().gap(5).items_center()
      .child(div().w(6).h(6).flex_none().rounded_full().bg(toneInk(t, r.tone)))
      .child(line(r.text, t.muted))))))
    .when(about.labels.length > 0, (el) => el.child(h_flex().flex_wrap().gap(6).children(about.labels.map((label) =>
      div().px(6).rounded(4).border_1().border_color(t.border).text_size(11).text_color(t.muted).child(label)))))
    .when(error !== null, (el) => el.child(line(`It did not refresh: ${error}`, t.dim)))
    .child(about.body.trim() === "" ? line("No description.", t.dim)
      : div().pt(4).min_w(0).child(TextView.markdown("about-body", about.body).selectable(true).text_size(12.5)));
}

function details(t, c, s, now) {
  const from = [c.workflow, c.event, c.kind === "status" ? "commit status" : c.app].filter((x) => x !== null).join(" · ");
  const status = [stateWords(c.state), duration(c.startedAt, c.completedAt, now), c.required ? "required" : null].filter((x) => x).join(" · ");
  const link = c.link === null ? [] : [h_flex().id("details-link").pt(6).cursor_pointer().on_click(open(c.link)).child(line("Open on GitHub", t.muted))];
  return v_flex().p(12).gap(3)
    .child(h_flex().gap(8).items_center()
      .child(div().w(14).flex_none().text_size(12.5).text_color(inkOf(t, c)).child(glyphOf(c)))
      .child(div().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(c.name)))
    .child(div().pl(22).text_size(11.5).text_color(t.dim).child(from))
    .child(line(status, t.muted).pl(22))
    .children(stepsOf(t, c, s, now))
    .children(link);
}

function stepsOf(t, c, s, now) {
  const say = (text) => [line(text, t.muted).pl(22).pt(8)];
  if (c.kind === "status") return [...say("A commit status, not a job: it has no steps."), ...c.description ? say(c.description) : []];
  if (!hasSteps(c)) return say(`A check from ${c.app ?? "another app"}: GitHub keeps no steps for it.`);
  if (c.steps === null) return say(s.phase === "showing" && s.stepsError !== null ? `Its steps did not load: ${s.stepsError}` : s.phase === "replay" ? "The frame has no steps for it." : "Reading its steps…");
  if (c.steps.length === 0) return say("No steps reported yet.");
  return [v_flex().pt(8).children(c.steps.map((step) => {
    const href = stepLink(c, step);
    return h_flex().id(`step-${step.number}`).h(24).pl(22).pr(4).gap(8).items_center().rounded(4)
      .when(href !== null, (el) => el.cursor_pointer().hover((x) => x.bg(t.hover)).on_click(open(href)))
      .child(div().w(14).flex_none().text_size(11.5).text_color(inkOf(t, step)).child(glyphOf(step)))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(step.bucket === "skipping" ? t.dim : t.foreground).child(step.name))
      .child(div().flex_none().w(52).text_right().text_size(11.5).text_color(t.dim).child(duration(step.startedAt, step.completedAt, now)));
  }))];
}
