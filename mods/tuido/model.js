// What the panel shows, from `tuido ls --json --all`. Pure, so `node --test` covers it.

const priorityGlyphs = { highest: "▲", high: "▴", medium: "△", normal: "•", low: "▽", lowest: "▿" };

/** A task's glyph, as `tuido ls` draws it, and the tone the panel colours it by. */
export function glyph(task) {
  if (task.state === "done") return { text: "✓", tone: "done" };
  if (task.state === "cancelled") return { text: "✗", tone: "cancelled" };
  if (task.state === "in progress") return { text: "◐", tone: "progress" };
  if ((task.blocked_by ?? []).length > 0) return { text: "⊘", tone: "blocked" };
  return { text: priorityGlyphs[task.priority] ?? "•", tone: task.priority ?? "normal" };
}

/** A local calendar date as YYYY-MM-DD, the form tuido writes. */
export function isoDay(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Whole days from one YYYY-MM-DD to another. Read as UTC so a DST change never makes a day 23 hours. */
export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The due column: MM-DD as `tuido ls` shows it, with today and tomorrow spelled out. */
export function dueLabel(due, today) {
  if (!due) return null;
  const days = daysBetween(today, due);
  const text = days === 0 ? "today" : days === 1 ? "tomorrow" : due.slice(5);
  return { text, overdue: days < 0, soon: days === 0 || days === 1 };
}

/** The age column: days since the ➕ created date, as `tuido ls` shows it; nothing for today or no date. */
export function ageLabel(created, today) {
  if (!created) return null;
  const days = daysBetween(created, today);
  return days > 0 ? `${days}d` : null;
}

/** `tuido ls`'s footer wording: "1 blocked, 2 done", reasons in alphabetical order. */
export function hiddenSummary(hidden) {
  return Object.keys(hidden).sort().map((k) => `${hidden[k]} ${k}`).join(", ");
}

/**
 * One group per list, in tuido's order, with what is left out counted by reason. `workspace` is a workspace name, or
 * null for every workspace. `showHidden` keeps hidden tasks in, as `ls --all` does. A list whose tasks are all hidden
 * still gets a group, so it can be opened, sorted and archived from the panel.
 */
export function groups(tasks, { workspace, showHidden }) {
  const out = [];
  const byRef = new Map();
  for (const task of tasks) {
    if (workspace !== null && task.workspace !== workspace) continue;
    const ref = `${task.workspace}/${task.list}`;
    let group = byRef.get(ref);
    if (group === undefined) {
      group = { ref, workspace: task.workspace, list: task.list, path: task.path, tasks: [], hidden: {} };
      byRef.set(ref, group);
      out.push(group);
    }
    if (task.hidden && !showHidden) group.hidden[task.hidden] = (group.hidden[task.hidden] ?? 0) + 1;
    else group.tasks.push(task);
  }
  return out;
}

/**
 * A group's rows: each task, preceded by the headings it enters, as `tuido ls` nests them. A heading the previous task
 * already sat under is not repeated.
 */
export function rows(group) {
  const out = [];
  let previous = [];
  for (const task of group.tasks) {
    const path = task.headings ?? [];
    let common = 0;
    while (common < path.length && common < previous.length && path[common] === previous[common]) common++;
    for (let depth = common; depth < path.length; depth++) out.push({ kind: "heading", text: path[depth], depth });
    out.push({ kind: "task", task, depth: path.length });
    previous = path;
  }
  return out;
}

/** The locator `tuido done --at` takes. */
export const locator = (task) => `${task.path}:${task.line}`;

/** The workspace `tuido use` reports ("work  (from state)"), or null when none is selected. */
export function parseUse(stdout) {
  return stdout.trim().split(/\s+/)[0] || null;
}

/** The todo root from `tuido sync --status`, or null if it names none. */
export function parseRoot(stdout) {
  return /^root\s+(.+)$/m.exec(stdout)?.[1].trim() ?? null;
}

/** The ref `tuido new` reports ("✓ new list work/oncall"), or null if it said something else. */
export function parseNewList(stdout) {
  return /^✓ new list (.+)$/m.exec(stdout)?.[1].trim() ?? null;
}

/** Quick-add text as `tuido add` arguments: words, so its flags (-p high -d fri -l list) work as on the command line. */
export function addArgs(text) {
  return text.trim().split(/\s+/).filter((w) => w !== "");
}

/**
 * Where quick add can write, from `tuido _lists --json`: each list in scope, and each of its sections. A list with
 * headings takes a bare `-l <list>` only when its marker names a capture section, as tuido refuses otherwise. `spec` is
 * the exact `-l` value; pass it with --all so a list in another workspace resolves too.
 */
export function destinations(lists, workspace) {
  const out = [];
  for (const l of lists) {
    if (workspace !== null && l.workspace !== workspace) continue;
    const ref = `${l.workspace}/${l.list}`;
    const bare = l.sections.length === 0 || Boolean(l.capture);
    out.push({ key: ref, spec: ref, workspace: l.workspace, list: l.list, section: null, capture: l.capture ?? null, usable: bare });
    for (const section of l.sections) {
      out.push({ key: `${ref}/${section}`, spec: `${ref}/${section}`, workspace: l.workspace, list: l.list, section, capture: null, usable: true });
    }
  }
  return out;
}
