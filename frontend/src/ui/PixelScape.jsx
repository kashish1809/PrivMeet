import { useEffect, useRef, useState } from "react";

import { cx } from "./cx";

/**
 * PrivMeet's pixel landscape: a moonlit lake under layered mountains, drawn pixel by pixel on
 * a small canvas and scaled up with crisp edges (each art pixel is PX CSS pixels).
 *
 * - Sky in stepped bands, joined with ordered (Bayer) dithering. Dark themes get the moon
 *   and stars; light themes a banded sun with rays and pixel clouds.
 * - Mountains as triangle peaks: a face lit by the moon and a face in shadow, moonlit caps on
 *   the tall ones, rock streaks, and farther ridges fading into the sky.
 * - The lake mirrors the ridges; the moon's reflection breaks into an audio waveform.
 * - On the shore a radio mast sends signal arcs, and speech-bubble lanterns (the PrivMeet mark)
 *   float over the water.
 *
 * Every color is read from the theme's --color-primary-* and --color-zinc-* variables, so the
 * presets re-tint it; it redraws only when the theme or the size changes (never per frame).
 * The only motion is CSS (a blinking light, bobbing lanterns), off for reduced motion.
 */

const PX = 4; // CSS pixels per art pixel
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const dither = (x, y) => BAYER[(y % 4) * 4 + (x % 4)];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
  const dark = document.documentElement.classList.contains("dark");
  if (dark) {
    const horizon = mix(p(900), p(600), 0.45);
    return {
      dark,
      skyTop: mix(z(950), p(950), 0.35),
      skyMid: mix(p(950), p(900), 0.4),
      horizon,
      moon: mix(p(100), WHITE, 0.4),
      glow: p(400),
      star: WHITE,
      layers: [mix(horizon, p(700), 0.45), mix(p(800), p(900), 0.3), mix(p(950), p(900), 0.35), mix(z(950), p(950), 0.45)],
      cap: mix(p(200), WHITE, 0.35),
      water: mix(z(950), p(950), 0.55),
      shore: mix(z(950), BLACK, 0.3),
      metal: p(300),
    };
  }
  const horizon = mix(p(200), p(300), 0.35);
  return {
    dark,
    skyTop: mix(p(50), WHITE, 0.55),
    skyMid: p(100),
    horizon,
    // Daytime: a warm sun (the accent pulled toward amber) and clouds instead of stars.
    moon: mix([255, 178, 76], p(300), 0.18),
    sunDeep: mix([240, 108, 68], p(500), 0.22),
    glow: mix([255, 210, 150], p(100), 0.35),
    star: p(300),
    cloud: mix(WHITE, p(50), 0.3),
    cloudShade: mix(p(100), p(200), 0.4),
    layers: [mix(horizon, p(300), 0.6), mix(p(300), p(400), 0.5), mix(p(500), p(600), 0.3), mix(p(700), p(800), 0.4)],
    cap: WHITE,
    water: mix(p(200), p(300), 0.55),
    shore: mix(p(800), p(900), 0.5),
    metal: p(700),
  };
}

/** Peaks for one ridge: triangles with a little ragged noise along the slopes. */
function ridgeLayer(rand, w, { count, minH, maxH, slope }) {
  const peaks = [];
  for (let i = 0; i < count; i += 1) {
    peaks.push({
      c: Math.round(((i + 0.2 + rand() * 0.6) / count) * w),
      h: minH + rand() * (maxH - minH),
      s: slope * (0.75 + rand() * 0.5),
    });
  }
  const height = new Float32Array(w);
  const owner = new Int16Array(w);
  for (let x = 0; x < w; x += 1) {
    let best = -1;
    let bi = 0;
    peaks.forEach((pk, i) => {
      const v = pk.h - Math.abs(x - pk.c) * pk.s;
      if (v > best) {
        best = v;
        bi = i;
      }
    });
    height[x] = Math.max(0, best + (rand() - 0.5) * 1.6);
    owner[x] = bi;
  }
  return { peaks, height, owner };
}

