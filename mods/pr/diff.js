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
function untabSpans(spans) {
  if (!spans.some(([, text]) => text.includes("\t"))) return spans;
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
function patchRows(patch) {
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

/** Whether a row is a line of the file, on one side or both: not a hunk's header, not a note of git's. @param {DiffRow} row */
export const isLine = (row) => row.kind !== "hunk" && row.kind !== "note";

/** The number a row shows in the gutter: where the line is now, or where it was when it is gone. */
export const rowNumber = (row) => (isLine(row) ? row.new ?? row.old : null);

/**
 * The rows with the helper's colours on them, or null when its lines are not these rows' lines: another count, kind,
 * number or text (a line the helper cut short still counts as the same line). Colours on the wrong line would be worse than
 * none, so one line off leaves the whole file plain.
 * @param {DiffRow[]} rows
 * @param {Line[]} lines
 * @returns {DiffRow[] | null}
 */
function paintRows(rows, lines) {
  let at = 0;
  const painted = [];
  for (const row of rows) {
    if (!isLine(row)) {
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
 * A patch ready to draw: its rows, coloured when `lines` are given and are its lines, and the digits its largest line
 * number takes. `coloured` says whether the colours went on.
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
    digits: String(rows.reduce((largest, row) => Math.max(largest, rowNumber(row) ?? 0), 0)).length,
  };
}

/** The spans that fit in `columns` characters: a longer line is cut, as a plain one is. @param {Span[]} spans @returns {Span[]} */
function cutSpans(spans, columns) {
  const kept = [];
  let left = columns;
  for (const [role, text, changed] of spans) {
    if (left <= 0) break;
    kept.push([role, text.slice(0, left), changed]);
    left -= text.length;
  }
  return kept;
}

/** The columns of a line that are drawn: a longer line is cut. */
export const CUT_COLUMNS = 400;

/**
 * Spans folded into lines of `columns` characters, as a terminal folds a long line: at the edge, wherever that falls.
 * There is always a first line, empty for no text.
 * @param {Span[]} spans @returns {Span[][]}
 */
function wrapSpans(spans, columns) {
  /** @type {Span[][]} */
  const lines = [[]];
  let room = columns;
  for (const [role, text, changed] of spans) {
    let rest = text;
    while (rest.length > 0) {
      if (room === 0) {
        lines.push([]);
        room = columns;
      }
      const part = rest.slice(0, room);
      lines.at(-1).push([role, part, changed]);
      room -= part.length;
      rest = rest.slice(part.length);
    }
  }
  return lines;
}

/** How many lines of `columns` characters a row is drawn in: as many as `wrapSpans` folds its cut text into. @param {DiffRow} row */
export const rowLines = (row, columns) =>
  (isLine(row) ? Math.max(1, Math.ceil(Math.min(row.text.length, CUT_COLUMNS) / columns)) : 1);

/**
 * A row's text as the lines it is drawn in: cut at CUT_COLUMNS, then folded at `columns`. A line that fits is its spans as they are.
 * @param {Extract<DiffRow, { text: string, old: number | null }>} row @returns {Span[][]}
 */
export function rowSpans(row, columns) {
  const spans = row.spans ?? [[0, row.text, 0]];
  return row.text.length <= Math.min(columns, CUT_COLUMNS) ? [spans] : wrapSpans(cutSpans(spans, CUT_COLUMNS), columns);
}
