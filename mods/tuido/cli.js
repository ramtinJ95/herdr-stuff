// The tuido CLI, which owns the files: the panel only reads `ls --json` and runs tuido's commands, so parsing, the
// ✅ stamp, sorting and the git commit after every change stay tuido's.
import { exec } from "herdr";

const install = "go install github.com/ramtinJ95/tuido/cmd/tuido@latest";

/** Runs `tuido <args>` and resolves with its output, or throws with what tuido said on stderr. */
export async function tuido(args, timeout = 30_000) {
  let r;
  try {
    r = await exec("tuido", args, { timeout });
  } catch (e) {
    throw new Error(`Could not run tuido (${e instanceof Error ? e.message : e}). Install it with \`${install}\`.`);
  }
  if (r.code === 0) return r;
  if (r.code === 4) throw new Error("tuido is not set up yet. Run `tuido init` in a terminal.");
  const said = r.stderr.trim().replace(/^tuido: /, "");
  if (said.includes("unknown flag: --at")) throw new Error(`This tuido has no \`done --at\`. Update it: \`tuido upgrade\` or \`${install}\`.`);
  throw new Error(said || `tuido ${args[0]} exited ${r.code}`);
}

/** The first line tuido printed, such as "✓ done: Fix ALB drain timeout → work/oncall". */
export const said = (r) => r.stdout.trim().split("\n")[0] ?? "";
