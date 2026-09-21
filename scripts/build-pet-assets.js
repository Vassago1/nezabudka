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
// the source, not the raw pixels, to remove per-pixel compression noise
// before it can jitter individual pixels in and out of the cutout band.
//
// The background reference itself is a per-pixel bilinear model built from
// the four corner samples, not one flat average. Several sources (seal in
// particular) have a soft vignette - the background is legitimately ~15-20
// levels darker in one corner than another - and a single global average
// forces the cutout band wide enough to cover that whole vignette range.
// A shaded patch of fur (e.g. the seal's belly, dimmed by the scarf sitting
// on top of it) can land inside that same wide band and, because it sits
// flush against the subject's real edge, the flood fill walks straight
// through the shading gradient and paints the whole shaded patch with
// partial alpha - not random noise, a smooth misclassified gradient shaped
// exactly like the shadow that caused it. Modeling the background's own
// smooth spatial gradient and comparing each pixel to the LOCAL expected
// background color at its position collapses the cutout band down to just
// the sensor/compression noise floor (a couple of levels), which is tight
// enough that the shaded-fur gradient - a lighting effect, not a position
// effect - no longer overlaps it.
//
// The soft feather is also only ever applied in a narrow spatial band around
// the subject's actual silhouette. A contact shadow on the floor is a smooth
// gradient, but the floor itself isn't perfectly flat - compression noise or
// faint surface texture can push isolated floor pixels into the cutout band
// unpredictably, which without a spatial limit paints a patch of blotchy
// partial alpha far out in what should be plain background. Any candidate
// background pixel more than EDGE_BAND px from the real silhouette is
// hardened straight to fully transparent regardless of its color distance;
// only the pixels actually near the edge get the graduated feather.
//
// Every render also bakes in a soft contact shadow under the pet's feet,
// full opacity, that reads as a light "puddle" once composited over
// anything but a white background. Color/texture can't reliably separate
// it from the pet - the shadow blends into the belly's own soft ambient
// shading as one continuous smooth gradient - so it's trimmed geometrically
// instead: the narrowest row near the bottom (the pet's own "waist", just
// above where the shadow fans out) sets how wide the subject is allowed to
// be down there, and anything wider than that in the same band is the
// shadow's flare, not the pet. The app draws its own CSS shadow underneath
// to replace it (see the pet screen's shadow element).
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
const BG_MARGIN = 4;        // slack added on top of the measured within-patch noise floor
const FEATHER_WIDTH = 10;   // width of the soft-edge distance band
const DISTANCE_BLUR_SIGMA = 1.5; // denoises the background-distance measurement only, not the final color
const SUBJECT_ALPHA_THRESHOLD = 128; // alpha above this counts as "subject" for bounding-box purposes
const BBOX_PADDING = 24;    // extra px kept around the subject's largest component, for its own feathered edge
const CONTAMINATED_CORNER_MAX_DEV = 20; // a corner patch this internally inconsistent contains part of the subject, not flat background
const EDGE_BAND = 6;        // px; how far from the real silhouette the soft feather is allowed to reach
const SHADOW_BAND_FRACTION = 0.25; // bottom fraction of the subject's own height searched for the contact shadow's flare
const SHADOW_MAX_GROWTH_PER_ROW = 18; // px/row the silhouette is allowed to widen naturally (a flipper or paw flaring out); more than this, in one row, is a shadow starting abruptly
const SHADOW_CORE_DIST = 150; // color distance from local bg above which a pixel is confidently real material, not a fading shadow/ambient-occlusion halo
const SHADOW_CORE_MIN_PLAUSIBLE_RATIO = 0.5; // a row's core span narrower than this fraction of the running reference is treated as a fluke, not a real narrowing
const SHADOW_WING_MARGIN = 20; // px of slack added around each row's own confident-material span before anything past it counts as shadow, not pet

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

// Averages a small square patch and also reports the largest single-pixel
// deviation from that average - the local compression/sensor noise floor.
function patchStats(raw, width, px, py, channels) {
  let sr = 0, sg = 0, sb = 0, n = 0;
  const vals = [];
  for (let y = py; y < py + CORNER_PATCH; y++) {
    for (let x = px; x < px + CORNER_PATCH; x++) {
      const idx = (y * width + x) * channels;
      const r = raw[idx], g = raw[idx + 1], b = raw[idx + 2];
      sr += r; sg += g; sb += b; n++;
      vals.push([r, g, b]);
    }
  }
  const avg = [sr / n, sg / n, sb / n];
  let maxDev = 0;
  for (const [r, g, b] of vals) {
    maxDev = Math.max(maxDev, Math.sqrt(colorDistSq(r, g, b, avg[0], avg[1], avg[2])));
  }
  return { avg, maxDev };
}

