#!/usr/bin/env node
// Converts the raw AI-generated pet renders in incoming-images/ into the
// cropped, transparent WebP sprites the app actually loads
// (mobile-build/img/<species>-<state>.webp and public/patient/img/...).
//
// Pipeline, all in one pass so nothing gets re-encoded through a lossy
// intermediate: sample the background color from the four corners, cut it
// out via a flood-filled color-distance chroma key (so an internal color
// boundary - e.g. a scarf tassel against the body - can never be mistaken
// for background just because it lands in the same distance band), trim to
// the subject's largest connected component, downscale with Lanczos3 if
// needed, encode once as lossy WebP.
//
// The distance-to-background decision is made on a lightly blurred copy of
// the source, not the raw pixels. The AVIF/JPEG sources are not perfectly
// flat where they look flat - compression leaves faint per-pixel noise in
// the "background" - and without the blur that noise pushes individual
// pixels in and out of the cutout band, which shows up as a sprayed/hatched
// translucent patch wherever a soft real-world gradient (e.g. depth-of-field
// falloff behind a flipper) sits close to the background reference color.
// Blurring only the distance measurement (never the final RGB) removes that
// per-pixel jitter while leaving fine detail like whiskers untouched, since
// those are far enough from the background color to stay classified as
// subject either way.
//
// Usage: node scripts/build-pet-assets.js [species ...]
//   node scripts/build-pet-assets.js            # all species
//   node scripts/build-pet-assets.js seal        # just seal-*

'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'incoming-images');
const OUT_DIRS = [
  path.join(ROOT, 'mobile-build', 'img'),
  path.join(ROOT, 'public', 'patient', 'img'),
];

const MAX_DIM = 800;        // longest output side, matches the existing sprite set
const CORNER_PATCH = 12;    // px x px sample square at each corner
const BG_MARGIN = 6;        // slack added on top of the measured corner-to-corner spread
const FEATHER_WIDTH = 18;   // width of the soft-edge distance band
const DISTANCE_BLUR_SIGMA = 1.5; // denoises the background-distance measurement only, not the final color
const SUBJECT_ALPHA_THRESHOLD = 128; // alpha above this counts as "subject" for bounding-box purposes
const BBOX_PADDING = 24;    // extra px kept around the subject's largest component, for its own feathered edge

const PETS = {
  cat: { good: 'cat-good.avif', great: 'cat-great.jpg', low: 'cat-low.avif', verylow: 'cat-verylow.avif' },
  dog: { good: 'dog-good.png', great: 'dog-great.png', low: 'dog-low.png', verylow: 'dog-verylow.png' },
  dragon: { good: 'dragon-good.png', great: 'dragon-great.png', low: 'dragon-low.png', verylow: 'dragon-verylow.png' },
  plant: { good: 'plant-good.png', great: 'plant-great.png', low: 'plant-low.avif', verylow: 'plant-verylow.png' },
  seal: { good: 'seal-good.avif', great: 'seal-great.avif', low: 'seal-low.png', verylow: 'seal-verylow.png' },
};

function colorDistSq(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

function sampleBackground(raw, width, height, channels) {
  const patches = [
    [0, 0],
    [width - CORNER_PATCH, 0],
    [0, height - CORNER_PATCH],
    [width - CORNER_PATCH, height - CORNER_PATCH],
  ];
  const avgs = patches.map(([px, py]) => {
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let y = py; y < py + CORNER_PATCH; y++) {
      for (let x = px; x < px + CORNER_PATCH; x++) {
        const idx = (y * width + x) * channels;
        sr += raw[idx]; sg += raw[idx + 1]; sb += raw[idx + 2]; n++;
      }
    }
    return [sr / n, sg / n, sb / n];
  });
  const bg = [0, 0, 0];
  for (const a of avgs) { bg[0] += a[0]; bg[1] += a[1]; bg[2] += a[2]; }
  bg[0] /= 4; bg[1] /= 4; bg[2] /= 4;
  let spread = 0;
  for (const a of avgs) {
    spread = Math.max(spread, Math.sqrt(colorDistSq(a[0], a[1], a[2], bg[0], bg[1], bg[2])));
  }
  return { bg, spread };
}

// Flood-fill chroma key. `candidate` marks every pixel within highT of the
// background reference color. Only candidates *reachable from the image
// border* through other candidates are ever cut out - an interior pixel
// that coincidentally falls in the same distance band (a pale scarf edge
// against pale fur, for instance) but is fully surrounded by opaque subject
// pixels never gets touched, no matter how close its color is to the
// background sample.
function floodCutout(raw, width, height, channels, bg, lowT, highT) {
  const n = width * height;
  const dist = new Float32Array(n);
  const candidate = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const idx = i * channels;
    const d = Math.sqrt(colorDistSq(raw[idx], raw[idx + 1], raw[idx + 2], bg[0], bg[1], bg[2]));
    dist[i] = d;
    candidate[i] = d <= highT ? 1 : 0;
  }

  const visited = new Uint8Array(n);
  const queue = new Int32Array(n);
  let qHead = 0, qTail = 0;

  const pushIfCandidate = (i) => {
    if (candidate[i] && !visited[i]) {
      visited[i] = 1;
      queue[qTail++] = i;
    }
  };
  for (let x = 0; x < width; x++) {
    pushIfCandidate(x);                          // top row
    pushIfCandidate((height - 1) * width + x);   // bottom row
  }
  for (let y = 0; y < height; y++) {
    pushIfCandidate(y * width);                  // left column
    pushIfCandidate(y * width + (width - 1));    // right column
  }

  while (qHead < qTail) {
    const i = queue[qHead++];
    const x = i % width;
    const y = (i / width) | 0;
    if (x > 0) pushIfCandidate(i - 1);
    if (x < width - 1) pushIfCandidate(i + 1);
    if (y > 0) pushIfCandidate(i - width);
    if (y < height - 1) pushIfCandidate(i + width);
  }

  const alpha = new Uint8ClampedArray(n);
  const featherRange = Math.max(1, highT - lowT);
  let midRangeCount = 0;
  for (let i = 0; i < n; i++) {
    if (!visited[i]) {
      alpha[i] = 255; // never reached from the border -> not background, full opacity
      continue;
    }
    const t = (dist[i] - lowT) / featherRange;
    const a = Math.round(Math.max(0, Math.min(1, t)) * 255);
    alpha[i] = a;
    if (a > 8 && a < 247) midRangeCount++;
  }
  return { alpha, midRangeRatio: midRangeCount / n };
}

