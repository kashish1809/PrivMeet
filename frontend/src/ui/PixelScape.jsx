import { useEffect, useRef, useState } from "react";

import { cx } from "./cx";

/**
 * PrivMeet's pixel landscapes, drawn pixel by pixel on a small canvas and scaled up crisply
 * (each art pixel is PX CSS pixels). Two scenes share one style:
 *
 * - "lake" (Home footer): fractal ridges over a lake that mirrors them; the moon's (or sun's)
 *   path on the water breaks into an audio waveform; a rocky shore with a radio mast sending
 *   signal arcs, a dock with a lantern post, grass with fireflies by night and flowers by day,
 *   and speech-bubble lanterns (the PrivMeet mark) floating in the sky.
 * - "clouds" (hero card): the same peaks seen from above a sea of clouds. Still: no overlays.
 *
 * Night (dark themes): indigo-to-violet sky, stars, a shooting star, a faint aurora and a
 * cratered moon. Day (light themes): a warm horizon band, layered clouds and a banded sun.
 * Mountains are shaded from their own slope (lit, mid, shadow), with rock texture, snow above
 * a ragged snowline and mist pooling between ridges.
 *
 * Colors come from the theme's --color-primary-* / --color-zinc-* variables, so the presets
 * re-tint it. It redraws only when the size or the theme changes, never per frame; the only
 * motion is CSS on a few small overlays of the lake scene, off for reduced motion.
 */

const PX = 4; // CSS pixels per art pixel
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const dither = (x, y) => BAYER[((y & 3) << 2) | (x & 3)];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap 2D hash noise in 0..1, for texture. */
function hash(x, y, s) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 1D midpoint-displacement ridge, length n, values 0..1. `rough` < 1 = smoother. */
function fractal(rand, n, rough) {
  let size = 1;
  while (size < n) size *= 2;
  const v = new Float32Array(size + 1);
  v[0] = rand();
  v[size] = rand();
  for (let step = size, amp = 0.9; step > 1; step /= 2, amp *= rough) {
    for (let i = step / 2; i < size; i += step) {
      v[i] = (v[i - step / 2] + v[i + step / 2]) / 2 + (rand() - 0.5) * amp;
    }
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i += 1) {
    lo = Math.min(lo, v[i]);
    hi = Math.max(hi, v[i]);
  }
  return Array.from({ length: n }, (_, i) => (v[i] - lo) / (hi - lo || 1));
}

/**
 * Altitude (art pixels above the horizon) per column for one mountain layer, and which peak
 * owns each column. Peaks sit at random places with heights from `lo` to `hi`, steep uneven
 * flanks and the odd shoulder, so the skyline is jagged and never a row of equal teeth.
 */
function peaks(rand, w, count, lo, hi, steep) {
  const list = [];
  for (let i = 0; i < count; i += 1) {
    const c = Math.round((rand() * 1.15 - 0.075) * w);
    const top = lo + (hi - lo) * rand() ** 1.4;
    const left = steep * (0.7 + rand() * 0.8);
    const right = steep * (0.7 + rand() * 0.8);
    list.push({ c, top, left, right });
    if (rand() < 0.55) {
      const side = rand() < 0.5 ? -1 : 1;
      const off = Math.round(top * (0.35 + rand() * 0.35) / steep);
      list.push({ c: c + side * off, top: top * (0.6 + rand() * 0.2), left, right });
    }
  }
  const edge = fractal(rand, w, 0.75);
  const alt = new Float32Array(w);
  const owner = new Int16Array(w);
  for (let x = 0; x < w; x += 1) {
    let best = lo * 0.5;
    let bi = 0;
    list.forEach((pk, k) => {
      const v = pk.top - Math.abs(x - pk.c) * (x < pk.c ? pk.left : pk.right);
      if (v > best) {
        best = v;
        bi = k;
      }
    });
    alt[x] = Math.max(1, best + (edge[x] - 0.5) * 2.5);
    owner[x] = bi;
  }
  return { list, alt, owner };
}

/** Theme color as [r, g, b]: Tailwind v4 defines oklch(), so let the browser convert it. */
function readColor(probe, name, fallback) {
  const g = probe.getContext("2d", { willReadFrequently: true });
  g.clearRect(0, 0, 1, 1);
  g.fillStyle = fallback;
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  g.fillRect(0, 0, 1, 1);
  const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
  return [r, gr, b];
}

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

/** Props every world can need, in either mode. The themed palettes override these; a custom
 *  theme can put any world in any mode, so each one must exist everywhere. */
const PROPS = {
  petal: [255, 183, 213],
  blossom: [[255, 205, 225], [244, 143, 186], [190, 70, 120]],
  pine: [[12, 40, 28], [26, 72, 50]],
  balloon: [[240, 90, 60], [255, 200, 90], [90, 160, 220], [250, 245, 235]],
  ice: [[245, 252, 255], [190, 228, 248], [120, 180, 220]],
  cactus: [70, 120, 80],
};

function palette() {
  return { ...PROPS, ...themedPalette() };
}

function themedPalette() {
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const p = (n) => readColor(probe, `--color-primary-${n}`, "#6366f1");
  const z = (n) => readColor(probe, `--color-zinc-${n}`, "#18181b");
  const root = document.documentElement;
  // Which world the theme lives in; each has its own easter eggs (see render()).
  // A custom theme names its landscape in data-scene; otherwise the theme id is the world.
  const biome = root.dataset.scene || root.dataset.theme || (root.classList.contains("dark") ? "indigo" : "slate");
  // A second hue so the scene is not one tone: violet by default, magenta under the cherry
  // blossom, a cold blue-green in the pine forest.
  const second = { rose: [217, 70, 239], forest: [45, 170, 160] }[biome] || [168, 85, 247];
  const violet = mix(p(500), second, 0.45);
  if (root.classList.contains("dark")) {
    if (biome === "amber") {
      // Warm dusk over a desert: red rock, a big harvest moon low over the mesas.
      const sand = [214, 160, 110];
      return {
        dark: true,
        biome,
        sky: [mix(z(950), p(950), 0.35), mix(p(950), z(900), 0.3), mix(p(900), [120, 50, 60], 0.35), mix(p(800), [190, 80, 60], 0.4), mix(p(600), [240, 140, 80], 0.45)],
        celestial: mix(p(200), [255, 220, 170], 0.5),
        celestialDeep: mix(p(400), [230, 120, 70], 0.4),
        glow: mix(p(500), [240, 120, 60], 0.4),
        star: mix(WHITE, p(100), 0.3),
        aurora: null,
        cloud: [mix(p(300), [255, 190, 140], 0.4), mix(p(800), [140, 70, 60], 0.4), mix(p(900), z(900), 0.45), mix(z(950), p(950), 0.4)],
        ridges: [mix(p(700), [170, 90, 70], 0.45), mix(p(800), [150, 70, 50], 0.5), mix(p(900), [110, 50, 40], 0.5), mix(p(950), z(900), 0.5), mix(z(950), p(950), 0.5)],
        light: mix(p(300), [255, 200, 150], 0.5),
        snow: mix(p(200), sand, 0.5),
        mist: mix(p(700), [200, 110, 80], 0.45),
        water: [mix(p(800), [150, 70, 60], 0.35), mix(z(950), p(950), 0.6)],
        ground: [mix(z(900), [90, 55, 40], 0.45), mix(z(950), BLACK, 0.35)],
        grass: mix(p(800), [90, 120, 60], 0.35),
        wood: mix(z(800), [110, 70, 40], 0.5),
        metal: p(300),
        bloom: [mix(p(300), [253, 224, 71], 0.6)],
        cactus: mix([60, 110, 70], z(800), 0.35),
      };
    }
    return {
      dark: true,
      biome,
      sky: [mix(z(950), p(950), 0.3), mix(p(950), z(950), 0.2), p(950), mix(p(900), violet, 0.3), mix(p(800), violet, 0.45)],
      celestial: mix(p(100), WHITE, 0.5),
      celestialDeep: mix(p(200), p(400), 0.4),
      glow: mix(p(500), violet, 0.3),
      star: WHITE,
      aurora: mix(p(300), [94, 234, 212], 0.55),
      cloud: [mix(p(300), z(400), 0.45), mix(p(900), z(700), 0.45), mix(p(950), z(800), 0.4), mix(z(950), p(950), 0.4)],
      ridges: [mix(p(700), violet, 0.35), mix(p(800), p(700), 0.4), p(900), mix(p(950), p(900), 0.4), mix(z(950), p(950), 0.5)],
      light: mix(p(200), WHITE, 0.3), // what the moon paints on lit faces
      snow: mix(p(100), WHITE, 0.55),
      mist: mix(p(700), violet, 0.4),
      water: [mix(p(900), violet, 0.25), mix(z(950), p(950), 0.6)],
      ground: [mix(z(950), p(950), 0.35), mix(z(950), BLACK, 0.35)],
      grass: mix(p(900), [40, 120, 110], 0.25),
      wood: mix(z(800), p(900), 0.4),
      metal: p(300),
      bloom: [mix(p(300), [253, 224, 71], 0.6)],
      // teal: a greener aurora over a fjord; sakura: a pink one; pine: a green one
      ...(biome === "teal" ? { aurora: mix(p(300), [110, 255, 170], 0.5) } : {}),
      ...(biome === "rose" ? { aurora: mix(p(300), [255, 150, 210], 0.5), petal: [255, 183, 213], blossom: [[255, 205, 225], [244, 143, 186], [190, 70, 120]] } : {}),
      ...(biome === "forest" ? { aurora: mix(p(300), [130, 255, 160], 0.55), snow: mix(p(100), WHITE, 0.7), pine: [mix(z(950), [10, 45, 30], 0.6), mix(z(900), [20, 70, 45], 0.55)] } : {}),
    };
  }
  // Light themes. The horizon is warm by default; Glacier keeps it ice-cold, Dawn pushes it to
  // a full sunrise.
  const horizon = { glacier: [[200, 236, 255], [170, 220, 250]], dawn: [[255, 200, 160], [255, 160, 120]] }[biome] || [[255, 214, 186], [255, 190, 160]];
  return {
    dark: false,
    biome,
    sky: [mix(p(100), WHITE, 0.45), mix(p(100), WHITE, 0.2), p(100), mix(p(100), horizon[0], 0.45), mix(p(200), horizon[1], 0.55)],
    celestial: mix([255, 186, 84], p(200), 0.15),
    celestialDeep: mix([244, 114, 72], p(400), 0.2),
    glow: mix([255, 214, 160], p(100), 0.3),
    star: p(300),
    cloud: [WHITE, mix(WHITE, p(100), 0.55), mix(p(200), horizon[0], 0.4), mix(p(300), p(400), 0.35)],
    ridges: [mix(p(200), [255, 200, 190], 0.3), mix(p(300), p(200), 0.4), p(400), mix(p(500), p(600), 0.5), mix(p(700), p(800), 0.5)],
    light: mix([255, 214, 160], WHITE, 0.3),
    snow: WHITE,
    mist: mix(WHITE, p(100), 0.4),
    water: [mix(p(200), [255, 214, 186], 0.3), mix(p(400), p(500), 0.5)],
    ground: [mix(p(700), p(800), 0.4), mix(p(900), p(950), 0.5)],
    grass: mix(p(600), [34, 160, 110], 0.35),
    wood: mix(p(800), [120, 72, 48], 0.5),
    metal: p(700),
    bloom: [[251, 113, 133], [250, 204, 21], WHITE],
    // Glacier: a pale winter sun and more snow; Dawn: a low, red sun.
    ...(biome === "glacier" ? { celestial: [255, 250, 225], celestialDeep: [210, 235, 250], glow: [225, 245, 255], ice: [[245, 252, 255], [190, 228, 248], [120, 180, 220]] } : {}),
    ...(biome === "dawn" ? { celestial: [255, 150, 90], celestialDeep: [235, 80, 60], glow: [255, 200, 150], balloon: [[240, 90, 60], [255, 200, 90], [90, 160, 220], [250, 245, 235]] } : {}),
  };
}

