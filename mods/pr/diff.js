/**
 * A stretch of a line in one colour: what it is in the code, as an index into ROLES, its text, and 1 when it is the part of
 * a changed line that differs from the line it replaced.
 * @typedef {[role: number, text: string, changed: 0 | 1]} Span
 */
/**
 * One line of a file's diff. `old` and `new` are its line numbers in the file before and after: a removed line has
 * no `new`, an added one no `old`. A `hunk` is the `@@` line that opens a stretch; a `note` is anything else git prints.
 * `spans` are the line's text in coloured stretches, once the helper has read the file.
 * @typedef {{ kind: "hunk" | "note", text: string } | { kind: "add" | "del" | "same", old: number | null, new: number | null, text: string, spans?: Span[] }} DiffRow
 */
/** A line as the helper gives it: its kind, its number on its own side, its spans. @typedef {[kind: "add" | "del" | "same", number: number, spans: Span[]]} Line */

/** What a stretch of code is, for its colour. The helper answers in indexes into this list, so its answer holds for every theme. */
export const ROLES = /** @type {const} */ (["plain", "comment", "string", "constant", "keyword", "function", "type", "punctuation"]);

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Text draws a tab as nothing: each is padded to the next 4-column stop, counted along the whole line. @param {Span[]} spans @returns {Span[]} */
export function untabSpans(spans) {
  let column = 0;
  return spans.map(([role, text, changed]) => {
    let out = "";
    for (const char of text) {
      const drawn = char === "\t" ? " ".repeat(4 - column % 4) : char;
      out += drawn;
      column += drawn.length;
    }
    return [role, out, changed];
  });
}

const untab = (text) => untabSpans([[0, text, 0]])[0][1];

/**
 * The rows of a unified diff as GitHub gives one per file: hunks only, without git's file header.
 * @param {string} patch
 * @returns {DiffRow[]}
 */
export function patchRows(patch) {
  let old = 0, next = 0;
  return patch.split("\n").map((line) => {
    const hunk = HUNK.exec(line);
    if (hunk !== null) {
      old = Number(hunk[1]);
      next = Number(hunk[2]);
      return { kind: "hunk", text: line };
    }
    const text = untab(line.slice(1));
    if (line[0] === "+") return { kind: "add", old: null, new: next++, text };
    if (line[0] === "-") return { kind: "del", old: old++, new: null, text };
    if (line[0] === " " || line === "") return { kind: "same", old: old++, new: next++, text };
    return { kind: "note", text: line.replace(/^\\ /, "") };
  });
}

/** The number a row shows in the gutter: where the line is now, or where it was when it is gone. */
export const rowNumber = (row) => (row.kind === "hunk" || row.kind === "note" ? null : row.new ?? row.old);

/**
 * The rows with the helper's colours on them, or null when its lines are not these rows' lines: another count, kind,
 * number or text (a line the helper cut short still counts as the same line). Colours on the wrong line would be worse than
 * none, so one line off leaves the whole file plain.
 * @param {DiffRow[]} rows
 * @param {Line[]} lines
 * @returns {DiffRow[] | null}
 */
export function paintRows(rows, lines) {
  let at = 0;
  const painted = [];
  for (const row of rows) {
    if (row.kind === "hunk" || row.kind === "note") {
      painted.push(row);
      continue;
    }
    const line = lines[at++];
    if (line === undefined) return null;
    const [kind, number, spans] = line;
    const drawn = untabSpans(spans);
    const text = drawn.map(([, part]) => part).join("");
    if (kind !== row.kind || number !== rowNumber(row) || !row.text.startsWith(text)) return null;
    // Pierre cuts a very long line short: what it left out is drawn plain.
    painted.push({ ...row, spans: text === row.text ? drawn : [...drawn, [0, row.text.slice(text.length), 0]] });
  }
  return at === lines.length ? painted : null;
}

/**
 * A patch ready to draw: its rows, coloured when `lines` are given and are its lines, the widest in characters, and the
 * digits its largest line number takes. `coloured` says whether the colours went on.
 * @param {string} patch
 * @param {Line[] | null} [lines]
 */
export function diffOf(patch, lines = null) {
  const plain = patchRows(patch);
  const painted = lines === null ? null : paintRows(plain, lines);
  const rows = painted ?? plain;
  return {
    rows,
    coloured: painted !== null,
    columns: rows.reduce((widest, row) => Math.max(widest, row.text.length), 0),
    digits: String(rows.reduce((largest, row) => Math.max(largest, rowNumber(row) ?? 0), 0)).length,
  };
}

/** The spans that fit in `columns` characters: a longer line is cut, as a plain one is. @param {Span[]} spans @returns {Span[]} */
export function cutSpans(spans, columns) {
  const kept = [];
  let left = columns;
  for (const [role, text, changed] of spans) {
    if (left <= 0) break;
    kept.push([role, text.slice(0, left), changed]);
    left -= text.length;
  }
  return kept;
}

/**
 * What the helper said of a pull request's files: each file's lines by path, or for a file it could not read the reason,
 * and in `note` why there are no colours at all, when it did not run.
 * @typedef {{ byPath: Map<string, Line[] | string>, note: string | null }} Colours
 */

/** No colours for any file, and why. @returns {Colours} */
export const noColours = (note) => ({ byPath: new Map(), note });

/** What the helper is given: the files that have a diff. */
export const helperInput = (files) =>
  ({ files: files.filter((file) => file.patch !== null).map(({ path, previous, status, patch }) => ({ path, previous, status, patch })) });

/**
 * A run of the helper read as colours. A helper that exits non-zero, or prints what is not its answer, gives the note.
 * @param {{ code: number, stdout: string, stderr: string }} result
 * @returns {Colours}
 */
export function coloursOf({ code, stdout, stderr }) {
  if (code !== 0) {
    if (stderr.includes("ERR_MODULE_NOT_FOUND")) return noColours("No syntax colours: run `npm install` in mods/pr/pierre.");
    return noColours(`No syntax colours: the helper failed. ${stderr.trim().split("\n").at(-1)}`);
  }
  try {
    const { files } = JSON.parse(stdout);
    return { byPath: new Map(files.map((file) => [file.path, file.lines ?? String(file.error)])), note: null };
  } catch (e) {
    return noColours(`No syntax colours: the helper's answer did not read. ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Why a file's diff is drawn plain, or null when it is coloured or the helper has not answered yet.
 * @param {Colours | undefined} colours `undefined` until the helper has been asked
 * @param {string} path
 * @param {boolean} coloured whether the helper's lines went onto the rows
 */
export function plainNote(colours, path, coloured) {
  if (colours === undefined || coloured) return null;
  if (colours.note !== null) return colours.note;
  const lines = colours.byPath.get(path);
  if (typeof lines === "string") return `No syntax colours for this file: ${lines}`;
  return `No syntax colours for this file: the helper ${lines === undefined ? "did not answer for it" : "read other lines than these"}.`;
}
