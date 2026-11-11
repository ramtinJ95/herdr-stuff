import { test } from "node:test";
import assert from "node:assert/strict";
import { keyLabel, ago, mix, alpha, hash } from "./util.js";

test("keyLabel reads bindings as people do", () => {
  assert.equal(keyLabel("ctrl-shift-t"), "Ctrl+Shift+T");
  assert.equal(keyLabel("ctrl-f c"), "Ctrl+F C");
  assert.equal(keyLabel("f2"), "F2");
  assert.equal(keyLabel("alt-]"), "Alt+]");
});

test("keyLabel keeps a minus key", () => {
  assert.equal(keyLabel("ctrl-f -"), "Ctrl+F -");
  assert.equal(keyLabel("ctrl--"), "Ctrl+-");
});

test("ago counts minutes, hours, days", () => {
  const now = 1_000_000_000_000;
  assert.equal(ago(now - 20_000, now), "now");
  assert.equal(ago(now - 4 * 60_000, now), "4m");
  assert.equal(ago(now - 3 * 3_600_000, now), "3h");
  assert.equal(ago(now - 50 * 3_600_000, now), "2d");
});

test("mix and alpha make colors", () => {
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(alpha("#102030", 0.5), "#10203080");
});

test("hash is stable and unsigned", () => {
  assert.equal(hash("sp1"), hash("sp1"));
  assert.notEqual(hash("sp1"), hash("sp2"));
  assert.ok(hash("anything") >= 0);
});
