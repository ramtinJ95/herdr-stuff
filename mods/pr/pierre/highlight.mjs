// The Node helper that colours the PR pane's diffs with Pierre (@pierre/diffs). Herdr's own runtime cannot run Pierre's
// highlighter, so the pane runs this with node and reads what it prints.
//
// Usage: node highlight.mjs <input.json>
//   input:  { "files": [{ "path", "previous", "status", "patch" }] }, a file's patch as GitHub gives it, hunks only
//   output: { "files": [{ "path", "lines": [[kind, number, [[role, text, changed]]]] } | { "path", "lines": null, "error" }] }
// A line is its kind (add, del, same), its number on its own side, and its text in spans; `role` is an index into ROLES
// in ../diff.js and `changed` is 1 on the part of a changed line that differs from the line it replaced.
import { readFileSync } from "node:fs";
import { DiffHunksRenderer, parsePatchFiles, registerCustomTheme } from "@pierre/diffs";
import { ROLES } from "../diff.js";

/** The TextMate scopes of each role; a role's most specific scope wins, as in any TextMate theme. */
const SCOPES = {
  comment: ["comment", "punctuation.definition.comment"],
  string: ["string", "punctuation.definition.string"],
  constant: ["constant", "variable.language", "support.constant"],
  keyword: ["keyword", "storage"],
  function: ["entity.name.function", "support.function", "meta.function-call.generic"],
  type: ["entity.name.type", "entity.name.class", "entity.name.tag", "entity.other.inherited-class", "support.type", "support.class"],
  punctuation: ["punctuation", "meta.brace", "keyword.operator"],
};

/** The theme has no real colours: each role is a colour that only names it, and the pane picks the colour for its own theme. */
const inkOf = (role) => `#0000a${ROLES.indexOf(role)}`;
const THEME = "herdr-roles";
registerCustomTheme(THEME, async () => ({
  name: THEME,
  type: "dark",
  colors: { "editor.background": "#000000", "editor.foreground": inkOf("plain") },
  tokenColors: Object.entries(SCOPES).map(([role, scope]) => ({ scope, settings: { foreground: inkOf(role) } })),
}));

const KINDS = { context: "same", "change-addition": "add", "change-deletion": "del" };
const textOf = (node) => (node.type === "text" ? node.value : (node.children ?? []).map(textOf).join(""));

function roleOf(node) {
  const style = String(node.properties?.style ?? "");
  const colour = /(?:^|;)\s*color:\s*(#[0-9a-fA-F]{6})/.exec(style)?.[1].toLowerCase();
  if (colour === undefined) return 0;
  const role = ROLES.findIndex((name) => inkOf(name) === colour);
  if (role < 0) throw new Error(`a colour that is not one of the theme's: ${colour}`);
  return role;
}

/** Adds the text under `node` to `spans`, joining a stretch to the one before it when they look the same. */
function collect(node, changed, spans) {
  for (const child of node.children ?? []) {
    if (child.type !== "text" && "data-diff-span" in (child.properties ?? {})) {
      collect(child, 1, spans);
      continue;
    }
    const role = child.type === "text" ? 0 : roleOf(child);
    const text = textOf(child);
    const last = spans.at(-1);
    if (text === "") continue;
    if (last !== undefined && last[0] === role && last[2] === changed) last[1] += text;
    else spans.push([role, text, changed]);
  }
}

function spansOf(content) {
  const spans = [];
  collect(content, 0, spans);
  const last = spans.at(-1);
  if (last !== undefined && last[1].endsWith("\n")) {
    last[1] = last[1].slice(0, -1);
    if (last[1] === "") spans.pop();
  }
  return spans;
}

/** One file as git would print it: Pierre reads whole diffs, and GitHub's patch leaves the file header out. */
function gitDiff({ path, previous, status, patch }) {
  const old = previous ?? path;
  return [`diff --git a/${old} b/${path}`, `--- ${status === "added" ? "/dev/null" : `a/${old}`}`, `+++ ${status === "removed" ? "/dev/null" : `b/${path}`}`, patch, ""].join("\n");
}

async function linesOf(file) {
  const parsed = parsePatchFiles(gitDiff(file)).flatMap((patch) => patch.files);
  if (parsed.length !== 1) throw new Error(`Pierre read ${parsed.length} files in one file's diff`);
  const result = await new DiffHunksRenderer({ diffStyle: "unified", theme: THEME }).asyncRender(parsed[0]);
  const lines = [];
  for (const row of result.columns?.unified ?? []) {
    const props = row.content?.properties ?? {};
    const type = props["data-line-type"];
    // A row between hunks has no line type; git's "No newline at end of file" has one and is still not a line.
    if (type === undefined || "data-no-newline" in props) continue;
    if (KINDS[type] === undefined) throw new Error(`a line type this helper does not read: ${type}`);
    lines.push([KINDS[type], Number(props["data-line"]), spansOf(row.content)]);
  }
  return lines;
}

const { files } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = [];
for (const file of files) {
  try {
    out.push({ path: file.path, lines: await linesOf(file) });
  } catch (e) {
    out.push({ path: file.path, lines: null, error: e instanceof Error ? e.message : String(e) });
  }
}
process.stdout.write(JSON.stringify({ files: out }));
