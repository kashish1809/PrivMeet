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
  if (document.documentElement.classList.contains("dark")) {
    return {
      dark: true,
      sky: [mix(z(950), p(950), 0.3), mix(p(950), z(950), 0.2), p(950), mix(p(900), violet, 0.3), mix(p(800), violet, 0.45)],
      celestial: mix(p(100), WHITE, 0.5),
      celestialDeep: mix(p(200), p(400), 0.4),
      glow: mix(p(500), violet, 0.3),
      star: WHITE,
      aurora: mix(p(300), [94, 234, 212], 0.55),
      cloud: [mix(p(300), WHITE, 0.15), mix(p(600), violet, 0.25), mix(p(800), violet, 0.2), mix(p(950), p(900), 0.4)],
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
    };
  }
  return {
    dark: false,
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
   * One cloud billow: a ball shaded from the light (sun or moon) in four tones with dithered
   * steps, a darker rim along its lower edge where it sits on the billow behind, and nothing
   * drawn below `floor` (so a cloud has a flat belly). `haze` pulls it toward the horizon.
   */
  const billow = (b, lightX, floor, haze = 0, hazeColor = null, flat = 0.82) => {
    const lx = Math.sign(lightX - b.c) * 0.45;
    const ly = -0.9;
    for (let y = Math.floor(b.cy - b.r * flat); y <= Math.min(floor, b.cy + b.r * flat); y += 1) {
      for (let x = Math.floor(b.c - b.r); x <= b.c + b.r; x += 1) {
        const nx = (x - b.c) / b.r;
        const ny = (y - b.cy) / (b.r * flat);
        const q = nx * nx + ny * ny;
        if (q > 1) continue;
        const v = nx * lx + ny * ly + (dither(x, y) - 0.5) * 0.16; // light falling on this pixel
        let c = v > 0.5 ? pal.cloud[0] : v > 0.05 ? pal.cloud[1] : v > -0.45 ? pal.cloud[2] : pal.cloud[3];
        if (q > 0.86 && ny > 0.1) c = mix(c, pal.cloud[3], 0.5); // rim on the shadow side
        if (haze) c = mix(c, hazeColor, haze);
        put(x, y, c);
      }
    }
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
  if (pal.dark) {
    for (let band = 0; band < 2; band += 1) {
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
      parts.sort((a, b) => b.r - a.r).reverse(); // small, low puffs behind the big middle ones
      parts.forEach((b) => billow(b, orb.x, belly));
      for (let x = Math.round(cx0 - span * 1.2); x <= cx0 + span * 1.2; x += 1) {
        if (get(x, belly)[0] !== get(x, belly - 1)[0]) continue;
        blend(x, belly, pal.cloud[3], 0.25); // a soft shadow line under the belly
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
    const snowAlt = hiPx * L.snow; // absolute altitude of the snowline
    for (let x = 0; x < w; x += 1) {
      const top = Math.round(horizonY - ridge.alt[x]);
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
      const mistY = horizonY - layers[li + 1].top * horizonY * 0.5;
      for (let y = Math.round(mistY - 3); y < mistY + 3; y += 1) {
        const t = 1 - Math.abs(y - mistY) / 3;
        for (let x = 0; x < w; x += 1) if (t * 0.4 * (0.6 + 0.4 * Math.sin(x * 0.04 + li)) > dither(x, y)) blend(x, y, pal.mist, 0.4);
      }
    }
  });

  const overlays = { lanterns: [], blinks: [], sparks: [] };

  if (!lake) {
    // ---- Sea of clouds: rows of shaded billows, back to front; each row sits on a solid mass
    // in shade, the next row covers its lower half, the farthest row is hazy.
    const rows = 2;
    for (let k = 0; k < rows; k += 1) {
      const baseY = h * (0.76 + k * 0.12);
      const haze = k === 0 ? 0.3 : 0;
      for (let y = Math.round(baseY); y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const t = (y - baseY) / (h - baseY);
          put(x, y, mix(t * 1.5 > dither(x, y) ? pal.cloud[3] : pal.cloud[2], horizonColor, haze));
        }
      }
      // big, flat billows in a loose row; the tallest drawn last so they sit in front
      const parts = [];
      for (let x = -14 + Math.floor(rand() * 10); x < w + 14; x += 11 + Math.floor(rand() * 9)) {
        const r = 9 + rand() * 8 - k * 2;
        parts.push({ c: x, cy: baseY - r * 0.2 + (rand() - 0.5) * 3, r });
      }
      parts.sort((a, b) => b.cy - a.cy).forEach((b) => billow(b, orb.x, h, haze, horizonColor, 0.62));
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

  // ---- Shores: a rocky outcrop on the left, a low bank on the right.
  const leftEnd = w * 0.24;
  const rightStart = w * 0.8;
  const rock = fractal(rand, w, 0.55);
  const shoreH = (x) => {
    if (x < leftEnd) return Math.round(h * (0.06 + 0.2 * (1 - x / leftEnd) ** 0.8) + rock[x] * 5);
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
    if (hash(x, 1, seed) > 0.45) {
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

  // ---- Lanterns floating over the water, clear of the moon.
  [0.3, 0.46, 0.9].forEach((at) => {
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
    </div>
  );
}