function render(ctx, w, h, seed, opts, pal) {
  const rand = rng(seed);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    d[i + 3] = 255;
  };
  const get = (x, y) => {
    const i = (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4;
    return [d[i], d[i + 1], d[i + 2]];
  };
  const blend = (x, y, c, t) => put(x, y, mix(get(x, y), c, t));

  /**
   * A cloud mass the way pixel artists draw one: the billows (circles) merge into one shape
   * with a flat belly at `floor`, then clean tones, no dither noise:
   *   a bright rim along the top, a light body, a shaded lower band, a dark line at the base,
   *   the side of each lobe that faces away from the light in shade,
   *   and a short shade line where one lobe sits in front of the next, so lobes read apart.
   * `haze` pulls every tone toward `hazeColor` (for far clouds).
   */
  const cloudMass = (billows, lightX, floor, flat = 0.7, haze = 0, hazeColor = null) => {
    const x0 = Math.floor(Math.min(...billows.map((b) => b.c - b.r)));
    const x1 = Math.ceil(Math.max(...billows.map((b) => b.c + b.r)));
    const tops = [];
    let highest = floor;
    for (let x = x0; x <= x1; x += 1) {
      let top = Infinity;
      let owner = -1;
      billows.forEach((b, k) => {
        const u = x - b.c;
        if (Math.abs(u) > b.r) return;
        const t = b.cy - Math.sqrt(b.r * b.r - u * u) * flat;
        if (t < top) {
          top = t;
          owner = k;
        }
      });
      tops.push({ x, top: Math.round(top), owner });
      if (owner >= 0) highest = Math.min(highest, Math.round(top));
    }
    const tone = (c) => (haze ? mix(c, hazeColor, haze) : c);
    tops.forEach(({ x, top, owner }, n) => {
      if (owner < 0 || top >= floor) return;
      const b = billows[owner];
      const away = Math.sign(x - b.c) !== Math.sign(lightX - b.c) && Math.abs(x - b.c) > b.r * 0.45;
      // a lobe edge: the neighbour column belongs to another billow whose top is lower
      const prev = tops[n - 1];
      const next = tops[n + 1];
      const edge = [prev, next].some((o) => o && o.owner >= 0 && o.owner !== owner && o.top > top + 1);
      for (let y = top; y <= floor; y += 1) {
        const depth = y - top;
        const lobe = b.r * flat; // how far this lobe hangs below its own crown
        let c = pal.cloud[1];
        if (depth === 0 || (depth <= 2 && !away && Math.abs(x - b.c) < b.r * 0.6)) c = pal.cloud[0];
        if (depth > lobe * 0.8 || (away && depth > 1)) c = pal.cloud[2];
        if (depth > lobe * 1.6) c = pal.cloud[3];
        if (edge && depth > 0 && depth < Math.max(3, lobe * 0.5)) c = pal.cloud[2];
        if (y === floor) c = pal.cloud[3];
        put(x, y, tone(c));
      }
    });
  };

  /**
   * One bank of the hero's cloud sea, painted the way pixel artists paint cumulus: round puffs
   * stacked on each other, each one shaded as a sphere lit by the moon or sun, its light
   * quantised into five tones with dithering between them. Higher puffs are painted first and
   * the lower ones overlap them, so every puff's lit crown sits against the shaded belly of
   * the one behind it, which separates them without any outline. Below the puffs the bank is
   * a solid mass that falls into shadow; the next bank forward covers it.
   *
   * (The first version drew a dark seam wherever two lobes met, which on dozens of lobes read
   * as a muddy jumble; the second used long flat lobes that read as striped rock strata.)
   */
  const cloudBank = ({ baseY, size, lightX, lightY, haze, hazeColor, ramp, glow }) => {
    const puffs = [];
    for (let x = -size + rand() * size; x < w + size; ) {
      const r = size * (0.8 + rand() * 0.5);
      puffs.push({ c: x, cy: baseY + (rand() - 0.5) * size * 0.3, r });
      // about half carry a smaller puff on top: enough to make the silhouette billow, few
      // enough that the bank does not turn into a field of pebbles
      if (rand() < 0.5) {
        const rr = r * (0.5 + rand() * 0.2);
        puffs.push({ c: x + (rand() - 0.5) * r * 0.6, cy: baseY - r * (0.5 + rand() * 0.2), r: rr });
      }
      x += r * (1.0 + rand() * 0.5);
    }
    const tones = ramp.map((c) => (haze ? mix(c, hazeColor, haze) : c)); // deep .. rim
    // The bank's body comes first, below the puffs, falling from shade into the deep tone.
    // Painted after them it sliced their lower halves off flat.
    const bodyTop = Math.round(baseY + size * 0.45);
    for (let y = Math.max(0, bodyTop); y < h; y += 1) {
      const f = (y - bodyTop) / Math.max(4, h - bodyTop);
      for (let x = 0; x < w; x += 1) put(x, y, tones[f * 1.4 > dither(x, y) ? 0 : 1]);
    }
    paintPuffs(puffs, tones, lightX, glow);
    void lightY;
  };

  /**
   * Paint round cloud puffs, higher ones first so lower ones overlap them, each lit as a ball
   * of scattering vapour. `clipY` gives a cloud a flat base (a small sky cloud); the tones run
   * from the deepest shade to the rim light.
   */
  const paintPuffs = (puffs, tones, lightX, glow, clipY = Infinity) => {
    puffs.sort((a, b) => a.cy - b.cy); // back (higher) first, front (lower) last
    const levels = tones.length - 1;
    const shadeAt = (x, y, light) => {
      // light 0..1 -> one of the five tones. Flat tones, dithered only in a narrow strip at
      // each boundary: dithering the whole range made every puff a checkerboard.
      const f = Math.min(levels, Math.max(0, light * levels));
      const k = Math.floor(f);
      const frac = f - k;
      const up = frac > 0.62 || (frac > 0.38 && (frac - 0.38) / 0.24 > dither(x, y));
      return tones[Math.min(levels, up ? k + 1 : k)];
    };
    for (const pf of puffs) {
      const lx = Math.sign(lightX - pf.c) * 0.55;
      const ly = -0.75; // the light is always above the cloud tops
      const warm = glow ? Math.max(0, 1 - Math.abs(pf.c - lightX) / (w * 0.4)) * 0.18 : 0;
      for (let y = Math.floor(pf.cy - pf.r); y <= Math.min(clipY, Math.ceil(pf.cy + pf.r)); y += 1) {
        for (let x = Math.floor(pf.c - pf.r); x <= Math.ceil(pf.c + pf.r); x += 1) {
          const nx = (x - pf.c) / pf.r;
          const ny = (y - pf.cy) / pf.r;
          const rr = nx * nx + ny * ny;
          if (rr > 1) continue;
          const nz = Math.sqrt(1 - rr);
          // Wrapped light: a cloud scatters light, so it bleeds round the side instead of
          // stopping at a hard terminator. Plain lambert made each puff a stone ball.
          const lambert = nx * lx + ny * ly + nz * 0.35;
          const wrapped = (lambert + 0.75) / 1.75;
          // the flat base of a small cloud sits in its own shade
          const base = y >= clipY - 1 ? 0.18 : 0;
          put(x, y, shadeAt(x, y, Math.min(1, wrapped * 0.9 + 0.12 + warm - base)));
        }
      }
    }
  };

  /** Draw an ASCII sprite: each character is a key of `colors`, "." is transparent. */
  const sprite = (rows, x0, y0, colors) => {
    rows.forEach((row, dy) => {
      [...row].forEach((ch, dx) => {
        if (ch !== "." && colors[ch]) put(x0 + dx, y0 + dy, colors[ch]);
      });
    });
  };

  // ---- Props for the newer themes, shared by both scenes.
  const CHERRY = [
    "....bBBb......",
    "..bBBPPBBb....",
    ".bBPPPPPPBb...",
    "bBPPbPPPPPBb..",
    ".BPPPPPbPPPB..",
    "..bBPPPPPBb...",
    "....bBTBb.....",
    "......T.......",
    "......TT......",
    ".......T......",
    ".......T......",
    "......TTT.....",
  ];
  const PINE = [
    ["..X..", ".XXX.", "..X..", ".XXX.", "XXXXX", ".XXX.", "XXXXX", "..T.."],
    ["..X..", ".XXX.", "XXXXX", "..X..", ".XXX.", "XXXXX", "..T..", "..T.."],
    ["...X...", "..XXX..", ".XXXXX.", "...X...", "..XXX..", ".XXXXX.", "XXXXXXX", "...T...", "...T..."],
  ];
  const BALLOON = [
    "..AAAAA..",
    ".ABBABBA.",
    "ABBAABBAA",
    "ABBAABBAA",
    "AABBAABBA",
    ".ABBAABB.",
    "..ABBAA..",
    "...AAA...",
    "...c.c...",
    "...DDD...",
    "...DDD...",
  ];
  const BERG = [
    ".....I.........",
    "....IIL........",
    "...IIILL...I...",
    "..IIIIILL.IIL..",
    ".IIIIIIIILIIIL.",
    "IIIIIIIIIIIIILL",
    "WWWWWWWWWWWWWWW",
  ];
  /** Petals: single pink pixels, a few with a paler neighbour, scattered over an area. */
  const petals = (n, x0, x1, y0, y1) => {
    for (let i = 0; i < n; i += 1) {
      const x = Math.round(x0 + rand() * (x1 - x0));
      const y = Math.round(y0 + rand() * (y1 - y0));
      put(x, y, pal.petal);
      if (rand() < 0.4) blend(x + 1, y, pal.petal, 0.5);
    }
  };
  /** A hot-air balloon in one of the theme's colour pairs. */
  const balloon = (x, y, k) => {
    const [a, b] = [pal.balloon[k % 4], pal.balloon[(k + 1) % 4]];
    sprite(BALLOON, x, y, { A: a, B: b, c: mix(pal.wood, BLACK, 0.2), D: pal.wood });
  };

  const lake = opts.scene === "lake";

  // ---- Meadow, the special day world and Neon Drive's counterpart: a summer afternoon with
  // towering cumulus over rolling green hills, a lone round tree, wildflowers in the grass and a
  // few birds. Built only from shapes this renderer already draws well: puffs and smooth curves.
  if (pal.biome === "meadow") {
    const ov = { lanterns: [], blinks: [], sparks: [], beams: [], fires: [], kites: [], planes: [] };
    const hex = (v) => [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    const SKY = [0x3d9be0, 0x5fb2ea, 0x8acbf2, 0xb6e0f8, 0xdff2fc].map(hex);
    const CLOUD = [0x9db9d6, 0xc3d8ea, 0xe2edf7, 0xf3f8fd, 0xffffff].map(hex);
    const LEAF = [0x24561d, 0x2f6e25, 0x438f31, 0x62ad45, 0x8dcb62].map(hex);
    const FLOWERS = [0xff5d73, 0xffd23f, 0xffffff, 0xc084fc, 0xff8fb1].map(hex);
    const horizon = Math.round(h * (lake ? 0.58 : 0.7));
    const sunX = Math.round(w * (lake ? 0.82 : opts.orbX));
    const sunY = Math.round(horizon * 0.22);
    const sunR = Math.max(4, Math.round(h * 0.07));

    // sky, deep blue at the top to pale at the horizon, dithered
    for (let y = 0; y < h; y += 1) {
      const f = Math.min(1, y / horizon) * (SKY.length - 1);
      const k = Math.floor(f);
      for (let x = 0; x < w; x += 1) put(x, y, f - k > dither(x, y) ? SKY[Math.min(SKY.length - 1, k + 1)] : SKY[k]);
    }
    // the sun: a bright disc in a wide soft glow
    for (let y = Math.max(0, sunY - sunR * 4); y < sunY + sunR * 4; y += 1) {
      for (let x = Math.max(0, sunX - sunR * 4); x < Math.min(w, sunX + sunR * 4); x += 1) {
        const d = Math.hypot(x - sunX, y - sunY);
        if (d <= sunR) put(x, y, d < sunR - 1 ? hex(0xfffbe6) : hex(0xffefb0));
        else if (d < sunR * 4 && (1 - d / (sunR * 4)) * 0.6 > dither(x, y)) blend(x, y, hex(0xfff6d2), 0.35);
      }
    }
    // towering cumulus: each a column of puffs, broad at the base, lit from the sun
    const cloud = (cx, base, size) => {
      const puffs = [];
      for (let k = -2; k <= 2; k += 1) {
        const r = size * (0.55 - Math.abs(k) * 0.08) * (0.9 + rand() * 0.25);
        puffs.push({ c: cx + k * size * 0.42, cy: base - r * 0.3, r });
      }
      for (let k = 0; k < 3; k += 1) {
        const r = size * (0.45 - k * 0.08);
        puffs.push({ c: cx + (rand() - 0.5) * size * 0.5, cy: base - size * (0.45 + k * 0.38), r });
      }
      paintPuffs(puffs, CLOUD, sunX, null, Math.round(base));
    };
    const cloudY = Math.round(horizon * (lake ? 0.62 : 0.78));
    const clouds = lake ? [[0.16, 0.2], [0.42, 0.26], [0.66, 0.17]] : [[0.62, 0.32], [0.98, 0.26]];
    clouds.forEach(([fx, fs]) => cloud(Math.round(w * fx), cloudY + Math.round((rand() - 0.5) * 4), h * fs));

    // rolling hills, far to near: hazy blue-green far away, saturated near
    const hills = [
      { base: 0.0, amp: 0.1, f: 0.021, tone: hex(0x9ccab6), haze: 0.5 },
      { base: 0.08, amp: 0.09, f: 0.029, tone: hex(0x77b56f), haze: 0.25 },
      { base: 0.18, amp: 0.08, f: 0.037, tone: hex(0x58a043), haze: 0.08 },
      { base: 0.3, amp: 0.07, f: 0.045, tone: hex(0x438f31), haze: 0 },
    ];
    let treeAt = null;
    hills.forEach((H, hi) => {
      const ph = rand() * 6.28;
      const ph2 = rand() * 6.28;
      const lit = mix(H.tone, hex(0xe8f7b0), 0.35);
      const shade = mix(H.tone, hex(0x1e3d1a), 0.3);
      for (let x = 0; x < w; x += 1) {
        // on the hero the heading sits on the left, so the land stays low there
        const lean = lake ? 1 : 0.45 + 0.55 * Math.min(1, x / (w * 0.55));
        const wave = Math.sin(x * H.f + ph) * 0.6 + Math.sin(x * H.f * 2.3 + ph2) * 0.4;
        const top = Math.round(horizon + h * H.base - (h * H.amp * (1 + wave) * 0.5 + h * 0.03) * lean);
        // the next hill forward hides the lower part of this one
        for (let y = Math.max(0, top); y < h; y += 1) {
          const d = y - top;
          let c = d < 2 ? lit : d > 6 + hi * 2 && (d - 6) * 0.08 > dither(x, y) ? shade : H.tone;
          if (H.haze) c = mix(c, SKY[4], H.haze);
          put(x, y, c);
        }
        // the lone tree stands on the second-nearest hill, right of the middle
        if (hi === 2 && x > w * (lake ? 0.58 : 0.7) && x < w * (lake ? 0.66 : 0.78) && (!treeAt || top < treeAt.y)) {
          treeAt = { x, y: top };
        }
        // grass tufts and wildflowers on the nearest hill
        if (hi === hills.length - 1) {
          if (hash(x, 5, seed) > 0.55) put(x, top - 1, lit);
          if (hash(x, 9, seed) > 0.86) {
            const fy = top + 2 + Math.floor(hash(x, 11, seed) * (h - top - 3));
            put(x, fy, FLOWERS[Math.floor(hash(x, 13, seed) * FLOWERS.length)]);
          }
        }
      }
    });
    // the lone tree: a short trunk and a round crown of leafy puffs
    if (treeAt) {
      const tr = Math.max(4, Math.round(h * (lake ? 0.07 : 0.1)));
      for (let y = treeAt.y - tr; y <= treeAt.y; y += 1) {
        put(treeAt.x, y, hex(0x5b3a22));
        put(treeAt.x + 1, y, hex(0x4a2e1a));
      }
      const crown = [];
      for (let k = 0; k < 5; k += 1) {
        crown.push({ c: treeAt.x + (k - 2) * tr * 0.42, cy: treeAt.y - tr - tr * 0.2 * (2 - Math.abs(k - 2)), r: tr * (0.55 + 0.1 * (2 - Math.abs(k - 2))) });
      }
      crown.push({ c: treeAt.x, cy: treeAt.y - tr * 1.75, r: tr * 0.6 });
      paintPuffs(crown, LEAF, sunX, null);
      // its shadow on the grass
      for (let dx = -tr; dx <= tr; dx += 1) blend(treeAt.x + dx + 2, treeAt.y + 1, hex(0x1e3d1a), 0.35);
    }
    // birds: small dark V shapes high in the sky
    const birds = lake ? [[0.3, 0.16], [0.34, 0.2], [0.55, 0.12]] : [[0.66, 0.14], [0.71, 0.2]];
    birds.forEach(([fx, fy]) => {
      const bx = Math.round(w * fx);
      const by = Math.round(horizon * fy);
      [[-2, -1], [-1, 0], [0, 1], [1, 0], [2, -1]].forEach(([dx, dy]) => put(bx + dx, by + dy, hex(0x3a4a5a)));
    });
    ctx.putImageData(img, 0, 0);
    return ov;
  }

  // ---- Nether Gate: a blocky underworld in the style of a certain sandbox game, every block
  // drawn here from noise (no game textures). Red haze, a fortress bridge on brick arches far
  // off, a netherrack roof hung with glowstone (hero), a lava sea with a lavafall, stepped
  // shores lit from below, an obsidian portal that shows the overworld through its swirl, and
  // PrivMeet's own bubble mascot hauling a block of netherrack.
  if (pal.biome === "nether") {
    const ov = { lanterns: [], blinks: [], sparks: [], beams: [], fires: [], kites: [], planes: [], motes: [] };
    const hex = (v) => [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    const RACK = [0x3e1214, 0x5a1d1f, 0x6f2626, 0x843330, 0x9c4840].map(hex);
    const BRICK = [0x2a0f14, 0x3a141b, 0x4a1b22].map(hex);
    const LAVA = [0xa61c0a, 0xd9420e, 0xff7a1a, 0xffae2e, 0xffe27a].map(hex);
    const FOG = [0x100306, 0x1f070a, 0x34100f, 0x521a12, 0x7a2c14].map(hex);
    const GLOW = [0x9a5a22, 0xd99a3a, 0xf6c95a, 0xfff0a8].map(hex);
    const OBS = [0x0b0814, 0x130c20, 0x1c1430, 0x2a1e4a, 0x453078].map(hex);
    const SWIRL = [0x3c0a8c, 0x6a1fd0, 0x9440f5, 0xc07bff, 0xe8c8ff].map(hex);
    // One block is B art pixels. The footer is mostly hidden under the page, so its world sits
    // low: about sixteen blocks to its height, nine in the hero card.
    const B = Math.max(4, Math.min(8, Math.round(h / (lake ? 16 : 9))));
    const cols = Math.ceil(w / B) + 1;
    const lavaTop = h - Math.round(B * (lake ? 2 : 1.5));
    const clump = B >= 6 ? 1 : 0; // texture pixels come in 2x2 clumps on big blocks

    /** One textured block, top-left at (x0, y0): clumped noise over `tones`, sparse bright
     *  specks and dark pits, a lit top-left edge and a shaded bottom-right one, then haze. */
    const cell = (x0, y0, tones, salt, haze = 0, fog = FOG[2]) => {
      const n = tones.length;
      for (let yy = 0; yy < B; yy += 1) {
        for (let xx = 0; xx < B; xx += 1) {
          const x = x0 + xx;
          const y = y0 + yy;
          const v = hash((x0 + (xx >> clump)) | 0, (y0 + (yy >> clump)) | 0, salt);
          let c = tones[Math.min(n - 2, Math.floor(v * (n - 1)))];
          const fleck = hash(x, y, salt + 1);
          if (fleck > 0.93) c = tones[n - 1];
          else if (fleck < 0.06) c = mix(tones[0], BLACK, 0.3);
          if (yy === 0 || xx === 0) c = mix(c, tones[n - 1], 0.4);
          else if (yy === B - 1 || xx === B - 1) c = mix(c, BLACK, 0.35);
          put(x, y, haze ? mix(c, fog, haze) : c);
        }
      }
    };
    const steps = (lo, hi, rough) => fractal(rand, cols, rough).map((v) => Math.round(lo + v * (hi - lo)));
    const glowAt = (gx, gy, radius, color, strength) => {
      for (let y = Math.max(0, Math.round(gy - radius)); y < Math.min(h, gy + radius); y += 1) {
        for (let x = Math.max(0, Math.round(gx - radius * 1.2)); x < Math.min(w, gx + radius * 1.2); x += 1) {
          const dd = Math.hypot((x - gx) / 1.2, y - gy) / radius;
          // a smooth falloff: dithered, the light read as a checkerboard round the portal
          if (dd < 1) blend(x, y, color, strength * (1 - dd) ** 1.6);
        }
      }
    };

    // the cave air: dark at the top, warming toward the lava
    for (let y = 0; y < h; y += 1) {
      const f = (y / h) ** 0.8 * (FOG.length - 1);
      const k = Math.floor(f);
      for (let x = 0; x < w; x += 1) put(x, y, f - k > dither(x, y) ? FOG[Math.min(FOG.length - 1, k + 1)] : FOG[k]);
    }
    // ash drifting in the haze
    for (let i = 0; i < w * h * 0.004; i += 1) blend(Math.floor(rand() * w), Math.floor(rand() * lavaTop), [120, 80, 70], 0.5);

    // a fortress bridge far off: a brick deck on arched piers, deep in the haze
    const deckY = Math.round(lavaTop - B * (lake ? 6.5 : 4.2));
    const deckH = Math.max(3, Math.round(B * 0.75));
    const bh = Math.max(2, Math.round(B / 3)); // brick course height
    const brickAt = (x, y) => {
      const row = Math.floor(y / bh);
      const bw = bh * 2;
      const mortar = y % bh === 0 || (x + (row % 2) * bh) % bw === 0;
      return mortar ? mix(BRICK[0], BLACK, 0.4) : BRICK[1 + (hash(Math.floor((x + (row % 2) * bh) / bw), row, 71) > 0.5 ? 1 : 0)];
    };
    const span = B * 4;
    for (let x = 0; x < w; x += 1) {
      for (let y = deckY; y < deckY + deckH; y += 1) put(x, y, mix(brickAt(x, y), FOG[2], 0.35));
      // fence posts along the deck
      if (x % (B * 2) < Math.max(1, B / 4)) for (let y = deckY - B; y < deckY; y += 1) put(x, y, mix(BRICK[1], FOG[2], 0.4));
      if (x % (B * 2) < B * 2) put(x, deckY - B, mix(BRICK[1], FOG[2], 0.45));
      // piers with round arches between them
      const u = ((x % span) + span) % span;
      const archR = span / 2 - B * 0.6;
      const dx = u - span / 2;
      const archTop = deckY + deckH + Math.round(B * 0.4);
      for (let y = deckY + deckH; y < lavaTop; y += 1) {
        const inside = Math.abs(dx) < archR && y > archTop + archR - Math.sqrt(Math.max(0, archR * archR - dx * dx));
        if (!inside) put(x, y, mix(brickAt(x, y), FOG[2], 0.5 + 0.2 * ((y - deckY) / (lavaTop - deckY))));
      }
    }
    // far cliffs in front of the bridge, hazed, with gaps of open lava
    const far = steps(lake ? -3 : -2, lake ? 4 : 3, 0.6);
    for (let c = 0; c < cols; c += 1) {
      for (let k = 0; k < far[c]; k += 1) cell(c * B, lavaTop - (k + 1) * B, RACK, 7, 0.55, FOG[3]);
    }

    // the roof (hero only: the footer fades out at the top), hung with glowstone
    if (!lake) {
      const roof = steps(1, 2, 0.8);
      for (let c = 0; c < cols; c += 1) {
        const depth = roof[c] + (rand() < 0.12 ? 1 : 0);
        for (let k = 0; k < depth; k += 1) cell(c * B, k * B - Math.round(B / 2), RACK, 3, 0.1, FOG[0]);
        if (rand() < 0.16) {
          const gy = depth * B - Math.round(B / 2);
          const tall = rand() < 0.4 ? 2 : 1;
          for (let k = 0; k < tall; k += 1) cell(c * B, gy + k * B, GLOW, 41 + c);
          glowAt(c * B + B / 2, gy + B, B * 3.2, GLOW[2], 0.4);
          ov.sparks.push({ x: c * B + Math.floor(rand() * B), y: gy + Math.floor(rand() * B * tall), delay: (rand() * 3).toFixed(2) });
        }
      }
    }

    // the lava sea: hot block-sized swirls with brighter currents, brightest at the surface
    for (let y = lavaTop; y < h; y += 1) {
      const depth = (y - lavaTop) / Math.max(1, h - lavaTop);
      for (let x = 0; x < w; x += 1) {
        const n = hash(x >> 1, (y - lavaTop) >> 1, 51) * 0.55 + hash(Math.floor(x / B), Math.floor(y / B), 52) * 0.45;
        const current = Math.sin(x / (B * 1.7) + y / (B * 0.9)) > 0.86 ? 0.3 : 0;
        const k = Math.max(0, Math.min(LAVA.length - 1, Math.floor((n * 0.85 + (1 - depth) * 0.3 + current) * LAVA.length) - 1));
        put(x, y, LAVA[k]);
      }
    }
    for (let x = 0; x < w; x += 1) put(x, lavaTop, LAVA[4]);
    for (let x = 0; x < w; x += 1) blend(x, lavaTop - 1, LAVA[3], 0.45);

    // near shores; flat round the portal's column and at the mascot's spot
    const portalCol = Math.round((w * (lake ? 0.74 : opts.orbX)) / B);
    const mascotCol = portalCol - (lake ? 6 : 4);
    const near = steps(-2, lake ? 3 : 2, 0.65).map((v, c) => {
      if (Math.abs(c - portalCol) <= 3) return lake ? 2 : 2;
      if (Math.abs(c - mascotCol) <= 1) return lake ? 2 : 1;
      return v;
    });
    for (let c = 0; c < cols; c += 1) {
      for (let k = 0; k < near[c]; k += 1) {
        const y0 = lavaTop - (k + 1) * B + B;
        cell(c * B, y0, RACK, 11 + k);
        // lit from below by the lava: an orange wash on the lowest block
        if (k === 0) for (let yy = 0; yy < B; yy += 1) for (let xx = 0; xx < B; xx += 1) blend(c * B + xx, y0 + yy, LAVA[2], 0.32 * (yy / B));
      }
    }
    // a lavafall pouring from the roof (hero) or from a cliff top (footer) into the sea
    const fallCol = Math.round((w * (lake ? 0.2 : 0.93)) / B);
    const fallTop = lake ? deckY + deckH : 0; // in the footer it pours off the bridge
    for (let y = fallTop; y < lavaTop; y += 1) {
      for (let xx = 0; xx < B; xx += 1) {
        const n = hash(fallCol * B + xx, (y >> 1) + (xx & 1), 81);
        put(fallCol * B + xx, y, LAVA[Math.min(4, 1 + Math.floor(n * 3.6))]);
      }
    }
    glowAt(fallCol * B + B / 2, lavaTop, B * 3, LAVA[3], 0.35);

    // ---- the portal
    const fw = 4;
    const fh = 5;
    const fx0 = (portalCol - 2) * B;
    const groundY = lavaTop - near[portalCol] * B + B;
    const fy0 = groundY - fh * B;
    const ix0 = fx0 + B;
    const iy0 = fy0 + B;
    const iw = (fw - 2) * B;
    const ih = (fh - 2) * B;
    const pcx = ix0 + iw / 2;
    const pcy = iy0 + ih / 2;
    glowAt(pcx, pcy, B * 4.5, SWIRL[2], 0.55);
    for (let by = 0; by < fh; by += 1) {
      for (let bx = 0; bx < fw; bx += 1) {
        if (bx > 0 && bx < fw - 1 && by > 0 && by < fh - 1) continue;
        cell(fx0 + bx * B, fy0 + by * B, OBS, 23 + bx * 7 + by);
        // the inner faces catch the portal's light
        for (let yy = 0; yy < B; yy += 1) for (let xx = 0; xx < B; xx += 1) {
          const px = fx0 + bx * B + xx;
          const py = fy0 + by * B + yy;
          const dIn = Math.max(0, Math.max(ix0 - px - 1, px - (ix0 + iw), iy0 - py - 1, py - (iy0 + ih)));
          if (dIn < 3) blend(px, py, SWIRL[3], 0.25 - dIn * 0.07);
        }
      }
    }
    // the field: spiral bands broken by noise, and the overworld seen through it
    for (let y = iy0; y < iy0 + ih; y += 1) {
      for (let x = ix0; x < ix0 + iw; x += 1) {
        const u = (x - pcx) / (iw / 2);
        const v = (y - pcy) / (ih / 2);
        const r = Math.hypot(u, v);
        const wave = Math.sin(Math.atan2(v, u) * 2 + r * 8) * 0.5 + 0.5;
        let c = SWIRL[Math.max(0, Math.min(4, Math.floor((wave + (hash(x, y, 61) - 0.5) * 0.3) * 5)))];
        const see = Math.max(0, 1 - r / 0.75);
        if (see > 0) {
          const hill = Math.round(pcy - ih * 0.02 + Math.sin((x - ix0) / Math.max(2, B * 0.6)) * B * 0.3);
          let o;
          if (y < hill) o = mix([168, 212, 255], [118, 170, 246], (y - iy0) / ih);
          else if (y < hill + Math.max(1, Math.round(B / 4))) o = hash(x, y, 62) < 0.3 ? [72, 142, 48] : [102, 180, 64];
          else o = hash(x, y, 63) < 0.4 ? [104, 72, 46] : [134, 96, 62];
          if (Math.abs(x - (pcx + iw * 0.2)) <= Math.max(1, B * 0.3) && Math.abs(y - (iy0 + ih * 0.2)) <= Math.max(1, B * 0.3)) o = [255, 238, 150];
          c = mix(c, o, Math.min(0.9, see * 1.4));
        }
        put(x, y, c);
      }
    }
    for (let i = 0; i < (lake ? 8 : 6); i += 1) {
      ov.motes.push({ x: Math.round(ix0 + rand() * iw), y: Math.round(iy0 + rand() * ih), tone: "violet", delay: (rand() * 4).toFixed(2) });
    }

    // ---- the mascot: PrivMeet's speech bubble, two violet eyes, arms up, carrying a block
    const mx = mascotCol * B + Math.round(B / 2);
    const feet = lavaTop - near[mascotCol] * B + B;
    const bw = Math.max(5, Math.round(B * 1.3));
    const bhh = Math.max(4, Math.round(B * 1.05));
    const legH = Math.max(1, Math.round(B / 3));
    const top = feet - legH - bhh;
    const INK = [42, 22, 64];
    const BODY = [242, 238, 255];
    for (let y = top; y < top + bhh; y += 1) {
      for (let x = mx - Math.floor(bw / 2); x < mx - Math.floor(bw / 2) + bw; x += 1) {
        const edgeX = x === mx - Math.floor(bw / 2) || x === mx - Math.floor(bw / 2) + bw - 1;
        const edgeY = y === top || y === top + bhh - 1;
        if (edgeX && edgeY) continue; // rounded corners
        put(x, y, edgeX || edgeY ? INK : y > top + bhh * 0.6 ? mix(BODY, SWIRL[3], 0.25) : BODY);
      }
    }
    put(mx - Math.floor(bw / 2) + 1, top + bhh, INK); // the bubble's tail
    put(mx - Math.floor(bw / 2) + 1, top + bhh - 1, BODY);
    const eyeY = top + Math.max(1, Math.round(bhh * 0.35));
    [mx - Math.max(1, Math.round(bw / 4)), mx + Math.max(1, Math.round(bw / 4)) - 1].forEach((ex) => {
      put(ex, eyeY, SWIRL[2]);
      put(ex, eyeY + 1, SWIRL[1]);
    });
    for (let k = 0; k < legH; k += 1) {
      put(mx - 1, top + bhh + k, INK);
      put(mx + 1, top + bhh + k, INK);
    }
    // arms up to the block it carries
    const blockY = top - B - Math.max(1, Math.round(B / 4));
    for (let y = blockY + B; y < top + 1; y += 1) {
      put(mx - Math.floor(bw / 2) - 1, y, INK);
      put(mx - Math.floor(bw / 2) + bw, y, INK);
    }
    cell(mx - Math.floor(B / 2), blockY, RACK, 99);
    glowAt(mx, top, B * 1.5, LAVA[2], 0.2);

    // embers rising off the lava (CSS overlays, see PixelScape)
    for (let i = 0; i < (lake ? 12 : 7); i += 1) {
      ov.motes.push({ x: Math.floor(rand() * w), y: lavaTop - 1 - Math.floor(rand() * B), tone: "ember", delay: (rand() * 5).toFixed(2) });
    }
    ctx.putImageData(img, 0, 0);
    return ov;
  }

  // ---- Neon Drive, the special world. Its own scene, not a recolour of the lake: a synthwave
  // night with a striped sun sinking behind neon mountains, a glowing grid running to the
  // horizon and faint CRT scanlines over everything. (Palms were tried and read as burnt
  // umbrellas at this pixel size, so the frame is left to the sun and the grid.)
  if (pal.biome === "neon") {
    const ov = { lanterns: [], blinks: [], sparks: [], beams: [], fires: [], kites: [], planes: [] };
    const hex = (v) => [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    const SKY = [0x0b0418, 0x1a0936, 0x3a0d5c, 0x7c1366, 0xd0246e].map(hex);
    const SUN = [0xffe66b, 0xffb340, 0xff6a4d, 0xff2f8f, 0xe01fd1].map(hex);
    const PINK = hex(0xff2bd6);
    const CYAN = hex(0x2de2e6);
    const horizon = Math.round(h * (lake ? 0.6 : 0.66));
    const sunX = Math.round(w * (lake ? 0.5 : opts.orbX));
    const sunR = Math.max(8, Math.round(h * (lake ? 0.22 : 0.3)));
    const sunY = horizon - Math.round(sunR * 0.45);

    // sky: five stops, dithered at every boundary
    for (let y = 0; y < horizon; y += 1) {
      const f = (y / horizon) * (SKY.length - 1);
      const k = Math.floor(f);
      for (let x = 0; x < w; x += 1) put(x, y, f - k > dither(x, y) ? SKY[Math.min(SKY.length - 1, k + 1)] : SKY[k]);
    }
    // stars, thinning toward the glow of the horizon; a few twinkle
    for (let i = 0; i < w * 0.22; i += 1) {
      const x = Math.floor(rand() * w);
      const y = Math.floor(rand() * horizon * 0.62);
      if (Math.hypot(x - sunX, y - sunY) < sunR * 1.6) continue;
      blend(x, y, rand() < 0.25 ? PINK : WHITE, 0.4 + rand() * 0.6);
      if (i % 37 === 0) ov.sparks.push({ x, y, delay: (rand() * 3).toFixed(2) });
    }
    // a soft glow round the sun
    for (let y = Math.max(0, sunY - sunR * 2); y < horizon; y += 1) {
      for (let x = Math.max(0, sunX - sunR * 2.4); x < Math.min(w, sunX + sunR * 2.4); x += 1) {
        const d = Math.hypot((x - sunX) / 1.2, y - sunY) / (sunR * 2);
        if (d < 1 && (1 - d) * 0.55 > dither(x, y)) blend(x, y, PINK, 0.22);
      }
    }
    // the sun: a vertical gradient, cut by horizontal bands that thicken toward the horizon
    for (let y = sunY - sunR; y <= sunY + sunR && y < horizon; y += 1) {
      const dy = y - sunY;
      const half = Math.sqrt(Math.max(0, sunR * sunR - dy * dy));
      const t = (dy + sunR) / (2 * sunR); // 0 top .. 1 bottom
      // the cuts: bands of sky through the lower sun, thickening toward the horizon
      if (dy > -sunR * 0.22) {
        const below = (dy + sunR * 0.22) / (sunR * 1.22); // 0 .. 1 across the cut zone
        const period = Math.max(4, Math.round(sunR * 0.24));
        const gap = Math.max(1, Math.round(below * period * 0.62));
        if ((y - sunY + 1000 * period) % period < gap) continue;
      }
      // flat bands of colour, not dithered: dithering made the sun a checkerboard
      const c = SUN[Math.min(SUN.length - 1, Math.floor(t * SUN.length))];
      for (let x = Math.round(sunX - half); x <= Math.round(sunX + half); x += 1) put(x, y, c);
    }
    // neon mountains, two ranges, low in the middle so the sun shows between them
    [
      { tone: hex(0x2a0d4d), rim: PINK, hi: 0.46, count: w / 34 },
      { tone: hex(0x160829), rim: CYAN, hi: 0.28, count: w / 26 },
    ].forEach((R, ri) => {
      const ridge = peaks(rand, w, Math.max(3, Math.round(R.count)), horizon * 0.06, horizon * R.hi, 0.85);
      for (let x = 0; x < w; x += 1) {
        const valley = Math.min(1, Math.abs(x - sunX) / (sunR * (lake ? 2.6 : 2.2))); // dips under the sun
        const alt = ridge.alt[x] * (0.15 + 0.85 * valley ** 1.4);
        const top = Math.round(horizon - alt);
        for (let y = Math.max(0, top); y < horizon; y += 1) {
          let c = R.tone;
          // a wireframe: faint lines down the slopes
          if ((x + (y >> 1) * (ri ? -1 : 1)) % 9 === 0 && y > top + 1) c = mix(R.tone, R.rim, 0.25);
          put(x, y, c);
        }
        if (top < horizon) put(x, top, R.rim);
        if (top + 1 < horizon) blend(x, top + 1, R.rim, 0.35);
      }
    });
    // the floor: dark, a pink haze along the horizon line, then the grid
    for (let y = horizon; y < h; y += 1) {
      const t = (y - horizon) / Math.max(1, h - horizon);
      for (let x = 0; x < w; x += 1) {
        let c = mix(hex(0x1c0838), hex(0x06010e), Math.min(1, t * 1.3));
        // the sun's reflection: a warm column straight down from it, fading toward the viewer
        const r = Math.abs(x - sunX) / (sunR * (1 + t * 1.5));
        if (r < 1 && (1 - r) * (1 - t) * 0.7 > dither(x, y)) c = mix(c, SUN[3], 0.35);
        put(x, y, c);
      }
    }
    for (let x = 0; x < w; x += 1) put(x, horizon, mix(PINK, WHITE, 0.25));
    for (let y = horizon + 1; y < horizon + 4 && y < h; y += 1) for (let x = 0; x < w; x += 1) blend(x, y, PINK, 0.35 - (y - horizon) * 0.08);
    // horizontal grid lines, closer together toward the horizon (perspective)
    const depth = h - horizon;
    // spacing grows with the square of the distance from the horizon, so the lines do not
    // pile into a solid pink band near the viewer
    // as many lines as the floor has room for: twelve on a 48 px floor was one every 4 px,
    // which read as solid stripes
    const rows = Math.max(4, Math.round(depth / 7));
    let lastY = -1;
    for (let k = 1; k <= rows; k += 1) {
      const y = horizon + Math.round(depth * (k / rows) ** 1.85);
      if (y >= h || y === lastY) continue;
      lastY = y;
      const near = (y - horizon) / depth;
      for (let x = 0; x < w; x += 1) blend(x, y, PINK, 0.4 + near * 0.45);
    }
    // vertical grid lines, all running to the vanishing point under the sun
    // Drawn as connected segments: one pixel per row left gaps wherever a line runs shallow,
    // since x then jumps several pixels between rows, and the outer lines broke into dots.
    for (let i = -40; i <= 40; i += 1) {
      const xFar = sunX + i * 0.8;
      const xNear = sunX + i * (w / 11);
      // Only lines that fan across the visible floor. The rest run almost flat from the
      // vanishing point and piled into one solid cyan band under the horizon.
      if (xNear < -w * 0.25 || xNear > w * 1.25) continue;
      const steep = Math.min(1, Math.max(0.2, (depth * 3) / Math.max(1, Math.abs(xNear - xFar))));
      let prev = null;
      for (let y = horizon + 1; y < h; y += 1) {
        const t = (y - horizon) / depth;
        const x = Math.round(xFar + (xNear - xFar) * t);
        const a = (0.25 + t * 0.5) * steep;
        if (prev === null || Math.abs(x - prev) <= 1) blend(x, y, CYAN, a);
        else {
          const step = Math.sign(x - prev);
          for (let xx = prev + step; xx !== x + step; xx += step) blend(xx, y, CYAN, a);
        }
        prev = x;
        if (x < -w || x > 2 * w) break;
      }
    }
    // CRT scanlines over the sky: every other row a touch darker. Not over the floor, where
    // they chopped the grid's vertical lines into dots and striped the whole ground.
    for (let y = 1; y < horizon; y += 2) for (let x = 0; x < w; x += 1) blend(x, y, BLACK, 0.12);
    ctx.putImageData(img, 0, 0);
    return ov;
  }
  const horizonY = Math.round(h * (lake ? 0.7 : 0.99));
  const orb = {
    x: Math.round(w * opts.orbX),
    y: Math.round(horizonY * (lake ? 0.38 : 0.3)),
    r: Math.max(4, Math.round(h * (pal.dark ? 0.08 : 0.1))),
  };

  // ---- Sky: five colour stops, every boundary dithered.
  const stops = pal.sky;
  for (let y = 0; y < horizonY; y += 1) {
    const f = (y / horizonY) * (stops.length - 1);
    const k = Math.floor(f);
    const a = stops[k];
    const b = stops[Math.min(stops.length - 1, k + 1)];
    for (let x = 0; x < w; x += 1) put(x, y, f - k > dither(x, y) ? b : a);
  }

  // ---- Aurora (night): two soft wavy curtains, dithered, brightest at their lower edge.
  if (pal.dark && pal.aurora) {
    const bands = pal.biome === "teal" ? 3 : 2; // the fjord's aurora is the main show
    for (let band = 0; band < bands; band += 1) {
      const baseY = horizonY * (0.22 + band * 0.12);
      for (let x = 0; x < w; x += 1) {
        const yc = baseY + Math.sin(x * 0.035 + band * 2 + seed) * horizonY * 0.06 + Math.sin(x * 0.11) * 2;
        const len = horizonY * (0.12 + 0.06 * Math.sin(x * 0.05 + band));
        for (let y = Math.round(yc - len); y < yc; y += 1) {
          const t = 1 - (yc - y) / len;
          if (t * 0.38 * (0.5 + 0.5 * Math.sin(x * 0.07 + band)) > dither(x, y)) blend(x, y, pal.aurora, 0.35);
        }
      }
    }
  }

  // ---- Halo, then the moon or the sun.
  const reach = pal.dark ? 4 : 5.5;
  for (let y = orb.y - orb.r * reach; y <= orb.y + orb.r * reach; y += 1) {
    for (let x = orb.x - orb.r * reach; x <= orb.x + orb.r * reach; x += 1) {
      if (y < 0 || y >= horizonY || x < 0 || x >= w) continue;
      const dist = Math.hypot(x - orb.x, y - orb.y) / orb.r;
      if (dist <= 1) continue;
      const strength = Math.max(0, 1 - (dist - 1) / (reach - 1)) * (pal.dark ? 0.6 : 0.75);
      if (strength > dither(x, y)) blend(x, y, pal.glow, pal.dark ? 0.4 : 0.55);
    }
  }
  if (pal.dark) {
    for (let y = -orb.r; y <= orb.r; y += 1) {
      for (let x = -orb.r; x <= orb.r; x += 1) {
        const rr = x * x + y * y;
        if (rr > orb.r * orb.r + 1) continue;
        const shade = (x + y) / (orb.r * 1.2); // the lower-right crescent in shade
        let c = shade > 0.55 && shade - 0.55 > dither(x, y) * 0.5 ? pal.celestialDeep : pal.celestial;
        if (hash(Math.floor((x + 40) / 2), Math.floor((y + 40) / 2), seed) > 0.8 && rr < (orb.r - 1) ** 2)
          c = mix(c, pal.celestialDeep, 0.5); // craters
        put(orb.x + x, orb.y + y, c);
      }
    }
  } else {
    for (let k = 0; k < 12; k += 1) {
      const a = (k * Math.PI) / 6 + Math.PI / 12;
      const len = k % 2 ? 3 : 5;
      for (let t = orb.r + 2; t <= orb.r + 2 + len; t += 1) {
        if ((t + k) % 3 === 0) continue; // dashed rays
        blend(Math.round(orb.x + Math.cos(a) * t), Math.round(orb.y + Math.sin(a) * t), pal.celestial, 0.85);
      }
    }
    for (let y = -orb.r; y <= orb.r; y += 1) {
      if (y > 1 && y % 3 === 2 && y < orb.r - 1) continue; // the cut bands
      for (let x = -orb.r; x <= orb.r; x += 1) {
        if (x * x + y * y > orb.r * orb.r + 1) continue;
        const t = (y + orb.r) / (2 * orb.r);
        put(orb.x + x, orb.y + y, t > 0.5 && (t - 0.5) * 2 > dither(x, y) ? pal.celestialDeep : pal.celestial);
      }
    }
  }

  // ---- Stars and a shooting star (night) or clouds (day).
  if (pal.dark) {
    for (let i = 0; i < w * 0.18; i += 1) {
      const x = Math.floor(rand() * w);
      const y = Math.floor(rand() * horizonY * 0.7);
      if (Math.hypot(x - orb.x, y - orb.y) < orb.r * 2.5) continue;
      const bright = rand();
      blend(x, y, pal.star, 0.35 + bright * 0.65);
      if (bright > 0.93) [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => blend(x + dx, y + dy, pal.star, 0.45));
    }
    if (pal.biome === "indigo" && lake) {
      // Easter egg: eleven stars trace the PrivMeet speech bubble, joined by faint lines.
      const cx0 = Math.round(w * 0.36);
      const cy0 = Math.round(horizonY * 0.18);
      const pts = [[0, 4], [2, 1], [6, 0], [10, 1], [12, 4], [10, 7], [6, 8], [3, 8], [1, 11], [1, 7], [0, 4]];
      for (let k = 0; k < pts.length - 1; k += 1) {
        const [ax, ay] = pts[k];
        const [bx, by] = pts[k + 1];
        const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2;
        for (let t = 1; t < steps; t += 2) {
          blend(cx0 + Math.round((ax + ((bx - ax) * t) / steps) * 1.6), cy0 + Math.round((ay + ((by - ay) * t) / steps) * 1.4), pal.star, 0.18);
        }
      }
      pts.slice(0, -1).forEach(([px, py], k) => {
        const x = cx0 + Math.round(px * 1.6);
        const y = cy0 + Math.round(py * 1.4);
        put(x, y, pal.star);
        if (k % 3 === 0) [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => blend(x + dx, y + dy, pal.star, 0.4));
      });
    }
    const sx = Math.round(w * (lake ? 0.18 : 0.42));
    const sy = Math.round(horizonY * 0.12);
    for (let i = 0; i < 14; i += 1) blend(sx + i, sy + Math.floor(i / 2), pal.star, 0.9 - i * 0.06);
  } else {
    // On the hero the left half holds the heading, so the sky clouds keep to the right half.
    const count = lake ? Math.max(3, Math.round(w / 70)) : 2;
    // (named `spread`: the loop body declares its own `span`, and reading that before its
    // declaration threw on every light theme and blanked the page)
    const [from, spread] = lake ? [0, 1] : [0.56, 0.4];
    for (let i = 0; i < count; i += 1) {
      const cx0 = Math.round(w * (from + spread * ((i + 0.2 + rand() * 0.6) / count)));
      const belly = Math.round(horizonY * (0.2 + rand() * (lake ? 0.32 : 0.22)));
      if (Math.abs(cx0 - orb.x) < orb.r * 4 && Math.abs(belly - orb.y) < orb.r * 3) continue;
      const span = 8 + Math.floor(rand() * 10);
      const parts = [];
      for (let k = -2; k <= 2; k += 1) {
        const r = span * (0.42 - Math.abs(k) * 0.08) * (0.85 + rand() * 0.3);
        parts.push({ c: cx0 + k * span * 0.42 + (rand() - 0.5) * 3, cy: belly - r * 0.35 - (2 - Math.abs(k)) * 1.5, r });
      }
      if (lake) cloudMass(parts, orb.x, belly, 0.85);
      else {
        const [c0, c1, c2] = pal.cloud;
        paintPuffs(parts, [c2, mix(c1, c2, 0.5), c1, mix(c0, c1, 0.4), c0], orb.x, null, belly);
      }
    }
  }

  // ---- Mountains, far to near: peaks with a lit and a shadow face split at the spine.
  const layers = lake
    ? [
        { hi: 0.55, lo: 0.2, count: w / 26, steep: 0.75, fade: 0.55, snow: 0.6 },
        { hi: 0.45, lo: 0.14, count: w / 22, steep: 0.9, fade: 0.36, snow: 0.66 },
        { hi: 0.34, lo: 0.09, count: w / 18, steep: 1.05, fade: 0.18, snow: 0.74 },
        { hi: 0.2, lo: 0.05, count: w / 14, steep: 1.2, fade: 0.05, snow: 9 },
        { hi: 0.1, lo: 0.03, count: w / 10, steep: 1.4, fade: 0, snow: 9 },
      ]
    : [
        { hi: 0.72, lo: 0.3, count: w / 30, steep: 0.75, fade: 0.5, snow: 0.55 },
        { hi: 0.82, lo: 0.25, count: w / 26, steep: 0.9, fade: 0.25, snow: 0.58 },
        { hi: 0.62, lo: 0.18, count: w / 22, steep: 1.05, fade: 0.06, snow: 0.62 },
      ];
  const horizonColor = stops[stops.length - 1];
  layers.forEach((L, li) => {
    const hiPx = L.hi * horizonY;
    const ridge = peaks(rand, w, Math.max(3, Math.round(L.count)), L.lo * horizonY, hiPx, L.steep);
    const tone = lake ? li : li + 1;
    const base = mix(pal.ridges[tone], horizonColor, L.fade);
    const lit = mix(base, pal.light, pal.dark ? 0.24 : 0.38);
    const shade = mix(base, pal.dark ? BLACK : pal.ridges[4], pal.dark ? 0.32 : 0.3);
    const desert = pal.biome === "amber";
    // absolute altitude of the snowline; the glacier and the pine forest sit in deeper winter
    const cold = pal.biome === "glacier" ? 0.62 : pal.biome === "forest" ? 0.85 : 1;
    const snowAlt = desert ? Infinity : hiPx * Math.min(L.snow, 1) * cold + (L.snow > 1 ? Infinity : 0);
    for (let x = 0; x < w; x += 1) {
      let altX = ridge.alt[x];
      // On the hero the heading sits on the left, so the peaks rise from there to the right.
      if (!lake) altX *= 0.3 + 0.7 * Math.min(1, Math.max(0, (x / w - 0.3) / 0.35));
      // Desert mesas: each peak is cut off flat at its own height, leaving a table-top butte.
      if (desert && li < 4) altX = Math.min(altX, ridge.list[ridge.owner[x]].top * (0.55 + 0.25 * hash(ridge.owner[x], li, seed)));
      const top = Math.round(horizonY - altX);
      const pk = ridge.list[ridge.owner[x]];
      const litFace = x === pk.c || Math.sign(x - pk.c) === Math.sign(orb.x - pk.c);
      const ragged = (hash(x >> 1, li, seed) - 0.5) * 4 + Math.sin(x * 0.7) * 1.2;
      for (let y = Math.max(0, top); y < horizonY; y += 1) {
        const depth = y - top;
        const altY = horizonY - y;
        let c = litFace ? lit : shade;
        // a softer band just inside the shadow face, so the spine reads as a ridge, not a seam
        if (!litFace && Math.abs(x - pk.c) <= 1 && depth > 1) c = mix(shade, base, 0.6);
        // rock: short diagonal strata of the neighbouring tone
        if (depth > 2 && hash((x + (litFace ? y : -y)) >> 1, y >> 2, li + seed) > 0.9) c = mix(c, litFace ? base : lit, 0.5);
        // desert rock: horizontal strata bands instead of snow
        if (desert && ((y + li) >> 1) % 3 === 0) c = mix(c, litFace ? base : pal.light, 0.35);
        // snow above the ridge's snowline, ragged, shaded on the dark face
        if (altY > snowAlt + ragged) c = litFace ? pal.snow : mix(pal.snow, shade, 0.42);
        // haze where the ridge meets the next one, dithered
        const low = depth / Math.max(1, horizonY - top);
        if (li < layers.length - 1 && low > 0.6 && (low - 0.6) * 1.8 > dither(x, y)) c = mix(c, mix(pal.mist, base, 0.4), 0.5);
        put(x, y, c);
      }
      if (top >= 0 && litFace) put(x, top, mix(lit, pal.light, 0.4)); // rim light on the crest
    }
    // mist pooling in front of this ridge
    if (li < layers.length - 1) {
      const mistY = horizonY - layers[li + 1].hi * horizonY * 0.5;
      for (let y = Math.round(mistY - 3); y < mistY + 3; y += 1) {
        const t = 1 - Math.abs(y - mistY) / 3;
        for (let x = 0; x < w; x += 1) if (t * 0.4 * (0.6 + 0.4 * Math.sin(x * 0.04 + li)) > dither(x, y)) blend(x, y, pal.mist, 0.4);
      }
    }
  });

  const overlays = { lanterns: [], blinks: [], sparks: [], beams: [], fires: [], kites: [], planes: [] };

  if (!lake) {
    // ---- Sea of clouds: three banks back to front. The far bank is small and hazy, the near
    // one big and crisp, so the eye reads depth; each covers the shadowed belly of the last.
    const [c0, c1, c2, c3] = pal.cloud;
    // deep -> rim. Weighted to the light end: a sea of cloud under the moon is mostly lit
    // tops, and only its folds go dark. The darkest tones made it read as rock.
    // Day needs the opposite weighting: white tops, but folds deep enough to give the puffs
    // form; the night ramp on a light theme was nearly all white and read as fog.
    const ramp = pal.dark
      ? [mix(c1, c2, 0.45), c1, mix(c0, c1, 0.62), mix(c0, c1, 0.3), c0]
      : [mix(c2, c3, 0.55), c2, mix(c1, c2, 0.5), c1, c0];
    const banks = [
      { baseY: h * 0.6, size: Math.max(6, h * 0.12), haze: 0.55 },
      { baseY: h * 0.73, size: Math.max(8, h * 0.17), haze: 0.28 },
      { baseY: h * 0.9, size: Math.max(9, h * 0.2), haze: 0 },
    ];
    banks.forEach((b) => cloudBank({ ...b, lightX: orb.x, lightY: orb.y, hazeColor: horizonColor, ramp, glow: pal.light }));
    // A signature per theme, kept to the right half where the heading is not.
    if (pal.biome === "rose") petals(Math.round(w * 0.12), w * 0.55, w, h * 0.08, h * 0.8);
    if (pal.biome === "dawn") {
      balloon(Math.round(w * 0.68), Math.round(h * 0.4), 0);
      balloon(Math.round(w * 0.94), Math.round(h * 0.5), 2);
    }
    ctx.putImageData(img, 0, 0);
    return overlays;
  }

  // ---- Water: a colour gradient, the wavy mirror of the scene, shimmer lines.
  for (let y = horizonY; y < h; y += 1) {
    const t = (y - horizonY) / (h - horizonY);
    const waterC = mix(pal.water[0], pal.water[1], Math.min(1, t * 1.3));
    const src = horizonY - 1 - Math.round((y - horizonY) * 1.25);
    const wobble = Math.round(Math.sin(y * 0.9) * 1.4);
    for (let x = 0; x < w; x += 1) {
      let c = waterC;
      if (src >= 0) c = mix(get(x + wobble, src), waterC, 0.5 + t * 0.35);
      if ((y - horizonY) % 3 === 1 && hash(x >> 3, y, seed) > 0.6) c = mix(c, pal.light, pal.dark ? 0.12 : 0.3);
      put(x, y, c);
    }
  }
  // the moon's (sun's) path: waveform bars on every other row
  for (let y = horizonY + 1; y < h; y += 2) {
    const t = (y - horizonY) / (h - horizonY);
    const amp = (0.3 + 0.7 * Math.abs(Math.sin(y * 0.85 + 0.4))) * (0.55 + 0.45 * Math.sin(y * 0.21)) * (1 - t * 0.3);
    const half = Math.max(1, Math.round(orb.r * 1.4 * amp));
    for (let x = orb.x - half; x <= orb.x + half; x += 1) {
      put(x, y, mix(pal.celestial, get(x, y), (Math.abs(x - orb.x) / (half + 1)) * 0.6 + t * 0.2));
    }
  }

  // ---- Shores: a rocky outcrop on the left that slopes down into the water (a curve that
  // flattens toward the lake), and a low bank on the right that the dock rests on.
  const leftEnd = w * 0.3;
  const rightStart = w * 0.8;
  const rock = fractal(rand, w, 0.55);
  const shoreH = (x) => {
    if (x < leftEnd) {
      const t = 1 - x / leftEnd; // 1 at the edge of the frame, 0 at the waterline
      return Math.max(0, Math.round(h * 0.25 * t ** 1.6 + rock[x] * 5 * t));
    }
    if (x > rightStart) return Math.round(h * (0.04 + 0.1 * ((x - rightStart) / (w - rightStart)) ** 0.9) + rock[x] * 3);
    return 0;
  };
  for (let x = 0; x < w; x += 1) {
    const sh = shoreH(x);
    if (!sh) continue;
    for (let y = h - sh; y < h; y += 1) {
      const depth = (y - (h - sh)) / sh;
      let c = depth < 0.15 || (depth < 0.4 && depth - 0.15 < dither(x, y) * 0.25) ? pal.ground[0] : pal.ground[1];
      if (hash(x, y, 7) > 0.92) c = mix(c, pal.light, 0.12);
      put(x, y, c);
    }
    // the wet edge: the last pixel of land before the water catches the light
    if (x < leftEnd && sh <= 6) put(x, h - sh, mix(pal.ground[0], pal.light, pal.dark ? 0.25 : 0.4));
    if (sh > 3 && hash(x, 1, seed) > 0.45) {
      const tall = 1 + Math.floor(hash(x, 2, seed) * 4);
      for (let y = h - sh - tall; y < h - sh; y += 1) put(x, y, pal.grass);
    }
    if (!pal.dark && hash(x, 3, seed) > 0.9) put(x, h - sh - 2, pal.bloom[Math.floor(hash(x, 4, seed) * pal.bloom.length)]);
  }
  if (pal.dark) {
    for (let i = 0; i < 9; i += 1) {
      const fx = Math.round(i < 5 ? rand() * leftEnd * 0.9 : rightStart + rand() * (w - rightStart));
      overlays.sparks.push({ x: fx, y: h - shoreH(fx) - 3 - Math.floor(rand() * 8), delay: (rand() * 3).toFixed(2) });
    }
  }

  // ---- Radio mast on the outcrop, sending signal arcs.
  const mx = Math.round(w * 0.07);
  const mBase = h - shoreH(mx);
  const mH = Math.round(h * 0.3);
  const mTop = mBase - mH;
  for (let y = mTop; y < mBase; y += 1) {
    const spread = Math.round(((y - mTop) / mH) * 2.5);
    put(mx - spread, y, pal.ground[1]);
    put(mx + spread, y, pal.ground[1]);
    if ((mBase - y) % 3 === 0) for (let x = mx - spread; x <= mx + spread; x += 1) put(x, y, pal.ground[1]);
    else if ((mBase - y) % 3 === 1) put(mx, y, pal.ground[1]);
  }
  [5, 8, 11].forEach((r, i) => {
    for (let a = -0.85; a <= 0.85; a += 0.07) {
      const y = Math.round(mTop - 1 + Math.sin(a) * r);
      for (const x of [Math.round(mx + Math.cos(a) * r), Math.round(mx - Math.cos(a) * r)]) blend(x, y, pal.metal, 0.8 - i * 0.25);
    }
  });
  overlays.blinks.push({ x: mx, y: mTop - 1, color: "red" });

  // ---- A dock reaching into the lake from the right bank, a lantern post at its end.
  const dockY = h - shoreH(Math.round(rightStart + 6)) + 1;
  const dockFrom = Math.round(rightStart - w * 0.08);
  for (let x = dockFrom; x < rightStart + 8; x += 1) {
    put(x, dockY, pal.wood);
    put(x, dockY + 1, mix(pal.wood, BLACK, 0.3));
    if ((x - dockFrom) % 6 === 0) for (let y = dockY + 2; y < dockY + 6; y += 1) put(x, y, mix(pal.wood, BLACK, 0.45));
  }
  for (let y = dockY - 8; y < dockY; y += 1) put(dockFrom + 1, y, pal.wood);
  put(dockFrom, dockY - 8, pal.wood);
  put(dockFrom + 2, dockY - 8, pal.wood);
  overlays.blinks.push({ x: dockFrom + 1, y: dockY - 10, color: "lamp" });

  // ---- Easter eggs, one set per theme.
  const ground = { X: pal.ground[1], o: pal.ground[0] };
  if (pal.biome === "teal") {
    // A whale tail breaking the water, with a splash.
    const tx = Math.round(w * 0.56);
    const ty = horizonY + Math.round((h - horizonY) * 0.35);
    sprite(["X.......X", "XX.....XX", ".XXX.XXX.", "...XXX...", "....X....", "....X...."], tx, ty - 5, { X: mix(pal.ground[0], pal.light, 0.15) });
    sprite(["w.w...w.w", ".w.....w."], tx, ty + 1, { w: mix(pal.light, WHITE, 0.4) });
    // A lighthouse on the right bank, its beam sweeping (overlay).
    const lx = Math.round(w * 0.93);
    const lBase = h - shoreH(lx);
    for (let y = lBase - 16; y < lBase; y += 1) {
      const band = Math.floor((lBase - y) / 3) % 2 === 0;
      for (let x = lx - 1; x <= lx + 1; x += 1) put(x, y, band ? mix(WHITE, pal.light, 0.3) : [190, 60, 60]);
    }
    sprite(["XXXXX", ".XXX.", ".X.X.", ".XXX."], lx - 2, lBase - 20, { X: pal.ground[1] });
    overlays.beams.push({ x: lx, y: lBase - 18 });
  } else if (pal.biome === "amber") {
    // Cacti on the banks and a campfire on the outcrop.
    const cactus = ["..X..", "X.X..", "X.X.X", "XXX.X", "..XXX", "..X..", "..X.."];
    [0.12, 0.19, 0.86, 0.95].forEach((at2) => {
      const cxp = Math.round(w * at2);
      sprite(cactus, cxp - 2, h - shoreH(cxp) - 7, { X: pal.cactus });
    });
    const fx = Math.round(w * 0.16);
    const fy = h - shoreH(fx);
    sprite(["X...X", ".XXX."], fx - 2, fy - 2, { X: pal.wood });
    overlays.fires.push({ x: fx, y: fy - 3 });
  } else if (pal.biome === "slate") {
    // A sailboat on the water, a logo-shaped kite on a string from the dock, a paper plane.
    const bx = Math.round(w * 0.42);
    const by = horizonY + Math.round((h - horizonY) * 0.3);
    sprite(["...X...", "...XS..", "...XSS.", "...XSSS", "...X...", "HHHHHHH", ".HHHHH."], bx, by - 6, {
      X: pal.wood,
      S: WHITE,
      H: mix(pal.ground[0], [180, 90, 70], 0.5),
    });
    overlays.kites.push({ x: dockFrom - 6, y: Math.round(horizonY * 0.35), anchorX: dockFrom + 1, anchorY: dockY - 8 });
    overlays.planes.push({ y: Math.round(horizonY * 0.22) });
  } else if (pal.biome === "rose") {
    // A cherry tree in bloom on the outcrop, its petals drifting over the lake.
    const tx = Math.round(w * 0.08);
    sprite(CHERRY, tx - 7, h - shoreH(tx) - CHERRY.length + 1, {
      P: pal.blossom[0],
      B: pal.blossom[1],
      b: pal.blossom[2],
      T: mix(pal.wood, BLACK, 0.25),
    });
    const tx2 = Math.round(w * 0.9);
    sprite(CHERRY, tx2 - 7, h - shoreH(tx2) - CHERRY.length + 1, {
      P: pal.blossom[0],
      B: pal.blossom[1],
      b: pal.blossom[2],
      T: mix(pal.wood, BLACK, 0.25),
    });
    petals(Math.round(w * 0.35), 0, w, horizonY * 0.3, h - 4);
  } else if (pal.biome === "forest") {
    // Pines along both banks, tallest at the edges of the frame.
    const stand = (from, to) => {
      for (let x = from; x < to; x += 3 + Math.floor(rand() * 4)) {
        const ground = h - shoreH(x);
        if (shoreH(x) < 3) continue;
        const t = PINE[Math.floor(rand() * PINE.length)];
        const lit = rand() < 0.3 ? pal.pine[1] : pal.pine[0];
        sprite(t, x - 2, ground - t.length + 1, { X: lit, T: mix(pal.wood, BLACK, 0.4) });
      }
    };
    stand(2, Math.round(leftEnd * 0.8));
    stand(Math.round(rightStart + 4), w - 3);
  } else if (pal.biome === "dawn") {
    // Hot-air balloons rising into the sunrise.
    [[0.24, 0.3], [0.62, 0.16], [0.74, 0.38]].forEach(([fx, fy], k) => balloon(Math.round(w * fx), Math.round(horizonY * fy), k));
  } else if (pal.biome === "glacier") {
    // Icebergs on the water.
    [[0.38, 0.2], [0.6, 0.45], [0.15, 0.55]].forEach(([fx, fy]) => {
      const bx = Math.round(w * fx);
      const by = horizonY + Math.round((h - horizonY) * fy);
      sprite(BERG, bx, by - BERG.length + 1, { I: pal.ice[0], L: pal.ice[1], W: pal.ice[2] });
    });
  }

  // ---- Lanterns floating over the water, clear of the moon.
  (pal.biome === "indigo" || pal.biome === "teal" ? [0.3, 0.46, 0.9] : []).forEach((at) => {
    overlays.lanterns.push({
      x: Math.round(w * (at + rand() * 0.03)),
      y: Math.round(horizonY * (0.3 + rand() * 0.3)),
      delay: (rand() * 3).toFixed(2),
    });
  });

  ctx.putImageData(img, 0, 0);
  return overlays;
}

/** Speech-bubble lantern, 5x4 art pixels, glowing and bobbing gently. */
function Lantern({ x, y, w, h, delay }) {
  return (
    <svg
      viewBox="0 0 5 5"
      shapeRendering="crispEdges"
      aria-hidden="true"
      className="pm-bob absolute drop-shadow-[0_0_6px_var(--color-primary-300)]"
      style={{ left: `${(x / w) * 100}%`, top: `${(y / h) * 100}%`, width: PX * 5, height: PX * 5, animationDelay: `${delay}s` }}
    >
      <rect x="0" y="0" width="5" height="3" className="fill-primary-100" />
      <rect x="1" y="3" width="1" height="1" className="fill-primary-100" />
      <rect x="1" y="1" width="1" height="1" className="fill-primary-500" />
      <rect x="3" y="1" width="1" height="1" className="fill-primary-500" />
    </svg>
  );
}

const at = (p, s) => ({ left: `${(p.x / s.w) * 100}%`, top: `${(p.y / s.h) * 100}%` });

/** A kite shaped like the PrivMeet mark, on a string down to the dock, swaying. */
function Kite({ kite, scene }) {
  return (
    <>
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${scene.w} ${scene.h}`}
        preserveAspectRatio="none"
      >
        <path
          d={`M${kite.x + 2.5} ${kite.y + 5} Q ${(kite.x + kite.anchorX) / 2} ${kite.y + 30} ${kite.anchorX} ${kite.anchorY}`}
          className="fill-none stroke-zinc-500"
          strokeWidth="0.35"
          strokeDasharray="1 1"
        />
      </svg>
      <svg viewBox="0 0 5 6" shapeRendering="crispEdges" aria-hidden="true" className="pm-bob absolute" style={{ ...at(kite, scene), width: PX * 5, height: PX * 6 }}>
        <rect x="0" y="0" width="5" height="3" className="fill-primary-500" />
        <rect x="1" y="3" width="1" height="1" className="fill-primary-500" />
        <rect x="1" y="1" width="1" height="1" className="fill-white" />
        <rect x="3" y="1" width="1" height="1" className="fill-white" />
        <rect x="2" y="4" width="1" height="1" className="fill-rose-400" />
        <rect x="3" y="5" width="1" height="1" className="fill-amber-300" />
      </svg>
    </>
  );
}

/**
 * Stars across the whole page background on dark themes, sparse at the top and denser toward
 * the horizon of the landscape below, a few twinkling. Nothing on light themes.
 */
export function PixelStars({ className }) {
  const box = useRef(null);
  const canvas = useRef(null);
  const [twinkles, setTwinkles] = useState([]);
  const [theme, setTheme] = useState(0);

  useEffect(() => {
    const obs = new MutationObserver(() => setTheme((t) => t + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "data-scene", "style"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const draw = () => {
      const c = canvas.current;
      const dark = document.documentElement.classList.contains("dark");
      const w = Math.max(10, Math.round(el.clientWidth / PX));
      const h = Math.max(10, Math.round(el.clientHeight / PX));
      c.width = w;
      c.height = h;
      const g = c.getContext("2d");
      g.clearRect(0, 0, w, h);
      if (!dark) {
        setTwinkles([]);
        return;
      }
      const star = palette().star;
      const rand = rng(97);
      const tw = [];
      for (let i = 0; i < w * h * 0.004; i += 1) {
        const x = Math.floor(rand() * w);
        const y = Math.floor(rand() ** 0.7 * h); // more stars lower down, toward the horizon
        const a = 0.15 + rand() * 0.55;
        g.fillStyle = `rgba(${star.join(",")},${a})`;
        g.fillRect(x, y, 1, 1);
        if (rand() < 0.04) {
          g.fillStyle = `rgba(${star.join(",")},${a * 0.5})`;
          g.fillRect(x - 1, y, 1, 1);
          g.fillRect(x + 1, y, 1, 1);
          g.fillRect(x, y - 1, 1, 1);
          g.fillRect(x, y + 1, 1, 1);
        }
        if (tw.length < 14 && rand() < 0.02) tw.push({ x, y, w, h, delay: (rand() * 3).toFixed(2) });
      }
      setTwinkles(tw);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [theme]);

  return (
    <div ref={box} aria-hidden="true" className={cx("pointer-events-none overflow-hidden", className)}>
      <canvas ref={canvas} className="absolute inset-0 h-full w-full [image-rendering:pixelated]" />
      {twinkles.map((t, i) => (
        <span
          key={i}
          className="pm-twinkle absolute size-1 bg-white shadow-[0_0_6px_1px_rgb(255_255_255/0.6)]"
          style={{ left: `${(t.x / t.w) * 100}%`, top: `${(t.y / t.h) * 100}%`, animationDelay: `${t.delay}s` }}
        />
      ))}
    </div>
  );
}

/** `scene`: "lake" (with the shore, mast, dock and floating lanterns) or "clouds" (still). */
export function PixelScape({ scene: kind = "lake", seed = 11, orbX = 0.68, className }) {
  const box = useRef(null);
  const canvas = useRef(null);
  const [scene, setScene] = useState(null);
  const [theme, setTheme] = useState(0);

  // Redraw when the theme changes (class or data-theme on <html>).
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme((t) => t + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "data-scene", "style"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    let last = "";
    const draw = () => {
      const w = Math.max(40, Math.round(el.clientWidth / PX));
      const h = Math.max(20, Math.round(el.clientHeight / PX));
      if (`${w}x${h}` === last) return; // same art size: nothing to redraw
      last = `${w}x${h}`;
      const c = canvas.current;
      c.width = w;
      c.height = h;
      const overlays = render(c.getContext("2d"), w, h, seed, { scene: kind, orbX }, palette());
      setScene({ w, h, ...overlays });
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [kind, seed, orbX, theme]);

  return (
    <div ref={box} aria-hidden="true" className={cx("pointer-events-none overflow-hidden", className)}>
      <canvas ref={canvas} className="absolute inset-0 h-full w-full [image-rendering:pixelated]" />
      {scene?.blinks.map((b, i) => (
        <span
          key={i}
          className={cx(
            "absolute size-1",
            b.color === "red"
              ? "pm-blink bg-red-500 shadow-[0_0_8px_2px_rgb(239_68_68/0.7)]"
              : "pm-twinkle bg-amber-200 shadow-[0_0_10px_3px_rgb(253_230_138/0.7)]",
          )}
          style={at(b, scene)}
        />
      ))}
      {scene?.sparks.map((s, i) => (
        <span
          key={`s${i}`}
          className="pm-twinkle absolute size-1 bg-yellow-200 shadow-[0_0_6px_2px_rgb(253_224_71/0.6)]"
          style={{ ...at(s, scene), animationDelay: `${s.delay}s` }}
        />
      ))}
      {scene?.lanterns.map((l, i) => (
        <Lantern key={`l${i}`} {...l} w={scene.w} h={scene.h} />
      ))}
      {scene?.beams.map((b, i) => (
        <span
          key={`b${i}`}
          className="pm-sweep absolute h-6 w-56 -translate-y-1/2 bg-gradient-to-r from-amber-100/70 to-transparent [clip-path:polygon(0_45%,100%_0,100%_100%,0_55%)]"
          style={at(b, scene)}
        />
      ))}
      {scene?.fires.map((f, i) => (
        <span
          key={`f${i}`}
          className="pm-flicker absolute h-3 w-2 -translate-x-1/2 -translate-y-full bg-gradient-to-t from-orange-500 via-amber-400 to-yellow-200 shadow-[0_0_14px_6px_rgb(251_146_60/0.45)] [clip-path:polygon(50%_0,100%_100%,0_100%)]"
          style={at(f, scene)}
        />
      ))}
      {scene?.kites.map((k, i) => (
        <Kite key={`k${i}`} kite={k} scene={scene} />
      ))}
      {scene?.planes.map((pl, i) => (
        <span key={`p${i}`} className="pm-drift absolute left-0" style={{ top: `${(pl.y / scene.h) * 100}%` }}>
          <svg viewBox="0 0 7 4" width={PX * 7} height={PX * 4} shapeRendering="crispEdges" aria-hidden="true">
            <path d="M0 0h1v1h1v1h2v1h3v1H0z" className="fill-white" />
            <path d="M1 1h1v1H1zM2 2h2v1H2z" className="fill-primary-200" />
          </svg>
        </span>
      ))}
    </div>
  );
}
