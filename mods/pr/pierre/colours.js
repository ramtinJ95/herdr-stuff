// The pane's side of the helper beside this file: what it is given, how it is run, and how its answer reads.
import { diffOf } from "../diff.js";
import { errorText, firstLine, lastLine } from "../text.js";

/** @typedef {import("../diff.js").Line} Line */
/** @typedef {import("../github.js").File} File */
/**
 * What the helper said of a pull request's files: each file's lines by path, or for a file it could not read the reason,
 * and in `note` why there are no colours at all, when it did not run.
 * @typedef {{ byPath: Map<string, Line[] | string>, note: string | null }} Colours
 */

/** No colours for any file, and why. @returns {Colours} */
const noColours = (note) => ({ byPath: new Map(), note });

/** What the helper is given: the files that have a diff. @param {File[]} files */
const helperInput = (files) =>
  ({ files: files.filter((file) => file.patch !== null).map(({ path, previous, status, patch }) => ({ path, previous, status, patch })) });

/**
 * A run of the helper read as colours. A helper that exits non-zero, or prints what is not its answer, gives the note.
 * @param {{ code: number, stdout: string, stderr: string }} result
 * @returns {Colours}
 */
function coloursOf({ code, stdout, stderr }) {
  if (code !== 0) {
    if (stderr.includes("ERR_MODULE_NOT_FOUND")) return noColours("No syntax colours: run `npm install` in mods/pr/pierre.");
    return noColours(`No syntax colours: the helper failed. ${lastLine(stderr)}`);
  }
  try {
    const { files } = JSON.parse(stdout);
    return { byPath: new Map(files.map((file) => [file.path, file.lines ?? String(file.error)])), note: null };
  } catch (e) {
    return noColours(`No syntax colours: the helper's answer did not read. ${errorText(e)}`);
  }
}

/**
 * Why a file's diff is drawn plain, or null when it is coloured or the helper has not answered yet.
 * @param {Colours | undefined} colours `undefined` until the helper has answered
 * @param {string} path
 * @param {boolean} coloured whether the helper's lines went onto the rows
 */
function plainNote(colours, path, coloured) {
  if (colours === undefined || coloured) return null;
  if (colours.note !== null) return colours.note;
  const lines = colours.byPath.get(path);
  if (typeof lines === "string") return `No syntax colours for this file: ${lines}`;
  return `No syntax colours for this file: the helper ${lines === undefined ? "did not answer for it" : "read other lines than these"}.`;
}

/**
 * A file's diff ready to draw: its rows with the helper's colours on them where it gave these lines theirs, and `why`
 * it is plain when it is.
 * @param {string} patch @param {Colours | undefined} colours `undefined` until the helper has answered
 */
export function colouredDiff(patch, colours, path) {
  const lines = colours?.byPath.get(path);
  const diff = diffOf(patch, Array.isArray(lines) ? lines : null);
  return { ...diff, why: plainNote(colours, path, diff.coloured) };
}

const HELPER_TIMEOUT_MS = 60_000;

/**
 * The files' syntax colours, from the helper run with node. It never rejects: no colours is an answer, with the reason
 * in its `note`.
 * @param {File[]} files
 * @param {{ helper: string, folder: string, exec: (program: string, argv: string[], options: { timeout: number }) => Promise<{ code: number, stdout: string, stderr: string }>,
 *   fs: { mkdir: Function, writeFile: Function, unlink: Function } }} with `helper` is the path of highlight.mjs; `folder` is where its input is written and removed
 * @returns {Promise<Colours>}
 */
export async function colourFiles(files, { helper, folder, exec, fs }) {
  const input = `${folder}/highlight-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  const why = (e) => firstLine(errorText(e));
  try {
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(input, JSON.stringify(helperInput(files)));
    const colours = await exec("node", [helper, input], { timeout: HELPER_TIMEOUT_MS })
      .then(coloursOf, (e) => noColours(`No syntax colours: node did not run. ${why(e)}`));
    await fs.unlink(input);
    return colours;
  } catch (e) {
    return noColours(`No syntax colours: the helper's input could not be written or removed. ${why(e)}`);
  }
}
