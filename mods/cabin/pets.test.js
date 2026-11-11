import { test } from "node:test";
import assert from "node:assert/strict";
import { W, H, ALL_SPECIES, species, speciesOf, furOf, petName } from "./pets.js";

const ROLES = new Set(".obdlknyEesS");

test("every species is a full W×H grid of known roles", () => {
  for (const name of ALL_SPECIES) {
    const { rows } = species(name);
    assert.equal(rows.length, H, `${name}: ${rows.length} rows`);
    rows.forEach((r, i) => {
      assert.equal(r.length, W, `${name} row ${i}: "${r}" is ${r.length} wide`);
      for (const c of r) assert.ok(ROLES.has(c), `${name} row ${i}: unknown role "${c}"`);
    });
  }
});

test("every species has eyes and a scarf", () => {
  for (const name of ALL_SPECIES) {
    const all = species(name).rows.join("");
    for (const c of "Ees") assert.ok(all.includes(c), `${name} lacks "${c}"`);
  }
});

test("an agent keeps the species it spawned as, and any species can spawn", () => {
  assert.equal(speciesOf("t1a"), speciesOf("t1a"));
  const seen = new Set(Array.from({ length: 200 }, (_, i) => speciesOf(`t${i.toString(36)}`)));
  assert.deepEqual([...seen].sort(), [...ALL_SPECIES].sort());
});

test("furs and names are stable per agent", () => {
  for (const name of ALL_SPECIES) {
    assert.ok(Array.isArray(species(name).body) && species(name).body.length > 0, `${name} has no furs`);
    assert.equal(furOf(name, "t1a"), furOf(name, "t1a"));
    assert.ok(species(name).body.includes(furOf(name, "t9z")));
  }
  assert.equal(petName("t1a"), petName("t1a"));
});
