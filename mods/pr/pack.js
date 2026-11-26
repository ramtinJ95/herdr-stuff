import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";

const PUBLIC = ["ramtinJ95/first-game", "ramtinJ95/survive-n-conquest"];
const KEEP = ["at", "repo", "number", "rateLimit", "pr", "oracle"];
const BUDGET = 1_500_000;
const out = new URL("./fixtures/", import.meta.url).pathname;

const inputs = process.argv.slice(2).flatMap((p) => (statSync(p).isDirectory()
  ? readdirSync(p).filter((f) => f.endsWith(".jsonl")).sort().map((f) => join(p, f)) : [p]));
if (inputs.length === 0) {
  console.error("usage: node mods/pr/pack.js <recording.jsonl | folder>...");
  process.exit(2);
}
mkdirSync(out, { recursive: true });

for (const file of inputs) {
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const kept = lines.flatMap((line, i) => {
    const where = `${basename(file)}:${i + 1}`;
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      console.log(`${where}: not whole JSON (still being written?), left out`);
      return [];
    }
    if (!PUBLIC.includes(frame.repo)) {
      console.log(`${where}: refused, ${frame.repo} is not on the public allow list`);
      return [];
    }
    if (frame.errors !== null) {
      console.log(`${where}: refused, GitHub answered with errors`);
      return [];
    }
    return [JSON.stringify(Object.fromEntries(KEEP.map((k) => [k, frame[k]])))];
  });
  if (kept.length === 0) continue;
  const name = `${basename(file, ".jsonl")}.jsonl.gz`;
  writeFileSync(join(out, name), gzipSync(`${kept.join("\n")}\n`, { level: 9 }));
  console.log(`${name}: ${kept.length} of ${lines.length} frames`);
}

const size = readdirSync(out).reduce((sum, f) => sum + statSync(join(out, f)).size, 0);
console.log(`fixtures/: ${size} bytes`);
if (size > BUDGET) {
  console.error(`over the ${BUDGET}-byte budget: keep whole lifecycles, and drop settled single-frame recordings first`);
  process.exit(1);
}