// Bounding box of the LARGEST connected component of near-opaque pixels,
// not just "anywhere alpha is above a threshold". Stray background noise far
// from the subject (isolated AVIF block artifacts that dodge the flood-fill
// cutout) is usually a few disconnected pixels - counting it directly into a
// simple min/max scan blows the crop out to nearly the full canvas. Picking
// the largest component keeps the crop tight around the actual pet.
function subjectBoundingBox(alpha, width, height) {
  const n = width * height;
  const isSubject = new Uint8Array(n);
  for (let i = 0; i < n; i++) isSubject[i] = alpha[i] > SUBJECT_ALPHA_THRESHOLD ? 1 : 0;

  const visited = new Uint8Array(n);
  const queue = new Int32Array(n);
  let best = null;

  for (let start = 0; start < n; start++) {
    if (!isSubject[start] || visited[start]) continue;
    let qHead = 0, qTail = 0;
    visited[start] = 1;
    queue[qTail++] = start;
    let minX = width, minY = height, maxX = -1, maxY = -1, size = 0;
    while (qHead < qTail) {
      const i = queue[qHead++];
      const x = i % width, y = (i / width) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      size++;
      const neighbors = [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1,
      ];
      for (const ni of neighbors) {
        if (ni >= 0 && isSubject[ni] && !visited[ni]) {
          visited[ni] = 1;
          queue[qTail++] = ni;
        }
      }
    }
    if (!best || size > best.size) best = { minX, minY, maxX, maxY, size };
  }

  if (!best) return { left: 0, top: 0, width, height }; // nothing detected as subject, punt

  const left = Math.max(0, best.minX - BBOX_PADDING);
  const top = Math.max(0, best.minY - BBOX_PADDING);
  const right = Math.min(width - 1, best.maxX + BBOX_PADDING);
  const bottom = Math.min(height - 1, best.maxY + BBOX_PADDING);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

async function processOne(species, state, filename) {
  const srcPath = path.join(SRC_DIR, filename);
  const image = sharp(srcPath);
  const { width, height } = await image.metadata();
  const raw = await image.raw().toBuffer(); // 3-channel RGB, all sources are flat-background renders
  const distSrc = await sharp(srcPath).blur(DISTANCE_BLUR_SIGMA).raw().toBuffer(); // denoised, used only to decide alpha

  const { bg, spread } = sampleBackground(distSrc, width, height, 3);
  const lowT = spread + BG_MARGIN;
  const highT = lowT + FEATHER_WIDTH;

  const { alpha, midRangeRatio } = floodCutout(distSrc, width, height, 3, bg, lowT, highT);

  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = raw[i * 3];
    rgba[i * 4 + 1] = raw[i * 3 + 1];
    rgba[i * 4 + 2] = raw[i * 3 + 2];
    rgba[i * 4 + 3] = alpha[i];
  }

  const box = subjectBoundingBox(alpha, width, height);
  let pipeline = sharp(rgba, { raw: { width, height, channels: 4 } }).extract(box);

  if (Math.max(box.width, box.height) > MAX_DIM) {
    pipeline = pipeline.resize({
      width: MAX_DIM,
      height: MAX_DIM,
      fit: 'inside',
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3,
    });
  }

  const outBuffer = await pipeline
    .webp({ quality: 95, lossless: false, nearLossless: false, effort: 6 })
    .toBuffer();

  const outName = `${species}-${state}.webp`;
  for (const dir of OUT_DIRS) {
    await fs.promises.writeFile(path.join(dir, outName), outBuffer);
  }

  console.log(
    `${outName}: bg=rgb(${bg.map((v) => v.toFixed(1)).join(',')}) spread=${spread.toFixed(1)} ` +
    `lowT=${lowT.toFixed(1)} highT=${highT.toFixed(1)} bbox=${box.width}x${box.height} ` +
    `midRangeAlpha=${(midRangeRatio * 100).toFixed(2)}%`
  );
}

async function main() {
  const requested = process.argv.slice(2);
  const species = requested.length ? requested : Object.keys(PETS);

  for (const s of species) {
    const states = PETS[s];
    if (!states) {
      console.error(`Unknown species "${s}", expected one of: ${Object.keys(PETS).join(', ')}`);
      process.exitCode = 1;
      continue;
    }
    for (const [state, filename] of Object.entries(states)) {
      await processOne(s, state, filename);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
