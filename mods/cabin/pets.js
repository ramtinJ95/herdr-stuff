// The den's pets: one species per agent program, drawn as pixel grids.
// No colors live here: each character names a role that render time fills
// from the theme (see paint() in pixel.js), so a pet recolors with the theme.
//
//   .  nothing          o  outline         b  body          d  body shade
//   l  belly, muzzle    k  inner ear       n  nose, cheeks  y  beak, feet
//   E  eye, upper half (the body's color while asleep or blinking)
//   e  eye, lower half  s  scarf (the agent's status color)
//   S  scarf shade

export const W = 16;
export const H = 15;

const SPECIES = {
  cat: {
    body: ["grey", "orange", "cream", "night"],
    rows: [
      "................",
      "..o.......o.....",
      ".obo.....obo....",
      ".okbooooobko....",
      "obbbbbbbbbbbo...",
      "obbEbbbbbEbbo...",
      "obbebbnbbebbo...",
      "onbbblllbbbno...",
      ".obbbbbbbbbo....",
      ".ossssssssso....",
      ".obbSsbbbbbo..o.",
      "obbllSlllbbbo.bo",
      "obblllllllbbo.bo",
      "obbllllllbbbobbo",
      ".ooooooooooooo..",
    ],
  },
  fox: {
    body: ["orange", "snow"],
    rows: [
      ".o.........o....",
      "obo.......obo...",
      "okbo.....obko...",
      "okbbooooobbko...",
      "obbbbbbbbbbbo...",
      "obbEbbbbbEbbo...",
      "obbebbbbbebbo...",
      ".olllbbblllo....",
      "..ollnnnllo.....",
      ".ossssssssso....",
      ".obbSsbbbbbo.oo.",
      "obbllSlllbbbobbo",
      "obblllllllbbobdo",
      "obbllllllbbbbllo",
      ".oooooooooooooo.",
    ],
  },
  owl: {
    body: ["brown", "snow"],
    rows: [
      "................",
      ".oo.........oo..",
      ".obo.......obo..",
      ".obboooooooobo..",
      "obbbbbbbbbbbbbo.",
      "obllllbbbllllbo.",
      "olEElloyolEEllo.",
      "oleellyyyleello.",
      "obllllbybllllbo.",
      ".osssssssssssso.",
      "obbSsbbbbbbbbbbo",
      "odblllllllllbbdo",
      "odbldldldldlbbdo",
      ".obbllllllllbbo.",
      "..oyyoooooyyoo..",
    ],
  },
  penguin: {
    body: ["night"],
    rows: [
      "................",
      "....oooooooo....",
      "...obbbbbbbbo...",
      "..obbbbbbbbbbo..",
      "..obEbbbbbbEbo..",
      "..obebllllbebo..",
      "..obbllyyllbbo..",
      "..obllllllllbo..",
      "..osssssssssso..",
      ".obbSslllllllbo.",
      "obbbSllllllllbbo",
      "obbllllllllllbbo",
      ".obllllllllllbo.",
      "..obllllllllbo..",
      "..oyyoooooooyyo.",
    ],
  },
  bunny: {
    body: ["snow", "brown", "cream"],
    rows: [
      "...oo...oo......",
      "..obko.okbo.....",
      "..obko.okbo.....",
      "..obkooobko.....",
      ".obbbbbbbbbo....",
      "obbEbbbbbEbbo...",
      "obbebbnbbebbo...",
      "onbbbblbbbbno...",
      ".obbbbbbbbbo....",
      ".ossssssssso....",
      ".obbSsbbbbbo....",
      "obbllSlllbbbo.o.",
      "obblllllllbbooko",
      "obbllllllbbbbobo",
      ".oooooooooooooo.",
    ],
  },
  bear: {
    body: ["bark", "snow"],
    rows: [
      "................",
      ".oo.......oo....",
      "obko.....okbo...",
      "obbooooooobbo...",
      "obbbbbbbbbbbo...",
      "obbEbbbbbEbbo...",
      "obbebbbbbebbo...",
      "obbbblllbbbbo...",
      ".obbllnllbbo....",
      ".ossssssssso....",
      "obbSsbbbbbbbo...",
      "obbbSlllllbbbo..",
      "obblllllllbbbo..",
      "obbllllllbbbbo..",
      ".ooooooooooooo..",
    ],
  },
};

const NAMES = Object.keys(SPECIES);

function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** The species an agent spawned as: any of them, the same one for that agent. */
export function speciesOf(address) {
  return NAMES[hash(`species:${address}`) % NAMES.length];
}

export function species(name) {
  return SPECIES[name] ?? SPECIES.cat;
}

export const ALL_SPECIES = NAMES;

// Furs: the same species twice gets a different coat when it can.
export function furOf(name, address) {
  const furs = species(name).body;
  return furs[hash(`fur:${address}`) % furs.length];
}

const PET_NAMES = [
  "Maple", "Juniper", "Cocoa", "Biscuit", "Pepper", "Hazel", "Clove", "Ember",
  "Birch", "Willow", "Mochi", "Nutmeg", "Chai", "Pine", "Toffee", "Sprout",
  "Fig", "Bramble", "Acorn", "Sage", "Marzipan", "Flurry", "Pippin", "Rowan",
];

/** A name for the pet; the same agent keeps it. */
export function petName(address) {
  return PET_NAMES[hash(`name:${address}`) % PET_NAMES.length];
}
