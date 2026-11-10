import { test } from "node:test";
import assert from "node:assert/strict";
import { addArgs, ageLabel, daysBetween, destinations, dueLabel, glyph, groups, hiddenSummary, parseRoot, parseUse, rows } from "./model.js";

const task = (over) => ({ workspace: "work", list: "inbox", path: "/t/work/inbox.md", line: 1, state: "open", desc: "x", priority: "normal", ...over });

test("glyphs follow tuido ls: state first, then blocked, then priority", () => {
  assert.equal(glyph(task({ state: "done", priority: "high" })).text, "✓");
  assert.equal(glyph(task({ blocked_by: ["ab12"], priority: "high" })).text, "⊘");
  assert.equal(glyph(task({ priority: "high" })).text, "▴");
  assert.equal(glyph(task({ priority: "normal" })).text, "•");
});

test("dates count calendar days, across a DST change", () => {
  assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2);
  assert.deepEqual(dueLabel("2026-08-10", "2026-08-10"), { text: "today", overdue: false, soon: true });
  assert.deepEqual(dueLabel("2026-08-11", "2026-08-10"), { text: "tomorrow", overdue: false, soon: true });
  assert.deepEqual(dueLabel("2026-08-09", "2026-08-10"), { text: "08-09", overdue: true, soon: false });
  assert.equal(dueLabel(undefined, "2026-08-10"), null);
  assert.equal(ageLabel("2026-08-08", "2026-08-10"), "2d");
  assert.equal(ageLabel("2026-08-10", "2026-08-10"), null);
});

test("groups scope to a workspace and count what they hide", () => {
  const tasks = [
    task({ line: 1 }),
    task({ line: 2, state: "done", hidden: "done" }),
    task({ line: 3, hidden: "blocked" }),
    task({ list: "oncall", path: "/t/work/oncall.md", hidden: "done", state: "done" }),
    task({ workspace: "home" }),
  ];
  const work = groups(tasks, { workspace: "work", showHidden: false });
  assert.deepEqual(work.map((g) => g.ref), ["work/inbox", "work/oncall"]);
  assert.equal(work[0].tasks.length, 1);
  assert.equal(hiddenSummary(work[0].hidden), "1 blocked, 1 done");
  assert.equal(work[1].tasks.length, 0, "a list with only hidden tasks keeps its group");

  const all = groups(tasks, { workspace: null, showHidden: true });
  assert.deepEqual(all.map((g) => g.ref), ["work/inbox", "work/oncall", "home/inbox"]);
  assert.equal(all[0].tasks.length, 3);
});

test("rows enter each heading once, nested as in the file", () => {
  const g = groups([
    task({ line: 1 }),
    task({ line: 3, headings: ["Oncall"] }),
    task({ line: 5, headings: ["Oncall", "Later"] }),
    task({ line: 6, headings: ["Oncall", "Later"] }),
    task({ line: 8, headings: ["Done"] }),
  ], { workspace: null, showHidden: false })[0];
  assert.deepEqual(rows(g).map((r) => r.kind === "heading" ? `#${r.depth} ${r.text}` : `${r.depth}:${r.task.line}`),
    ["0:1", "#0 Oncall", "1:3", "#1 Later", "2:5", "2:6", "#0 Done", "1:8"]);
});

test("parses tuido's text replies", () => {
  assert.equal(parseUse("work  (from state)\n"), "work");
  assert.equal(parseUse(""), null);
  assert.equal(parseRoot("root      /home/me/todo\ngit       true\n"), "/home/me/todo");
  assert.equal(parseRoot("git true\n"), null);
  assert.deepEqual(addArgs("  rotate certs  -p high -d fri "), ["rotate", "certs", "-p", "high", "-d", "fri"]);
  assert.deepEqual(addArgs("   "), []);
});

test("destinations offer each list and section add -l can write to", () => {
  const lists = [
    { workspace: "work", list: "inbox", sections: [] },
    { workspace: "work", list: "work", sections: ["Infra tasks", "Backend tasks"] },
    { workspace: "work", list: "oncall", sections: ["Now"], capture: "Now" },
    { workspace: "home", list: "inbox", sections: [] },
  ];
  const work = destinations(lists, "work");
  assert.deepEqual(work.map((d) => `${d.spec}${d.usable ? "" : " (needs a section)"}`), [
    "work/inbox", "work/work (needs a section)", "work/work/Infra tasks", "work/work/Backend tasks", "work/oncall", "work/oncall/Now",
  ]);
  assert.equal(destinations(lists, null).length, 7);
});
