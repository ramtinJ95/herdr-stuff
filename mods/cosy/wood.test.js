import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Record the real wood.js element tree without needing the native renderer.
const elements = `
  class Element {
    constructor(kind, path) { this.kind = kind; this.path = path; this.style = {}; this.items = []; }
    child(el) { this.items.push(el); return this; }
    children(items) { this.items.push(...items); return this; }
  }
  for (const key of ["absolute", "top", "left", "right", "w", "h", "rounded", "overflow_hidden"]) {
    Element.prototype[key] = function(value = true) { this.style[key] = value; return this; };
  }
  export const div = () => new Element("div");
  export const image = (path) => new Element("image", path);
`;
const data = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const woodURL = new URL("./wood.js", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === woodURL) {
      if (specifier === "gpui-kit") return { url: data(elements), shortCircuit: true };
      if (specifier === "./look.js") return { url: data('export const ART = "mods/cosy/art";'), shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const { lying } = await import("./wood.js");
hooks.deregister();

test("wood covers both halves across window sizes, aspect ratios and zoom levels", () => {
  // Include the screenshot's beam, just below/above the old fixed reach,
  // narrow windows, 4K/8K, fractional sizes, and taller/thinner beams.
  for (const height of [1, 26, 53.5, 54, 80]) {
    for (const width of [1, 320, 840, 2 * height * 25 - 0.5, 2 * height * 25 + 0.5, 3084, 3840, 7680, 20000.25]) {
      const [beam] = lying(width, height, { x: 1, y: 2, round: 12 });
      assert.deepEqual(beam.style, { absolute: true, top: 2, left: 1, w: width, h: height, rounded: 12, overflow_hidden: true });
      assert.equal(beam.items.length, 2);
      for (const [i, half] of beam.items.entries()) {
        assert.equal(half.style.left, i * width / 2);
        assert.equal(half.style.w, width / 2);
        assert.equal(half.style.h, height);
        assert.equal(half.style.overflow_hidden, true);
        const [plank] = half.items;
        assert.equal(plank.path, `mods/cosy/art/wood${i ? "-r" : ""}.jpg`);
        assert.equal(plank.style[i ? "right" : "left"], 0);
        assert.equal(plank.style.rounded, undefined, "no rounded seam in the middle");
        for (const zoom of [0.5, 0.75, 1, 1.1, 1.25, 1.5, 2, 3]) {
          // Conservatively round the contain-fit thickness DOWN to a device
          // pixel and recover its aspect-preserving width (the host's fit).
          const paintedHeight = Math.floor(plank.style.w / 25 * zoom) / zoom;
          const paintedWidth = paintedHeight * 25;
          assert.ok(paintedWidth >= width / 2, `${width}x${height} at ${zoom}: no horizontal gap`);
          const top = plank.style.top + (plank.style.h - paintedHeight) / 2;
          assert.ok(top <= 0 && top + paintedHeight >= height, `${width}x${height} at ${zoom}: no vertical gap`);
        }
      }
    }
  }
});

test("wood handles a hidden or collapsed beam without negative image sizes", () => {
  for (const [width, height] of [[0, 54], [-2, 54], [100, 0], [100, -2]]) {
    assert.deepEqual(lying(width, height), []);
  }
});
