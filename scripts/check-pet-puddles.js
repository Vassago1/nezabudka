#!/usr/bin/env node
// Mechanical check for the baked-in light "puddle" under pet sprites.
//
// A puddle pixel = opaque (alpha > ALPHA_OPAQUE), near-white and low-saturation,
// AND connected to the transparent background through other such pixels (4-conn).
// Interior pale material (a seal's belly, a cream tummy) is enclosed by darker
// outline/fur so it is never reachable from the outside and is left alone.
//
// Checked zone: the bottom ZONE_FRACTION of the sprite (where the floor shadow
// lives) plus, separately, anywhere in the image (reported as "stray").
//   node scripts/check-pet-puddles.js         # report only, exit 1 if any found
//   node scripts/check-pet-puddles.js --fix   # make them transparent, rewrite files
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
sharp.cache(false);

const ROOT = path.join(__dirname, '..');
const DIRS = [path.join(ROOT, 'public', 'patient', 'img'), path.join(ROOT, 'mobile-build', 'img')];
const ZONE_FRACTION = 0.15;
const ALPHA_OPAQUE = 128;
// Thresholds per sprite. Seals have genuinely pale (200-235) fur that a looser
// threshold would eat into, and their floor shadow is brighter than that fur, so
// they get a stricter "near-white" bar; seal-verylow's white background leaves
// faint off-white blotches that need a slightly lower one.
function thresholds(name) {
  if (process.env.PUDDLE_MIN) return { min: +process.env.PUDDLE_MIN, spread: +(process.env.PUDDLE_SPREAD || 25) };
  if (name.startsWith('seal-verylow')) return { min: 224, spread: 25 };
  if (name.startsWith('seal-')) return { min: 238, spread: 25 };
  return { min: 205, spread: 40 };
}
let MIN_CHANNEL = 205, MAX_SPREAD = 40, ALLOW_POCKETS_OFF = false;
const SIGNIFICANT_PX = 60;   // fewer reachable light px than this = just a few edge pixels of the character
const SIGNIFICANT_RUN = 25;  // ...or a horizontal run of light px at least this wide

const isLight = (d, i) => d[i + 3] > ALPHA_OPAQUE &&
  Math.min(d[i], d[i + 1], d[i + 2]) >= MIN_CHANNEL &&
  Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) <= MAX_SPREAD;

// Light opaque pixels reachable from transparency through light pixels.
function reachableLight(d, w, h) {
  const n = w * h, seen = new Uint8Array(n), q = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) if (d[i * 4 + 3] <= ALPHA_OPAQUE) { seen[i] = 2; q[tail++] = i; }
  const out = [];
  while (head < tail) {
    const i = q[head++], x = i % w, y = (i / w) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j < 0 || seen[j]) continue;
      if (isLight(d, j * 4)) { seen[j] = 1; out.push(j); q[tail++] = j; }
    }
  }
  return out;
}

// Enclosed near-white pockets: leftover background trapped between parts of the
// subject (the gap between drooping plant leaves). Only for non-seal sprites,
// whose real material is never this white and low-saturation.
const POCKET_MIN = 240, POCKET_SPREAD = 20, POCKET_SIZE = 200;
function enclosedPockets(d, w, h, reached) {
  const n = w * h, seen = new Uint8Array(n), out = [];
  const inPocket = (i) => !reached.has(i) && d[i * 4 + 3] > ALPHA_OPAQUE &&
    Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) >= POCKET_MIN &&
    Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) - Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) <= POCKET_SPREAD;
  for (let s = 0; s < n; s++) {
    if (seen[s] || !inPocket(s)) continue;
    const comp = [s]; seen[s] = 1;
    for (let k = 0; k < comp.length; k++) {
      const i = comp[k], x = i % w, y = (i / w) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && !seen[j] && inPocket(j)) { seen[j] = 1; comp.push(j); }
      }
    }
    if (comp.length >= POCKET_SIZE) out.push(...comp);
  }
  return out;
}

function analyse(d, w, h) {
  const y0 = Math.floor(h * (1 - ZONE_FRACTION));
  let px = reachableLight(d, w, h);
  const set = new Set(px);
  if (!ALLOW_POCKETS_OFF) px = px.concat(enclosedPockets(d, w, h, set));
  let zone = 0, stray = 0, maxRun = 0;
  for (const i of px) { if (((i / w) | 0) >= y0) zone++; else stray++; }
  for (let y = y0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) { if (set.has(y * w + x)) { run++; if (run > maxRun) maxRun = run; } else run = 0; }
  }
  const found = zone >= SIGNIFICANT_PX || maxRun >= SIGNIFICANT_RUN || stray >= SIGNIFICANT_PX;
  return { px, zone, stray, maxRun, found };
}

async function main() {
  const fix = process.argv.includes('--fix');
  let anyFound = false;
  for (const dir of DIRS) {
    for (const f of fs.readdirSync(dir).filter((n) => /^(cat|dog|plant|dragon|seal)-(great|good|low|verylow)\.webp$/.test(n)).sort()) {
      const file = path.join(dir, f);
      ({ min: MIN_CHANNEL, spread: MAX_SPREAD } = thresholds(f));
      ALLOW_POCKETS_OFF = f.startsWith('seal-');
      const { data, info } = await sharp(fs.readFileSync(file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const { width: w, height: h } = info;
      let r = analyse(data, w, h);
      const label = `${path.relative(ROOT, file)}: zone=${r.zone}px stray=${r.stray}px maxRun=${r.maxRun}`;
      if (!r.found) { console.log('OK    ' + label); continue; }
      if (!fix) { anyFound = true; console.log('FOUND ' + label); continue; }
      let rounds = 0;
      while (r.px.length && rounds++ < 10) { // peeling exposes the next layer of the anti-aliased rim
        for (const i of r.px) data[i * 4 + 3] = 0;
        r = analyse(data, w, h);
        if (!r.px.length) break;
      }
      const out = await sharp(data, { raw: { width: w, height: h, channels: 4 } })
        .webp({ quality: 95, effort: 6, alphaQuality: 100 }).toBuffer();
      fs.writeFileSync(file, out);
      console.log('FIXED ' + label + ` (${rounds} round(s))`);
    }
  }
  if (anyFound) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
