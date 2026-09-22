// One-off, human-verified fix for seal-low.webp's baked-in floor shadow.
//
// Why not the mechanical detector: seal fur and the shadow occupy the exact
// same achromatic/brightness range (verified: real fur dips to channel ~49 in
// natural AO shading, the shadow's core dips to ~110, and both fade smoothly
// out to white) so no color/brightness threshold can tell them apart, and a
// pure geometry (silhouette-width) approach also risks confusion because real
// anatomy has its own decelerate/reaccelerate bumps. This fix instead uses a
// boundary manually located and visually verified against this one file: the
// silhouette's width plateaus (true anatomical "waist") from y=141 to y=192
// at roughly x=[104,412], then reaccelerates outward - the shadow's flare,
// not the pet. Only ACHROMATIC pixels past that boundary are erased, so the
// teal flipper yarn (which legitimately extends into that same column range,
// confirmed by direct pixel sampling) is left untouched.
'use strict';
const fs = require('fs');
const sharp = require('sharp');
sharp.cache(false);

const FILES = ['public/patient/img/seal-low.webp', 'mobile-build/img/seal-low.webp'];
const TRIM_START_Y = 195;   // first row of the confirmed shadow flare
const SAFE_MIN_X = 70;      // plateau bound (104) minus margin
const SAFE_MAX_X = 440;     // plateau bound (412) plus margin
const ACHROMATIC_SPREAD = 20; // only erase neutral-gray pixels; colored (flipper) pixels are preserved

(async () => {
  for (const file of FILES) {
    const { data, info } = await sharp(fs.readFileSync(file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = info;
    let erased = 0, preserved = 0;
    for (let y = TRIM_START_Y; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x >= SAFE_MIN_X && x <= SAFE_MAX_X) continue;
        const i = (y * w + x) * 4;
        if (data[i + 3] <= 128) continue;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const spread = Math.max(r, g, b) - Math.min(r, g, b);
        if (spread <= ACHROMATIC_SPREAD) { data[i + 3] = 0; erased++; }
        else preserved++;
      }
    }
    const out = await sharp(data, { raw: { width: w, height: h, channels: 4 } })
      .webp({ quality: 95, effort: 6, alphaQuality: 100 }).toBuffer();
    fs.writeFileSync(file, out);
    console.log(file, 'erased='+erased, 'preserved(colored, kept)='+preserved);
  }
})();