// Builds a per-pixel background model by bilinearly interpolating the four
// corner averages across the canvas, so a vignetted/gradient background is
// compared against its own local expected value rather than one flat
// average. Also returns the background noise floor (the worst within-patch
// deviation seen in any corner), which is a much tighter number than the
// corner-to-corner spread a flat model would need to cover.
//
// Not every source keeps all four corners clear - a curled-up pose can put
// part of the subject right in a corner (seal-low, seal-verylow both do).
// A corner patch that straddles subject and background has a huge internal
// deviation - nothing like the few-levels noise floor a flat patch has - so
// any corner over CONTAMINATED_CORNER_MAX_DEV is treated as unreliable,
// dropped from the noise-floor measurement, and its average is replaced
// with the average of the remaining clean corners instead of trusting it.
function backgroundModel(raw, width, height, channels) {
  const corners = {
    tl: patchStats(raw, width, 0, 0, channels),
    tr: patchStats(raw, width, width - CORNER_PATCH, 0, channels),
    bl: patchStats(raw, width, 0, height - CORNER_PATCH, channels),
    br: patchStats(raw, width, width - CORNER_PATCH, height - CORNER_PATCH, channels),
  };

  const cleanKeys = Object.keys(corners).filter((k) => corners[k].maxDev <= CONTAMINATED_CORNER_MAX_DEV);
  if (cleanKeys.length === 0) {
    throw new Error('All four corner patches look contaminated by the subject - cannot locate a background reference');
  }
  const cleanAvg = [0, 0, 0];
  for (const k of cleanKeys) {
    for (let c = 0; c < 3; c++) cleanAvg[c] += corners[k].avg[c];
  }
  for (let c = 0; c < 3; c++) cleanAvg[c] /= cleanKeys.length;

  for (const k of Object.keys(corners)) {
    if (corners[k].maxDev > CONTAMINATED_CORNER_MAX_DEV) corners[k] = { avg: cleanAvg, maxDev: 0, contaminated: true };
  }

  const { tl, tr, bl, br } = corners;
  const noise = Math.max(...cleanKeys.map((k) => corners[k].maxDev));

  const at = (x, y) => {
    const fx = x / (width - 1);
    const fy = y / (height - 1);
    const out = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const top = tl.avg[c] * (1 - fx) + tr.avg[c] * fx;
      const bottom = bl.avg[c] * (1 - fx) + br.avg[c] * fx;
      out[c] = top * (1 - fy) + bottom * fy;
    }
    return out;
  };
  const contaminated = Object.keys(corners).filter((k) => corners[k].contaminated);
  return { at, noise, contaminated, corners: { tl: tl.avg, tr: tr.avg, bl: bl.avg, br: br.avg } };
}

// 4-connected component labeling of a binary mask. Returns a label per pixel
// (-1 where the mask is false) and each component's pixel count.
function connectedComponents(mask, width, height) {
  const n = width * height;
  const label = new Int32Array(n).fill(-1);
  const sizes = [];
  const queue = new Int32Array(n);
  let nextLabel = 0;
  for (let start = 0; start < n; start++) {
    if (!mask[start] || label[start] !== -1) continue;
    let qHead = 0, qTail = 0;
    label[start] = nextLabel;
    queue[qTail++] = start;
    let size = 0;
    while (qHead < qTail) {
      const i = queue[qHead++];
      const x = i % width, y = (i / width) | 0;
      size++;
      const neighbors = [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1,
      ];
      for (const ni of neighbors) {
        if (ni >= 0 && mask[ni] && label[ni] === -1) {
          label[ni] = nextLabel;
          queue[qTail++] = ni;
        }
      }
    }
    sizes.push(size);
    nextLabel++;
  }
  return { label, sizes };
}

