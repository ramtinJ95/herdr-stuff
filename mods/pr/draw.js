import { div } from "gpui-kit";
import { TextView, h_flex, v_flex } from "gpui-base";
import { theme } from "herdr";
import { duration, hasSteps, plural, summarize } from "./model.js";
import { aboutLine, ago, blockerWords, currentStep, failureLines, headlineOf, liveShown, reviewerWords, selectedRow, stepLink } from "./view.js";

export const WIDE_PX = 720;

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

const where = (t, place) => [`${place.branch ?? "no branch"} · ${folder(place.cwd)}${place.machine === null ? "" : ` on ${place.machine}`}`, t.dim];

function failed(app, t, failure, now, place) {
  const { headline, tone, fix } = failureLines(failure, app.resetAt, now);
  return notice(t, tone, "still", headline, [fix === null ? null : [fix, t.muted], where(t, place)]);
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
};

export function drawPane(app, now) {
  const t = theme();
  const s = app.state;
  return v_flex().id("pr").track_focus(app.handle).size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
    .on_size_change((size, cx) => app.resized(size, cx))
    .on_key_down((e, cx) => app.key(e, cx))
    .on_mouse_down("left", (_e, cx) => app.pressed(cx))
    .child("shown" in s && s.shown !== null ? snapshotView(app, t, s, now) : PLACEHOLDERS[s.phase](app, t, s, now));
}

function snapshotView(app, t, s, now) {
  const { snapshot } = s.shown;
  const clock = s.shown.source === "replay" ? s.shown.fetchedAt : now;
  const sum = summarize(snapshot, { localHead: s.phase === "showing" ? s.localHead : null });
  const rows = app.rows();
  const checks = rows.some((r) => r.kind !== "about");
  const selected = selectedRow(rows, app.selected);
  const detailed = selected?.kind === "check" ? selected.check : null;
  // Each row is one child of the list, whatever opens under it, so a row's place in `rows` is the child scroll_to_item reveals.
  const items = rows.map((row) => {
    const drawn = rowView(app, t, row, row === selected, clock);
    const under = row.kind === "about" && row.open ? aboutBlock(t, s, now)
      : !app.wide && app.expanded && row === selected && detailed !== null
        ? div().id("details-under").ml(24).mr(12).my(4).rounded(6).bg(t.raised).child(details(t, detailed, s, clock))
        : null;
    return under === null ? drawn : v_flex().flex_none().child(drawn).child(under);
  });
  const list = v_flex().id("checks").flex_1().min_w(0).min_h(0).py(4).overflow_y_scrollbar().track_scroll(app.scroll)
    .children(checks ? items : [...items, line("No checks reported for this commit.", t.muted).px(14).py(8)]);
  const body = app.wide && checks
    ? h_flex().flex_1().min_h(0).items_start().child(list.h_full())
      .child(v_flex().id("details").flex_1().min_w(0).h_full().border_l_1().border_color(t.border).overflow_y_scrollbar()
        .child(detailed !== null ? details(t, detailed, s, clock) : line("Select a check to see its steps.", t.dim).p(12)))
    : list;
  return v_flex().size_full().min_h(0).child(header(app, t, s, sum, now)).child(body);
}

function header(app, t, s, sum, now) {
  const { snapshot, fetchedAt, source } = s.shown;
  const pr = snapshot.pr;
  const trouble = s.phase === "locating" ? null : s.trouble;
  const live = liveShown(s.shown, trouble);
  const look = !live && source !== "replay" ? "faded" : sum.ci.kind === "pending" ? "pulse" : "still";
  const age = source === "replay" ? `replay, recorded ${ago(fetchedAt, now)}` : live ? null : `as of ${ago(fetchedAt, now)}`;
  const blockers = blockerWords(sum);
  const fine = (text) => div().pl(17).truncate().text_size(11.5).text_color(t.dim).child(text);
  return v_flex().flex_none().px(14).pt(10).pb(10).gap(3).border_b_1().border_color(t.border)
    .child(h_flex().gap(8).items_center()
      .child(dot(t, sum.tone, look))
      .child(h_flex().id("title").flex_1().min_w(0).gap(6).cursor_pointer().on_click(open(pr.url))
        .child(div().flex_none().text_size(13).text_color(t.muted).child(`#${pr.number}`))
        .child(div().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).hover((x) => x.text_color(t.muted)).child(pr.title)))
      .when(age !== null, (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(age))))
    .child(div().pl(17).text_size(13).text_color(live || source === "replay" ? t.foreground : t.muted).child(headlineOf(sum)))
    .when(blockers.length > 0, (el) => el.child(line(blockers.join(" · "), t.muted).pl(17)))
    .child(fine(`${pr.headRef} → ${pr.baseRef} · ${short(pr.head)} · +${pr.additions} −${pr.deletions} · ${plural(pr.files, "file")}`))
    .when(sum.stale, (el) => el.child(line(`Your checkout is at ${short(s.localHead)}, not ${short(pr.head)}, the commit CI ran.`, t.muted).pl(17)))
    .when(trouble !== null, (el) => {
      const { headline, fix } = failureLines(trouble.failure, app.resetAt, now);
      return el.child(line(fix === null ? headline : `${headline}. ${fix}`, t.muted).pl(17));
    })
    .children(mergeRow(app, t, now));
}

function mergeButton(t, text, look, press) {
  return h_flex().id("merge").h(26).px(10).items_center().rounded(6).flex_none().text_size(12)
    .border_1().border_color(look === "armed" ? t.solid : t.input).bg(look === "armed" ? t.solid : t.raised)
    .text_color(look === "armed" ? t.solid_foreground : t.foreground)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .when(look !== "off", (el) => el.cursor_pointer().hover((x) => x.opacity(0.85)).on_click((_e, cx) => press(cx)))
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
  return row(mergeButton(t, offer.label, offer.look, (cx) => app.pressMerge(cx)), ...note);
}

function rowView(app, t, row, selected, now) {
  const base = h_flex().id(row.key).h(26).flex_none().pr(14).gap(8).items_center().cursor_pointer()
    .when(selected, (el) => el.bg(t.selected)).hover((x) => x.bg(t.hover))
    .on_click((_e, cx) => app.clickRow(cx, row));
  const fold = (title, count) => base.pl(14)
    .child(div().w(10).flex_none().text_size(11).text_color(t.dim).child(row.open ? "▾" : "▸"))
    .child(div().text_size(12).font_semibold().text_color(t.muted).child(title))
    .children(count === null ? [] : [line(String(count), t.dim)]);
  if (row.kind === "group") return fold(row.group.title, row.group.checks.length);
  if (row.kind === "about") return fold("Description", null);
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
