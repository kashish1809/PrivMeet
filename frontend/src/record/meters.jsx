import { useEffect, useRef } from "react";

import { cx } from "../ui";
import { level } from "./mixer";

/**
 * Run `draw(dt)` every animation frame while mounted. The meters write to the DOM or a canvas
 * directly, so the page does not re-render 60 times a second.
 */
function useFrames(draw, active = true) {
  const fn = useRef(draw);
  fn.current = draw;
  useEffect(() => {
    if (!active) return undefined;
    let id = 0;
    const loop = () => {
      fn.current();
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [active]);
}

/**
 * Five-bar mic level, like the "You" tile in the mockup. Also exposes the level to `onLevel`
 * (0..1, ~60 times a second) so the tile can light its ring while someone speaks.
 */
export function LevelMeter({ analyser, muted, className, onLevel }) {
  const bars = useRef([]);
  const buffer = useRef(null);
  useFrames(() => {
    if (!analyser) return;
    if (!buffer.current || buffer.current.length !== analyser.fftSize) buffer.current = new Uint8Array(analyser.fftSize);
    const v = muted ? 0 : level(analyser, buffer.current);
    onLevel?.(v);
    bars.current.forEach((el, i) => {
      if (!el) return;
      const on = v > (i + 0.5) / 6;
      el.style.transform = `scaleY(${on ? 1 : 0.35})`;
      el.style.opacity = on ? "1" : "0.35";
    });
  }, !!analyser);

  return (
    <span className={cx("inline-flex h-4 items-center gap-0.5", className)} aria-hidden="true">
      {[0.45, 0.7, 1, 0.7, 0.45].map((h, i) => (
        <span
          key={i}
          ref={(el) => {
            bars.current[i] = el;
          }}
          className="w-[3px] origin-center rounded-full bg-primary-400 transition-[transform,opacity] duration-75"
          style={{ height: `${h * 100}%`, transform: "scaleY(0.35)", opacity: 0.35 }}
        />
      ))}
    </span>
  );
}

/**
 * Scrolling waveform of everything being recorded (mic + shared audio), in the accent color
 * of the current theme. Draws a bar per frame and scrolls left; frozen while `paused`.
 */
export function Waveform({ analyser, paused, className, label = "Recording waveform" }) {
  const canvas = useRef(null);
  const buffer = useRef(null);
  const history = useRef([]);

  useFrames(() => {
    const el = canvas.current;
    if (!el || !analyser) return;
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (el.width !== Math.round(w * dpr)) el.width = Math.round(w * dpr);
    if (el.height !== Math.round(h * dpr)) el.height = Math.round(h * dpr);
    if (!buffer.current) buffer.current = new Uint8Array(analyser.fftSize);

    const step = 4; // px per bar (3 px bar + 1 px gap)
    const max = Math.ceil(w / step);
    if (!paused) {
      history.current.push(level(analyser, buffer.current));
      if (history.current.length > max) history.current.splice(0, history.current.length - max);
    }

    const g = el.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    // Read the accent from the theme so the four presets re-color the canvas too.
    const styles = getComputedStyle(el);
    g.fillStyle = styles.getPropertyValue("--wave-color").trim() || "#6366f1";
    const data = history.current;
    const x0 = w - data.length * step;
    for (let i = 0; i < data.length; i += 1) {
      const bar = Math.max(2, data[i] * (h - 4));
      g.globalAlpha = paused ? 0.35 : 0.45 + 0.55 * (i / data.length);
      g.fillRect(x0 + i * step, (h - bar) / 2, 3, bar);
    }
  }, !!analyser);

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={label}
      className={cx("block h-16 w-full [--wave-color:var(--color-primary-500)]", className)}
    />
  );
}
