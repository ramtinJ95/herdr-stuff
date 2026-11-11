// The layout's own look, kept in the theme's colors. A layout file can only
// name theme colors, and those can't say "wood": so the café writes its
// window-frame colors into the shown layout, and paints its back wall as an
// image in the theme's colors at the window's size (wall.js), whenever the
// theme or the window's size changes. Only these fields change; sizes, shown
// panels and every other click stay.

import { layout, run, appHome } from "herdr";
import * as fs from "fs/promises";
import { find } from "./util.js";
import { wall } from "./wall.js";

const FRAME = 5;
const DIR = "backgrounds";
// A resize paints once it settles, not on every step of the drag.
const SETTLE = 350;

/** What the café wants the layout to look like, for a palette and window size. */
export function look(p, size) {
  const w = wall(p, size);
  return {
    wall: w,
    background: { image: `${DIR}/cabin-wall-${w.key}.svg`, fit: "cover" },
    border: { width: FRAME, color: p.frame },
    focus: { width: FRAME, color: p.frameLit },
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Patch the shown layout when its café look is stale. Call from render (it
 * measures the window). memo: the caller's own {}; cx: the caller's.
 */
export function tailor(p, memo, cx) {
  const l = layout();
  const pane = find(l, "main")?.content?.pane;
  if (!l || !pane) return;
  const v = globalThis.window.viewport_size();
  const size = { width: Math.round(v.width), height: Math.round(v.height) };
  if (!size.width || !size.height) return;
  const want = look(p, size);
  if (same(l.background, want.background) && same(pane.border, want.border) && same(pane.focus, want.focus)) return;
  // Once per wanted look: if the app keeps a different spelling, don't loop.
  const key = want.wall.key + want.border.color + want.focus.color;
  if (memo.last === key) return;
  memo.last = key;
  cx.spawn(async (cx) => {
    await cx.sleep(SETTLE);
    if (memo.last !== key) return;
    const home = appHome();
    const name = `cabin-wall-${want.wall.key}.svg`;
    try {
      await fs.mkdir(`${home}/${DIR}`, { recursive: true });
      await fs.writeFile(`${home}/${DIR}/${name}`, want.wall.svg);
    } catch (e) {
      console.log(`cabin: could not paint the wall (${e})`);
      return;
    }
    if (memo.last !== key) return;
    const next = JSON.parse(JSON.stringify(layout()));
    const old = typeof next.background === "object" ? next.background?.image : null;
    next.background = want.background;
    const frame = find(next, "main").content.pane;
    frame.border = want.border;
    frame.focus = want.focus;
    run("layout.set", { layout: next });
    // The old wall goes once the new one is up, so no frame shows none.
    if (old?.startsWith(`${DIR}/cabin-wall-`) && old !== want.background.image)
      await fs.unlink(`${home}/${old}`).catch((e) => console.log(`cabin: could not take down the old wall (${e})`));
  });
}