// Flood-fill chroma key. `candidate` marks every pixel within highT of the
// LOCAL background reference color. Only candidates *reachable from the
// image border* through other candidates are ever cut out - an interior
// pixel that coincidentally falls in the same distance band (a pale scarf
// edge against pale fur, for instance) but is fully surrounded by opaque
// subject pixels never gets touched, no matter how close its color is to
// the background sample.
//
// Before that flood fill runs, every "not background colored" pixel is
// grouped into connected components and only the largest is trusted as the
// actual pet - smaller islands (an isolated fleck of floor texture whose
// color happens to fall outside the cutout band, a stray sensor artifact)
// are folded back into the background candidate set instead of being kept
// as full-opacity noise specks.
function floodCutout(raw, width, height, channels, bgModel, lowT, highT) {
  const n = width * height;
  const dist = new Float32Array(n);
  const candidate = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const idx = i * channels;
      const bg = bgModel.at(x, y);
      const d = Math.sqrt(colorDistSq(raw[idx], raw[idx + 1], raw[idx + 2], bg[0], bg[1], bg[2]));
      dist[i] = d;
      candidate[i] = d <= highT ? 1 : 0;
    }
  }

  const notCandidate = new Uint8Array(n);
  for (let i = 0; i < n; i++) notCandidate[i] = candidate[i] ? 0 : 1;
  const { label, sizes } = connectedComponents(notCandidate, width, height);
  let largestLabel = -1, largestSize = -1;
  sizes.forEach((size, idx) => {
    if (size > largestSize) { largestSize = size; largestLabel = idx; }
  });
  const trueSubject = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (label[i] === -1) continue;
    if (label[i] === largestLabel) trueSubject[i] = 1;
    else candidate[i] = 1; // stray island, not the pet - treat it as background candidate instead
  }

  // The renders all come with a soft contact shadow baked into the floor,
  // which is part of the largest component (it touches the feet) and reads
  // as "not background colored" - so without this step it stays a fully
  // opaque light patch under the pet instead of fading into whatever scene
  // the app composites it over.
  //
  // Two different shadow shapes show up, and only one signal is safe for
  // each. Some shadows start with an abrupt step (the seal's paw plants on
  // a floor, then the shadow flares hard) - geometry alone catches that:
  // real anatomy widens a silhouette by a few px per row, so a jump bigger
  // than SHADOW_MAX_GROWTH_PER_ROW in a single row is the shadow starting,
  // not the pet. That check is tried first, on trueSubject's full width -
  // no color reasoning involved, so it can't be fooled by a pale belly.
  //
  // Other shadows fade in gradually with no jump at all (a pot's base
  // ambient-occlusion halo widening in lockstep with the pot's own taper) -
  // the growth-rate check finds nothing to freeze on and leaves the row
  // untouched. Only in that case - when tier one comes up empty for the
  // whole band - does a second pass fall back to color: measure each row's
  // width using only pixels confidently far from the background color
  // (SHADOW_CORE_DIST), which a smooth low-contrast halo never reaches even
  // as it widens. This pass is never applied to a subject the first pass
  // already found a shadow-onset row in, because a pale subject (the
  // seal's white belly) can have long stretches where even real fur
  // doesn't clear SHADOW_CORE_DIST while a stray dark fleck (a whisker, a
  // scarf thread) does, which is exactly the kind of subject the abrupt-
  // jump case already covers correctly - re-running the color-based pass
  // over it risks collapsing a row's width down to a sliver around that one
  // fleck. A running reference span guards against that collapse even in
  // the fallback case: a new row only replaces the reference when its own
  // core is a plausible continuation (at least half the reference's
  // width), so a single implausible sliver keeps trimming against the last
  // good reference instead of erasing the row.
  let subjectMinY = height, subjectMaxY = -1;
  for (let i = 0; i < n; i++) {
    if (!trueSubject[i]) continue;
    const y = (i / width) | 0;
    if (y < subjectMinY) subjectMinY = y;
    if (y > subjectMaxY) subjectMaxY = y;
  }
  if (subjectMaxY >= 0) {
    const bandTop = subjectMaxY - Math.round((subjectMaxY - subjectMinY) * SHADOW_BAND_FRACTION);

    // Tier 1: abrupt-jump detection on the full (non-color-filtered) width.
    let allowedMinX = null, allowedMaxX = null;
    let jumpFrozen = false;
    let freezeStartY = -1;
    for (let y = bandTop; y <= subjectMaxY; y++) {
      let minX = -1, maxX = -1;
      for (let x = 0; x < width; x++) {
        if (trueSubject[y * width + x]) {
          if (minX === -1) minX = x;
          maxX = x;
        }
      }
      if (minX === -1) continue;
      if (jumpFrozen) continue;
      if (allowedMinX === null) {
        allowedMinX = minX;
        allowedMaxX = maxX;
      } else {
        const growLeft = allowedMinX - minX;
        const growRight = maxX - allowedMaxX;
        if (growLeft > SHADOW_MAX_GROWTH_PER_ROW || growRight > SHADOW_MAX_GROWTH_PER_ROW) {
          jumpFrozen = true;
          freezeStartY = y;
        } else {
          allowedMinX = minX;
          allowedMaxX = maxX;
        }
      }
    }

    if (jumpFrozen) {
      const safeMinX = allowedMinX - SHADOW_WING_MARGIN;
      const safeMaxX = allowedMaxX + SHADOW_WING_MARGIN;
      for (let y = freezeStartY; y <= subjectMaxY; y++) {
        for (let x = 0; x < width; x++) {
          if (x >= safeMinX && x <= safeMaxX) continue;
          const i = y * width + x;
          if (trueSubject[i]) { trueSubject[i] = 0; candidate[i] = 1; }
        }
      }
    } else {
      // Tier 2: no abrupt jump anywhere in the band - fall back to a
      // color+geometry combination for a gradually fading halo instead.
      let refMinX = null, refMaxX = null;
      for (let y = bandTop; y <= subjectMaxY; y++) {
        let minX = -1, maxX = -1;
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          if (trueSubject[i] && dist[i] > SHADOW_CORE_DIST) {
            if (minX === -1) minX = x;
            maxX = x;
          }
        }

        if (minX !== -1) {
          const refWidth = refMinX === null ? -1 : refMaxX - refMinX;
          const rowWidth = maxX - minX;
          if (refMinX === null || rowWidth >= refWidth * SHADOW_CORE_MIN_PLAUSIBLE_RATIO) {
            refMinX = minX;
            refMaxX = maxX;
          }
          // else: an implausible sliver next to the established reference
          // (likely a lone dark fleck on otherwise pale material) - keep
          // the existing reference instead of snapping to it
        }

        if (refMinX === null) continue; // no plausible reference established yet this low - leave the row alone

        const safeMinX = refMinX - SHADOW_WING_MARGIN;
        const safeMaxX = refMaxX + SHADOW_WING_MARGIN;
        for (let x = 0; x < width; x++) {
          if (x >= safeMinX && x <= safeMaxX) continue;
          const i = y * width + x;
          if (trueSubject[i]) { trueSubject[i] = 0; candidate[i] = 1; }
        }
      }
    }
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

  // Spatial (pixel-count) BFS distance from the true subject's silhouette,
  // traveling only through background-connected cells. Used to confine the
  // soft feather to a thin band around the real edge - see EDGE_BAND above.
  const spatialDist = new Int32Array(n).fill(-1);
  const edgeQueue = new Int32Array(n);
  let eHead = 0, eTail = 0;
  for (let i = 0; i < n; i++) {
    if (!trueSubject[i]) continue;
    const x = i % width, y = (i / width) | 0;
    const neighbors = [
      x > 0 ? i - 1 : -1,
      x < width - 1 ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y < height - 1 ? i + width : -1,
    ];
    for (const ni of neighbors) {
      if (ni >= 0 && visited[ni] && spatialDist[ni] === -1) {
        spatialDist[ni] = 1;
        edgeQueue[eTail++] = ni;
      }
    }
  }
  while (eHead < eTail) {
    const i = edgeQueue[eHead++];
    const x = i % width, y = (i / width) | 0;
    const d = spatialDist[i];
    const neighbors = [
      x > 0 ? i - 1 : -1,
      x < width - 1 ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y < height - 1 ? i + width : -1,
    ];
    for (const ni of neighbors) {
      if (ni >= 0 && visited[ni] && spatialDist[ni] === -1) {
        spatialDist[ni] = d + 1;
        edgeQueue[eTail++] = ni;
      }
    }
  }

  const alpha = new Uint8ClampedArray(n);
  const featherRange = Math.max(1, highT - lowT);
  let midRangeCount = 0;
  for (let i = 0; i < n; i++) {
    if (trueSubject[i]) { alpha[i] = 255; continue; }
    if (!visited[i]) { alpha[i] = 255; continue; } // isolated bg-colored pocket fully inside the subject (an eye highlight, etc.)
    const sd = spatialDist[i];
    if (sd === -1 || sd > EDGE_BAND) { alpha[i] = 0; continue; } // far from any real edge - hard background
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

  const bgModel = backgroundModel(distSrc, width, height, 3);
  const lowT = bgModel.noise + BG_MARGIN;
  const highT = lowT + FEATHER_WIDTH;

  const { alpha, midRangeRatio } = floodCutout(distSrc, width, height, 3, bgModel, lowT, highT);

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
    `${outName}: cornerTL=rgb(${bgModel.corners.tl.map((v) => v.toFixed(1)).join(',')}) ` +
    `noise=${bgModel.noise.toFixed(2)}${bgModel.contaminated.length ? ' contaminated=' + bgModel.contaminated.join(',') : ''} ` +
    `lowT=${lowT.toFixed(1)} highT=${highT.toFixed(1)} ` +
    `bbox=${box.width}x${box.height} midRangeAlpha=${(midRangeRatio * 100).toFixed(2)}%`
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

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