/** Draw the whole scene into the canvas; returns the positions of the animated overlays. */
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

  const horizonY = Math.round(h * (opts.lake ? 0.72 : 0.98));
  const moon = {
    x: Math.round(w * opts.moonX),
    y: Math.round(h * opts.moonY),
    r: Math.max(4, Math.round(h * (pal.dark ? 0.085 : 0.11))), // the sun a little bigger
  };

  // Sky: 6 bands from top to horizon, dithered where two bands meet.
  const bands = 6;
  const bandColor = (k) => {
    const u = k / (bands - 1);
    return u < 0.55 ? mix(pal.skyTop, pal.skyMid, u / 0.55) : mix(pal.skyMid, pal.horizon, (u - 0.55) / 0.45);
  };
  for (let y = 0; y < horizonY; y += 1) {
    const f = (y / horizonY) * (bands - 1);
    const band = Math.floor(f);
    const a = bandColor(band);
    const b = bandColor(Math.min(bands - 1, band + 1));
    for (let x = 0; x < w; x += 1) put(x, y, f - band > dither(x, y) ? b : a);
  }

  // Halo: dithered rings that thin out with distance (both sun and moon).
  const reach = pal.dark ? 4 : 5;
  for (let y = moon.y - moon.r * reach; y <= moon.y + moon.r * reach; y += 1) {
    for (let x = moon.x - moon.r * reach; x <= moon.x + moon.r * reach; x += 1) {
      if (y < 0 || y >= horizonY || x < 0 || x >= w) continue;
      const dist = Math.hypot(x - moon.x, y - moon.y) / moon.r;
      if (dist <= 1) continue;
      const strength = Math.max(0, 1 - (dist - 1) / (reach - 1)) * (pal.dark ? 0.55 : 0.7);
      if (strength > dither(x, y)) put(x, y, mix(get(x, y), pal.glow, pal.dark ? 0.35 : 0.5));
    }
  }
  if (pal.dark) {
    // Moon: a pale disc, the lower right in shade, three craters.
    for (let y = -moon.r; y <= moon.r; y += 1) {
      for (let x = -moon.r; x <= moon.r; x += 1) {
        if (x * x + y * y > moon.r * moon.r + 1) continue;
        let c = (x + y) / moon.r > 0.75 ? mix(pal.moon, pal.glow, 0.35) : pal.moon;
        if ((x - 2) ** 2 + (y + 1) ** 2 < 3 || (x + 2) ** 2 + (y - 2) ** 2 < 2 || (x + 1) ** 2 + (y + 3) ** 2 < 1.5)
          c = mix(pal.moon, pal.glow, 0.25);
        put(moon.x + x, moon.y + y, c);
      }
    }
  } else {
    // Sun: short pixel rays in eight directions, then the disc, warm at the top and deeper at
    // the bottom, its lower half cut by bands that let the sky through.
    for (let k = 0; k < 8; k += 1) {
      const a = (k * Math.PI) / 4 + Math.PI / 8;
      for (let t = moon.r + 2; t <= moon.r + 4 + (k % 2) * 2; t += 1) {
        put(Math.round(moon.x + Math.cos(a) * t), Math.round(moon.y + Math.sin(a) * t), mix(pal.moon, pal.glow, 0.3));
      }
    }
    for (let y = -moon.r; y <= moon.r; y += 1) {
      if (y > 0 && y % 3 === 1 && y < moon.r) continue; // the bands
      for (let x = -moon.r; x <= moon.r; x += 1) {
        if (x * x + y * y > moon.r * moon.r + 1) continue;
        const t = (y + moon.r) / (2 * moon.r);
        put(moon.x + x, moon.y + y, t > 0.55 ? (t - 0.55) * 2.2 > dither(moon.x + x, moon.y + y) ? pal.sunDeep : pal.moon : pal.moon);
      }
    }
  }

  // Stars, a few with a cross shape.
  const starCount = Math.round(w * (pal.dark ? 0.14 : 0.04));
  for (let i = 0; i < starCount; i += 1) {
    const x = Math.floor(rand() * w);
    const y = Math.floor(rand() * horizonY * 0.62);
    if (Math.hypot(x - moon.x, y - moon.y) < moon.r * 2.2) continue;
    put(x, y, mix(get(x, y), pal.star, pal.dark ? 0.55 + rand() * 0.45 : 0.6));
    if (pal.dark && rand() < 0.08) {
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => put(x + dx, y + dy, mix(get(x + dx, y + dy), pal.star, 0.4)));
    }
  }

  // Clouds by day: stacked rounded puffs, lit on top, shaded underneath.
  if (!pal.dark) {
    const clouds = Math.max(2, Math.round(w / 90));
    for (let i = 0; i < clouds; i += 1) {
      const cx0 = Math.round(w * ((i + 0.3 + rand() * 0.4) / clouds));
      const cy0 = Math.round(horizonY * (0.18 + rand() * 0.32));
      if (Math.abs(cx0 - moon.x) < moon.r * 3 && Math.abs(cy0 - moon.y) < moon.r * 2) continue;
      const puffs = [[0, 0, 5], [-6, 2, 4], [6, 2, 4], [-11, 4, 2.5], [11, 4, 3]];
      for (let y = cy0 - 6; y <= cy0 + 6; y += 1) {
        for (let x = cx0 - 15; x <= cx0 + 15; x += 1) {
          const inside = puffs.some(([dx, dy, r]) => (x - cx0 - dx) ** 2 + ((y - cy0 - dy) * 1.6) ** 2 <= r * r * 2.2);
          if (!inside || y > cy0 + 5) continue;
          const under = y - cy0 > 2;
          put(x, y, under && (y - cy0 - 2) / 3 > dither(x, y) ? pal.cloudShade : pal.cloud);
        }
      }
    }
  }

  // Mountains, far to near.
  const scale = opts.lake ? 1 : 0.8;
  const specs = [
    { count: Math.max(3, Math.round(w / 55)), minH: 0.22, maxH: 0.42, slope: 0.85, fade: 0.55 },
    { count: Math.max(3, Math.round(w / 45)), minH: 0.16, maxH: 0.34, slope: 1.0, fade: 0.32 },
    { count: Math.max(4, Math.round(w / 36)), minH: 0.1, maxH: 0.24, slope: 1.15, fade: 0.12 },
    { count: Math.max(5, Math.round(w / 28)), minH: 0.05, maxH: 0.13, slope: 1.35, fade: 0 },
  ];
  specs.forEach((spec, li) => {
    const layer = ridgeLayer(rand, w, { ...spec, minH: spec.minH * h * scale, maxH: spec.maxH * h * scale });
    const base = mix(pal.layers[li], pal.horizon, spec.fade);
    const lit = mix(base, pal.moon, pal.dark ? 0.16 : 0.35);
    const shade = mix(base, pal.dark ? BLACK : pal.layers[3], 0.27);
    const tallest = Math.max(...layer.peaks.map((pk) => pk.h));
    for (let x = 0; x < w; x += 1) {
      const top = Math.round(horizonY - layer.height[x]);
      const pk = layer.peaks[layer.owner[x]];
      const facesMoon = Math.sign(x - pk.c) === Math.sign(moon.x - pk.c) || x === pk.c;
      for (let y = Math.max(0, top); y < horizonY; y += 1) {
        const depth = y - top;
        let c = facesMoon ? lit : shade;
        // rock streaks: short diagonal runs of the other tone
        if (depth > 2 && (x * 3 + y * (facesMoon ? 1 : -1) + li * 7) % 17 === 0) c = mix(c, facesMoon ? shade : lit, 0.5);
        // the ridge spine running down from each peak, wobbling a little
        if (depth < pk.h * 0.6 && x === pk.c + Math.round(Math.sin(depth * 0.45 + li) * 1.2)) c = mix(c, lit, 0.55);
        // speckle on the shadow side, so it reads as rock and not a flat fill
        if (!facesMoon && dither(x + li, y) < 0.07) c = mix(c, lit, 0.3);
        // each ridge darkens toward its foot, dithered
        const low = depth / Math.max(1, horizonY - top);
        if (low > 0.6 && (low - 0.6) / 0.6 > dither(x, y)) c = mix(c, shade, 0.5);
        // caps on the tall peaks, with a ragged lower edge
        if (li < 3 && pk.h > tallest * 0.62 && depth < pk.h * 0.16 + ((x * 7 + li) % 3) - 1)
          c = facesMoon ? pal.cap : mix(pal.cap, shade, 0.45);
        put(x, y, c);
      }
    }
  });

  const overlays = { lanterns: [], mast: null };

  if (opts.lake) {
    // Water: a mirror of everything above the horizon, darkened, broken by ripple rows.
    for (let y = horizonY; y < h; y += 1) {
      const dy = y - horizonY;
      const src = horizonY - 1 - Math.round(dy * 1.15);
      const ripple = (y + Math.floor(rand() * 2)) % 3 === 0;
      for (let x = 0; x < w; x += 1) {
        let c = pal.water;
        if (src >= 0) c = mix(get(x + (ripple ? 1 : 0), src), pal.water, 0.55 + Math.min(0.35, dy / (h - horizonY)));
        if (ripple && (x + y * 5) % 11 < 4) c = mix(c, pal.water, 0.6);
        if (ripple && rand() < 0.012) c = mix(c, pal.glow, 0.6); // glints
        put(x, y, c);
      }
    }
    // The moon's path on the water as waveform bars: loud in bursts, quieter farther out.
    for (let y = horizonY + 1; y < h; y += 2) {
      const t = (y - horizonY) / (h - horizonY);
      const amp = (0.35 + 0.65 * Math.abs(Math.sin(y * 0.9 + 0.4))) * (0.55 + 0.45 * Math.sin(y * 0.23)) * (1 - t * 0.35);
      const half = Math.max(1, Math.round(moon.r * 1.3 * amp));
      for (let x = moon.x - half; x <= moon.x + half; x += 1) {
        put(x, y, mix(pal.moon, pal.water, (Math.abs(x - moon.x) / (half + 1)) * 0.55 + t * 0.25));
      }
    }
    // Shore on both sides with reeds.
    const shoreH = (x) => {
      const left = Math.max(0, 1 - x / (w * 0.22));
      const right = Math.max(0, (x - w * 0.84) / (w * 0.16));
      return Math.round((left * 0.2 + right * 0.15) * h + Math.sin(x * 0.5) * 1.2 * (left + right));
    };
    for (let x = 0; x < w; x += 1) {
      const sh = shoreH(x);
      for (let y = h - sh; y < h; y += 1) put(x, y, pal.shore);
      if (sh > 2 && rand() < 0.45) {
        const reed = 2 + Math.floor(rand() * 5);
        for (let y = h - sh - reed; y < h - sh; y += 1) put(x, y, mix(pal.shore, pal.horizon, 0.15));
      }
    }
    // Radio mast on the left shore: a lattice tower sending signal arcs.
    const mx = Math.round(w * 0.085);
    const mBase = h - shoreH(mx);
    const mH = Math.round(h * 0.34);
    const mTop = mBase - mH;
    for (let y = mTop; y < mBase; y += 1) {
      const spread = Math.round(((y - mTop) / mH) * 2);
      put(mx - spread, y, pal.shore);
      put(mx + spread, y, pal.shore);
      if ((mBase - y) % 3 === 0) for (let x = mx - spread; x <= mx + spread; x += 1) put(x, y, pal.shore);
    }
    [5, 8].forEach((r, i) => {
      for (let a = -0.9; a <= 0.9; a += 0.08) {
        const y = Math.round(mTop - 1 + Math.sin(a) * r);
        for (const x of [Math.round(mx + Math.cos(a) * r), Math.round(mx - Math.cos(a) * r)]) {
          put(x, y, mix(get(x, y), pal.metal, 0.75 - i * 0.25));
        }
      }
    });
    overlays.mast = { x: mx, y: mTop - 1 };
    // Spread over the sky, kept clear of the moon.
    [0.24, 0.42, 0.88].forEach((at) => {
      overlays.lanterns.push({
        x: Math.round(w * (at + rand() * 0.04)),
        y: Math.round(horizonY * (0.35 + rand() * 0.3)),
        delay: (rand() * 3).toFixed(2),
      });
    });
  } else {
    overlays.lanterns.push({ x: Math.round(w * 0.5), y: Math.round(h * 0.28), delay: "0.4" });
  }

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

export function PixelScape({ seed = 11, lake = true, moonX = 0.68, moonY = 0.3, className }) {
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
      const key = `${w}x${h}`;
      if (key === last) return; // resize to the same art size: nothing to do
      last = key;
      const c = canvas.current;
      c.width = w;
      c.height = h;
      const overlays = render(c.getContext("2d"), w, h, seed, { lake, moonX, moonY }, palette());
      setScene({ w, h, ...overlays });
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [seed, lake, moonX, moonY, theme]);

  return (
    <div ref={box} aria-hidden="true" className={cx("pointer-events-none overflow-hidden", className)}>
      <canvas ref={canvas} className="absolute inset-0 h-full w-full [image-rendering:pixelated]" />
      {scene?.mast && (
        <span
          className="pm-blink absolute size-1 bg-red-500 shadow-[0_0_8px_2px_rgb(239_68_68/0.7)]"
          style={{ left: `${(scene.mast.x / scene.w) * 100}%`, top: `${(scene.mast.y / scene.h) * 100}%` }}
        />
      )}
      {scene?.lanterns.map((l, i) => (
        <Lantern key={i} {...l} w={scene.w} h={scene.h} />
      ))}
    </div>
  );
}
