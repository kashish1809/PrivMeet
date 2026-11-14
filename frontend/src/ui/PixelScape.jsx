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

function palette() {
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const p = (n) => readColor(probe, `--color-primary-${n}`, "#6366f1");
  const z = (n) => readColor(probe, `--color-zinc-${n}`, "#18181b");
  const violet = mix(p(500), [168, 85, 247], 0.45); // a second hue so the scene is not one tone
  const root = document.documentElement;
  // Which world the theme lives in; each has its own easter eggs (see render()).
  const biome = root.dataset.theme || (root.classList.contains("dark") ? "indigo" : "slate");
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
      // teal: a greener aurora over a fjord
      ...(biome === "teal" ? { aurora: mix(p(300), [110, 255, 170], 0.5) } : {}),
    };
  }
  return {
    dark: false,
    biome,
    sky: [mix(p(100), WHITE, 0.45), mix(p(100), WHITE, 0.2), p(100), mix(p(100), [255, 214, 186], 0.45), mix(p(200), [255, 190, 160], 0.55)],
    celestial: mix([255, 186, 84], p(200), 0.15),
    celestialDeep: mix([244, 114, 72], p(400), 0.2),
    glow: mix([255, 214, 160], p(100), 0.3),
    star: p(300),
    cloud: [WHITE, mix(WHITE, p(100), 0.55), mix(p(200), [255, 214, 196], 0.4), mix(p(300), p(400), 0.35)],
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

  /** Draw an ASCII sprite: each character is a key of `colors`, "." is transparent. */
  const sprite = (rows, x0, y0, colors) => {
    rows.forEach((row, dy) => {
      [...row].forEach((ch, dx) => {
        if (ch !== "." && colors[ch]) put(x0 + dx, y0 + dy, colors[ch]);
      });
    });
  };

  const lake = opts.scene === "lake";
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
    const count = Math.max(3, Math.round(w / 70));
    for (let i = 0; i < count; i += 1) {
      const cx0 = Math.round(w * ((i + 0.2 + rand() * 0.6) / count));
      const belly = Math.round(horizonY * (0.2 + rand() * (lake ? 0.32 : 0.22)));
      if (Math.abs(cx0 - orb.x) < orb.r * 4 && Math.abs(belly - orb.y) < orb.r * 3) continue;
      const span = 8 + Math.floor(rand() * 10);
      const parts = [];
      for (let k = -2; k <= 2; k += 1) {
        const r = span * (0.42 - Math.abs(k) * 0.08) * (0.85 + rand() * 0.3);
        parts.push({ c: cx0 + k * span * 0.42 + (rand() - 0.5) * 3, cy: belly - r * 0.35 - (2 - Math.abs(k)) * 1.5, r });
      }
      cloudMass(parts, orb.x, belly, 0.85);
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
  let perch = null;
  layers.forEach((L, li) => {
    const hiPx = L.hi * horizonY;
    const ridge = peaks(rand, w, Math.max(3, Math.round(L.count)), L.lo * horizonY, hiPx, L.steep);
    const tone = lake ? li : li + 1;
    const base = mix(pal.ridges[tone], horizonColor, L.fade);
    const lit = mix(base, pal.light, pal.dark ? 0.24 : 0.38);
    const shade = mix(base, pal.dark ? BLACK : pal.ridges[4], pal.dark ? 0.32 : 0.3);
    const desert = pal.biome === "amber";
    const snowAlt = desert ? Infinity : hiPx * L.snow; // absolute altitude of the snowline
    for (let x = 0; x < w; x += 1) {
      let altX = ridge.alt[x];
      // Desert mesas: each peak is cut off flat at its own height, leaving a table-top butte.
      if (desert && li < 4) altX = Math.min(altX, ridge.list[ridge.owner[x]].top * (0.55 + 0.25 * hash(ridge.owner[x], li, seed)));
      const top = Math.round(horizonY - altX);
      // remember the nearest mesa top around a third of the way in: the coyote stands there
      if (desert && li === 2 && x > w * 0.28 && x < w * 0.44 && (!perch || top < perch.y)) perch = { x, y: top };
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
    // ---- Sea of clouds: rows of shaded billows, back to front; each row sits on a solid mass
    // in shade, the next row covers its lower half, the farthest row is hazy.
    const rows = 3;
    for (let k = 0; k < rows; k += 1) {
      const floor = h - 1 + (k === rows - 1 ? 0 : 0);
      const baseY = h * (0.72 + k * 0.09);
      const haze = [0.45, 0.2, 0][k];
      const parts = [];
      for (let x = -16 + Math.floor(rand() * 10); x < w + 16; x += 9 + Math.floor(rand() * 10)) {
        const r = 7 + rand() * 8 - k;
        parts.push({ c: x, cy: baseY - r * 0.3 + (rand() - 0.5) * 4, r });
      }
      cloudMass(parts, orb.x, floor, 0.9, haze, horizonColor);
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
    // Cacti on the banks, a campfire on the outcrop, a coyote howling on a mesa.
    const cactus = ["..X..", "X.X..", "X.X.X", "XXX.X", "..XXX", "..X..", "..X.."];
    [0.12, 0.19, 0.86, 0.95].forEach((at2) => {
      const cxp = Math.round(w * at2);
      sprite(cactus, cxp - 2, h - shoreH(cxp) - 7, { X: pal.cactus });
    });
    const fx = Math.round(w * 0.16);
    const fy = h - shoreH(fx);
    sprite(["X...X", ".XXX."], fx - 2, fy - 2, { X: pal.wood });
    overlays.fires.push({ x: fx, y: fy - 3 });
    const coyote = ["......X.", ".....XX.", "X...XXX.", "XXXXXX..", "XXXXX...", "X.X.X..."];
    if (perch) sprite(coyote, perch.x - 4, perch.y - 6, { X: mix(pal.ground[1], BLACK, 0.3) });
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
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
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
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
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
