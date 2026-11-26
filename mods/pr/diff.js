/**
 * One line of a file's diff. `old` and `new` are its line numbers in the file before and after: a removed line has
 * no `new`, an added one no `old`. A `hunk` is the `@@` line that opens a stretch; a `note` is anything else git prints.
 * @typedef {{ kind: "hunk" | "note", text: string } | { kind: "add" | "del" | "same", old: number | null, new: number | null, text: string }} DiffRow
 */

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Text draws a tab as nothing: pad each to the next 4-column stop. */
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

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

/** A patch ready to draw: its rows, the widest in characters, and the digits its largest line number takes. */
export function diffOf(patch) {
  const rows = patchRows(patch);
  return {
    rows,
    columns: rows.reduce((widest, row) => Math.max(widest, row.text.length), 0),
    digits: String(rows.reduce((largest, row) => Math.max(largest, rowNumber(row) ?? 0), 0)).length,
  };
}
